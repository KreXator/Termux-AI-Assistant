/**
 * commands.js — Telegram command handlers
 *
 * Handles all /commands and routes plain messages through the agent pipeline.
 */
'use strict';

const db      = require('../db/database');
const ollama  = require('../llm/ollama');
const router  = require('../agent/router');
const search  = require('../tools/search');
const coder   = require('../tools/coder');

const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);

/**
 * Returns true if the user is authorized to use the bot.
 */
function isAllowed(userId) {
  if (!ALLOWED_IDS.length) return true;  // open if no list set
  return ALLOWED_IDS.includes(userId);
}

/**
 * Send a long-ish message, splitting if necessary (Telegram 4096-char limit).
 */
async function sendLong(bot, chatId, text, opts = {}) {
  const MAX = 4000;
  if (text.length <= MAX) {
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  }
  for (let i = 0; i < text.length; i += MAX) {
    await bot.sendMessage(chatId, text.slice(i, i + MAX), { parse_mode: 'Markdown' });
  }
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleStart(bot, msg) {
  const name = msg.from?.first_name || 'User';
  await sendLong(bot, msg.chat.id,
    `👋 Hi ${name}! I'm your local AI assistant running on Ollama.\n\n` +
    `Type anything to chat. Available commands:\n\n` +
    `/help — show all commands\n` +
    `/model [name] — switch model\n` +
    `/models — list available models\n` +
    `/persona [name] — change personality\n` +
    `/memory — show remembered facts\n` +
    `/remember [fact] — save a fact\n` +
    `/forget — clear all memory\n` +
    `/notes — show notes\n` +
    `/note [text] — add a note\n` +
    `/todo — show todo list\n` +
    `/task [text] — add a to-do item\n` +
    `/done [n] — mark todo #n done\n` +
    `/search [query] — search the web\n` +
    `/run [code] — execute JS code\n` +
    `/clear — clear conversation context\n` +
    `/status — show system status`
  );
}

async function handleHelp(bot, msg) {
  return handleStart(bot, msg);
}

async function handleStatus(bot, msg) {
  const userId = msg.from.id;
  const alive  = await ollama.isOllamaRunning();
  const cfg    = db.getConfig(userId);
  const models = alive ? await ollama.listModels() : [];

  await sendLong(bot, msg.chat.id,
    `🖥 *System Status*\n\n` +
    `Ollama: ${alive ? '✅ running' : '❌ offline'}\n` +
    `Active model: \`${cfg.model}\`\n` +
    `Persona: ${cfg.persona}\n` +
    `Available models: ${models.length ? models.join(', ') : 'none detected'}\n` +
    `Router: small=\`${router.MODEL_SMALL}\` large=\`${router.MODEL_LARGE}\``
  );
}

async function handleClear(bot, msg) {
  db.clearHistory(msg.from.id);
  await bot.sendMessage(msg.chat.id, '🗑 Conversation context cleared.');
}

// ─── Model & Persona ─────────────────────────────────────────────────────────

async function handleModel(bot, msg, args) {
  const userId = msg.from.id;
  if (!args.length) {
    const cfg = db.getConfig(userId);
    return bot.sendMessage(msg.chat.id, `Current model: \`${cfg.model}\``);
  }
  const modelName = args.join(' ');
  db.setConfig(userId, { model: modelName });
  await bot.sendMessage(msg.chat.id, `✅ Model switched to \`${modelName}\`. (Manual override active.)`);
}

async function handleModels(bot, msg) {
  const alive = await ollama.isOllamaRunning();
  if (!alive) return bot.sendMessage(msg.chat.id, '❌ Ollama is not running.');
  const models = await ollama.listModels();
  await sendLong(bot, msg.chat.id,
    models.length
      ? `🤖 *Available models:*\n${models.map(m => `• \`${m}\``).join('\n')}`
      : 'No models found. Run `ollama pull llama3` in Termux.'
  );
}

async function handlePersona(bot, msg, args) {
  const userId  = msg.from.id;
  const persona = args[0] || 'default';
  db.setConfig(userId, { persona });
  await bot.sendMessage(msg.chat.id, `🎭 Persona set to: *${persona}*`);
}

// ─── Memory ──────────────────────────────────────────────────────────────────

async function handleMemory(bot, msg) {
  const facts = db.getMemory(msg.from.id);
  if (!facts.length)
    return bot.sendMessage(msg.chat.id, 'No memories stored yet. Use /remember [fact].');
  const list = facts.map((f, i) => `${i + 1}. ${f.fact} _(${f.ts.slice(0, 10)})_`).join('\n');
  await sendLong(bot, msg.chat.id, `🧠 *Remembered facts:*\n\n${list}`);
}

async function handleRemember(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /remember [fact about you]');
  db.addMemory(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Noted!');
}

async function handleForget(bot, msg) {
  db.forgetAll(msg.from.id);
  await bot.sendMessage(msg.chat.id, '🗑 All memories cleared.');
}

// ─── Notes ──────────────────────────────────────────────────────────────────

async function handleNotes(bot, msg) {
  const notes = db.getNotes(msg.from.id);
  if (!notes.length)
    return bot.sendMessage(msg.chat.id, 'No notes yet. Use /note [text].');
  const list = notes.map((n, i) => `${i + 1}. ${n.note} _(${n.ts.slice(0, 10)})_`).join('\n');
  await sendLong(bot, msg.chat.id, `📝 *Your notes:*\n\n${list}`);
}

async function handleNote(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /note [note text]');
  db.addNote(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Note saved!');
}

// ─── Todos ───────────────────────────────────────────────────────────────────

async function handleTodos(bot, msg) {
  const todos = db.getTodos(msg.from.id);
  if (!todos.length)
    return bot.sendMessage(msg.chat.id, 'No tasks yet. Use /task [text].');
  const list = todos
    .map((t, i) => `${t.done ? '✅' : '⬜'} ${i + 1}. ${t.task}`)
    .join('\n');
  await sendLong(bot, msg.chat.id, `📋 *Todo list:*\n\n${list}`);
}

async function handleTask(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /task [task description]');
  db.addTodo(msg.from.id, args.join(' '));
  await bot.sendMessage(msg.chat.id, '✅ Task added!');
}

async function handleDone(bot, msg, args) {
  const n = parseInt(args[0], 10);
  if (isNaN(n) || n < 1)
    return bot.sendMessage(msg.chat.id, 'Usage: /done [task number]');
  db.doneTodo(msg.from.id, n - 1);
  await bot.sendMessage(msg.chat.id, `✅ Task #${n} marked as done.`);
}

