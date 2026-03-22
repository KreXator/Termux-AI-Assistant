/**
 * nlRouter.js — Unified natural-language message router
 *
 * Replaces the fragmented intentHandler + needsSearch + NL routing regex approach.
 * Every plain-text message gets classified in one fast LLM call into:
 *
 *   bot_command  — bot configuration/management (schedules, reminders, notes, etc.)
 *   web_search   — needs live/current data (weather, news, prices, sports)
 *   chat         — everything else (conversation, coding, questions from training data)
 *
 * Falls back to { type: 'chat' } on any error or timeout — never breaks the bot.
 */
'use strict';

const openrouter = require('../llm/openrouter');
const ollama     = require('../llm/ollama');

const ROUTE_TIMEOUT_MS = 8_000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a router for a personal Telegram AI assistant bot.
The user speaks Polish or English.
Classify the user's message into exactly one route.

Routes:
- "bot_command" — user wants to manage the bot: add/list schedules, reminders, notes, todos, memory facts, RSS feeds, briefings
- "web_search"  — user needs live/current data: weather, today's news, stock prices, crypto rates, sports results, anything that changes over time
- "chat"        — everything else: questions answered from training data, conversation, coding help, creative tasks, explanations, "how does X work?"

Return ONLY valid JSON. No prose, no markdown, no code block.

JSON schema:
{"type": "bot_command|web_search|chat", "intent": "<intent or null>", "lang": "pl|en", "params": {}}

lang: "pl" if the user wrote in Polish, "en" if in English.

For "web_search" and "chat": intent must be null, params must be {}.
For "bot_command": include the specific intent and extracted parameters.

Supported bot_command intents and params:
- list_todos            {}
- list_notes            {}
- list_reminders        {}
- list_memory           {}
- list_schedules        {}
- list_feeds            {}
- briefing_add_feed     {"url": "https://...", "label": "name", "category": "jobs|news|tech|general"}
- briefing_on           {}
- briefing_off          {}
- briefing_time_morning {"time": "HH:MM", "enable": true|false}
- briefing_time_evening {"time": "HH:MM", "enable": true|false}
- briefing_keywords_add {"keyword": "phrase in lowercase"}
- briefing_keywords_remove {"keyword": "phrase in lowercase"}
- briefing_run_now      {"type": "morning|evening"}
- schedule_add          {"time": "HH:MM", "query": "search query string"}
- remind                {"when": "30min|2h|45s|HH:MM", "text": "reminder message"}
- remember              {"fact": "fact about the user in third person, Polish"}

Time normalization rules:
- "za 30 minut" → "30min"
- "za 2 godziny" → "2h"
- "za pół godziny" → "30min"
- "o 7:30" → "07:30"
- Always zero-pad hours: "7:30" → "07:30"

CRITICAL — use "chat" (not "bot_command") for:
- Questions about how things work: "jak działa RSS?", "co to jest briefing?"
- Code-related tasks: "dodaj mi komentarz", "napisz funkcję"
- General conversation, greetings, opinions
- Planning real-world activities: "zaplanuj trasę", "zaplanuj wyjazd", "zaplanuj dzień", "zaplanuj projekt", "stwórz plan" — these are NOT schedule_add!
- schedule_add is ONLY for "zaplanuj automatyczne wyszukiwanie o HH:MM [query]"

CRITICAL — use "web_search" for:
- Weather: "pogoda", "jaka pogoda", "sprawdź pogodę"
- Today/current/live: "dzisiaj", "teraz", "aktualnie", "today", "right now", "latest"
- News: "wiadomości", "aktualności", "news", "headlines"
- Prices/rates: "kurs", "cena", "bitcoin", "btc", "eth", "crypto", "notowania"
- Sports: "kto wygrał", "wyniki meczu", "tabela ligowa", "who won"
- Any factual query needing up-to-date data

