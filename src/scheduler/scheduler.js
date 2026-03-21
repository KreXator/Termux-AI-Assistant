/**
 * scheduler.js — Cron-based scheduled tasks
 *
 * Each user can register daily web searches via /schedule add HH:MM [query].
 * At the specified time, the bot runs the search and pushes results to the user's chat.
 *
 * Uses node-cron under the hood. All schedules are persisted in data/schedules.json
 * and restored automatically when the bot restarts.
 */
'use strict';

const cron   = require('node-cron');
const db     = require('../db/database');
const search = require('../tools/search');

// Map of scheduleId → cron.ScheduledTask
const activeTasks = new Map();

let _bot = null;  // set on init()

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert "HH:MM" to a cron expression for daily execution.
 * "08:30" → "30 8 * * *"
 */
function timeToCron(time) {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) throw new Error(`Invalid time format: "${time}". Use HH:MM`);
  return `${m} ${h} * * *`;
}

/**
 * Start a single cron task and store it in activeTasks.
 */
function startTask(schedule) {
  if (activeTasks.has(schedule.id)) return; // already running

  let expr;
  try {
    expr = timeToCron(schedule.time);
  } catch (err) {
    console.error(`[scheduler] Cannot start schedule ${schedule.id}:`, err.message);
    return;
  }

  const tz = process.env.TZ || 'Europe/Warsaw';

  const task = cron.schedule(expr, async () => {
    console.log(`[scheduler] Running: "${schedule.query}" for chatId=${schedule.chatId}`);
    try {
      const results = await search.webSearch(schedule.query, 5);
      const header  = `🔔 *Scheduled alert* — _${schedule.query}_\n\n`;
      await sendLong(schedule.chatId, header + results);
    } catch (err) {
      console.error('[scheduler] Task error:', err.message);
    }
  }, { timezone: tz });

  activeTasks.set(schedule.id, task);
  console.log(`[scheduler] Scheduled "${schedule.query}" daily at ${schedule.time} (${tz})`);
}

/**
 * Helper: split long messages and send via bot.
 */
async function sendLong(chatId, text) {
  const MAX = 4000;
  for (let i = 0; i < text.length; i += MAX) {
    await _bot.sendMessage(chatId, text.slice(i, i + MAX), { parse_mode: 'Markdown' });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the scheduler. Must be called once at startup with the bot instance.
 * Restores all persisted schedules from the database.
 */
async function init(bot) {
  _bot = bot;
  const all = await db.getAllSchedules();
  for (const schedule of all) {
    startTask(schedule);
  }
  console.log(`[scheduler] Initialized — ${all.length} schedule(s) loaded.`);
}

/**
 * Add and start a new schedule immediately.
 * @param {object} schedule — as returned by db.addSchedule()
 */
function add(schedule) {
  startTask(schedule);
}

/**
 * Stop and remove a schedule by its id.
 * @param {string} scheduleId
 */
function remove(scheduleId) {
  const task = activeTasks.get(scheduleId);
  if (task) {
    task.stop();
    activeTasks.delete(scheduleId);
  }
}

/**
 * Run a schedule immediately (for testing via /schedule test [n]).
 * @param {object} schedule
 */
async function runNow(schedule) {
  console.log(`[scheduler] Running NOW: "${schedule.query}" for chatId=${schedule.chatId}`);
  const results = await search.webSearch(schedule.query, 5);
  const header  = `🔔 *Test run* — _${schedule.query}_\n\n`;
  await sendLong(schedule.chatId, header + results);
}

module.exports = { init, add, remove, runNow };
