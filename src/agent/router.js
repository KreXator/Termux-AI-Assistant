/**
 * router.js — Smart model router (LLM Gateway)
 *
 * Classifies user intent into SIMPLE or COMPLEX.
 * SIMPLE → small/fast model (chat, notes, todos, memory)
 * COMPLEX → large model (code generation, research, multi-step reasoning)
 *
 * Classification is purely heuristic (regex + keyword matching) so it runs
 * with zero LLM round-trips, keeping the phone responsive.
 */
'use strict';

const MODEL_SMALL = process.env.MODEL_SMALL || 'llama3.2:3b';
const MODEL_LARGE = process.env.MODEL_LARGE || 'llama3:8b';

// Keywords that signal COMPLEX tasks → route to large model
const COMPLEX_PATTERNS = [
  /\bkod\b/i, /\bcode\b/i, /\bscript\b/i, /\bskrypt\b/i,
  /\bnapisa[ćc]\b/i, /\bwrite\b.*\b(function|class|program)\b/i,
  /\brefactor\b/i, /\bdebug\b/i, /\banalyse\b/i, /\banaliz\b/i,
  /\barchitektur[ae]\b/i, /\bimplementu[jj]\b/i, /\bimplement\b/i,
  /\bSQL\b/i, /\bregex\b/i, /\bapi\b.*\bdesign\b/i,
  /\bwyjaśnij\b.{0,30}\balance/i, /\bexplain\b.{0,30}\bcomplex\b/i,
  /\bporównaj\b/i, /\bcompare\b/i,
  /\bplan\b.{0,20}\b(projekt|project|feature)\b/i,
  /\bwyszukaj w sieci\b/i, /\bsearch the web\b/i,
];

// Keywords that explicitly signal SIMPLE tasks → keep them fast
const SIMPLE_PATTERNS = [
  /^\/?(note|notes|notat[ak]i?)\b/i,
  /^\/?(todo|tasks|zadania)\b/i,
  /^\/?(memory|memory|pamięć|zapamiętaj)\b/i,
  /^\/?(clear|wyczyść|forget)\b/i,
  /^\/?(model|persona)\b/i,
  /^\/?(help|pomoc|start)\b/i,
  /\bhello\b/i, /\bcze[śs][ćc]\b/i, /\bdzie[ńn]\b/i,
  /\bco s[ły]chać\b/i, /^(ok|okay|dzięki|thx|thanks)\b/i,
];

/**
 * Returns the appropriate model name for a given user message.
 * @param {string} message
 * @param {string} [override] — if user has manually set a model, respect it
 * @returns {string} model name
 */
function routeModel(message, override = null) {
  // If user manually overrode the model this session, respect it
  if (override) return override;

  const text = message.trim();

  // Explicit simple → small model
  if (SIMPLE_PATTERNS.some(p => p.test(text))) return MODEL_SMALL;

  // Long messages (>200 chars) are likely complex
  if (text.length > 200) return MODEL_LARGE;

  // Code block in message → complex
  if (/```/.test(text)) return MODEL_LARGE;

  // Complex keyword match → large model
  if (COMPLEX_PATTERNS.some(p => p.test(text))) return MODEL_LARGE;

  // Default → small/fast
  return MODEL_SMALL;
}

/**
 * Returns a human-readable label for the model tier.
 */
function modelLabel(model) {
  return model === MODEL_LARGE ? '🧠 large' : '⚡ fast';
}

module.exports = { routeModel, modelLabel, MODEL_SMALL, MODEL_LARGE };