Examples:
"Pokaż moje zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"pokaż zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"moje zadania" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"lista zadań" → {"type":"bot_command","intent":"list_todos","lang":"pl","params":{}}
"moje notatki" → {"type":"bot_command","intent":"list_notes","lang":"pl","params":{}}
"lista przypomnień" → {"type":"bot_command","intent":"list_reminders","lang":"pl","params":{}}
"zaplanowane wyszukiwania" → {"type":"bot_command","intent":"list_schedules","lang":"pl","params":{}}
"pokaż feedy RSS" → {"type":"bot_command","intent":"list_feeds","lang":"pl","params":{}}
"moja pamięć" → {"type":"bot_command","intent":"list_memory","lang":"pl","params":{}}
"show my todos" → {"type":"bot_command","intent":"list_todos","lang":"en","params":{}}
"dodaj feed https://justjoin.it/rss.xml jako justjoinit z kategorią jobs" → {"type":"bot_command","intent":"briefing_add_feed","lang":"pl","params":{"url":"https://justjoin.it/rss.xml","label":"justjoinit","category":"jobs"}}
"włącz poranne raporty" → {"type":"bot_command","intent":"briefing_on","lang":"pl","params":{}}
"wyłącz raporty" → {"type":"bot_command","intent":"briefing_off","lang":"pl","params":{}}
"ustaw poranny raport na 7:30" → {"type":"bot_command","intent":"briefing_time_morning","lang":"pl","params":{"time":"07:30","enable":false}}
"włącz poranny raport o 7:30" → {"type":"bot_command","intent":"briefing_time_morning","lang":"pl","params":{"time":"07:30","enable":true}}
"odpal briefing" → {"type":"bot_command","intent":"briefing_run_now","lang":"pl","params":{"type":"morning"}}
"odpal wieczorny briefing" → {"type":"bot_command","intent":"briefing_run_now","lang":"pl","params":{"type":"evening"}}
"zaplanuj wyszukiwanie o 9:00 oferty pracy Node.js" → {"type":"bot_command","intent":"schedule_add","lang":"pl","params":{"time":"09:00","query":"oferty pracy Node.js"}}
"zaplanuj trasę rowerową 10 km" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"zaplanuj mi dzień" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"zaplanuj wyjazd do Krakowa" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"przypomnij mi za 30 minut o spotkaniu" → {"type":"bot_command","intent":"remind","lang":"pl","params":{"when":"30min","text":"spotkanie"}}
"remind me in 2 hours to send the report" → {"type":"bot_command","intent":"remind","lang":"en","params":{"when":"2h","text":"send the report"}}
"zapamiętaj że szukam pracy zdalnej" → {"type":"bot_command","intent":"remember","lang":"pl","params":{"fact":"Szuka pracy zdalnej"}}
"remember I prefer concise answers" → {"type":"bot_command","intent":"remember","lang":"en","params":{"fact":"Prefers concise answers"}}
"sprawdź pogodę w Warszawie" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"jaka jest pogoda dzisiaj?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"kurs bitcoina" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"jakie są dzisiejsze wiadomości?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"kto wygrał mecz dziś?" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"aktualny kurs EUR/PLN" → {"type":"web_search","intent":null,"lang":"pl","params":{}}
"Jakie masz możliwości?" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"napisz mi funkcję w Python" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"jak działa RSS?" → {"type":"chat","intent":null,"lang":"pl","params":{}}
"co to jest briefing?" → {"type":"chat","intent":null,"lang":"pl","params":{}}`;

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(text) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: text },
  ];
  try {
    return await openrouter.complete(openrouter.OR_MODEL_SMALL, messages);
  } catch {
    try {
      return await ollama.completeRaw(process.env.MODEL_SMALL || 'qwen2.5:3b-instruct-q4_K_M', messages);
    } catch {
      return null;
    }
  }
}

// ─── Parse LLM response ───────────────────────────────────────────────────────

const KNOWN_INTENTS = new Set([
  'list_todos', 'list_notes', 'list_reminders', 'list_memory', 'list_schedules', 'list_feeds',
  'briefing_add_feed', 'briefing_on', 'briefing_off',
  'briefing_time_morning', 'briefing_time_evening',
  'briefing_keywords_add', 'briefing_keywords_remove',
  'briefing_run_now', 'schedule_add', 'remind', 'remember',
]);

function parse(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);

    const type = obj.type;
    if (type !== 'bot_command' && type !== 'web_search' && type !== 'chat') return null;

    if (type === 'bot_command') {
      if (!obj.intent || !KNOWN_INTENTS.has(obj.intent)) return null;
      return {
        type,
        intent: obj.intent,
        lang: obj.lang === 'en' ? 'en' : 'pl',
        params: obj.params || {},
      };
    }

    // web_search or chat
    return { type, intent: null, lang: obj.lang === 'en' ? 'en' : 'pl', params: {} };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a plain-text message into a routing decision.
 * Always resolves — never throws.
 * @param {string} text
 * @returns {Promise<{type: 'bot_command'|'web_search'|'chat', intent: string|null, lang: string, params: object}>}
 */
async function route(text) {
  try {
    const raw = await Promise.race([
      callLLM(text),
      new Promise((_, rej) => setTimeout(() => rej(new Error('router timeout')), ROUTE_TIMEOUT_MS)),
    ]);
    return parse(raw) || { type: 'chat', intent: null, lang: 'pl', params: {} };
  } catch {
    return { type: 'chat', intent: null, lang: 'pl', params: {} };
  }
}

module.exports = { route };
