/**
 * search.js — Web search tool via DuckDuckGo
 * Returns top N results as plain text summary for LLM injection.
 */
'use strict';

let ddg;
try {
  ddg = require('duck-duck-scrape');
} catch {
  ddg = null;
}

/**
 * Search DuckDuckGo and return a formatted string of results.
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<string>}
 */
async function webSearch(query, maxResults = 5) {
  if (!ddg) {
    return '[Web search unavailable — duck-duck-scrape not installed]';
  }

  try {
    const results = await ddg.search(query, {
      safeSearch: ddg.SafeSearchType.MODERATE,
    });

    const hits = (results.results || []).slice(0, maxResults);
    if (!hits.length) return `[No web results found for: "${query}"]`;

    const formatted = hits
      .map((r, i) => `**${i + 1}. ${r.title}**\n${r.url}\n${r.description || ''}`)
      .join('\n\n');

    return `Web search results for "${query}":\n\n${formatted}`;
  } catch (err) {
    return `[Web search error: ${err.message}]`;
  }
}

module.exports = { webSearch };
