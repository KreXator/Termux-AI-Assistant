/**
 * router.js — Smart 3-tier model router
 *
 * SMALL  → qwen2.5:3b-instruct-q4_K_M  — simple chat, notes, todos, quick Q&A   (~2-8s)
 * MEDIUM → qwen2.5:7b-instruct-q4_K_M  — analysis, conversation, general topics  (~10-30s)
 * LARGE  → qwen3:8b                     — complex reasoning, code, hard problems   (~20-60s)
 *
 * Classification is purely heuristic (regex + length), zero LLM round-trips.
 */
'use strict';

const MODEL_SMALL  = process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M';
const MODEL_LARGE  = process.env.MODEL_LARGE  || 'qwen3:8b';

// ── Coding patterns → always LARGE ────────────────────────────────────────────
const CODING_PATTERNS = [
  /\bkod\b/i, /\bcode\b/i, /\bscript\b/i, /\bskrypt\b/i,
  /\bnapisa[ćc]\b.*\b(funkcj|kod|skrypt|program|class|function)\b/i,
  /\bwrite\b.*\b(function|class|program|script)\b/i,
  /\brefactor\b/i, /\bdebug\b/i, /\bSQL\b/i,
  /\bregex\b/i, /\bapi\b.*\bdesign\b/i,
  /\bimplementu[jj]\b/i, /\bimplement\b/i,
  /\barchitektur[ae]\b/i,
  /```[\s\S]/,              // message contains code block
  /^\s*\/run\b/i,
];

// ── Complex/analytical patterns → MEDIUM ──────────────────────────────────────
const MEDIUM_PATTERNS = [
  /analiz/i,            // analizuj, przeanalizuj, analiza
  /wyjaśnij/i, /explain\b/i,
  /porównaj/i, /compare\b/i,
  /podsumuj/i, /summariz/i,
  /\bplan\b.{0,20}\b(projekt|project|feature|zadanie)\b/i,
  /strateg/i,
  /\bresearch\b/i, /wyszukaj/i,
  /co myślisz/i, /what do you think\b/i,
  /opini[ae]/i,         // opinia, opinię
  /oceń/i, /assess\b/i,
];

// ── Polish content → MEDIUM (3B model hallucinates badly in Polish) ───────────
// Triggered by: Polish diacritics + substantive length, or common Polish
// question/request words that indicate the user wants a real answer.
const POLISH_PATTERNS = [
  /\b(przepis|składniki|przygotowanie|gotow)\b/i,   // recipes
  /\b(jak\s+\w+|co\s+to\s+jest|czym\s+jest)\b/i,   // how/what questions
  /\b(powiedz|wyjaśnij|opisz|napisz|podaj)\b/i,     // requests
  /\b(dlaczego|kiedy|gdzie|który|która)\b/i,         // WH-questions
  /\b(pomóż|pomoz|proszę|prosze)\b/i,               // please/help
  /\b(jakie|jaką|jakim|jaki)\b/i,                   // what kind of
];

// Detect substantive Polish text: has diacritics AND is long enough to matter
function isPolishContent(text) {
  const hasDiacritics = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text);
  return hasDiacritics && text.length > 30;
}

// ── Simple patterns → always SMALL ────────────────────────────────────────────
const SIMPLE_PATTERNS = [
  new RegExp('^\\/?(?:note|notes|notat[ak]i?)\\b', 'i'),
  new RegExp('^\\/?(?:todo|tasks|zadania)\\b', 'i'),
  new RegExp('^\\/?(?:memory|zapamiętaj|remember)\\b', 'i'),
  new RegExp('^\\/?(?:clear|wyczy[sś][cć]|forget)\\b', 'i'),
  new RegExp('^\\/?(?:help|pomoc|start)\\b', 'i'),
  /\bhello\b/i, /\bcze[śs][ćc]\b/i,
  /\bco s[ły]chać\b/i, /^(ok|okay|dzięki|thx|thanks|siema)\b/i,
  /\bjaki.*dzień\b/i, /\bjaka.*godzin\b/i,     // date/time questions
];

/**
 * Returns the appropriate model name for a given user message.
 * @param {string} message
 * @param {string|null} [override] — user-set model, always respected
 * @returns {string} model name
 */
function routeModel(message, override = null) {
  if (override) return override;

  const text = (message || '').trim();

  // Explicit simple signals → small model
  if (SIMPLE_PATTERNS.some(p => p.test(text))) return MODEL_SMALL;

  // Coding / complex reasoning → large
  if (CODING_PATTERNS.some(p => p.test(text))) return MODEL_LARGE;

  // Analysis / longer texts → medium
  if (MEDIUM_PATTERNS.some(p => p.test(text))) return MODEL_MEDIUM;
  if (text.length > 300) return MODEL_MEDIUM;

  // Substantive Polish content → medium (3B hallucinates badly in Polish)
  if (POLISH_PATTERNS.some(p => p.test(text))) return MODEL_MEDIUM;
  if (isPolishContent(text)) return MODEL_MEDIUM;

  // Everything else → small (fast)
  return MODEL_SMALL;
}

/**
 * Returns a human-readable label for the model tier.
 */
function modelLabel(model) {
  if (model === MODEL_LARGE)  return '🧠 high';
  if (model === MODEL_MEDIUM) return '⚡ medium';
  return '💬 fast';
}

module.exports = { routeModel, modelLabel, MODEL_SMALL, MODEL_MEDIUM, MODEL_LARGE };
