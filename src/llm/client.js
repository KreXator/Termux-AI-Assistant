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

const PERSONAS       = require('../../config/personas.json');
const HISTORY_WINDOW = parseInt(process.env.HISTORY_WINDOW || '10', 10);

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getSystemPrompt(persona = 'default') {
  return PERSONAS[persona] || PERSONAS.default;
}

async function pruneHistory(userId) {
  const history = db.getHistory(userId);
  if (history.length <= HISTORY_WINDOW) return history;
  const trimmed = history.slice(-HISTORY_WINDOW);
  db.saveHistory(userId, trimmed);
  return trimmed;
}

/**
 * Returns the model ID that will actually be used for a request.
 * When OpenRouter is active, local tier names are mapped to OR model IDs.
 */
function resolveDisplayModel(localModel) {
  if (process.env.OPENROUTER_API_KEY) return openrouter.mapModel(localModel);
  return localModel;
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

  // 3. Call provider (OR primary, Ollama fallback)
  let reply;
  if (process.env.OPENROUTER_API_KEY) {
    try {
      reply = await openrouter.complete(model, messages);
      console.log('[client] provider=openrouter');
    } catch (err) {
      console.warn('[client] OpenRouter failed, falling back to Ollama:', err.message);
      reply = await ollama.completeRaw(model, messages);
      console.log('[client] provider=ollama (fallback)');
    }
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
