/**
 * database.js — JSON flat-file persistence layer
 * Manages: conversation history, persistent memory, notes, todos, config, schedules
 */
'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// Anchor to project root regardless of where the process was launched from.
// __dirname = src/db/  →  ../../data = <project-root>/data
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CHAT_FILE          = path.join(DATA_DIR, 'chat.json');
const MEMORY_FILE        = path.join(DATA_DIR, 'memory.json');
const NOTES_FILE         = path.join(DATA_DIR, 'notes.json');
const TODO_FILE          = path.join(DATA_DIR, 'todos.json');
const CONFIG_FILE        = path.join(DATA_DIR, 'config.json');
const SCHEDULE_FILE      = path.join(DATA_DIR, 'schedules.json');
const REMINDER_FILE      = path.join(DATA_DIR, 'reminders.json');
const BRIEFING_FEEDS_FILE    = path.join(DATA_DIR, 'briefing_feeds.json');
const BRIEFING_SEEN_FILE     = path.join(DATA_DIR, 'briefing_seen.json');
const BRIEFING_CFG_FILE      = path.join(DATA_DIR, 'briefing_config.json');
const BRIEFING_KEYWORDS_FILE = path.join(DATA_DIR, 'briefing_keywords.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJSON(file, defaultVal) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultVal, null, 2));
    return defaultVal;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultVal;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[db] saveJSON failed for', file, ':', err.message);
  }
}

// ─── Conversation History ────────────────────────────────────────────────────

function getHistory(userId) {
  const all = loadJSON(CHAT_FILE, {});
  return all[String(userId)] || [];
}

function saveHistory(userId, messages) {
  const all = loadJSON(CHAT_FILE, {});
  all[String(userId)] = messages;
  saveJSON(CHAT_FILE, all);
}

function appendMessage(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content, ts: Date.now() });
  saveHistory(userId, history);
}

function clearHistory(userId) {
  saveHistory(userId, []);
}

// ─── Persistent Memory (facts about the user) ───────────────────────────────

function getMemory(userId) {
  const all = loadJSON(MEMORY_FILE, {});
  return all[String(userId)] || [];
}

function addMemory(userId, fact) {
  const all  = loadJSON(MEMORY_FILE, {});
  const uid  = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ fact, ts: new Date().toISOString() });
  saveJSON(MEMORY_FILE, all);
}

function forgetAll(userId) {
  const all = loadJSON(MEMORY_FILE, {});
  all[String(userId)] = [];
  saveJSON(MEMORY_FILE, all);
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function getNotes(userId) {
  const all = loadJSON(NOTES_FILE, {});
  return all[String(userId)] || [];
}

function addNote(userId, note) {
  const all = loadJSON(NOTES_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ note, ts: new Date().toISOString() });
  saveJSON(NOTES_FILE, all);
}

function deleteNote(userId, index) {
  const all  = loadJSON(NOTES_FILE, {});
  const uid  = String(userId);
  if (all[uid] && index >= 0 && index < all[uid].length) {
    all[uid].splice(index, 1);
    saveJSON(NOTES_FILE, all);
    return true;
  }
  return false;
}

// ─── Todos ───────────────────────────────────────────────────────────────────

function getTodos(userId) {
  const all = loadJSON(TODO_FILE, {});
  return all[String(userId)] || [];
}

