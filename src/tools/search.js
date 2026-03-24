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
  try {
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
  } catch (err) {
    if (err.response?.status === 429) {
      return `[Rate limit exceeded for Serper API. Please try again later or check your SERPER_API_KEY quota.]`;
    }
    throw err;
  }
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

const NEWS_DOMAINS = {
  local:   ['gazetalubuska.pl', 'wzielonej.pl', 'zielonanews.pl', 'rzg.pl'],
  country: ['tvn24.pl', 'rmf24.pl', 'onet.pl', 'wp.pl', 'interia.pl', 'rp.pl'],
  world:   ['reuters.com', 'bbc.com', 'cnn.com', 'theguardian.com', 'dw.com'],
  tech:    ['spidersweb.pl', 'dobreprogramy.pl', 'theverge.com', 'techcrunch.com', 'wired.com', 'engadget.com']
};

/**
 * Strip Polish/English command verbs from a news query so they don't pollute search results.
 */
function cleanNewsQuery(query) {
  if (!query) return '';
  const cleaned = query
    .replace(/^(podaj|pokaż|pokaż mi|daj|daj mi|podajcie|sprawdź|check out|show me|give me|co to są|jakie są|co nowego w|co nowego z)\s+/i, '')
    .trim();
  return cleaned || query;
}

/**
 * Fetch news headlines using Serper's /news endpoint.
 * Supports domain whitelisting via 'category'.
 * @param {string} query
 * @param {number} maxResults
 * @param {'local'|'country'|'world'|'tech'} [category]
 * @returns {Promise<string>}
 */
async function serperNewsSearch(query, maxResults = 5, category = null) {
  try {
    let q = cleanNewsQuery(query);
    
    // Apply domain whitelisting if category is specified
    if (category && NEWS_DOMAINS[category]) {
      const sites = NEWS_DOMAINS[category].map(s => `site:${s}`).join(' OR ');
      q = `(${sites}) ${q}`.trim();
    }

    const res = await axios.post(
      'https://google.serper.dev/news',
      { q, num: maxResults, tbs: 'qdr:d' }, // past 24h for freshness
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
      const date = r.date ? ` _(${r.date})_` : '';
      const source = r.source ? `*${r.source}*` : '';
      const title = (r.title || 'No title').replace(/[\[\]\(\)]/g, ''); // Basic sanitization for Markdown links
      const snippet = (r.snippet || '').slice(0, 180);
      return `${i + 1}. [${title}](${r.link})${date}\n   ${source}${snippet ? ' — ' + snippet : ''}`;
    });

    const header = category ? `📰 *${category.toUpperCase()} NEWS: ${query}*` : `📰 *${query}*`;
    return `${header}\n\n${lines.join('\n\n')}`;
  } catch (err) {
    if (err.response?.status === 429) {
      return `[Rate limit exceeded for Serper News API.]`;
    }
    throw err;
  }
}

/**
 * Multi-source overview: Local, Country, World.
 */
async function getNewsDigest(query = 'najważniejsze wiadomości') {
  try {
    const results = await Promise.allSettled([
      serperNewsSearch('Zielona Góra', 3, 'local'),
      serperNewsSearch('Polska', 3, 'country'),
      serperNewsSearch('World', 3, 'world')
    ]);

    const sections = results.map((res, i) => {
      if (res.status === 'fulfilled') return res.value;
      return `❌ Błąd w kategorii ${['Lokalne', 'Krajowe', 'Świat'][i]}: ${res.reason.message}`;
    });

    return `🗓️ *CODZIENNY PRZEGLĄD WIADOMOŚCI*\n_${new Date().toLocaleDateString('pl-PL')}_\n\n${sections.join('\n\n---\n\n')}`;
  } catch (err) {
    return `❌ Nie udało się wygenerować przeglądu: ${err.message}`;
  }
}

// ─── Serper Jobs ──────────────────────────────────────────────────────────────

/**
 * Search job listings via Serper's /search endpoint with Polish locale.
 * Handles Google Jobs cards (`res.data.jobs`) when present, falls back to organic.
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<string>}
 */
async function serperJobsSearch(query, maxResults = 5) {
  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: maxResults, gl: 'pl', hl: 'pl' },
      {
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );

    // Google Jobs cards (Serper may include these for job queries)
    const jobCards = res.data.jobs || [];
    if (jobCards.length) {
      const lines = jobCards.slice(0, maxResults).map((j, i) => {
        const salary = j.salary ? ` · *${j.salary}*` : '';
        const location = j.location ? ` · 📍 ${j.location}` : '';
        const via = j.via ? ` · ${j.via}` : '';
        const link = (j.applyOptions?.[0]?.link) || j.shareLink || '';
        return `${i + 1}. *${j.title}*\n   ${j.companyName || ''}${salary}${location}${via}${link ? '\n   ' + link : ''}`;
      });
      return `💼 *${query}*\n\n${lines.join('\n\n')}`;
    }

    // Fallback: organic results with job-focused formatting
    const hits = (res.data.organic || []).slice(0, maxResults);
    if (!hits.length) return `[Brak wyników dla: "${query}"]`;

    const lines = hits.map((r, i) => {
      const snippet = (r.snippet || '').slice(0, 200);
      return `${i + 1}. [${r.title}](${r.link})\n   ${snippet}`;
    });
    return `💼 *${query}*\n\n${lines.join('\n\n')}`;
  } catch (err) {
    if (err.response?.status === 429) {
      return `[Rate limit exceeded for Serper Jobs API. Please try again later or check your SERPER_API_KEY quota.]`;
    }
    throw err;
  }
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

module.exports = { webSearch, serperNewsSearch, serperJobsSearch };
