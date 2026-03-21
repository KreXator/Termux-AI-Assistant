/**
 * intentHandler.js — Natural language intent detection for bot configuration
 *
 * Intercepts plain-text messages that look like bot-config commands and
 * translates them to structured actions, so the user doesn't need slash commands.
 *
 * Only runs when a message contains trigger patterns — zero overhead for normal chat.
 */
'use strict';

const openrouter = require('../llm/openrouter');
const ollama     = require('../llm/ollama');

// ─── Trigger gate ─────────────────────────────────────────────────────────────
// Uses specific multi-word patterns to avoid false positives on conversational text.
// Single-word triggers only when the word is highly specific to bot commands.

const TRIGGER_RE = new RegExp([
  // Reminders — high specificity, Polish + English
  'przypomnij\\s+mi',
  'przypomnij\\s+o',
  'ustaw\\s+przypomnienie',
  'remind\\s+me',
  'set\\s+a\\s+reminder',
  // Relative time patterns that strongly indicate reminder intent
  'za\\s+\\d+\\s*(minut|min|godzin|godz|sekund|sek|h)',
  'za\\s+pół\\s+godziny',
  'za\\s+chwilę',

  // Memory — high specificity
  'zapamiętaj\\s+(że|sobie|iż)',
  'pamiętaj\\s+że',
  'zapisz\\s+że',
  'zanotuj\\s+że',
  'remember\\s+that',
  'note\\s+that',

  // Briefing run now
  'odpal\\s+briefing',
  'uruchom\\s+briefing',
  'wyślij\\s+briefing',
  'pokaż\\s+briefing',
  'daj\\s+briefing',
  'run\\s+briefing',
  'send\\s+briefing',
  'briefing\\s+now',
  'briefing\\s+teraz',

  // Briefing feeds — add/remove/list
  'dodaj\\s+feed',
  'dodaj\\s+rss',
  'add\\s+feed',
  'subscribe\\s+to',
  'subskrybuj',
  'usuń\\s+feed',
  'remove\\s+feed',
  'delete\\s+feed',
  'moje\\s+feedy',
  'lista\\s+feed',
  'pokaż\\s+feedy',
  'jakie\\s+mam\\s+feed',
  'podaj\\s+feedy',
  'show\\s+(my\\s+)?feeds',
  'list\\s+(my\\s+)?feeds',

  // Briefing on/off
  'włącz\\s+(raporty|briefing|poranne|wieczorne|poranny|wieczorny)',
  'wyłącz\\s+(raporty|briefing|poranne|wieczorne|poranny|wieczorny)',
  'aktywuj\\s+(raporty|briefing)',
  'dezaktywuj\\s+(raporty|briefing)',
  'enable\\s+(briefing|reports)',
  'disable\\s+(briefing|reports)',
  'turn\\s+on\\s+(briefing|reports)',
  'turn\\s+off\\s+(briefing|reports)',

  // Briefing time configuration
  'ustaw\\s+(poranny|wieczorny|poranne|wieczorne)\\s+raport',
  'zmień\\s+godzinę\\s+(porannego|wieczornego)',
  'poranny\\s+raport\\s+o',
  'wieczorny\\s+raport\\s+o',
  'morning\\s+(report|briefing)\\s+at',
  'evening\\s+(report|briefing)\\s+at',
  'set\\s+(morning|evening)\\s+(report|briefing)',
  'morning\\s+at\\s+\\d',
  'evening\\s+at\\s+\\d',

  // Briefing keywords / filters
  'filtruj\\s+(oferty|stanowiska|po)',
  'dodaj\\s+(filtr|słowo\\s+kluczowe|keyword)',
  'usuń\\s+(filtr|słowo\\s+kluczowe|keyword)',
  'add\\s+(keyword|filter)',
  'remove\\s+(keyword|filter)',
  'filter\\s+(jobs|offers)',
  'szukaj\\s+tylko',
  'pokaż\\s+tylko\\s+(oferty|stanowiska)',

  // Scheduled searches
  'zaplanuj\\s+(codzienne|wyszukiwanie|harmonogram)',
  'schedule\\s+(daily|search)',
  'codziennie\\s+o\\s+\\d',
  'every\\s+day\\s+at',
  'dodaj\\s+harmonogram',
].join('|'), 'i');

// ─── Intent classification prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intent classifier for a personal Telegram AI assistant bot.
Your only job: extract the user's bot-configuration intent from their message.
The user speaks Polish or English.
Return ONLY valid JSON — no prose, no markdown, no code block, no backticks.

