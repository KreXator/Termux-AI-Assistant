/**
 * rss.js — Universal RSS/Atom feed fetcher
 *
 * Fetches any RSS or Atom feed and returns a normalized array of items.
 * Deduplication is handled by the caller (briefing.js) using item IDs stored in DB.
 */
'use strict';

const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['media:content', 'media'], ['content:encoded', 'contentEncoded']],
  },
});

/**
 * Fetch and parse an RSS/Atom feed URL.
 * @param {string} url
 * @returns {Promise<Array<{id, title, link, summary, pubDate, category}>>}
 */
async function fetchFeed(url) {
  const feed = await parser.parseURL(url);
  return feed.items.map(item => ({
    id:       item.guid || item.link || item.title || String(Math.random()),
    title:    (item.title    || '(no title)').trim(),
    link:     item.link      || '',
    summary:  (item.contentSnippet || item.contentEncoded || item.content || '').slice(0, 400).trim(),
    pubDate:  item.pubDate   || item.isoDate || '',
    feedTitle: feed.title    || url,
  }));
}

/**
 * Fetch multiple feeds and return combined items, tagging each with its feed label.
 * Errors on individual feeds are logged but don't abort others.
 * @param {Array<{url, label, category}>} feeds
 * @returns {Promise<Array<{id, title, link, summary, pubDate, feedTitle, label, category}>>}
 */
async function fetchFeeds(feeds) {
  const results = await Promise.allSettled(
    feeds.map(f => fetchFeed(f.url).then(items =>
      items.map(item => ({ ...item, label: f.label, category: f.category }))
    ))
  );

  const items = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      items.push(...results[i].value);
    } else {
      console.warn(`[rss] Failed to fetch "${feeds[i].label}" (${feeds[i].url}): ${results[i].reason?.message}`);
    }
  }
  return items;
}

module.exports = { fetchFeed, fetchFeeds };
