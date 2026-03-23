/**
 * search.js — Web search tool
 *
 * Priority:
 *   1. Serper.dev (SERPER_API_KEY set in .env) — real Google results, reliable, recommended
 *   2. DuckDuckGo scrape fallback (duck-duck-scrape) — no key needed, but fragile
 *
 * Get a free Serper key (2500 free queries) at https://serper.dev
 */
'use strict';

const axios = require('axios');

let ddg;
try {
  ddg = require('duck-duck-scrape');
} catch {
  ddg = null;
}

// ─── Serper (Google) ─────────────────────────────────────────────────────────

async function serperSearch(query, maxResults = 3) {
  const res = await axios.post(
    'https://google.serper.dev/search',
    { q: query, num: maxResults },
    {
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    }
  );

  const hits = (res.data.organic || []).slice(0, maxResults);
  if (!hits.length) return `[No results found for: "${query}"]`;

  const formatted = hits
    .map((r, i) => {
      const snippet = (r.snippet || '').slice(0, 150);
      return `**${i + 1}. ${r.title}**\n${r.link}\n${snippet}`;
    })
    .join('\n\n');

  return `🔍 Google results for "${query}":\n\n${formatted}`;
}

// ─── DuckDuckGo scrape fallback ───────────────────────────────────────────────

async function ddgSearch(query, maxResults = 3) {
  if (!ddg) return '[Web search unavailable — install duck-duck-scrape or set SERPER_API_KEY]';

  const results = await ddg.search(query, { safeSearch: ddg.SafeSearchType.MODERATE });
  const hits = (results.results || []).slice(0, maxResults);
  if (!hits.length) return `[No results found for: "${query}"]`;

  const formatted = hits
    .map((r, i) => {
      const desc = (r.description || '').slice(0, 150);
      return `**${i + 1}. ${r.title}**\n${r.url}\n${desc}`;
    })
    .join('\n\n');

  return `🔍 DuckDuckGo results for "${query}":\n\n${formatted}`;
}

// ─── Serper News ──────────────────────────────────────────────────────────────

/**
 * Fetch news headlines using Serper's /news endpoint.
 * Returns formatted text ready to send to the user — no LLM needed.
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<string>}
 */
/**
 * Strip Polish/English command verbs from a news query so they don't pollute search results.
 * "Podaj wiadomości z kraju" → "wiadomości z kraju"  (avoids matching "PODAJ DALEJ" foundation)
 */
function cleanNewsQuery(query) {
  const cleaned = query
    .replace(/^(podaj|pokaż|pokaż mi|daj|daj mi|podajcie|sprawdź|check out|show me|give me|co to są|jakie są|co nowego w|co nowego z)\s+/i, '')
    .trim();
  return cleaned || query;
}

async function serperNewsSearch(query, maxResults = 5) {
  const q = cleanNewsQuery(query);
  const res = await axios.post(
    'https://google.serper.dev/news',
    { q, num: maxResults, gl: 'pl', hl: 'pl', tbs: 'qdr:w' },  // past week
    {
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    }
  );

  const hits = (res.data.news || []).slice(0, maxResults);
  if (!hits.length) return `[Brak wyników dla: "${q}"]`;

  const lines = hits.map((r, i) => {
    const date    = r.date    ? ` _(${r.date})_`    : '';
    const source  = r.source  ? `*${r.source}*`     : '';
    const snippet = (r.snippet || '').slice(0, 180);
    return `${i + 1}. [${r.title}](${r.link})${date}\n   ${source}${snippet ? ' — ' + snippet : ''}`;
  });

  return `📰 *${q}*\n\n${lines.join('\n\n')}`;
}

// ─── Unified entry point ──────────────────────────────────────────────────────

/**
 * Search the web and return a formatted string of results.
 * Uses Serper (Google) if SERPER_API_KEY is set, otherwise DuckDuckGo.
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<string>}
 */
async function webSearch(query, maxResults = 3) {
  try {
    if (process.env.SERPER_API_KEY) {
      return await serperSearch(query, maxResults);
    }
    return await ddgSearch(query, maxResults);
  } catch (err) {
    return `[Web search error: ${err.message}]`;
  }
}

module.exports = { webSearch, serperNewsSearch };
