/**
 * briefing.js — Daily briefing report generator
 *
 * Builds morning and evening reports from the user's RSS feeds.
 * New items only (deduplication via DB seen-IDs).
 * LLM summarizes the content using the user's profile from /remember.
 */
'use strict';

const db         = require('../db/database');
const rss        = require('./rss');
const openrouter = require('../llm/openrouter');
const ollama     = require('../llm/ollama');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today() {
  return new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/**
 * Call LLM for summarization. Uses OR premium (reliable, no rate limit) or Ollama fallback.
 */
async function summarize(prompt) {
  try {
    return await openrouter.complete(openrouter.OR_MODEL_PREMIUM, [
      { role: 'user', content: prompt },
    ]);
  } catch {
    return await ollama.completeRaw(process.env.MODEL_LARGE || 'qwen3:8b', [
      { role: 'user', content: prompt },
    ]);
  }
}

/**
 * Filter feed items to only those not yet seen, then mark them as seen.
 */
function filterNew(userId, items) {
  const seen    = db.getBriefingSeenIds(userId);
  const newOnes = items.filter(i => !seen.has(i.id));
  if (newOnes.length) db.markBriefingSeen(userId, newOnes.map(i => i.id));
  return newOnes;
}

/**
 * Apply keyword filter to job-category items.
 * Items from non-jobs categories pass through unchanged.
 * Jobs items are kept only if at least one keyword matches title or summary.
 * If user has no keywords, all job items pass through.
 */
function applyKeywordFilter(userId, items) {
  const keywords = db.getBriefingKeywords(userId);
  if (!keywords.length) return items;
  return items.filter(item => {
    if (item.category !== 'jobs') return true;
    const text = `${item.title} ${item.summary}`.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

/**
 * Format items by category into a readable block.
 */
function formatItems(items, maxPerCategory = 8) {
  const byCategory = {};
  for (const item of items) {
    const cat = item.category || item.label || 'general';
    if (!byCategory[cat]) byCategory[cat] = [];
    if (byCategory[cat].length < maxPerCategory) byCategory[cat].push(item);
  }

  const lines = [];
  for (const [cat, catItems] of Object.entries(byCategory)) {
    lines.push(`*${cat.toUpperCase()}*`);
    for (const item of catItems) {
      const title = item.title.slice(0, 100);
      const link  = item.link ? ` — [link](${item.link})` : '';
      lines.push(`• ${title}${link}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Morning briefing ─────────────────────────────────────────────────────────

/**
 * Build and return the morning briefing text for a user.
 * Returns null if no feeds configured or no new items.
 */
async function buildMorning(userId) {
  const feeds = db.getBriefingFeeds(userId);
  if (!feeds.length) return null;

  console.log(`[briefing] Morning for user ${userId} — fetching ${feeds.length} feed(s)…`);
  const allItems     = await rss.fetchFeeds(feeds);
  const newItems     = filterNew(userId, allItems);
  const filteredItems = applyKeywordFilter(userId, newItems);

  if (!filteredItems.length) {
    return `🌅 *PORANNY RAPORT — ${today()}*\n\n_Brak nowych pozycji w feedach._`;
  }

  // Build context for LLM summary
  const memFacts  = db.getMemory(userId);
  const memBlock  = memFacts.length
    ? `Fakty o użytkowniku:\n${memFacts.map(f => `- ${f.fact}`).join('\n')}\n\n`
    : '';

  const itemsText = filteredItems.map(i =>
    `[${i.label}] ${i.title}${i.summary ? ': ' + i.summary : ''}`
  ).join('\n');

  const summary = await summarize(
    `${memBlock}Oto nowe pozycje z RSS z dzisiaj rano:\n\n${itemsText}\n\n` +
    `Napisz krótkie, zwięzłe podsumowanie po polsku (maks 5 zdań). ` +
    `Wyróżnij pozycje najbardziej istotne dla użytkownika. Nie wymieniaj wszystkiego — skup się na tym co ważne.`
  );

  const itemsList = formatItems(filteredItems);

  return [
    `🌅 *PORANNY RAPORT — ${today()}*`,
    `_(${filteredItems.length} nowych pozycji z ${feeds.length} feedów)_`,
    '',
    `📊 *PODSUMOWANIE*`,
    summary,
    '',
    `📋 *SZCZEGÓŁY*`,
    itemsList,
  ].join('\n');
}

// ─── Evening briefing ─────────────────────────────────────────────────────────

/**
 * Build and return the evening briefing text for a user.
 * Evening fetches again but only shows items added since morning (new unseen ones).
 */
async function buildEvening(userId) {
  const feeds = db.getBriefingFeeds(userId);
  if (!feeds.length) return null;

  console.log(`[briefing] Evening for user ${userId} — fetching ${feeds.length} feed(s)…`);
  const allItems      = await rss.fetchFeeds(feeds);
  const newItems      = filterNew(userId, allItems);
  const filteredItems = applyKeywordFilter(userId, newItems);

  if (!filteredItems.length) {
    return `🌙 *WIECZORNY RAPORT — ${today()}*\n\n_Brak nowych pozycji od porannego raportu._`;
  }

  const memFacts = db.getMemory(userId);
  const memBlock = memFacts.length
    ? `Fakty o użytkowniku:\n${memFacts.map(f => `- ${f.fact}`).join('\n')}\n\n`
    : '';

  const itemsText = filteredItems.map(i =>
    `[${i.label}] ${i.title}${i.summary ? ': ' + i.summary : ''}`
  ).join('\n');

  const summary = await summarize(
    `${memBlock}Oto nowe pozycje z RSS z dzisiaj po południu/wieczorem:\n\n${itemsText}\n\n` +
    `Napisz krótkie wieczorne podsumowanie dnia po polsku (maks 4 zdania). ` +
    `Co było najważniejsze? Jakie są kluczowe wnioski na jutro?`
  );

  const itemsList = formatItems(filteredItems);

  return [
    `🌙 *WIECZORNY RAPORT — ${today()}*`,
    `_(${filteredItems.length} nowych pozycji)_`,
    '',
    `📊 *PODSUMOWANIE DNIA*`,
    summary,
    '',
    `📋 *NOWE POZYCJE*`,
    itemsList,
  ].join('\n');
}

module.exports = { buildMorning, buildEvening };
