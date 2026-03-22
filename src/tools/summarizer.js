/**
 * summarizer.js — Fetch a URL and summarize its content via LLM
 */
'use strict';

const axios = require('axios');
const openrouter = require('../llm/openrouter');
const ollama     = require('../llm/ollama');

const FETCH_TIMEOUT    = 12_000;
const MAX_CONTENT_LEN  = 5_000; // chars passed to LLM — ~1250 tokens

// Exported so commands.js / nlRouter can detect URLs in messages
const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** Strip HTML tags and collapse whitespace — returns plain text. */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchText(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT,
    maxContentLength: 1_000_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TelegramSummaryBot/1.0)' },
    // Accept HTML and plain text; reject binaries
    validateStatus: s => s >= 200 && s < 400,
  });

  const ct = res.headers['content-type'] || '';
  if (!ct.includes('text') && !ct.includes('html') && !ct.includes('json')) {
    throw new Error(`Unsupported content-type: ${ct}`);
  }

  const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const text = ct.includes('html') ? stripHtml(raw) : raw;
  return text.slice(0, MAX_CONTENT_LEN);
}

/**
 * Summarize a web page in 4–5 sentences.
 * @param {string} url
 * @param {'pl'|'en'} lang
 * @returns {Promise<string>}
 */
async function summarizeUrl(url, lang = 'pl') {
  let text;
  try {
    text = await fetchText(url);
  } catch (err) {
    return `⚠️ ${lang === 'pl' ? 'Nie udało się pobrać strony' : 'Could not fetch page'}: ${err.message}`;
  }

  if (!text || text.length < 80) {
    return lang === 'pl'
      ? '⚠️ Strona nie zawiera wystarczającej ilości tekstu.'
      : '⚠️ Page has no readable content.';
  }

  const langWord = lang === 'pl' ? 'Polish' : 'English';
  const prompt = `Summarize the following web page content in 4-5 concise sentences in ${langWord}. Lead with the main point. Do not start with "The article" or "This text". Do not add headers.\n\n${text}`;

  const messages = [
    { role: 'system', content: 'You are a concise summarizer. Output only the summary, nothing else.' },
    { role: 'user',   content: prompt },
  ];

  try {
    if (process.env.OPENROUTER_API_KEY) {
      return await openrouter.complete(openrouter.OR_MODEL_MEDIUM, messages, 300);
    }
    return await ollama.completeRaw(process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M', messages);
  } catch (err) {
    return `⚠️ ${lang === 'pl' ? 'Błąd LLM' : 'LLM error'}: ${err.message}`;
  }
}

module.exports = { summarizeUrl, URL_RE };
