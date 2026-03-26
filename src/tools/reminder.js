/**
 * reminder.js — One-time reminder system with persistence
 *
 * Supports:
 *   "30min"  → fires in 30 minutes
 *   "2h"     → fires in 2 hours
 *   "45s"    → fires in 45 seconds
 *   "17:30"  → fires at 17:30 today (or tomorrow if that time has passed)
 *
 * Reminders are persisted to data/reminders.json and restored on bot startup.
 * Expired reminders are discarded silently on restore.
 */
'use strict';

const db = require('../db/database');

// Map of internalId → { timeoutId, chatId, userId, text, fireAt }
const reminders = new Map();
let nextId = 1;
let initialized = false;

// ─── Time parsing ─────────────────────────────────────────────────────────────

// Polish ordinal feminine genitive hours ("o dziewiętnastej" = 19:00)
// Sorted longest-first so two-word entries match before single-word ones.
const POLISH_ORDINALS = [
  ['dwudziestej czwartej', 0],
  ['dwudziestej trzeciej', 23],
  ['dwudziestej drugiej', 22],
  ['dwudziestej pierwszej', 21],
  ['dwudziestej', 20],
  ['dziewiętnastej', 19],
  ['osiemnastej', 18],
  ['siedemnastej', 17],
  ['szesnastej', 16],
  ['piętnastej', 15],
  ['czternastej', 14],
  ['trzynastej', 13],
  ['dwunastej', 12],
  ['jedenastej', 11],
  ['dziesiątej', 10],
  ['dziewiątej', 9],
  ['ósmej', 8],
  ['siódmej', 7],
  ['szóstej', 6],
  ['piątej', 5],
  ['czwartej', 4],
  ['trzeciej', 3],
  ['drugiej', 2],
  ['pierwszej', 1],
  ['północy', 0],
  ['południa', 12],
];

/**
 * Parse a time string into milliseconds from now.
 * Returns null if the format is not recognised.
 * @param {string} str
 * @returns {number|null} delay in ms
 */
function parseTime(str) {
  if (!str) return null;
  str = str.trim();

  const s = str.trim().toLowerCase();

  // 1. Classic relative: Xmin, Xh, Xs
  const relNext = s.match(/^(\d+)\s*(min|m|h|s)$/i);
  if (relNext) {
    const val = parseInt(relNext[1]);
    const unit = relNext[2].toLowerCase();
    if (unit === 's') return val * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    return val * 60 * 1000; // default min
  }

  // 2. DD.MM.YYYY or DD.MM date (e.g. "4.04.2026 19:00" or "04.04 19:00")
  const dmyMatch = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*(?:o\s+)?(?:(\d{1,2}):(\d{2}))?$/);
  if (dmyMatch) {
    const day   = parseInt(dmyMatch[1]);
    const month = parseInt(dmyMatch[2]) - 1; // 0-indexed
    const year  = dmyMatch[3] ? parseInt(dmyMatch[3]) : new Date().getFullYear();
    const hours = dmyMatch[4] != null ? parseInt(dmyMatch[4]) : 0;
    const mins  = dmyMatch[5] != null ? parseInt(dmyMatch[5]) : 0;
    const target = new Date(year, month, day, hours, mins, 0, 0);
    const delay  = target.getTime() - Date.now();
    return delay > 0 ? delay : null;
  }

  // 3. Absolute / Relative Day parsing
  // Normalize string: "jutro o 19:00" -> "jutro 19:00"
  let clean = s.replace(/\bo\b/g, '').replace(/\s+/g, ' ');
  
  let targetDate = new Date();
  let timeStr = clean;

  const hasJutro = clean.includes('jutro') || clean.includes('tomorrow');
  const hasPojutrze = clean.includes('pojutrze');
  const hasDzisiaj = clean.includes('dzisiaj') || clean.includes('today');

  // Day offsets
  if (hasJutro) {
    targetDate.setDate(targetDate.getDate() + 1);
    timeStr = clean.replace(/jutro|tomorrow/g, '').trim();
  } else if (hasPojutrze) {
    targetDate.setDate(targetDate.getDate() + 2);
    timeStr = clean.replace(/pojutrze/g, '').trim();
  } else if (hasDzisiaj) {
    timeStr = clean.replace(/dzisiaj|today/g, '').trim();
  }

  // Check for Polish ordinal hour (e.g. "dziewiętnastej", "dwudziestej pierwszej")
  for (const [ordinal, hour] of POLISH_ORDINALS) {
    if (timeStr.includes(ordinal)) {
      targetDate.setHours(hour, 0, 0, 0);
      const isRelativeDayMentioned = hasJutro || hasPojutrze || hasDzisiaj;
      if (!isRelativeDayMentioned && targetDate.getTime() < Date.now()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      const delay = targetDate.getTime() - Date.now();
      return delay > 0 ? delay : null;
    }
  }

  // Parse time part (HH:MM or HH)
  const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const mins = parseInt(timeMatch[2] || '0');
    const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    targetDate.setHours(hours, mins, 0, 0);

    // If no specific day was mentioned AND the time is in the past, assume tomorrow
    const isRelativeDayMentioned = hasJutro || hasPojutrze || hasDzisiaj;
    if (!isRelativeDayMentioned && targetDate.getTime() < Date.now()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }

    const delay = targetDate.getTime() - Date.now();
    return delay > 0 ? delay : null;
  }

  return null;
}