// ─── Web Search ──────────────────────────────────────────────────────────────

async function handleSearch(bot, msg, args) {
  if (!args.length)
    return bot.sendMessage(msg.chat.id, 'Usage: /search [query]');
  const query = args.join(' ');
  await bot.sendMessage(msg.chat.id, `🔍 Searching: _${query}_...`);
  const results = await search.webSearch(query);
  await sendLong(bot, msg.chat.id, results);
}

// ─── Code Execution ──────────────────────────────────────────────────────────

async function handleRun(bot, msg, args) {
  const code = args.join(' ');
  if (!code) return bot.sendMessage(msg.chat.id, 'Usage: /run [js code]');
  await bot.sendMessage(msg.chat.id, '⚙️ Running...');
  const result = await coder.runCode(code);
  await sendLong(bot, msg.chat.id, coder.formatResult(result));
}

// ─── Plain Message → Agent ───────────────────────────────────────────────────

async function handleMessage(bot, msg) {
  const userId  = msg.from.id;
  const text    = msg.text?.trim();
  if (!text) return;

  // Show typing indicator
  await bot.sendChatAction(msg.chat.id, 'typing');

  const cfg         = db.getConfig(userId);
  const manualModel = cfg.model !== router.MODEL_SMALL && cfg.model !== router.MODEL_LARGE
    ? cfg.model   // user manually set a different model
    : null;

  // Decide: web search needed?
  const needsSearch = /\b(search|wyszukaj|google|find|znajdź).+\b/i.test(text) ||
                      /\bco to jest\b/i.test(text) && text.length > 40;

  let enriched = text;
  if (needsSearch) {
    await bot.sendMessage(msg.chat.id, '🔍 Searching the web first...');
    const results = await search.webSearch(text);
    enriched = `User asked: ${text}\n\nContext from web search:\n${results}`;
  }

  // Route to appropriate model
  const model = manualModel || router.routeModel(text, null);
  const label = router.modelLabel(model);

  try {
    const reply = await ollama.chat({
      userId,
      userMessage: enriched,
      model,
      persona: cfg.persona,
    });
    // Prefix with model label only for complex (large) calls
    const prefixed = model === router.MODEL_LARGE ? `${label}\n\n${reply}` : reply;
    await sendLong(bot, msg.chat.id, prefixed);
  } catch (err) {
    const errMsg = err.code === 'ECONNREFUSED'
      ? '❌ Cannot reach Ollama. Make sure it is running in Termux: `ollama serve`'
      : `❌ Error: ${err.message}`;
    await bot.sendMessage(msg.chat.id, errMsg);
  }
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * Register all handlers on a TelegramBot instance.
 */
function register(bot) {
  // Middleware: auth check
  function guard(handler) {
    return async (msg, match) => {
      if (!msg || !msg.chat || !msg.from) return;
      if (!isAllowed(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized.');
      }
      return handler(bot, msg, match);
    };
  }

  // Command routing
  bot.onText(/^\/start/, guard(m => handleStart(bot, m)));
  bot.onText(/^\/help/, guard(m => handleHelp(bot, m)));
  bot.onText(/^\/status/, guard(m => handleStatus(bot, m)));
  bot.onText(/^\/clear/, guard(m => handleClear(bot, m)));

  bot.onText(/^\/model(?:\s+(.+))?$/, guard((m, match) =>
    handleModel(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/models/, guard(m => handleModels(bot, m)));
  bot.onText(/^\/persona(?:\s+(.+))?$/, guard((m, match) =>
    handlePersona(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/memory/, guard(m => handleMemory(bot, m)));
  bot.onText(/^\/remember(?:\s+(.+))?$/, guard((m, match) =>
    handleRemember(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/forget/, guard(m => handleForget(bot, m)));

  bot.onText(/^\/notes?/, guard(m => handleNotes(bot, m)));
  bot.onText(/^\/note(?:\s+(.+))?$/, guard((m, match) =>
    handleNote(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/todos?/, guard(m => handleTodos(bot, m)));
  bot.onText(/^\/task(?:\s+(.+))?$/, guard((m, match) =>
    handleTask(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/done(?:\s+(\d+))?$/, guard((m, match) =>
    handleDone(bot, m, match[1] ? [match[1]] : [])));

  bot.onText(/^\/search(?:\s+(.+))?$/, guard((m, match) =>
    handleSearch(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/run(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleRun(bot, m, match[1] ? [match[1].trim()] : [])));

  // Catch-all for plain messages
  bot.on('message', guard(m => {
    if (!m.text || m.text.startsWith('/')) return;
    return handleMessage(bot, m);
  }));
}

module.exports = { register };
