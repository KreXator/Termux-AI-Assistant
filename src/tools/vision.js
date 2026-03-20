/**
 * vision.js — Image analysis
 *
 * Primary:  OpenRouter vision model (google/gemma-3-12b-it:free)
 * Fallback: Local Ollama vision model (llava:7b)
 *
 * Flow:
 *   1. Download photo from Telegram
 *   2. Base64-encode it
 *   3. Try OpenRouter vision → fall back to Ollama on error
 *   4. Return the model's text response
 */
'use strict';

const https      = require('https');
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const axios      = require('axios');
const openrouter = require('../llm/openrouter');

const VISION_MODEL = process.env.VISION_MODEL   || 'llava:7b';
const OLLAMA_BASE  = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

/**
 * Returns the model ID that will actually handle vision requests.
 */
function getActiveVisionModel() {
  if (process.env.OPENROUTER_API_KEY) return openrouter.OR_VISION_MODEL;
  return VISION_MODEL;
}

/**
 * Download a file from a URL to a temp path.
 * Handles both http and https.
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    lib.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Analyze an image from Telegram.
 * @param {TelegramBot} bot
 * @param {string} fileId      — file_id of the largest photo size
 * @param {string} [prompt]    — optional user prompt/question about the image
 * @returns {Promise<string>}  — model's description/analysis
 */
async function analyzeImage(bot, fileId, prompt = 'Describe this image in detail.') {
  // 1. Get download URL
  const fileInfo = await bot.getFile(fileId);
  const fileUrl  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

  // 2. Download to temp file
  const ext     = path.extname(fileInfo.file_path) || '.jpg';
  const tmpPath = path.join(os.tmpdir(), `vision_${Date.now()}${ext}`);
  await downloadFile(fileUrl, tmpPath);

  try {
    // 3. Base64 encode
    const imageData = fs.readFileSync(tmpPath).toString('base64');
    const ext       = path.extname(fileInfo.file_path).toLowerCase();
    const mimeType  = ext === '.png' ? 'image/png' : 'image/jpeg';

    // 4a. Try OpenRouter vision (primary)
    if (process.env.OPENROUTER_API_KEY) {
      try {
        return await openrouter.completeVision(imageData, prompt, mimeType);
      } catch (err) {
        console.warn('[vision] OpenRouter failed, falling back to Ollama:', err.message);
      }
    }

    // 4b. Ollama fallback
    const res = await axios.post(`${OLLAMA_BASE}/api/chat`, {
      model:    VISION_MODEL,
      stream:   false,
      messages: [{ role: 'user', content: prompt, images: [imageData] }],
    }, { timeout: 120_000 });

    const reply = res.data.message?.content || '';
    return reply.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

module.exports = { analyzeImage, getActiveVisionModel, VISION_MODEL };