/**
 * Format milliseconds into a human-readable "fires in X" string.
 */
function formatDelay(ms) {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60)  return `${totalSec}s`;
  const min = Math.round(totalSec / 60);
  if (min  < 60)  return `${min} min`;
  const h   = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Arm a single reminder: set the timeout, store in Map.
 */
function armReminder(bot, { id, chatId, userId, text, fireAt }) {
  const delayMs = new Date(fireAt).getTime() - Date.now();
  if (delayMs <= 0) return; // already expired

  const timeoutId = setTimeout(async () => {
    reminders.delete(id);
    persist();
    try {
      await bot.sendMessage(chatId, `⏰ *Reminder:* ${text}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[reminder] Failed to send:', err.message);
    }
  }, delayMs);

  reminders.set(id, { id, timeoutId, chatId, userId, text, fireAt });
}

/**
 * Write current reminder state to disk (strips in-memory-only timeoutId).
 */
function persist() {
  if (!initialized) {
    console.warn('[reminder] Skipped persist(): initialization not finished.');
    return;
  }
  db.saveReminders([...reminders.values()]).catch(err =>
    console.error('[reminder] persist failed:', err.message)
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Restore reminders from disk on bot startup. Call once with the bot instance.
 */
async function init(bot) {
  const saved = await db.loadReminders();
  const now = Date.now();
  let missedCount = 0;

  for (const r of saved) {
    const fireAtMs = new Date(r.fireAt).getTime();
    if (fireAtMs <= now) {
      // Missed while offline — notify user immediately
      try {
        await bot.sendMessage(r.chatId, `⏰ *Missed Reminder:* ${r.text}\n_(scheduled for ${r.fireAt})_`, { parse_mode: 'Markdown' });
        missedCount++;
      } catch (err) {
        console.error('[reminder] Failed to send missed notify:', err.message);
      }
    } else {
      armReminder(bot, r);
    }
  }

  // Keep nextId above the highest restored id
  if (saved.length) {
    const ids = saved.map(r => Number(r.id)).filter(id => !isNaN(id));
    if (ids.length) {
      const maxId = Math.max(...ids);
      if (maxId >= nextId) nextId = maxId + 1;
    }
  }

  initialized = true;
  console.log(`[reminder] Init complete. Restored: ${saved.length - missedCount}, Missed: ${missedCount}`);
}

/**
 * Add a new reminder.
 * @param {TelegramBot} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {string} text       — reminder message
 * @param {number} delayMs    — from parseTime()
 * @returns {{ id: number, fireAt: string, inMs: string }}
 */
function add(bot, chatId, userId, text, delayMs) {
  const id     = nextId++;
  const fireAt = new Date(Date.now() + delayMs).toISOString();

  armReminder(bot, { id, chatId, userId, text, fireAt });
  persist();

  return { id, fireAt, inMs: formatDelay(delayMs) };
}

/**
 * List all active reminders for a user.
 * @param {number} userId
 * @returns {Array<{ id, text, fireAt }>}
 */
function list(userId) {
  return [...reminders.entries()]
    .filter(([, r]) => r.userId === userId)
    .map(([id, r]) => ({ id, text: r.text, fireAt: r.fireAt }));
}

/**
 * Cancel reminder by its position in the user's list (1-based).
 * Returns the cancelled reminder text, or null if not found.
 * @param {number} userId
 * @param {number} pos  — 1-based position from list()
 * @returns {string|null}
 */
function cancel(userId, pos) {
  const userList = list(userId);
  if (pos < 1 || pos > userList.length) return null;

  const { id, text } = userList[pos - 1];
  const r = reminders.get(id);
  if (r) clearTimeout(r.timeoutId);
  reminders.delete(id);
  persist();
  return text;
}

module.exports = { init, parseTime, formatDelay, add, list, cancel };
