/**
 * voice.js — Voice transcription via Groq Whisper API
 *
 * Requires: GROQ_API_KEY in .env
 * Model: whisper-large-v3-turbo (fast, accurate, free tier: 28,800 sec/day)
 *
 * Flow:
 *   1. Download OGG voice file from Telegram
 *   2. POST to Groq transcription endpoint as multipart form
 *   3. Return transcribed text string
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL        = 'whisper-large-v3-turbo';

/**
 * Download a file from a URL to a temp path.
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => {
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
 * Build a multipart/form-data body manually (no external deps).
 * @param {object} fields  — { fieldName: stringValue }
 * @param {object} fileField — { name, filePath, filename, contentType }
 * @returns {{ body: Buffer, boundary: string }}
 */
function buildFormData(fields, fileField) {
  const boundary = '----WhoaFormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    );
  }

  const fileData = fs.readFileSync(fileField.filePath);
  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
    `Content-Type: ${fileField.contentType}\r\n\r\n`;

  parts.push(fileHeader);
  const body = Buffer.concat([
    Buffer.from(parts.join('')),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return { body, boundary };
}

/**
 * Transcribe a Telegram voice message.
 * @param {TelegramBot} bot
 * @param {string} fileId  — msg.voice.file_id
 * @returns {Promise<string|null>}  — transcribed text, or null if not configured
 */
async function transcribe(bot, fileId) {
  if (!GROQ_API_KEY) return null;

  // 1. Get download URL from Telegram
  const fileInfo = await bot.getFile(fileId);
  const fileUrl  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

  // 2. Download to temp file
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
  await downloadFile(fileUrl, tmpPath);

  try {
    // 3. Build multipart body
    const { body, boundary } = buildFormData(
      { model: MODEL, language: 'en', response_format: 'text' },
      { name: 'file', filePath: tmpPath, filename: 'voice.ogg', contentType: 'audio/ogg' }
    );

    // 4. POST to Groq
    const text = await new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      };

      const req = https.request(GROQ_URL, options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Groq API error ${res.statusCode}: ${data}`));
          } else {
            // response_format: 'text' → plain string
            resolve(data.trim());
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return text || null;
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

module.exports = { transcribe };
