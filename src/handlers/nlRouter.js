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

const openrouter     = require('../llm/openrouter');
const ollama         = require('../llm/ollama');
const semanticRouter = require('../llm/semanticRouter');
const router         = require('../agent/router');

const ROUTE_TIMEOUT_MS = 8_000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a router for a personal Telegram AI assistant bot.
The user speaks Polish or English.
Classify the user's message into exactly one route.

Routes:
- "bot_command" — user wants to manage the bot: add/list schedules, reminders, notes, todos, memory facts, RSS feeds, briefings
- "web_search"  — user needs live/current data: weather, today's news, stock prices, crypto rates, sports results, anything that changes over time
- "chat"        — everything else: questions answered from training data, conversation, coding help, creative tasks, explanations, "how does X work?"

If "bot_command", also include "intent" and "params" for the specific tool.
KNOWN INTENTS:
- list_todos, list_notes, list_reminders, list_memory, list_schedules, list_feeds
- briefing_add_feed     {"url": "...", "label": "...", "category": "..."}
- briefing_on, briefing_off
- briefing_time_morning {"time": "HH:MM", "enable": true}
- briefing_time_evening {"time": "HH:MM", "enable": true}
- briefing_keywords_add {"keyword": "..."}
- briefing_keywords_remove {"keyword": "..."}
- briefing_run_now      {"type": "morning|evening"}
- schedule_add          {"time": "HH:MM", "query": "search query string"}
- remind                {"when": "30min|2h|45s|HH:MM|jutro 10:00|tomorrow 5pm", "text": "reminder message"}
- remember              {"fact": "fact about the user in third person, Polish"}
- summarize_url         {}
- daily_digest          {}
- todo_add              {"task": "task description"}
- note_add              {"note": "note content"}
- clear_history         {}
- forget_all            {}
- system_update         {}

Time normalization rules:
- "za 30 minut" → "30min"
- "jutro o 19:00" → "jutro 19:00"

