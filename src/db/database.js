/**
 * database.js — persistance layer using LowDB (pure JSON, Termux-safe)
 * Manages: conversation history, persistent memory, notes, todos
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CHAT_FILE    = path.join(DATA_DIR, 'chat.json');
const MEMORY_FILE  = path.join(DATA_DIR, 'memory.json');
const NOTES_FILE   = path.join(DATA_DIR, 'notes.json');
const TODO_FILE    = path.join(DATA_DIR, 'todos.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'config.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
  if (all[uid] && all[uid][index]) all[uid].splice(index, 1);
  saveJSON(NOTES_FILE, all);
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

function doneTodo(userId, index) {
  const all = loadJSON(TODO_FILE, {});
  const uid = String(userId);
  if (all[uid] && all[uid][index]) all[uid][index].done = true;
  saveJSON(TODO_FILE, all);
}

function clearTodos(userId) {
  const all = loadJSON(TODO_FILE, {});
  all[String(userId)] = all[String(userId)]?.filter(t => !t.done) || [];
  saveJSON(TODO_FILE, all);
}

// ─── Config (per-user settings: model, persona) ─────────────────────────────

function getConfig(userId) {
  const all = loadJSON(CONFIG_FILE, {});
  return all[String(userId)] || {
    model:   process.env.MODEL_SMALL || 'llama3.2:3b',
    persona: 'default',
  };
}

function setConfig(userId, updates) {
  const all = loadJSON(CONFIG_FILE, {});
  const uid = String(userId);
  all[uid]  = { ...getConfig(userId), ...updates };
  saveJSON(CONFIG_FILE, all);
}

module.exports = {
  // history
  getHistory, appendMessage, clearHistory,
  // memory
  getMemory, addMemory, forgetAll,
  // notes
  getNotes, addNote, deleteNote,
  // todos
  getTodos, addTodo, doneTodo, clearTodos,
  // config
  getConfig, setConfig,
};
