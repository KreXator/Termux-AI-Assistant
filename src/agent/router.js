/**
 * router.js — Smart 3-tier model router
 *
 * SMALL  → gemma2:2b    — simple chat, notes, todos, quick Q&A   (~5-15s on mobile)
 * MEDIUM → llama3.1:8b  — analysis, conversation, general topics  (~30-90s)
 * LARGE  → qwen2.5-coder:7b — code generation, debugging, complex (~30-90s)
 *
 * Classification is purely heuristic (regex + length), zero LLM round-trips.
 */
'use strict';

const MODEL_SMALL  = process.env.MODEL_SMALL  || 'gemma2:2b';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'llama3.1:8b';
const MODEL_LARGE  = process.env.MODEL_LARGE  || 'qwen2.5-coder:7b';

// ── Coding patterns → always LARGE (qwen2.5-coder is purpose-built for this) ──
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

  // Coding → large (qwen2.5-coder)
  if (CODING_PATTERNS.some(p => p.test(text))) return MODEL_LARGE;

  // Analysis / longer texts → medium
  if (MEDIUM_PATTERNS.some(p => p.test(text))) return MODEL_MEDIUM;
  if (text.length > 300) return MODEL_MEDIUM;

  // Everything else → small (fast)
  return MODEL_SMALL;
}

/**
 * Returns a human-readable label for the model tier.
 */
function modelLabel(model) {
  if (model === MODEL_LARGE)  return '💻 coder';
  if (model === MODEL_MEDIUM) return '🧠 medium';
  return '⚡ fast';
}

module.exports = { routeModel, modelLabel, MODEL_SMALL, MODEL_MEDIUM, MODEL_LARGE };
