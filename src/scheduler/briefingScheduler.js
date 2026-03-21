/**
 * briefingScheduler.js — Cron jobs for daily morning/evening briefings
 *
 * Reads all users' briefing configs on startup and schedules their reports.
 * New schedules are activated immediately when the user changes their config.
 */
'use strict';

const cron     = require('node-cron');
const db       = require('../db/database');
const briefing = require('../tools/briefing');

let _bot = null;

// taskKey → cron.ScheduledTask
const tasks = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeToCron(time) {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) throw new Error(`Invalid time: "${time}"`);
  return `${m} ${h} * * *`;
}

function taskKey(userId, type) {
  return `${userId}:${type}`;
}

async function sendLong(chatId, text) {
  const MAX = 4000;
  for (let i = 0; i < text.length; i += MAX) {
    await _bot.sendMessage(chatId, text.slice(i, i + MAX), { parse_mode: 'Markdown' });
  }
}

async function runBriefing(userId, chatId, type) {
  console.log(`[briefingScheduler] Running ${type} for userId=${userId}`);
  try {
    const text = type === 'morning'
      ? await briefing.buildMorning(userId)
      : await briefing.buildEvening(userId);

    if (text) await sendLong(chatId, text);
    else console.log(`[briefingScheduler] No content for ${type} userId=${userId}`);
  } catch (err) {
    console.error(`[briefingScheduler] Error for ${type} userId=${userId}:`, err.message);
  }
}

// ─── Task management ─────────────────────────────────────────────────────────

function scheduleOne(userId, chatId, type, time) {
  const key = taskKey(userId, type);
  // cancel existing
  if (tasks.has(key)) { tasks.get(key).stop(); tasks.delete(key); }

  let expr;
  try { expr = timeToCron(time); }
  catch (err) { console.error(`[briefingScheduler] ${err.message}`); return; }

  const tz   = process.env.TZ || 'Europe/Warsaw';
  const task = cron.schedule(expr, () => runBriefing(userId, chatId, type), { timezone: tz });
  tasks.set(key, task);
  console.log(`[briefingScheduler] Scheduled ${type} for userId=${userId} at ${time} (${tz})`);
}

function cancelOne(userId, type) {
  const key = taskKey(userId, type);
  if (tasks.has(key)) { tasks.get(key).stop(); tasks.delete(key); }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize briefing scheduler. Must be called once at startup with the bot instance.
 */
async function init(bot) {
  _bot = bot;
  const configs = await db.getAllBriefingConfigs();
  for (const cfg of configs) {
    if (!cfg.chatId) continue;
    if (cfg.morningEnabled) scheduleOne(cfg.userId, cfg.chatId, 'morning', cfg.morningTime);
    if (cfg.eveningEnabled) scheduleOne(cfg.userId, cfg.chatId, 'evening', cfg.eveningTime);
  }
  console.log(`[briefingScheduler] Initialized — ${tasks.size} task(s) active.`);
}

/**
 * Reload a single user's briefing tasks after config change.
 */
async function reload(userId, chatId) {
  const cfg = await db.getBriefingConfig(userId);
  if (cfg.morningEnabled) scheduleOne(userId, chatId, 'morning', cfg.morningTime);
  else cancelOne(userId, 'morning');
  if (cfg.eveningEnabled) scheduleOne(userId, chatId, 'evening', cfg.eveningTime);
  else cancelOne(userId, 'evening');
}

/**
 * Trigger a briefing immediately (for /briefing now morning|evening).
 */
async function runNow(userId, chatId, type) {
  await runBriefing(userId, chatId, type);
}

module.exports = { init, reload, runNow };
