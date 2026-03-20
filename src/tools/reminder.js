/**
 * reminder.js — In-memory one-time reminder system
 *
 * Supports:
 *   "30min"  → fires in 30 minutes
 *   "2h"     → fires in 2 hours
 *   "45s"    → fires in 45 seconds
 *   "17:30"  → fires at 17:30 today (or tomorrow if that time has passed)
 *
 * Reminders are NOT persisted across restarts (by design — keep it simple).
 */
'use strict';

// Map of internalId → reminder object
const reminders = new Map();
let nextId = 1;

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a time string into milliseconds from now.
 * Returns null if the format is not recognised.
 * @param {string} str
 * @returns {number|null} delay in ms
 */
function parseTime(str) {
  if (!str) return null;
  str = str.trim();

  // Xmin / Xm
  const minMatch = str.match(/^(\d+)\s*(?:min|m)$/i);
  if (minMatch) return parseInt(minMatch[1], 10) * 60_000;

  // Xh
  const hMatch = str.match(/^(\d+)\s*h$/i);
  if (hMatch) return parseInt(hMatch[1], 10) * 3_600_000;

  // Xs
  const sMatch = str.match(/^(\d+)\s*s$/i);
  if (sMatch) return parseInt(sMatch[1], 10) * 1_000;

  // HH:MM — fire at a specific time today or tomorrow
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const now    = new Date();
    const target = new Date();
    target.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new reminder.
 * @param {object} bot         — TelegramBot instance
 * @param {number} chatId
 * @param {number} userId
 * @param {string} text        — reminder message
 * @param {number} delayMs     — from parseTime()
 * @returns {{ id: number, fireAt: string, inMs: string }}
 */
function add(bot, chatId, userId, text, delayMs) {
  const id     = nextId++;
  const fireAt = new Date(Date.now() + delayMs).toISOString();

  const timeoutId = setTimeout(async () => {
    reminders.delete(id);
    try {
      await bot.sendMessage(chatId, `⏰ *Reminder:* ${text}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[reminder] Failed to send:', err.message);
    }
  }, delayMs);

  reminders.set(id, { timeoutId, chatId, userId, text, fireAt });

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
  return text;
}

module.exports = { parseTime, formatDelay, add, list, cancel };