function addTodo(userId, task) {
  const all = loadJSON(TODO_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  all[uid].push({ task, done: false, ts: new Date().toISOString() });
  saveJSON(TODO_FILE, all);
}

/**
 * Mark todo at index as done. Returns true if the index was valid, false otherwise.
 */
function doneTodo(userId, index) {
  const all = loadJSON(TODO_FILE, {});
  const uid = String(userId);
  if (all[uid] && index >= 0 && index < all[uid].length) {
    all[uid][index].done = true;
    saveJSON(TODO_FILE, all);
    return true;
  }
  return false;
}

function clearTodos(userId) {
  const all = loadJSON(TODO_FILE, {});
  all[String(userId)] = all[String(userId)]?.filter(t => !t.done) || [];
  saveJSON(TODO_FILE, all);
}

// ─── Config (per-user settings) ──────────────────────────────────────────────

const DEFAULT_MODEL = process.env.MODEL_SMALL || 'qwen2.5:3b-instruct-q4_K_M';

function getConfig(userId) {
  const all = loadJSON(CONFIG_FILE, {});
  return all[String(userId)] || {
    model:             DEFAULT_MODEL,
    persona:           'default',
    manualModel:       false,
    customInstruction: null,
    chatId:            null,
  };
}

function setConfig(userId, updates) {
  const all = loadJSON(CONFIG_FILE, {});
  const uid = String(userId);
  all[uid]  = { ...getConfig(userId), ...updates };
  saveJSON(CONFIG_FILE, all);
}

// ─── Schedules ───────────────────────────────────────────────────────────────

function getSchedules(userId) {
  const all = loadJSON(SCHEDULE_FILE, {});
  return all[String(userId)] || [];
}

/**
 * Add a new schedule. Returns the saved schedule object (with generated id).
 * @param {number} userId
 * @param {number} chatId  — Telegram chat ID to send results to
 * @param {string} query   — search query to run
 * @param {string} time    — "HH:MM" in 24h format
 * @returns {object} schedule
 */
function addSchedule(userId, chatId, query, time) {
  const all = loadJSON(SCHEDULE_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  const schedule = {
    id:     crypto.randomUUID(),
    userId: Number(userId),
    chatId,
    query,
    time,
    ts:     new Date().toISOString(),
  };
  all[uid].push(schedule);
  saveJSON(SCHEDULE_FILE, all);
  return schedule;
}

/**
 * Remove schedule by index (0-based). Returns removed schedule or null.
 */
function removeSchedule(userId, index) {
  const all = loadJSON(SCHEDULE_FILE, {});
  const uid = String(userId);
  if (!all[uid] || index < 0 || index >= all[uid].length) return null;
  const [removed] = all[uid].splice(index, 1);
  saveJSON(SCHEDULE_FILE, all);
  return removed;
}

/**
 * Returns all schedules across all users — used on bot startup to restore cron tasks.
 */
function getAllSchedules() {
  const all = loadJSON(SCHEDULE_FILE, {});
  return Object.values(all).flat();
}

// ─── Reminders ───────────────────────────────────────────────────────────────

/**
 * Load all persisted reminders (array of { id, chatId, userId, text, fireAt }).
 * Filters out already-expired entries automatically.
 */
function loadReminders() {
  const all = loadJSON(REMINDER_FILE, []);
  const now = Date.now();
  return all.filter(r => new Date(r.fireAt).getTime() > now);
}

/**
 * Persist the current reminder list (strip in-memory-only fields like timeoutId).
 * @param {Array<{ id, chatId, userId, text, fireAt }>} list
 */
function saveReminders(list) {
  saveJSON(REMINDER_FILE, list.map(r => ({
    id:     r.id,
    chatId: r.chatId,
    userId: r.userId,
    text:   r.text,
    fireAt: r.fireAt,
  })));
}

// ─── Briefing Feeds ──────────────────────────────────────────────────────────

function getBriefingFeeds(userId) {
  const all = loadJSON(BRIEFING_FEEDS_FILE, {});
  return all[String(userId)] || [];
}

function addBriefingFeed(userId, url, label, category = 'general') {
  const all = loadJSON(BRIEFING_FEEDS_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  // prevent duplicate labels
  all[uid] = all[uid].filter(f => f.label !== label);
  all[uid].push({ url, label, category, ts: new Date().toISOString() });
  saveJSON(BRIEFING_FEEDS_FILE, all);
}

function removeBriefingFeed(userId, label) {
  const all = loadJSON(BRIEFING_FEEDS_FILE, {});
  const uid = String(userId);
  if (!all[uid]) return false;
  const before = all[uid].length;
  all[uid] = all[uid].filter(f => f.label !== label);
  saveJSON(BRIEFING_FEEDS_FILE, all);
  return all[uid].length < before;
}

// ─── Briefing Seen IDs (deduplication) ───────────────────────────────────────

const SEEN_MAX = 2000; // keep last N item IDs per user

function getBriefingSeenIds(userId) {
  const all = loadJSON(BRIEFING_SEEN_FILE, {});
  return new Set(all[String(userId)] || []);
}

function markBriefingSeen(userId, ids) {
  const all = loadJSON(BRIEFING_SEEN_FILE, {});
  const uid = String(userId);
  const current = all[uid] || [];
  const merged  = [...new Set([...current, ...ids])];
  // prune oldest if over cap
  all[uid] = merged.length > SEEN_MAX ? merged.slice(-SEEN_MAX) : merged;
  saveJSON(BRIEFING_SEEN_FILE, all);
}

// ─── Briefing Config (per-user schedule + preferences) ───────────────────────

const DEFAULT_BRIEFING_CFG = {
  morningTime: '08:00',
  eveningTime: '20:00',
  morningEnabled: false,
  eveningEnabled: false,
  chatId: null,
};

function getBriefingConfig(userId) {
  const all = loadJSON(BRIEFING_CFG_FILE, {});
  return { ...DEFAULT_BRIEFING_CFG, ...(all[String(userId)] || {}) };
}

function setBriefingConfig(userId, updates) {
  const all = loadJSON(BRIEFING_CFG_FILE, {});
  const uid = String(userId);
  all[uid]  = { ...getBriefingConfig(userId), ...updates };
  saveJSON(BRIEFING_CFG_FILE, all);
}

function getAllBriefingConfigs() {
  const all = loadJSON(BRIEFING_CFG_FILE, {});
  return Object.entries(all).map(([userId, cfg]) => ({ userId: Number(userId), ...cfg }));
}

// ─── Briefing Keywords (job offer filters) ───────────────────────────────────

function getBriefingKeywords(userId) {
  const all = loadJSON(BRIEFING_KEYWORDS_FILE, {});
  return all[String(userId)] || [];
}

function addBriefingKeyword(userId, keyword) {
  const all = loadJSON(BRIEFING_KEYWORDS_FILE, {});
  const uid = String(userId);
  if (!all[uid]) all[uid] = [];
  const kw = keyword.trim().toLowerCase();
  if (!all[uid].includes(kw)) {
    all[uid].push(kw);
    saveJSON(BRIEFING_KEYWORDS_FILE, all);
    return true;
  }
  return false; // already exists
}

function removeBriefingKeyword(userId, keyword) {
  const all = loadJSON(BRIEFING_KEYWORDS_FILE, {});
  const uid = String(userId);
  if (!all[uid]) return false;
  const kw = keyword.trim().toLowerCase();
  const before = all[uid].length;
  all[uid] = all[uid].filter(k => k !== kw);
  saveJSON(BRIEFING_KEYWORDS_FILE, all);
  return all[uid].length < before;
}

module.exports = {
  // history
  getHistory, saveHistory, appendMessage, clearHistory,
  // memory
  getMemory, addMemory, forgetAll,
  // notes
  getNotes, addNote, deleteNote,
  // todos
  getTodos, addTodo, doneTodo, clearTodos,
  // config
  getConfig, setConfig,
  // schedules
  getSchedules, addSchedule, removeSchedule, getAllSchedules,
  // reminders
  loadReminders, saveReminders,
  // briefing
  getBriefingFeeds, addBriefingFeed, removeBriefingFeed,
  getBriefingSeenIds, markBriefingSeen,
  getBriefingConfig, setBriefingConfig, getAllBriefingConfigs,
  getBriefingKeywords, addBriefingKeyword, removeBriefingKeyword,
};
