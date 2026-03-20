/**
 * ollama.js — Ollama REST API client
 * Handles: chat requests, context pruning, model listing
 */
'use strict';

const axios = require('axios');
const db    = require('../db/database');

const BASE_URL       = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const HISTORY_WINDOW = parseInt(process.env.HISTORY_WINDOW || '10', 10);

// ─── Personas ────────────────────────────────────────────────────────────────
const PERSONAS = require('../../config/personas.json');

function getSystemPrompt(persona = 'default') {
  return PERSONAS[persona] || PERSONAS.default;
}

// ─── History pruning ─────────────────────────────────────────────────────────

/**
 * Prune history to the last HISTORY_WINDOW messages to keep context manageable.
 */
async function pruneHistory(userId) {
  const history = db.getHistory(userId);
  if (history.length <= HISTORY_WINDOW) return history;
  const trimmed = history.slice(-HISTORY_WINDOW);
  db.saveHistory(userId, trimmed);
  return trimmed;
}

// ─── Main chat call ──────────────────────────────────────────────────────────

/**
 * Send a message to Ollama and return the assistant reply text.
 * @param {object} opts
 * @param {number}      opts.userId
 * @param {string}      opts.userMessage
 * @param {string}      opts.model
 * @param {string}      [opts.persona]            — persona key from personas.json
 * @param {string|null} [opts.customInstruction]  — overrides persona if set
 */
async function chat({ userId, userMessage, model, persona = 'default', customInstruction = null }) {
  // 1. append user message
  db.appendMessage(userId, 'user', userMessage);

  // 2. get pruned history
  const history = await pruneHistory(userId);

  // 3. inject persistent memory as context
  const memFacts = db.getMemory(userId);
  const memBlock = memFacts.length
    ? `\n\nKnown facts about the user:\n${memFacts.map(f => `- ${f.fact}`).join('\n')}`
    : '';

  // 4. build messages array — custom instruction overrides persona
  const basePrompt   = customInstruction || getSystemPrompt(persona);
  const systemContent = basePrompt + memBlock;
  const messages = [
    { role: 'system', content: systemContent },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  // 5. call Ollama — 180s timeout (reasoning models generate think tokens)
  console.log(`[ollama] calling model=${model}, messages=${messages.length}`);
  let res;
  try {
    res = await axios.post(`${BASE_URL}/api/chat`, {
      model,
      messages,
      stream: false,
    }, { timeout: 180_000 });
  } catch (err) {
    console.error('[ollama] axios error:', err.code || err.message);
    throw err;
  }

  if (!res.data?.message?.content) {
    console.error('[ollama] unexpected response:', JSON.stringify(res.data).slice(0, 200));
    throw new Error('Empty response from Ollama');
  }

  // 6. Strip Qwen3 <think>...</think> reasoning blocks before sending to user
  const reply = res.data.message.content
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trim();

  // 7. persist assistant response
  db.appendMessage(userId, 'assistant', reply);

  return reply;
}

/**
 * Raw completion — just the API call, no db interaction.
 * Used by client.js as the Ollama fallback.
 * @param {string} model
 * @param {Array<{role, content}>} messages
 * @returns {Promise<string>}
 */
async function completeRaw(model, messages) {
  console.log(`[ollama] calling model=${model}, messages=${messages.length}`);
  let res;
  try {
    res = await axios.post(`${BASE_URL}/api/chat`, {
      model,
      messages,
      stream: false,
    }, { timeout: 180_000 });
  } catch (err) {
    console.error('[ollama] axios error:', err.code || err.message);
    throw err;
  }
  if (!res.data?.message?.content) {
    console.error('[ollama] unexpected response:', JSON.stringify(res.data).slice(0, 200));
    throw new Error('Empty response from Ollama');
  }
  return res.data.message.content
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trim();
}

/**
 * List available models from local Ollama.
 */
async function listModels() {
  try {
    const res = await axios.get(`${BASE_URL}/api/tags`, { timeout: 5000 });
    return (res.data.models || []).map(m => m.name);
  } catch (err) {
    console.error('[ollama] listModels error:', err.message);
    return [];
  }
}

/**
 * Health check — returns true if Ollama is reachable.
 */
async function isOllamaRunning() {
  try {
    await axios.get(`${BASE_URL}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, completeRaw, listModels, isOllamaRunning, getSystemPrompt };
