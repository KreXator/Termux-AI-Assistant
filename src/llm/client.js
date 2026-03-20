/**
 * client.js — Unified LLM client
 *
 * Primary:  OpenRouter (free cloud models) — when OPENROUTER_API_KEY is set
 * Fallback: Local Ollama                   — when OR is unavailable or not configured
 *
 * Handles all history / memory / persona logic so providers only deal with
 * raw messages arrays.
 */
'use strict';

const db         = require('../db/database');
const openrouter = require('./openrouter');
const ollama     = require('./ollama');

const PERSONAS = require('../../config/personas.json');

// Local tier model names (used to build the OR cascade)
const MODEL_SMALL  = process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M';
const MODEL_LARGE  = process.env.MODEL_LARGE  || 'qwen3:8b';

// History limits:
//   HISTORY_CHARS  — primary limit: total character budget across all messages.
//                    1 token ≈ 4 chars; 200 000 chars ≈ 50 000 tokens.
//                    Safe for any 131K-context model (Gemma 27B etc.) with room for
//                    system prompt, memory block, and response.
//   HISTORY_WINDOW — secondary cap: max number of messages regardless of chars.
//                    Prevents pathological cases (e.g. 5000 one-liner messages).
const HISTORY_CHARS  = parseInt(process.env.HISTORY_CHARS  || '200000', 10);
const HISTORY_WINDOW = parseInt(process.env.HISTORY_WINDOW || '100',    10);

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getSystemPrompt(persona = 'default') {
  return PERSONAS[persona] || PERSONAS.default;
}

/**
 * Trim conversation history to fit within HISTORY_CHARS + HISTORY_WINDOW.
 * Always keeps the most recent messages; drops oldest first.
 * Persists the trimmed result so the data file doesn't grow indefinitely.
 */
async function pruneHistory(userId) {
  const history = db.getHistory(userId);

  // Walk backwards, accumulating chars until we hit the budget
  let kept       = [];
  let totalChars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msgChars = (history[i].content || '').length;
    if (totalChars + msgChars > HISTORY_CHARS) break;
    kept.unshift(history[i]);
    totalChars += msgChars;
  }

  // Apply message-count cap as a safety valve
  if (kept.length > HISTORY_WINDOW) kept = kept.slice(-HISTORY_WINDOW);

  // Persist trimmed version so the JSON file doesn't grow unboundedly
  if (kept.length < history.length) db.saveHistory(userId, kept);

  return kept;
}

/**
 * Returns the model ID that will actually be used for a request.
 * When OpenRouter is active, local tier names are mapped to OR model IDs.
 */
function resolveDisplayModel(localModel) {
  if (process.env.OPENROUTER_API_KEY) return openrouter.mapModel(localModel);
  return localModel;
}

// ─── OpenRouter cascade ───────────────────────────────────────────────────────

/**
 * Returns the list of local tier models to try in order, starting from `model`.
 * Small escalates through Medium → Large; Medium → Large; Large stays solo.
 */
function buildOrCascade(model) {
  if (model === MODEL_SMALL)  return [MODEL_SMALL,  MODEL_MEDIUM, MODEL_LARGE];
  if (model === MODEL_MEDIUM) return [MODEL_MEDIUM, MODEL_LARGE];
  return [model]; // LARGE or any explicit OR model ID — no escalation
}

/**
 * Try OpenRouter with automatic tier escalation on 429.
 * Small → Medium → Large before giving up and letting Ollama take over.
 */
async function tryOpenRouterWithCascade(model, messages) {
  const candidates = buildOrCascade(model);
  let lastErr;
  for (const m of candidates) {
    try {
      const reply = await openrouter.complete(m, messages);
      console.log(`[client] provider=openrouter model=${openrouter.mapModel(m)}`);
      return reply;
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`[client] OR ${openrouter.mapModel(m)} rate-limited (429), trying next tier…`);
        lastErr = err;
        continue;
      }
      throw err; // non-429 error → surface immediately (triggers Ollama fallback)
    }
  }
  throw lastErr; // all OR tiers exhausted → caller falls back to Ollama
}

// ─── Main chat call ───────────────────────────────────────────────────────────

/**
 * Send a message and return the assistant reply.
 * Tries OpenRouter first; falls back to Ollama on any error.
 *
 * @param {object} opts
 * @param {number}      opts.userId
 * @param {string}      opts.userMessage
 * @param {string}      opts.model             — local tier model name from router.js
 * @param {string}      [opts.persona]
 * @param {string|null} [opts.customInstruction]
 * @returns {Promise<string>}
 */
async function chat({ userId, userMessage, model, persona = 'default', customInstruction = null }) {
  // 1. Persist user message
  db.appendMessage(userId, 'user', userMessage);

  // 2. Build history + memory + system prompt
  const history   = await pruneHistory(userId);
  const memFacts  = db.getMemory(userId);
  const memBlock  = memFacts.length
    ? `\n\nKnown facts about the user:\n${memFacts.map(f => `- ${f.fact}`).join('\n')}`
    : '';

  const systemContent = (customInstruction || getSystemPrompt(persona)) + memBlock;
  const messages = [
    { role: 'system', content: systemContent },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  // 3. Call provider (OR primary with tier cascade, Ollama fallback)
  let reply;
  if (process.env.OPENROUTER_API_KEY) {
    reply = await tryOpenRouterWithCascade(model, messages);
  } else {
    reply = await ollama.completeRaw(model, messages);
    console.log('[client] provider=ollama');
  }

  // 4. Persist assistant reply
  db.appendMessage(userId, 'assistant', reply);

  return reply;
}

// ─── Model listing ────────────────────────────────────────────────────────────

async function listModels() {
  const lines = [];

  if (process.env.OPENROUTER_API_KEY) {
    const orAlive = await openrouter.isReachable();
    lines.push(`*OpenRouter* (${orAlive ? 'online — primary' : 'offline'})`);
    lines.push(`  Small  : \`${openrouter.OR_MODEL_SMALL}\``);
    lines.push(`  Medium : \`${openrouter.OR_MODEL_MEDIUM}\``);
    lines.push(`  Large  : \`${openrouter.OR_MODEL_LARGE}\``);
    lines.push(`  Vision : \`${openrouter.OR_VISION_MODEL}\``);
    lines.push(`  Premium: \`${openrouter.OR_MODEL_PREMIUM}\` ← /model premium`);
    lines.push('');
    lines.push(`*Ollama* (fallback)`);
  } else {
    lines.push(`*Ollama* (primary — no OPENROUTER\\_API\\_KEY set)`);
  }

  const ollamaAlive  = await ollama.isOllamaRunning();
  const ollamaModels = ollamaAlive ? await ollama.listModels() : [];
  lines.push(`Status: ${ollamaAlive ? 'online' : 'offline'}`);
  if (ollamaModels.length) {
    ollamaModels.forEach(m => lines.push(`  • \`${m}\``));
  } else {
    lines.push('  No local models found.');
  }

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  chat,
  listModels,
  resolveDisplayModel,
  getSystemPrompt,
  isOllamaRunning:       ollama.isOllamaRunning,
  isOpenRouterReachable: openrouter.isReachable,
};
