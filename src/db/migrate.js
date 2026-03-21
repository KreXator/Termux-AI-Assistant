/**
 * migrate.js — One-time migration from JSON flat files to Turso
 *
 * Run once on the machine that has existing data:
 *   node src/db/migrate.js
 *
 * Requires TURSO_URL + TURSO_AUTH_TOKEN in environment (or .env loaded).
 */
'use strict';

require('dotenv').config();

const path  = require('path');
const fs    = require('fs');
const turso = require('./turso');
const db    = require('./database');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');

function loadJSON(file, def) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return def;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}

async function migrate() {
  console.log('[migrate] Initializing schema…');
  await db.init();

  // ── chat_history ──────────────────────────────────────────────────────────
  const chat = loadJSON('chat.json', {});
  let chatRows = 0;
  for (const [uid, msgs] of Object.entries(chat)) {
    for (const m of msgs) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO chat_history (user_id, role, content, ts) VALUES (?, ?, ?, ?)',
        args: [uid, m.role, m.content, m.ts || new Date().toISOString()],
      });
      chatRows++;
    }
  }
  console.log(`[migrate] chat_history: ${chatRows} rows`);

  // ── memory ────────────────────────────────────────────────────────────────
  const memory = loadJSON('memory.json', {});
  let memRows = 0;
  for (const [uid, facts] of Object.entries(memory)) {
    for (const f of facts) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO memory (user_id, fact, ts) VALUES (?, ?, ?)',
        args: [uid, f.fact, f.ts || new Date().toISOString()],
      });
      memRows++;
    }
  }
  console.log(`[migrate] memory: ${memRows} rows`);

  // ── notes ─────────────────────────────────────────────────────────────────
  const notes = loadJSON('notes.json', {});
  let noteRows = 0;
  for (const [uid, ns] of Object.entries(notes)) {
    for (const n of ns) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO notes (user_id, note, ts) VALUES (?, ?, ?)',
        args: [uid, n.note, n.ts || new Date().toISOString()],
      });
      noteRows++;
    }
  }
  console.log(`[migrate] notes: ${noteRows} rows`);

  // ── todos ─────────────────────────────────────────────────────────────────
  const todos = loadJSON('todos.json', {});
  let todoRows = 0;
  for (const [uid, ts] of Object.entries(todos)) {
    for (const t of ts) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO todos (user_id, task, done, ts) VALUES (?, ?, ?, ?)',
        args: [uid, t.task, t.done ? 1 : 0, t.ts || new Date().toISOString()],
      });
      todoRows++;
    }
  }
  console.log(`[migrate] todos: ${todoRows} rows`);

  // ── config ────────────────────────────────────────────────────────────────
  const configs = loadJSON('config.json', {});
  let cfgRows = 0;
  for (const [uid, c] of Object.entries(configs)) {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO config (user_id, model, persona, manual_model, custom_instruction, chat_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [uid, c.model || null, c.persona || 'default', c.manualModel ? 1 : 0, c.customInstruction || null, c.chatId ? String(c.chatId) : null],
    });
    cfgRows++;
  }
  console.log(`[migrate] config: ${cfgRows} rows`);

  // ── schedules ─────────────────────────────────────────────────────────────
  const scheds = loadJSON('schedules.json', {});
  let schedRows = 0;
  for (const [uid, arr] of Object.entries(scheds)) {
    for (const s of arr) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO schedules (id, user_id, chat_id, query, time, ts) VALUES (?, ?, ?, ?, ?, ?)',
        args: [s.id, uid, String(s.chatId), s.query, s.time, s.ts || new Date().toISOString()],
      });
      schedRows++;
    }
  }
  console.log(`[migrate] schedules: ${schedRows} rows`);

  // ── reminders ─────────────────────────────────────────────────────────────
  const reminders = loadJSON('reminders.json', []);
  let remRows = 0;
  for (const r of reminders) {
    await turso.execute({
      sql:  'INSERT OR IGNORE INTO reminders (id, chat_id, user_id, text, fire_at) VALUES (?, ?, ?, ?, ?)',
      args: [r.id, String(r.chatId), String(r.userId), r.text, r.fireAt],
    });
    remRows++;
  }
  console.log(`[migrate] reminders: ${remRows} rows`);

  // ── briefing_feeds ────────────────────────────────────────────────────────
  const feeds = loadJSON('briefing_feeds.json', {});
  let feedRows = 0;
  for (const [uid, arr] of Object.entries(feeds)) {
    for (const f of arr) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO briefing_feeds (user_id, url, label, category, ts) VALUES (?, ?, ?, ?, ?)',
        args: [uid, f.url, f.label, f.category || 'general', f.ts || new Date().toISOString()],
      });
      feedRows++;
    }
  }
  console.log(`[migrate] briefing_feeds: ${feedRows} rows`);

  // ── briefing_seen ─────────────────────────────────────────────────────────
  const seen = loadJSON('briefing_seen.json', {});
  let seenRows = 0;
  for (const [uid, ids] of Object.entries(seen)) {
    for (const id of ids) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO briefing_seen (user_id, item_id) VALUES (?, ?)',
        args: [uid, id],
      });
      seenRows++;
    }
  }
  console.log(`[migrate] briefing_seen: ${seenRows} rows`);

  // ── briefing_config ───────────────────────────────────────────────────────
  const bCfgs = loadJSON('briefing_config.json', {});
  let bCfgRows = 0;
  for (const [uid, c] of Object.entries(bCfgs)) {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO briefing_config
              (user_id, morning_time, evening_time, morning_enabled, evening_enabled, chat_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [uid, c.morningTime || '08:00', c.eveningTime || '20:00',
             c.morningEnabled ? 1 : 0, c.eveningEnabled ? 1 : 0,
             c.chatId ? String(c.chatId) : null],
    });
    bCfgRows++;
  }
  console.log(`[migrate] briefing_config: ${bCfgRows} rows`);

  // ── briefing_keywords ─────────────────────────────────────────────────────
  const keywords = loadJSON('briefing_keywords.json', {});
  let kwRows = 0;
  for (const [uid, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      await turso.execute({
        sql:  'INSERT OR IGNORE INTO briefing_keywords (user_id, keyword) VALUES (?, ?)',
        args: [uid, kw],
      });
      kwRows++;
    }
  }
  console.log(`[migrate] briefing_keywords: ${kwRows} rows`);

  console.log('[migrate] Done.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