Supported intents:
- briefing_add_feed      → add an RSS feed to daily briefing
- briefing_on            → enable daily briefing reports
- briefing_off           → disable daily briefing reports
- briefing_time_morning  → set morning briefing time (also enable if user says "włącz o X")
- briefing_time_evening  → set evening briefing time
- briefing_keywords_add  → add keyword filter for job offers
- briefing_keywords_remove → remove keyword filter
- briefing_list_feeds    → list all configured RSS feeds
- briefing_run_now      → trigger morning or evening briefing immediately
- schedule_add           → add a daily recurring web search at a specific time
- remind                 → set a one-time reminder
- remember               → save a persistent fact about the user
- none                   → regular conversation, question, or unrecognized request

JSON schema:
{"intent": "<intent>", "lang": "pl|en", "params": <params object>}

lang: "pl" if the user wrote in Polish, "en" if in English.

Params per intent:
- briefing_add_feed:      {"url": "https://...", "label": "short name", "category": "jobs|news|tech|general"}
- briefing_on/off:        {}
- briefing_time_morning:  {"time": "HH:MM", "enable": true|false}  — enable=true if user also wants to turn it on
- briefing_time_evening:  {"time": "HH:MM", "enable": true|false}
- briefing_keywords_add:  {"keyword": "exact phrase in lowercase"}
- briefing_keywords_remove: {"keyword": "exact phrase in lowercase"}
- briefing_list_feeds:    {}
- briefing_run_now:      {"type": "morning|evening"}  — "morning" if user says morning/poranny/rano, "evening" if evening/wieczorny/wieczorem, default "morning"
- schedule_add:           {"time": "HH:MM", "query": "search query string"}
- remind:                 {"when": "30min|2h|45s|HH:MM", "text": "reminder message"}
- remember:               {"fact": "fact about the user in third person, Polish"}
- none:                   {}

Time normalization rules:
- "za 30 minut" → "30min"
- "za 2 godziny" → "2h"
- "za pół godziny" → "30min"
- "za 45 sekund" → "45s"
- "o 7:30" / "o siódmej trzydzieści" → "07:30"
- "o ósmej" → "08:00"
- "jutro o 9" → "09:00" (ignore "tomorrow")
- Always zero-pad hours: "7:30" → "07:30"

Category detection rules (briefing_add_feed):
- Explicit text: "jobs", "praca", "oferty", "oferty pracy", "rekrutacja" → "jobs"
- Explicit text: "news", "wiadomości", "aktualności" → "news"
- Explicit text: "tech", "technologia", "programowanie" → "tech"
- URL heuristic: if URL contains "job", "jobs", "praca", "career", "work", "rekrut", "hiring" → "jobs"
- URL heuristic: if URL contains "news", "wiadomosc", "aktualnosc" → "news"
- URL heuristic: if URL contains "tech", "dev", "programming", "software" → "tech"
- default → "general"

CRITICAL disambiguation — use "none" for these:
- Questions about how something works: "jak działa RSS?", "co to jest briefing?"
- Code-related: "dodaj mi komentarz", "dodaj funkcję", "usuń ten błąd"
- General conversation: "dodaj mi trochę kontekstu", "zapamiętaj gdzie skończyliśmy"
- Asking for information: "przypomnij mi jak się konfiguruje...", "przypomnij mi co to jest..."
- Editing/writing tasks: "zapamiętaj tę listę", "zapisz ten tekst"

Examples:
"dodaj feed https://justjoin.it/rss.xml jako justjoinit z kategorią jobs"
→ {"intent":"briefing_add_feed","lang":"pl","params":{"url":"https://justjoin.it/rss.xml","label":"justjoinit","category":"jobs"}}

"add feed https://justjoin.it/rss.xml as justjoinit category jobs"
→ {"intent":"briefing_add_feed","lang":"en","params":{"url":"https://justjoin.it/rss.xml","label":"justjoinit","category":"jobs"}}

"subskrybuj https://remotive.io/rss/remote-jobs/product jako remotive"
→ {"intent":"briefing_add_feed","params":{"url":"https://remotive.io/rss/remote-jobs/product","label":"remotive","category":"general"}}

"włącz poranne raporty"
→ {"intent":"briefing_on","lang":"pl","params":{}}

"enable briefing"
→ {"intent":"briefing_on","lang":"en","params":{}}

"włącz poranny raport o 7:30"
→ {"intent":"briefing_time_morning","lang":"pl","params":{"time":"07:30","enable":true}}

"set morning report at 7:30"
→ {"intent":"briefing_time_morning","lang":"en","params":{"time":"07:30","enable":false}}

"ustaw poranny raport na 6:45"
→ {"intent":"briefing_time_morning","params":{"time":"06:45","enable":false}}

"zmień godzinę wieczornego raportu na 21:00"
→ {"intent":"briefing_time_evening","params":{"time":"21:00","enable":false}}

"wyłącz raporty"
→ {"intent":"briefing_off","params":{}}

"filtruj oferty po słowie remote IT project manager"
→ {"intent":"briefing_keywords_add","lang":"pl","params":{"keyword":"remote it project manager"}}

