/**
 * openrouter.js — OpenRouter API client (OpenAI-compatible)
 *
 * Maps local 3-tier model names to free OpenRouter equivalents:
 *   MODEL_SMALL  → meta-llama/llama-3.2-3b-instruct:free
 *   MODEL_MEDIUM → mistralai/mistral-small-3.1-24b-instruct:free
 *   MODEL_LARGE  → meta-llama/llama-3.3-70b-instruct:free
 *
 * Vision: google/gemma-3-12b-it:free (natively multimodal)
 */
'use strict';

const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const BASE_URL           = 'https://openrouter.ai/api/v1';

// Local tier names (Ollama model strings from .env)
const MODEL_SMALL  = process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M';
const MODEL_LARGE  = process.env.MODEL_LARGE  || 'qwen3:8b';

// OpenRouter free model defaults (overridable via env)
// Hosted by Google AI Studio / Nvidia — reliable, no Venice rate limits
const OR_MODEL_SMALL   = process.env.OR_MODEL_SMALL   || 'google/gemma-3-4b-it:free';
const OR_MODEL_MEDIUM  = process.env.OR_MODEL_MEDIUM  || 'google/gemma-3-12b-it:free';
const OR_MODEL_LARGE   = process.env.OR_MODEL_LARGE   || 'google/gemma-3-27b-it:free';
const OR_VISION_MODEL  = process.env.OR_VISION_MODEL  || 'google/gemma-3-12b-it:free';

// Optional paid model — manually selectable via /model premium
// Best price/quality for a personal assistant ($0.40/M out, 1M ctx, excellent Polish)
const OR_MODEL_PREMIUM = process.env.OR_MODEL_PREMIUM || 'google/gemini-2.5-flash-lite';

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

/**
 * Send a messages array to OpenRouter and return the assistant reply text.
 * @param {string} localModel  — local tier name (mapped internally to OR model)
 * @param {Array<{role, content}>} messages
 * @returns {Promise<string>}
 */
async function complete(localModel, messages) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  const orModel   = mapModel(localModel);
  const normalized = injectSystemAsUser(messages);
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
};