Format:
{"type": "route_name", "intent": "intent_name", "lang": "pl|en", "params": {}}`;

// ─── Regex Pre-checks ─────────────────────────────────────────────────────────

const URL_PRECHECK_RE = /https?:\/\/[^\s]+/;
const SUMMARIZE_TRIGGER_RE = /\b(podsumuj|streszcz|streścij|summarize|tldr|przeczytaj|co tam|co pisze)\b/i;

// "co mam dziś", "plan na dziś", "standup"
const DAILY_DIGEST_RE = /\b(co\s+mam\s+dzi[śs]|plan\s+na\s+dzi[śs]|m[oó]j\s+dzie[nń]|standup|co\s+dzi[śs]\b)/i;

// Live/current-data queries → web_search
// Covers: news, weather, finance, sports, local events — anything time-sensitive.
// LLM models hallucinate these categories when they don't have real-time access.
// prettier-ignore
// Note: \b avoided after non-ASCII chars (ł, ą etc.) — use (?:\s|$) lookahead where needed
const LIVE_DATA_RE = /\b(pogoda\b|prognoza\s+(?:pogody|na\s+\w+)|ile\s+stopni|kurs\s+\w+|notowania\b|gie[lł]da\b|bitcoin\b|btc\b|\beth\b|kryptowalu[tc]|cena\s+(?:benzyny|gazu|pr[aą]du|ropy|diesla)|wyniki?\s+(?:meczu?|ligi|rozgrywek)|tabela\s+\w*\s*ligi|kto\s+wygra[lł]|co\s+(?:graj[aą]|leci)(?:\s|$)|wydarzenia\s+w\b|imprezy?\s+w\b)/i;

// Navigation queries → web_search with special redirect to mapping apps (no LLM)
// prettier-ignore
const NAV_SEARCH_RE = /\b(jak\s+(?:dojecha[ćc]|dojad[ęe]|dotrze[ćc]|doj[śs][ćc])|drog[ęa]\s+powrotn|trasa?\s+rowerow|trasa?\s+(?:piesz|samochodow)|(?:wymyśl|zaproponuj|poka[zż]|podaj|polecasz?|pole[ćc])\s+.{0,40}tras[ęea]?|jak[aą]\s+tras[ęea]|(?:lekk[aą]|ciekaw[aą]|fajna?|krótk[aą]|ładn[aą])\s+tras[ęea]|tras[ęea]\s+.{0,30}(?:polecasz?|zaproponuj|wymyśl|pole[ćc])|wycieczk[ięa]\s+rowerow)/i;

const LIST_PRECHECK = [
  // 1. Additions (Specific content patterns)
  { re: /^(?:przypomnij|remind|alert|alarm|dodaj\s+przypomnienie|nowe\s+przypomnienie|ustaw\s+alarm|ustaw\s+przypomnienie)(?:\s+mi)?(?:\s+o)?[:\s]+\s*(.+)$/i, intent: 'remind' },
  { re: /^(?:dodaj|zapisz|nowe|nowa|nową|add|new)\s+(?:zadani[ae]|tasks?|todos?)[:\s]+\s*([\s\S]+)$/i,       intent: 'todo_add'       },
  { re: /^(?:dodaj|zapisz|nowe|nowa|nową|add|new)\s+(?:notatk[aęę]?|note)[:\s]+\s*([\s\S]+)$/i,           intent: 'note_add'       },
  { re: /^(?:zapamiętaj|remember|zanotuj|fact|zapisz\s+fakt)[:\s]+\s*(.+)$/i,          intent: 'remember'       },

  // 2. State toggles
  { re: /(?:^|\s)(włącz|enable|on)\s+(briefing|raporty)(?:\s|$)/i,                                intent: 'briefing_on'    },
  { re: /(?:^|\s)(wyłącz|disable|off)\s+(briefing|raporty)(?:\s|$)/i,                               intent: 'briefing_off'   },
  { re: /(?:^|\s)(odpal|uruchom|run|start|generuj)\s+(?:.{0,20}\s+)?(briefing|raport)(?:\s|$)/i, intent: 'briefing_run_now'},
  
  // 3. Lists (General requests)
  { re: /(?:^|\s)(?:moje\s+)?notatki(?:\s|$)|(?:^|\s)list[aeyę]\s+notatek(?:\s|$)|(?:^|\s)pokaż\s+notatki(?:\s|$)|(?:^|\s)notatkę(?:\s|$)|(?:^|\s)notes(?:\s|$)/i,        intent: 'list_notes'     },
  { re: /(?:^|\s)(?:moje\s+)?zadania(?:\s|$)|(?:^|\s)list[aeyę]\s+zadań(?:\s|$)|(?:^|\s)pokaż\s+zadania(?:\s|$)|(?:^|\s)todos?\b|(?:^|\s)taski(?:\s|$)/i,  intent: 'list_todos'     },
  { re: /(?:^|\s)(?:moje\s+)?przypomnienia(?:\s|$)|(?:^|\s)list[aeyę]\s+przypomnień(?:\s|$)|(?:^|\s)pokaż\s+przypomnienia(?:\s|$)/i, intent: 'list_reminders' },
  { re: /(?:^|\s)(?:moja\s+)?pamięć(?:\s|$)|(?:^|\s)zapamiętane(?:\s|$)|(?:^|\s)pokaż\s+pamięć(?:\s|$)/i,                     intent: 'list_memory'    },
  { re: /(?:^|\s)zaplanowane\s+wyszukiwania(?:\s|$)|(?:^|\s)pokaż\s+(harmonogram|schedule)(?:\s|$)/i,             intent: 'list_schedules' },
  { re: /(?:^|\s)(?:moje\s+)?feedy(?:\s|$)|(?:^|\s)list[aeyę]\s+(?:feedów|rss)(?:\s|$)|(?:^|\s)pokaż\s+(feedy|feed[sy]?\s+rss)(?:\s|$)/i,   intent: 'list_feeds'     },

  // 4. Utility
  { re: /(?:^|\s)(wyczyść|usuń|clear|reset)\s+(historię|czat|history|chat)(?:\s|$)/i,     intent: 'clear_history'},
  { re: /(?:^|\s)(zapomnij|forget|wyczyść|usuń)\s+(wszystko|wszystkie\s+fakty|everything)(?:\s|$)/i, intent: 'forget_all'},
  { re: /(?:^|\s)(zaktualizuj|aktualizuj|update)\s+(system|bota|bot|kod)(?:\s|$)/i,                intent: 'system_update'  },
];

// ─── Polish ordinal hour normalizer ───────────────────────────────────────────
// Converts e.g. "jutro o dziewiętnastej" → "jutro 19:00" so existing HH:MM
// patterns can handle it without expanding every downstream regex.
const ORDINAL_MAP = [
  ['dwudziestej czwartej', '0:00'],  ['dwudziestej trzeciej', '23:00'],
  ['dwudziestej drugiej', '22:00'],  ['dwudziestej pierwszej', '21:00'],
  ['dwudziestej', '20:00'],          ['dziewiętnastej', '19:00'],
  ['osiemnastej', '18:00'],          ['siedemnastej', '17:00'],
  ['szesnastej', '16:00'],           ['piętnastej', '15:00'],
  ['czternastej', '14:00'],          ['trzynastej', '13:00'],
  ['dwunastej', '12:00'],            ['jedenastej', '11:00'],
  ['dziesiątej', '10:00'],           ['dziewiątej', '9:00'],
  ['ósmej', '8:00'],                 ['siódmej', '7:00'],
  ['szóstej', '6:00'],               ['piątej', '5:00'],
  ['czwartej', '4:00'],              ['trzeciej', '3:00'],
  ['drugiej', '2:00'],               ['pierwszej', '1:00'],
  ['północy', '0:00'],               ['południa', '12:00'],
];

function normalizeOrdinalTime(text) {
  const lower = text.toLowerCase();
  for (const [ordinal, time] of ORDINAL_MAP) {
    if (lower.includes(ordinal)) {
      return text.replace(new RegExp(ordinal, 'i'), time);
    }
  }
  return text;
}

const CHAT_OVERRIDE = /\bzaplanuj\b.{0,40}\b(trasę|wyjazd|dzień|projekt|menu|wakacje|podróż|weekend|wycieczkę|aktywność|czas|tydzień)\b/i;
const SCHEDULE_ADD_RE = /\bzaplanuj\b.{0,100}\bo\s+(\d{1,2}:\d{2})\b/i;

function precheck(text) {
  if (CHAT_OVERRIDE.test(text)) return { type: 'chat', intent: null, lang: 'pl', params: {} };

  // 1. UNIVERSAL DETERMINISTIC INTERCEPTORS (Sticky Intent)
  for (const { re, intent } of LIST_PRECHECK) {
    if (re.test(text)) {
      if (intent === 'remind') {
        const m = /^(?:przypomnij|remind|alert|alarm|dodaj\s+przypomnienie|nowe\s+przypomnienie|ustaw\s+alarm|ustaw\s+przypomnienie)(?:\s+mi)?(?:\s+o)?[:\s]+\s*([\s\S]+)$/i.exec(text);
        if (m) {
          // Normalize Polish ordinal hours → HH:MM before regex matching
          const content = normalizeOrdinalTime(m[1].trim());
          // Also handle DD.MM.YYYY / DD.MM date formats
          const timeMatch = /^(?:za\s+|o\s+|na\s+)?((?:jutro|tomorrow|today|dzisiaj|pojutrze)(?:\s+(?:o\s+)?(?:\d{1,2}:\d{2}|\d{1,2}\.\d{2}(?:\.\d{4})?)(?:\s*(?:am|pm))?)?|\d+[hms]|\d{1,2}:\d{2}|\d{1,2}\.\d{2}(?:\.\d{4})?)(?:\s+(?:o\s+)?(.+))?$/i.exec(content);
          if (timeMatch) {
            return {
              type: 'bot_command',
              intent: 'remind',
              lang: 'pl',
              params: { when: timeMatch[1], text: timeMatch[2]?.trim() || null }
            };
          }
          const timeEndMatch = /^(.+?)\s+(?:za\s+|o\s+|na\s+)(\d+[hms]|\d{1,2}:\d{2}|jutro|today|tomorrow|dzisiaj|pojutrze)$/i.exec(content);
          if (timeEndMatch) {
            return {
              type: 'bot_command',
              intent: 'remind',
              lang: 'pl',
              params: { when: timeEndMatch[2], text: timeEndMatch[1].trim() }
            };
          }
          // 3. English "me at 5pm to call mom"
          const enMatch = /^(?:me\s+)?at\s+((?:\d{1,2}(?::\d{2})?\s*(?:am|pm))|\d{1,2}:\d{2})\s+to\s+(.+)$/i.exec(content);
          if (enMatch) {
            return {
              type: 'bot_command',
              intent: 'remind',
              lang: 'en',
              params: { when: enMatch[1], text: enMatch[2].trim() }
            };
          }
          return { type: 'bot_command', intent: 'remind', lang: 'pl', params: { _raw: content } };
        }
      }
      if (intent === 'todo_add' || intent === 'note_add' || intent === 'remember') {
        const m = /^(?:dodaj|zapisz|nowe|nowa|nową|add|new|zapamiętaj|remember|zanotuj|fact|zapisz\s+fakt)\s+(?:zadani[ae]|task|todo|notatk[aęę]?|note|że|that)?[:\s]+\s*([\s\S]+)$/i.exec(text);
        if (m) {
          const content = m[1].trim();
          let p = {};
          if (intent === 'todo_add') p = { task: content };
          else if (intent === 'note_add') p = { note: content };
          else if (intent === 'remember') p = { fact: content };
          return { type: 'bot_command', intent, lang: 'pl', params: p };
        }
      }
      if (intent === 'briefing_run_now') {
        const isEvening = /\b(wieczorny|evening)\b/i.test(text);
        return { type: 'bot_command', intent, lang: 'pl', params: { type: isEvening ? 'evening' : 'morning' } };
      }
      return { type: 'bot_command', intent, lang: 'pl', params: {} };
    }
  }

  // 2. OTHER SPECIAL PRECHECKS
  const urlMatch = URL_PRECHECK_RE.exec(text);
  if (urlMatch && (SUMMARIZE_TRIGGER_RE.test(text) || text.trim().match(/^https?:\/\//i))) {
    return { type: 'bot_command', intent: 'summarize_url', lang: 'pl', params: { url: urlMatch[0] } };
  }

  if (DAILY_DIGEST_RE.test(text)) {
    return { type: 'bot_command', intent: 'daily_digest', lang: 'pl', params: {} };
  }

  // Job search precheck
  if (/\b(szukam\s+pracy|oferty\s+pracy|szukam\s+roboty|ogłoszenia\s+o\s+pracę)\b/i.test(text)) return null;

  // Local events queries
  if (/\b(wydarzen[iy]a?\s+(?:lokalne?|na\s+weekend|w\s+\w+)|co\s+(?:robi[ćc]|zwiedzi[ćc]|zobaczy[ćc])\s+(?:z\s+dzieckiem|z\s+córk|z\s+synem|w\s+\w+)|atrakcje?\s+(?:dla|w\s+\w+)|co\s+polecasz\s+(?:z\s+dzieckiem|z\s+córk|z\s+synem|w\s+\w+))\b/i.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: { subtype: 'local_events' } };
  }

  // News queries
  if (/\b(wiadomo[śs]ci|aktualno[śs]ci|przeg[lł][aą]d\s+wiadomo[śs]ci|skr[oó]t\s+wiadomo[śs]ci|(?:lokalne?|regionalne?|krajowe?|[śs]wiatowe?|zagraniczne?|sportowe?|technologiczne?)\s+wiadomo[śs]ci|wiadomo[śs]ci\s+(?:lokalne?|krajowe?|ze?\s+[śs]wiata?|z\s+\w+|sportowe?|technologiczne?)|headlines?|news\b|co\s+si[ęe]\s+dzieje|co\s+nowego(?:\s|$))\b/i.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: { subtype: 'news' } };
  }

  if (LIVE_DATA_RE.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: {} };
  }

  if (NAV_SEARCH_RE.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: { subtype: 'navigation' } };
  }

  const schedMatch = SCHEDULE_ADD_RE.exec(text);
  if (schedMatch) {
    const time  = schedMatch[1].padStart(5, '0');
    const query = text
      .replace(/\bzaplanuj\s+(?:mi\s+|sobie\s+)?/i, '')
      .replace(/\s+o\s+\d{1,2}:\d{2}\b.*$/i, '')
      .trim();
    return { type: 'bot_command', intent: 'schedule_add', lang: 'pl', params: { time, query } };
  }

  return null;
}

// ─── Parse LLM response ───────────────────────────────────────────────────────

const KNOWN_INTENTS = new Set([
  'list_todos', 'list_notes', 'list_reminders', 'list_memory', 'list_schedules', 'list_feeds',
  'briefing_add_feed', 'briefing_on', 'briefing_off',
  'briefing_time_morning', 'briefing_time_evening',
  'briefing_keywords_add', 'briefing_keywords_remove',
  'briefing_run_now', 'schedule_add', 'remind', 'remember',
  'summarize_url', 'daily_digest', 'job_search',
  'todo_add', 'note_add', 'clear_history', 'forget_all', 'system_update',
]);

function parse(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type === 'bot_command' && !KNOWN_INTENTS.has(parsed.intent)) {
      parsed.type = 'chat';
    }
    return parsed;
  } catch {
    return null;
  }
}

async function callLLM(text) {
  const model = router.MODEL_SMALL;
  const raw = await ollama.completeRaw(model, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ]);
  return raw.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

const FOLLOWUP_RE = /^(co|jak|ile|czy|a\s+|i\s+|no\s+to|to\s+|ale\s+|ok\s+|okej|dobra|super|fajnie|świetnie|dzięki|i\s+co|co\s+z|co\s+jeszcze|coś\s+jeszcze|a\s+co|a\s+jak|coś\s+na|polecasz|a\s+może|może\s+coś)\b/i;

async function route(text, context = {}) {
  const fast = precheck(text);
  if (fast) return fast;

  if (context.lastRoute === 'web_search' && text.length < 80 && FOLLOWUP_RE.test(text)) {
    return { type: 'web_search', intent: null, lang: 'pl', params: {} };
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const { route: semRoute } = await semanticRouter.classify(text);
      if (semRoute === 'web_search' || semRoute === 'chat') {
        return { type: semRoute, intent: null, lang: 'pl', params: {} };
      }
    } catch (err) {
      console.warn('[nlRouter] semantic router failed, falling back to LLM:', err.message);
    }
  }

  try {
    const raw = await Promise.race([
      callLLM(text),
      new Promise((_, rej) => setTimeout(() => rej(new Error('router timeout')), ROUTE_TIMEOUT_MS)),
    ]);
    return parse(raw) || { type: 'web_search', intent: null, lang: 'pl', params: {} };
  } catch {
    return { type: 'web_search', intent: null, lang: 'pl', params: {} };
  }
}

module.exports = { route, precheck };