"filter job offers by keyword: remote senior"
→ {"intent":"briefing_keywords_add","lang":"en","params":{"keyword":"remote senior"}}

"dodaj filtr: senior"
→ {"intent":"briefing_keywords_add","lang":"pl","params":{"keyword":"senior"}}

"usuń filtr remote"
→ {"intent":"briefing_keywords_remove","lang":"pl","params":{"keyword":"remote"}}

"odpal briefing"
→ {"intent":"briefing_run_now","lang":"pl","params":{"type":"morning"}}

"odpal briefing now in the morning"
→ {"intent":"briefing_run_now","lang":"en","params":{"type":"morning"}}

"odpal briefing wieczorny"
→ {"intent":"briefing_run_now","lang":"pl","params":{"type":"evening"}}

"run briefing now"
→ {"intent":"briefing_run_now","lang":"en","params":{"type":"morning"}}

"wyślij mi wieczorny briefing"
→ {"intent":"briefing_run_now","lang":"pl","params":{"type":"evening"}}

"podaj moje feedy rss"
→ {"intent":"briefing_list_feeds","lang":"pl","params":{}}

"jakie mam feedy?"
→ {"intent":"briefing_list_feeds","lang":"pl","params":{}}

"moje feedy rss"
→ {"intent":"briefing_list_feeds","lang":"pl","params":{}}

"pokaż feedy"
→ {"intent":"briefing_list_feeds","lang":"pl","params":{}}

"list my feeds"
→ {"intent":"briefing_list_feeds","lang":"en","params":{}}

"show my rss feeds"
→ {"intent":"briefing_list_feeds","lang":"en","params":{}}

"remove keyword filter senior"
→ {"intent":"briefing_keywords_remove","lang":"en","params":{"keyword":"senior"}}

"zaplanuj codzienne wyszukiwanie o 9:00 oferty pracy Node.js Warsaw remote"
→ {"intent":"schedule_add","lang":"pl","params":{"time":"09:00","query":"oferty pracy Node.js Warsaw remote"}}

"schedule daily search at 8:00 for Python developer jobs Warsaw"
→ {"intent":"schedule_add","lang":"en","params":{"time":"08:00","query":"Python developer jobs Warsaw"}}

"przypomnij mi za 30 minut o spotkaniu z Anną"
→ {"intent":"remind","lang":"pl","params":{"when":"30min","text":"spotkanie z Anną"}}

"remind me in 2 hours to send the report"
→ {"intent":"remind","lang":"en","params":{"when":"2h","text":"send the report"}}

"ustaw przypomnienie na 17:30 — zadzwoń do mamy"
→ {"intent":"remind","lang":"pl","params":{"when":"17:30","text":"zadzwoń do mamy"}}

"zapamiętaj że szukam pracy jako IT Project Manager, preferuję pracę zdalną"
→ {"intent":"remember","lang":"pl","params":{"fact":"Szuka pracy jako IT Project Manager, preferuje pracę zdalną"}}

"note that I prefer concise answers"
→ {"intent":"remember","lang":"en","params":{"fact":"Prefers concise answers"}}

"remember I'm a Python developer with 5 years experience"
→ {"intent":"remember","lang":"en","params":{"fact":"Python developer with 5 years of experience"}}

"jak działa RSS?"
→ {"intent":"none","params":{}}

"przypomnij mi jak działają generatory w Python"
→ {"intent":"none","params":{}}

"dodaj mi więcej informacji o tym temacie"
→ {"intent":"none","params":{}}

"zapamiętaj gdzie skończyliśmy"
→ {"intent":"none","params":{}}`;

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callLLM(userText) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userText },
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

function parseResponse(raw) {
  if (!raw) return null;
  try {
    // Strip markdown code blocks if present
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    if (!obj.intent || obj.intent === 'none') return null;
    // Validate known intents
    const KNOWN = new Set([
      'briefing_add_feed', 'briefing_on', 'briefing_off',
      'briefing_time_morning', 'briefing_time_evening',
      'briefing_keywords_add', 'briefing_keywords_remove',
      'briefing_list_feeds', 'briefing_run_now',
      'schedule_add', 'remind', 'remember',
    ]);
    if (!KNOWN.has(obj.intent)) return null;
    return { intent: obj.intent, lang: obj.lang === 'en' ? 'en' : 'pl', params: obj.params || {} };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to detect a bot-configuration intent in the user's plain-text message.
 * Returns null if no intent detected or on any error.
 * @param {string} text
 * @returns {Promise<{intent: string, params: object} | null>}
 */
async function detectIntent(text) {
  if (!TRIGGER_RE.test(text)) return null;
  const raw = await callLLM(text);
  return parseResponse(raw);
}

module.exports = { detectIntent };
