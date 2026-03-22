/**
 * openrouter.js — OpenRouter API client (OpenAI-compatible)
 *
 * Model tiers:
 *   small  (💬) google/gemma-3-4b-it:free        — free, routing + simple tasks
 *   medium (⚡) mistralai/mistral-small-2603      — paid daily driver, Intel 19, best Polish
 *   large  (🧠) openai/gpt-4.1-mini              — paid, complex tasks / code, Intel 23
 *   coder  (🛠️) openai/gpt-4.1-mini              — same as large (GPT-4.1 strong at coding)
 *   premium(💰) google/gemini-2.5-flash           — best available, manual /model premium
 *
 * Free models (small): cascade to premium on 429.
 * Paid models (medium/large): called directly, no cascade.
 * Ollama: local fallback when OpenRouter is unavailable (handled in client.js).
 */
'use strict';

const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const BASE_URL           = 'https://openrouter.ai/api/v1';

// Local tier names (Ollama model strings from .env)
const MODEL_SMALL  = process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M';
const MODEL_LARGE  = process.env.MODEL_LARGE  || 'qwen3:8b';

const OR_MODEL_SMALL   = process.env.OR_MODEL_SMALL   || 'google/gemma-3-4b-it:free';
// Mistral Small 4 (2603): Intel 19, 0.59s TTFT, European company → strong Polish, $0.15/$0.60/M
const OR_MODEL_MEDIUM  = process.env.OR_MODEL_MEDIUM  || 'mistralai/mistral-small-2603';
// GPT-4.1 mini: Intel 23, 1M ctx, strong at code + reasoning, $0.40/$1.60/M
const OR_MODEL_LARGE   = process.env.OR_MODEL_LARGE   || 'openai/gpt-4.1-mini';
const OR_VISION_MODEL  = process.env.OR_VISION_MODEL  || 'google/gemma-3-12b-it:free';

// Best available — manually selectable via /model premium.
// Gemini 2.5 Flash: 88.4% Global-MMLU, reasoning toggle, $0.30/$2.50/M.
const OR_MODEL_PREMIUM = process.env.OR_MODEL_PREMIUM || 'google/gemini-2.5-flash';

// Coding model — manually selectable via /model code.
// GPT-4.1 mini: same as LARGE, strong SWE-bench performance.
const OR_MODEL_CODER   = process.env.OR_MODEL_CODER   || 'openai/gpt-4.1-mini';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function orHeaders() {
  return {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type':  'application/json',
    'HTTP-Referer':  'https://github.com/KreXator/AI-Assistant',
    'X-Title':       'AI Assistant',
  };
}

/**
 * Map a local (Ollama-tier) model name to the corresponding OpenRouter model ID.
 */
function mapModel(localModel) {
  if (localModel === MODEL_SMALL)  return OR_MODEL_SMALL;
  if (localModel === MODEL_MEDIUM) return OR_MODEL_MEDIUM;
  if (localModel === MODEL_LARGE)  return OR_MODEL_LARGE;
  // Already an OpenRouter model ID (contains '/')
  if (localModel && localModel.includes('/')) return localModel;
  // Unknown local model — route to LARGE for best quality
  return OR_MODEL_LARGE;
}

// ─── Chat completion ──────────────────────────────────────────────────────────

/**
 * Google AI Studio (Gemma) rejects the 'system' role ("Developer instruction is not enabled").
 * Convert system message → user/assistant handshake so the instruction still reaches the model.
 * Only applied for Gemma models — Mistral, OpenAI, etc. support system role natively.
 */
function injectSystemAsUser(messages) {
  const sysIdx = messages.findIndex(m => m.role === 'system');
  if (sysIdx === -1) return messages;
  const sysContent = messages[sysIdx].content;
  const rest = messages.filter((_, i) => i !== sysIdx);
  return [
    { role: 'user',      content: sysContent   },
    { role: 'assistant', content: 'Understood.' },
    ...rest,
  ];
}

function needsSystemWorkaround(orModel) {
  return orModel.startsWith('google/gemma');
}

/**
 * Send a messages array to OpenRouter and return the assistant reply text.
 * @param {string} localModel  — local tier name (mapped internally to OR model)
 * @param {Array<{role, content}>} messages
 * @returns {Promise<string>}
 */
async function complete(localModel, messages) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  const orModel    = mapModel(localModel);
  const normalized = needsSystemWorkaround(orModel) ? injectSystemAsUser(messages) : messages;
  console.log(`[openrouter] calling model=${orModel}, messages=${normalized.length}`);

  let res;
  try {
    res = await axios.post(`${BASE_URL}/chat/completions`, {
      model:    orModel,
      messages: normalized,
    }, {
      timeout: 180_000,
      headers: orHeaders(),
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error(`[openrouter] HTTP ${err.response?.status} — ${detail}`);
    throw err;
  }

  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) {
    console.error('[openrouter] unexpected response:', JSON.stringify(res.data).slice(0, 200));
    throw new Error('Empty response from OpenRouter');
  }

  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// ─── Vision completion ────────────────────────────────────────────────────────

/**
 * Analyze a base64-encoded image using an OpenRouter vision model.
 * @param {string} base64Image
 * @param {string} prompt
 * @param {string} [mimeType]
 * @returns {Promise<string>}
 */
async function completeVision(base64Image, prompt, mimeType = 'image/jpeg') {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  console.log(`[openrouter] vision model=${OR_VISION_MODEL}`);

  const res = await axios.post(`${BASE_URL}/chat/completions`, {
    model:    OR_VISION_MODEL,
    messages: [{
      role:    'user',
      content: [
        { type: 'text',      text:      prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
      ],
    }],
  }, {
    timeout: 120_000,
    headers: orHeaders(),
  });

  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty vision response from OpenRouter');
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Returns true if the API key is set and OpenRouter is reachable.
 */
async function isReachable() {
  if (!OPENROUTER_API_KEY) return false;
  try {
    await axios.get(`${BASE_URL}/models`, {
      timeout: 5000,
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  complete,
  completeVision,
  isReachable,
  mapModel,
  OR_MODEL_SMALL,
  OR_MODEL_MEDIUM,
  OR_MODEL_LARGE,
  OR_VISION_MODEL,
  OR_MODEL_PREMIUM,
  OR_MODEL_CODER,
};
