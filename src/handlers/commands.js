/**
 * commands.js — Telegram command handlers
 *
 * Handles all /commands and routes plain messages through the agent pipeline.
 */
'use strict';

const db         = require('../db/database');
const llm        = require('../llm/client');
const openrouter = require('../llm/openrouter');
const router     = require('../agent/router');
const search    = require('../tools/search');
const coder     = require('../tools/coder');
const scheduler        = require('../scheduler/scheduler');
const reminder         = require('../tools/reminder');
const briefingCmd      = require('./briefingCmd');
const bScheduler       = require('../scheduler/briefingScheduler');
const intentHandler    = require('./intentHandler');
const weather   = require('../tools/weather');
const voice     = require('../tools/voice');
const vision    = require('../tools/vision');

const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);

// ─── Intent confirmation state ────────────────────────────────────────────────
// userId (string) → { intent, lang, params, chatId, msgId, timer }
const pendingIntents = new Map();
const CONFIRMATION_TTL = 90_000; // 90 seconds — auto-expire pending confirmations

/** Human-readable summary of a detected intent, shown before user confirms. */
function formatConfirmation(type, lang, params) {
  const pl = lang !== 'en';
  switch (type) {
    case 'briefing_add_feed':
      return `${pl ? 'Dodaj feed' : 'Add feed'} *${params.label || '?'}*\n` +
             `URL: \`${params.url || '?'}\`\n` +
             `${pl ? 'Kategoria' : 'Category'}: *${params.category || 'general'}*`;
    case 'briefing_on':
      return pl ? 'Włącz codzienne raporty briefing' : 'Enable daily briefing reports';
    case 'briefing_off':
      return pl ? 'Wyłącz codzienne raporty briefing' : 'Disable daily briefing reports';
    case 'briefing_time_morning':
      return (pl ? 'Ustaw poranny raport na' : 'Set morning briefing to') +
             ` *${params.time || '?'}*` +
             (params.enable ? (pl ? ' i włącz' : ' and enable') : '');
    case 'briefing_time_evening':
      return (pl ? 'Ustaw wieczorny raport na' : 'Set evening briefing to') +
             ` *${params.time || '?'}*` +
             (params.enable ? (pl ? ' i włącz' : ' and enable') : '');
    case 'briefing_keywords_add':
      return (pl ? 'Dodaj filtr słów kluczowych:' : 'Add keyword filter:') +
             ` *${params.keyword || '?'}*`;
    case 'briefing_keywords_remove':
      return (pl ? 'Usuń filtr:' : 'Remove filter:') +
             ` *${params.keyword || '?'}*`;
    case 'briefing_run_now': {
      const t = params.type === 'evening'
        ? (pl ? 'wieczorny' : 'evening') : (pl ? 'poranny' : 'morning');
      return (pl ? `Uruchom ${t} briefing teraz` : `Run ${t} briefing now`);
    }
    case 'schedule_add':
      return (pl ? 'Zaplanuj wyszukiwanie codziennie o' : 'Schedule daily search at') +
             ` *${params.time || '?'}*\n` +
             (pl ? 'Zapytanie:' : 'Query:') + ` _${params.query || '?'}_`;
    case 'remind':
      return (pl ? 'Ustaw przypomnienie' : 'Set reminder') +
             ` *${params.when || '?'}*\n` +
             (pl ? 'Treść:' : 'Text:') + ` _${params.text || '?'}_`;
    case 'remember':
      return (pl ? 'Zapamiętaj fakt:' : 'Remember fact:') +
             ` _${params.fact || '?'}_`;
    default:
      return type;
  }
}

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
    `*Core*\n` +
    `/help — show this message\n` +
    `/status — system status\n` +
    `/clear — clear conversation context\n\n` +
    `*Models & Persona*\n` +
    `/model [name|auto|premium] — switch model or re-enable auto-routing\n` +
    `/models — list available models\n` +
    `/persona [name] — change personality (default/coder/polish/researcher/planner)\n` +
    `/instruct [text] — set a custom system instruction\n` +
    `/instruct show — show current instruction\n` +
    `/instruct clear — revert to persona\n\n` +
    `*Memory*\n` +
    `/memory — show remembered facts\n` +
    `/remember [fact] — save a fact\n` +
    `/forget — clear all memory\n\n` +
    `*Notes*\n` +
    `/notes — show notes\n` +
    `/note [text] — add a note\n` +
    `/delnote [n] — delete note #n\n\n` +
    `*Todos*\n` +
    `/todo — show todo list\n` +
    `/task [text] — add a to-do item\n` +
    `/done [n] — mark todo #n done\n\n` +
    `*Search & Automation*\n` +
    `/search [query] — search the web now\n` +
    `/schedules — list scheduled searches\n` +
    `/schedule add HH:MM [query] — add daily search alert\n` +
    `/schedule test [n] — run schedule #n right now\n` +
    `/schedule del [n] — remove schedule #n\n\n` +
    `*Reminders*\n` +
    `/remind [when] [text] — set a one-time reminder\n` +
    `  when: 30min · 2h · 45s · 17:30\n` +
    `/reminders — list your active reminders\n` +
    `/remindel [n] — cancel reminder #n\n\n` +
    `*Weather*\n` +
    `/weather [city] — current weather\n\n` +
    `*Media*\n` +
    `Send a 🎤 voice message — I'll transcribe it\n` +
    `Send a 📷 photo — I'll describe it\n\n` +
    `*Dev*\n` +
    `/run [code] — execute JS code\n\n` +
    `*Memory tips*\n` +
    `• Bot keeps ~50k tokens of conversation history automatically\n` +
    `• /remember [fact] — save facts that survive /clear and restarts\n` +
    `  _e.g._ \`/remember Prefer concise answers in Polish\`\n` +
    `• /instruct [text] — set a permanent system persona\n` +
    `  _e.g._ \`/instruct Always reply in Polish. Be concise.\`\n` +
    `• /memory — show saved facts · /forget — erase all facts\n` +
    `• /clear — wipe conversation only (facts + instruct stay)\n` +
    `• /model premium — switch to paid model for complex tasks`
  );
}

async function handleHelp(bot, msg) {
  return handleStart(bot, msg);
}

async function handleStatus(bot, msg) {
  const userId      = msg.from.id;
  const cfg         = db.getConfig(userId);
  const schedules   = db.getSchedules(userId);
  const searchMode  = process.env.SERPER_API_KEY ? '✅ Serper (Google)' : '⚠️ DuckDuckGo scrape';
  const orKey       = !!process.env.OPENROUTER_API_KEY;
  const orAlive     = orKey ? await llm.isOpenRouterReachable() : false;
  const ollamaAlive = await llm.isOllamaRunning();

  const orLine    = orKey
    ? `✅ configured (${orAlive ? 'online' : 'unreachable'})`
    : '➖ not configured';
  const ollamaLine = ollamaAlive ? '✅ running' : '❌ offline';
  const activeDisplay = llm.resolveDisplayModel(cfg.model);

  await sendLong(bot, msg.chat.id,
    `🖥 *System Status*\n\n` +
    `OpenRouter: ${orLine}\n` +
    `Ollama: ${ollamaLine} ${orKey ? '_(fallback)_' : '_(primary)_'}\n\n` +
    `Active model: \`${activeDisplay}\` ${cfg.manualModel ? '_(manual)_' : '_(auto-routed)_'}\n` +
    `Persona: ${cfg.persona}${cfg.customInstruction ? ' _(overridden by /instruct)_' : ''}\n` +
    `Web search: ${searchMode}\n` +
    `Schedules: ${schedules.length} active\n\n` +
    `Router tiers:\n` +
    `  💬 small=\`${llm.resolveDisplayModel(router.MODEL_SMALL)}\`\n` +
    `  ⚡ medium=\`${llm.resolveDisplayModel(router.MODEL_MEDIUM)}\`\n` +
    `  🧠 large=\`${llm.resolveDisplayModel(router.MODEL_LARGE)}\``
  );
}

async function handleClear(bot, msg) {
  db.clearHistory(msg.from.id);
  await bot.sendMessage(msg.chat.id, '🗑 Conversation context cleared.');
}

// ─── Model & Persona ─────────────────────────────────────────────────────────

// Named model aliases — resolved to actual model IDs before storing
const MODEL_ALIASES = {
  premium: openrouter.OR_MODEL_PREMIUM,
  code:    openrouter.OR_MODEL_CODER,
  large:   openrouter.OR_MODEL_LARGE,
  medium:  openrouter.OR_MODEL_MEDIUM,
  small:   openrouter.OR_MODEL_SMALL,
};

async function handleModel(bot, msg, args) {
  const userId = msg.from.id;
  if (!args.length) {
    const cfg = db.getConfig(userId);
    return bot.sendMessage(msg.chat.id,
      `Current model: \`${cfg.model}\` ${cfg.manualModel ? '_(manual override)_' : '_(auto-routed)_'}\n\n` +
      `Available shortcuts:\n` +
      `  \`/model auto\`    — auto-routing (default)\n` +
      `  \`/model code\`    — Devstral 2 (coding sessions)\n` +
      `  \`/model premium\` — Gemini Flash Lite (paid, no limits)`
    );
  }
  const input     = args.join(' ').toLowerCase();
  if (input === 'auto') {
    db.setConfig(userId, { model: router.MODEL_SMALL, manualModel: false });
    return bot.sendMessage(msg.chat.id, '✅ Auto-routing re-enabled.');
  }
  const modelName = MODEL_ALIASES[input] || args.join(' ');
  db.setConfig(userId, { model: modelName, manualModel: true });
  await bot.sendMessage(msg.chat.id,
    `✅ Model switched to \`${modelName}\`. Auto-routing disabled.\nUse \`/model auto\` to re-enable.`
  );
}

async function handleModels(bot, msg) {
  const info = await llm.listModels();
  await sendLong(bot, msg.chat.id, `🤖 *Models*\n\n${info}`);
}

async function handlePersona(bot, msg, args) {
  const userId  = msg.from.id;
  const persona = args[0] || 'default';
  db.setConfig(userId, { persona });
  await bot.sendMessage(msg.chat.id, `🎭 Persona set to: *${persona}*`);
}

// ─── Custom Instructions ─────────────────────────────────────────────────────

async function handleInstruct(bot, msg, args) {
  const userId = msg.from.id;

  if (!args.length || args[0] === 'show') {
    const cfg = db.getConfig(userId);
    if (!cfg.customInstruction)
      return bot.sendMessage(msg.chat.id,
        'No custom instruction set.\nUsage: `/instruct [your system prompt text]`'
      );
    return sendLong(bot, msg.chat.id, `📋 *Current custom instruction:*\n\n${cfg.customInstruction}`);
  }

  if (args[0] === 'clear') {
    db.setConfig(userId, { customInstruction: null });
    return bot.sendMessage(msg.chat.id, '✅ Custom instruction cleared. Back to persona.');
  }

  const instruction = args.join(' ');
  db.setConfig(userId, { customInstruction: instruction });
  await bot.sendMessage(msg.chat.id,
    `✅ Custom instruction saved! This replaces your persona for all future messages.\n` +
    `Use \`/instruct clear\` to revert.`
  );
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

async function handleDelNote(bot, msg, args) {
  const n = parseInt(args[0], 10);
  if (isNaN(n) || n < 1)
    return bot.sendMessage(msg.chat.id, 'Usage: /delnote [note number]');
  const deleted = db.deleteNote(msg.from.id, n - 1);
  if (!deleted)
    return bot.sendMessage(msg.chat.id, `❌ No note #${n}. Use /notes to see your list.`);
  await bot.sendMessage(msg.chat.id, `🗑 Note #${n} deleted.`);
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
  const marked = db.doneTodo(msg.from.id, n - 1);
  if (!marked)
    return bot.sendMessage(msg.chat.id, `❌ No task #${n}. Use /todo to see your list.`);
  await bot.sendMessage(msg.chat.id, `✅ Task #${n} marked as done.`);
}

// ─── Schedules ───────────────────────────────────────────────────────────────

async function handleSchedule(bot, msg, args) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const sub    = args[0];

  // /schedule (no args) or /schedules → list
  if (!sub || sub === 'list') {
    return handleScheduleList(bot, msg);
  }

  // /schedule add HH:MM search query text
  if (sub === 'add') {
    const timeArg = args[1];
    const query   = args.slice(2).join(' ');

    if (!timeArg || !query)
      return bot.sendMessage(chatId,
        'Usage: `/schedule add HH:MM [search query]`\n' +
        'Example: `/schedule add 08:00 job offers Warsaw Node.js developer`',
        { parse_mode: 'Markdown' }
      );

    if (!/^\d{1,2}:\d{2}$/.test(timeArg))
      return bot.sendMessage(chatId, '❌ Invalid time format. Use HH:MM e.g. `08:00`');

    const schedule = db.addSchedule(userId, chatId, query, timeArg);
    scheduler.add(schedule);

    const tz = process.env.TZ || 'Europe/Warsaw';
    await bot.sendMessage(chatId,
      `✅ Schedule added!\n` +
      `🕐 *${timeArg}* daily (${tz})\n` +
      `🔍 Query: _${query}_\n\n` +
      `Results will be sent here. Use \`/schedule test [n]\` to try it now.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /schedule test N → run schedule immediately
  if (sub === 'test') {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 1)
      return bot.sendMessage(chatId, 'Usage: /schedule test [number]');
    const schedules = db.getSchedules(userId);
    if (n > schedules.length)
      return bot.sendMessage(chatId, `❌ No schedule #${n}. Use /schedules to see your list.`);
    await bot.sendMessage(chatId, `⏳ Running schedule #${n} now...`);
    try {
      await scheduler.runNow(schedules[n - 1]);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
    return;
  }

  // /schedule del N
  if (sub === 'del' || sub === 'delete' || sub === 'remove') {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 1)
      return bot.sendMessage(chatId, 'Usage: /schedule del [number]');
    const removed = db.removeSchedule(userId, n - 1);
    if (!removed)
      return bot.sendMessage(chatId, `❌ No schedule #${n}. Use /schedules to see your list.`);
    scheduler.remove(removed.id);
    await bot.sendMessage(chatId, `🗑 Schedule #${n} removed.`);
    return;
  }

  return handleScheduleList(bot, msg);
}

async function handleScheduleList(bot, msg) {
  const schedules = db.getSchedules(msg.from.id);
  if (!schedules.length)
    return bot.sendMessage(msg.chat.id,
      'No schedules yet.\nUse `/schedule add HH:MM [query]` to create one.',
      { parse_mode: 'Markdown' }
    );
  const tz   = process.env.TZ || 'Europe/Warsaw';
  const list = schedules
    .map((s, i) => `${i + 1}. 🕐 *${s.time}* daily — _${s.query}_`)
    .join('\n');
  await sendLong(bot, msg.chat.id,
    `📅 *Scheduled searches* (${tz}):\n\n${list}\n\n` +
    `Use \`/schedule test [n]\` to run one now, \`/schedule del [n]\` to remove.`
  );
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
  if (!ALLOWED_IDS.length) {
    return bot.sendMessage(msg.chat.id,
      '⚠️ `/run` is disabled: set `ALLOWED_USER_IDS` in `.env` first.\n' +
      'This command executes code with full system privileges.',
      { parse_mode: 'Markdown' }
    );
  }
  const code = args.join(' ');
  if (!code) return bot.sendMessage(msg.chat.id, 'Usage: /run [js code]');
  await bot.sendMessage(msg.chat.id, '⚙️ Running...');
  const result = await coder.runCode(code);
  await sendLong(bot, msg.chat.id, coder.formatResult(result));
}

// ─── Reminders ───────────────────────────────────────────────────────────────

async function handleRemind(bot, msg, args) {
  const chatId  = msg.chat.id;
  const userId  = msg.from.id;

  if (!args.length)
    return bot.sendMessage(chatId,
      'Usage: `/remind [when] [message]`\n' +
      'Examples:\n  `/remind 30min call John`\n  `/remind 2h drink water`\n  `/remind 17:30 meeting`',
      { parse_mode: 'Markdown' }
    );

  const delayMs = reminder.parseTime(args[0]);
  if (delayMs === null)
    return bot.sendMessage(chatId,
      `❌ Cannot parse time: \`${args[0]}\`\n` +
      'Accepted: `30min`, `2h`, `45s`, `17:30`',
      { parse_mode: 'Markdown' }
    );

  const text = args.slice(1).join(' ') || 'Reminder!';
  const info = reminder.add(bot, chatId, userId, text, delayMs);

  await bot.sendMessage(chatId,
    `⏰ Reminder set!\n` +
    `📝 _${text}_\n` +
    `🕐 Fires in *${info.inMs}*`,
    { parse_mode: 'Markdown' }
  );
}

async function handleReminders(bot, msg) {
  const chatId = msg.chat.id;
  const list   = reminder.list(msg.from.id);
  if (!list.length)
    return bot.sendMessage(chatId, 'No active reminders. Use `/remind [when] [text]` to add one.', { parse_mode: 'Markdown' });

  const lines = list.map((r, i) => {
    const fireAt = new Date(r.fireAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${i + 1}. ⏰ *${fireAt}* — _${r.text}_`;
  }).join('\n');

  await sendLong(bot, chatId, `⏰ *Active reminders:*\n\n${lines}\n\nUse \`/remindel [n]\` to cancel.`);
}

async function handleReminderDel(bot, msg, args) {
  const chatId = msg.chat.id;
  const n = parseInt(args[0], 10);
  if (isNaN(n) || n < 1)
    return bot.sendMessage(chatId, 'Usage: /remindel [reminder number]');
  const text = reminder.cancel(msg.from.id, n);
  if (!text)
    return bot.sendMessage(chatId, `❌ No reminder #${n}. Use /reminders to see your list.`);
  await bot.sendMessage(chatId, `🗑 Reminder #${n} cancelled: _${text}_`, { parse_mode: 'Markdown' });
}

// ─── Weather ─────────────────────────────────────────────────────────────────

async function handleWeather(bot, msg, args) {
  const chatId = msg.chat.id;
  if (!args.length)
    return bot.sendMessage(chatId, 'Usage: /weather [city]\nExample: `/weather Warsaw`', { parse_mode: 'Markdown' });

  await bot.sendChatAction(chatId, 'typing');
  try {
    const result = await weather.getWeather(args.join(' '));
    await sendLong(bot, chatId, result);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Weather error: ${err.message}`);
  }
}

// ─── Voice Transcription ──────────────────────────────────────────────────────

async function handleVoice(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!process.env.GROQ_API_KEY) {
    return bot.sendMessage(chatId,
      '⚠️ Voice transcription requires `GROQ_API_KEY` in `.env`.\nGet a free key at groq.com.',
      { parse_mode: 'Markdown' }
    );
  }

  await bot.sendChatAction(chatId, 'typing');
  const waitMsg = await bot.sendMessage(chatId, '🎤 Transcribing...');

  try {
    const fileId = msg.voice.file_id;
    const text   = await voice.transcribe(bot, fileId);

    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    if (!text) {
      return bot.sendMessage(chatId, '⚠️ Transcription returned empty. Try speaking more clearly.');
    }

    // Send transcription then process as normal message
    await bot.sendMessage(chatId, `🎤 *Transcribed:*\n_${text}_`, { parse_mode: 'Markdown' });

    // Route through AI as if the user typed the message
    const fakeMsgText = { ...msg, text: text };
    await handleMessage(bot, fakeMsgText);
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ Transcription failed: ${err.message}`);
  }
}

// ─── Image Analysis ───────────────────────────────────────────────────────────

async function handlePhoto(bot, msg) {
  const chatId   = msg.chat.id;
  const userId   = msg.from.id;

  // Telegram sends multiple sizes; use the largest
  const photos   = msg.photo;
  const largest  = photos[photos.length - 1];
  const fileId   = largest.file_id;
  const caption  = msg.caption?.trim() || 'Describe this image in detail.';

  await bot.sendChatAction(chatId, 'upload_photo');
  const waitMsg = await bot.sendMessage(chatId, `🔍 Analyzing image with \`${vision.getActiveVisionModel()}\`...`, { parse_mode: 'Markdown' });

  try {
    const description = await vision.analyzeImage(bot, fileId, caption);
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await sendLong(bot, chatId, `🖼 *Image analysis:*\n\n${description}`);
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    let errMsg = `❌ Vision error: ${err.message}`;
    if (err.code === 'ECONNREFUSED')
      errMsg = `❌ Vision unavailable: OpenRouter unreachable and Ollama not running.\nStart Ollama: \`ollama serve\``;
    await bot.sendMessage(chatId, errMsg, { parse_mode: 'Markdown' });
  }
}

// ─── Natural Language Intent Executor ────────────────────────────────────────

/** Pick the right language string: t('en', 'English text', 'Polski tekst') */
function t(lang, en, pl) { return lang === 'en' ? en : pl; }

/**
 * Execute a parsed intent. Returns true if handled, false if intent unknown.
 */
async function executeIntent(bot, msg, intent) {
  const { intent: type, params, lang = 'pl' } = intent;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Store chatId for briefing scheduler
  db.setBriefingConfig(userId, { chatId });

  switch (type) {
    case 'briefing_add_feed': {
      const { url, label, category = 'general' } = params;
      if (!url || !label) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Could not detect URL or feed name. Try: `/briefing add <url> <label>`',
                  '⚠️ Nie mogłem rozpoznać URL ani nazwy feeda. Spróbuj: `/briefing add <url> <label>`'),
          { parse_mode: 'Markdown' });
        return true;
      }
      db.addBriefingFeed(userId, url, label, category);
      await bot.sendMessage(chatId,
        `✅ ${t(lang, 'Feed added', 'Feed dodany')}: \`${label}\` (${category})\n${url}`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'briefing_on': {
      const feeds = db.getBriefingFeeds(userId);
      if (!feeds.length) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Add an RSS feed first. E.g: "add feed https://... as myfeed category jobs"',
                  '⚠️ Najpierw dodaj feed RSS. Np: "dodaj feed https://... jako myfeed z kategorią jobs"'));
        return true;
      }
      db.setBriefingConfig(userId, { morningEnabled: true, eveningEnabled: true, chatId });
      const bSched = require('../scheduler/briefingScheduler');
      bSched.reload(userId, chatId);
      const cfg = db.getBriefingConfig(userId);
      await bot.sendMessage(chatId,
        `✅ ${t(lang, 'Reports enabled', 'Raporty włączone')}.\n${t(lang, 'Morning', 'Poranny')}: *${cfg.morningTime}* | ${t(lang, 'Evening', 'Wieczorny')}: *${cfg.eveningTime}*`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'briefing_off': {
      db.setBriefingConfig(userId, { morningEnabled: false, eveningEnabled: false });
      const bSched = require('../scheduler/briefingScheduler');
      bSched.reload(userId, chatId);
      await bot.sendMessage(chatId, `⏹ ${t(lang, 'Reports disabled.', 'Raporty wyłączone.')}`);
      return true;
    }

    case 'briefing_time_morning':
    case 'briefing_time_evening': {
      const { time, enable } = params;
      if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Could not parse the time. Use HH:MM format, e.g. 07:30.',
                  '⚠️ Nie rozpoznałem godziny. Podaj w formacie HH:MM, np. 07:30.'));
        return true;
      }
      const isMorning = type === 'briefing_time_morning';
      const timeKey   = isMorning ? 'morningTime'    : 'eveningTime';
      const enableKey = isMorning ? 'morningEnabled' : 'eveningEnabled';
      const labelStr  = isMorning ? t(lang, 'morning', 'porannego') : t(lang, 'evening', 'wieczornego');
      const updates   = { [timeKey]: time };
      if (enable) updates[enableKey] = true;
      db.setBriefingConfig(userId, updates);
      const bSched = require('../scheduler/briefingScheduler');
      bSched.reload(userId, chatId);
      const onOff = enable ? t(lang, ' and enabled', ' i włączony') : '';
      await bot.sendMessage(chatId,
        `✅ ${t(lang, 'Time for', 'Godzina')} ${labelStr} ${t(lang, 'report', 'raportu')}: *${time}*${onOff}`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'briefing_keywords_add': {
      const { keyword } = params;
      if (!keyword) {
        await bot.sendMessage(chatId, t(lang, '⚠️ Could not detect keyword.', '⚠️ Nie rozpoznałem słowa kluczowego.'));
        return true;
      }
      const added = db.addBriefingKeyword(userId, keyword);
      await bot.sendMessage(chatId,
        added
          ? `✅ ${t(lang, 'Filter', 'Filtr')} \`${keyword.toLowerCase()}\` ${t(lang, 'added to job offers.', 'dodany do ofert pracy.')}`
          : `ℹ️ ${t(lang, 'Filter', 'Filtr')} \`${keyword.toLowerCase()}\` ${t(lang, 'already exists.', 'już istnieje.')}`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'briefing_keywords_remove': {
      const { keyword } = params;
      if (!keyword) {
        await bot.sendMessage(chatId, t(lang, '⚠️ Could not detect keyword.', '⚠️ Nie rozpoznałem słowa kluczowego.'));
        return true;
      }
      const ok = db.removeBriefingKeyword(userId, keyword);
      await bot.sendMessage(chatId,
        ok
          ? `✅ ${t(lang, 'Filter', 'Filtr')} \`${keyword.toLowerCase()}\` ${t(lang, 'removed.', 'usunięty.')}`
          : `❌ ${t(lang, 'Filter', 'Filtr')} \`${keyword.toLowerCase()}\` ${t(lang, 'not found.', 'nie znaleziony.')}`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'briefing_run_now': {
      const type = params.type === 'evening' ? 'evening' : 'morning';
      const feeds = db.getBriefingFeeds(userId);
      if (!feeds.length) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ No feeds configured. Add one: `/briefing add <url> <label>`',
                  '⚠️ Brak feedów. Dodaj: `/briefing add <url> <label>`'),
          { parse_mode: 'Markdown' });
        return true;
      }
      await bot.sendMessage(chatId,
        t(lang, `⏳ Generating ${type} briefing…`, `⏳ Generuję ${type === 'morning' ? 'poranny' : 'wieczorny'} raport…`));
      await bScheduler.runNow(userId, chatId, type);
      return true;
    }

    case 'briefing_list_feeds': {
      const feeds = db.getBriefingFeeds(userId);
      if (!feeds.length) {
        await bot.sendMessage(chatId,
          t(lang,
            '_No feeds configured._\nAdd one: `/briefing add <url> <label>`',
            '_Brak skonfigurowanych feedów._\nDodaj: `/briefing add <url> <label>`'),
          { parse_mode: 'Markdown' });
        return true;
      }
      const lines = [`*📰 ${t(lang, 'Your RSS feeds', 'Twoje feedy RSS')} (${feeds.length}):*`, ''];
      for (const f of feeds) {
        lines.push(`• *${f.label}* _${f.category}_`);
        lines.push(`  ${f.url}`);
      }
      await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
      return true;
    }

    case 'schedule_add': {
      const { time, query } = params;
      if (!time || !query || !/^\d{1,2}:\d{2}$/.test(time)) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Could not parse time or query. Try: `/schedule add HH:MM [query]`',
                  '⚠️ Nie rozpoznałem godziny lub zapytania. Spróbuj: `/schedule add HH:MM [zapytanie]`'),
          { parse_mode: 'Markdown' });
        return true;
      }
      const schedule = db.addSchedule(userId, chatId, query, time);
      scheduler.add(schedule);
      const tz = process.env.TZ || 'Europe/Warsaw';
      await bot.sendMessage(chatId,
        `✅ ${t(lang, 'Scheduled!', 'Zaplanowano!')}\n🕐 *${time}* ${t(lang, 'daily', 'codziennie')} (${tz})\n🔍 _${query}_`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'remind': {
      const { when, text: reminderText } = params;
      if (!when) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Could not parse the time. Try: "remind me in 30min about meeting"',
                  '⚠️ Nie rozpoznałem czasu. Spróbuj: "przypomnij mi za 30min o spotkaniu"'));
        return true;
      }
      const delayMs = reminder.parseTime(when);
      if (delayMs === null) {
        await bot.sendMessage(chatId,
          `⚠️ ${t(lang, 'Could not parse time', 'Nie rozpoznałem czasu')}: \`${when}\`. ${t(lang, 'Use: 30min, 2h, 17:30', 'Użyj: 30min, 2h, 17:30')}`,
          { parse_mode: 'Markdown' });
        return true;
      }
      const rText = reminderText || t(lang, 'Reminder!', 'Przypomnienie!');
      const info  = reminder.add(bot, chatId, userId, rText, delayMs);
      await bot.sendMessage(chatId,
        `⏰ ${t(lang, 'Reminder set!', 'Przypomnienie ustawione!')}\n📝 _${rText}_\n🕐 ${t(lang, 'In', 'Za')} *${info.inMs}*`,
        { parse_mode: 'Markdown' });
      return true;
    }

    case 'remember': {
      const { fact } = params;
      if (!fact) {
        await bot.sendMessage(chatId,
          t(lang, '⚠️ Could not detect the fact to remember.', '⚠️ Nie rozpoznałem faktu do zapamiętania.'));
        return true;
      }
      db.addMemory(userId, fact);
      await bot.sendMessage(chatId,
        `🧠 ${t(lang, 'Got it:', 'Zapamiętałem:')} _${fact}_`,
        { parse_mode: 'Markdown' });
      return true;
    }

    default:
      return false;
  }
}

// ─── Plain Message → Agent ───────────────────────────────────────────────────

async function handleMessage(bot, msg) {
  const userId  = msg.from.id;
  const chatId  = msg.chat.id;
  const text    = msg.text?.trim();
  if (!text) return;

  // Store chatId so scheduler can push messages even without a prior message
  const cfg = db.getConfig(userId);
  if (cfg.chatId !== chatId) db.setConfig(userId, { chatId });

  // Natural language intent detection — runs only when trigger words present
  const intent = await intentHandler.detectIntent(text);
  if (intent) {
    const { intent: type, lang, params } = intent;

    // Read-only intents execute immediately — no confirmation needed
    if (type === 'briefing_list_feeds') {
      const handled = await executeIntent(bot, msg, intent);
      if (handled) return;
    } else {
      // All state-changing intents: show confirmation with inline buttons
      const summary = formatConfirmation(type, lang, params);
      const sent = await bot.sendMessage(chatId,
        `🤖 *Czy o to chodziło?*\n${summary}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Tak, wykonaj', callback_data: `confirm:${userId}` },
              { text: '❌ Anuluj',       callback_data: `cancel:${userId}` },
            ]],
          },
        }
      );
      // Overwrite any previous pending intent for this user
      if (pendingIntents.has(String(userId))) {
        clearTimeout(pendingIntents.get(String(userId)).timer);
      }
      const timer = setTimeout(() => pendingIntents.delete(String(userId)), CONFIRMATION_TTL);
      pendingIntents.set(String(userId), {
        intent, chatId, msgId: sent.message_id, timer,
      });
      return;
    }
  }

  await bot.sendChatAction(chatId, 'typing');

  const manualModel = cfg.manualModel ? cfg.model : null;

  // Decide: web search needed?
  const needsSearch = /\b(search|wyszukaj|google|find|znajdź).+\b/i.test(text) ||
                      (/\bco to jest\b/i.test(text) && text.length > 40);

  let enriched = text;
  if (needsSearch) {
    await bot.sendMessage(chatId, '🔍 Searching the web first...');
    const results = await search.webSearch(text);
    enriched = `User asked: ${text}\n\nContext from web search:\n${results}`;
  }

  const model        = manualModel || router.routeModel(text, null);
  const label        = router.modelLabel(model);
  const displayModel = llm.resolveDisplayModel(model);

  let typingInterval;
  let loadingMsg = null;
  try {
    if (model !== router.MODEL_SMALL) {
      loadingMsg = await bot.sendMessage(chatId, `⏳ *${label} — ${displayModel}...*`);
    }

    typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing'), 5000);

    const reply = await llm.chat({
      userId,
      userMessage:       enriched,
      model,
      persona:           cfg.persona,
      customInstruction: cfg.customInstruction || null,
    });

    clearInterval(typingInterval);
    if (loadingMsg) {
      await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    }

    const prefixed = model !== router.MODEL_SMALL ? `${label}\n\n${reply}` : reply;
    await sendLong(bot, chatId, prefixed);
  } catch (err) {
    clearInterval(typingInterval);

    let errMsg = `❌ Error: ${err.message}`;
    if (err.code === 'ECONNREFUSED')
      errMsg = '❌ All providers unreachable.\n' +
               'OpenRouter: check your API key.\n' +
               'Ollama: run `ollama serve` to start it.';
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
      errMsg = `⏱️ *Timeout!* Model \`${displayModel}\` did not respond within 180s.\nTry a lighter model with \`/model auto\`.`;

    await bot.sendMessage(chatId, errMsg, { parse_mode: 'Markdown' });
  }
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

function register(bot) {
  function guard(handler) {
    return async (msg, match) => {
      if (!msg || !msg.chat || !msg.chat.id || !msg.from) return;
      if (!isAllowed(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized.');
      }
      return handler(msg, match);
    };
  }

  bot.onText(/^\/start/, guard(m => handleStart(bot, m)));
  bot.onText(/^\/help/,  guard(m => handleHelp(bot, m)));
  bot.onText(/^\/status/,guard(m => handleStatus(bot, m)));
  bot.onText(/^\/clear/, guard(m => handleClear(bot, m)));

  bot.onText(/^\/model(?:\s+(.+))?$/, guard((m, match) =>
    handleModel(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/models/, guard(m => handleModels(bot, m)));
  bot.onText(/^\/persona(?:\s+(.+))?$/, guard((m, match) =>
    handlePersona(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/instruct(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleInstruct(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/memory/, guard(m => handleMemory(bot, m)));
  bot.onText(/^\/remember(?:\s+(.+))?$/, guard((m, match) =>
    handleRemember(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/forget/, guard(m => handleForget(bot, m)));

  bot.onText(/^\/notes?/, guard(m => handleNotes(bot, m)));
  bot.onText(/^\/note(?:\s+(.+))?$/, guard((m, match) =>
    handleNote(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/delnote(?:\s+(\d+))?$/, guard((m, match) =>
    handleDelNote(bot, m, match[1] ? [match[1]] : [])));

  bot.onText(/^\/todos?/, guard(m => handleTodos(bot, m)));
  bot.onText(/^\/task(?:\s+(.+))?$/, guard((m, match) =>
    handleTask(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/done(?:\s+(\d+))?$/, guard((m, match) =>
    handleDone(bot, m, match[1] ? [match[1]] : [])));

  // /schedule and /schedules both route to the same handler
  bot.onText(/^\/schedules?(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleSchedule(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/search(?:\s+(.+))?$/, guard((m, match) =>
    handleSearch(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/run(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleRun(bot, m, match[1] ? [match[1].trim()] : [])));

  bot.onText(/^\/remind(?:\s+([\s\S]+))?$/, guard((m, match) =>
    handleRemind(bot, m, match[1]?.trim().split(/\s+/) || [])));
  bot.onText(/^\/reminders?$/, guard(m => handleReminders(bot, m)));
  bot.onText(/^\/remindel(?:\s+(\d+))?$/, guard((m, match) =>
    handleReminderDel(bot, m, match[1] ? [match[1]] : [])));

  bot.onText(/^\/weather(?:\s+(.+))?$/, guard((m, match) =>
    handleWeather(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.onText(/^\/briefing(?:\s+([\s\S]+))?$/, guard((m, match) =>
    briefingCmd.handle(bot, m, match[1]?.trim().split(/\s+/) || [])));

  bot.on('message', guard(m => {
    // Voice message
    if (m.voice) return handleVoice(bot, m);
    // Photo message
    if (m.photo) return handlePhoto(bot, m);
    // Text commands skip
    if (!m.text || m.text.startsWith('/')) return;
    return handleMessage(bot, m);
  }));

  // ─── Intent confirmation (inline keyboard callbacks) ───────────────────────
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const colonIdx = data.indexOf(':');
    if (colonIdx === -1) return bot.answerCallbackQuery(query.id);

    const action       = data.slice(0, colonIdx);
    const targetUserId = data.slice(colonIdx + 1);
    const userId       = String(query.from.id);

    // Only the original user may confirm/cancel their own pending action
    if (userId !== targetUserId) {
      return bot.answerCallbackQuery(query.id, { text: 'To nie twoja akcja.' });
    }

    const pending = pendingIntents.get(userId);
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: 'Akcja wygasła lub już wykonana.' });
      return;
    }

    // Clear pending state
    clearTimeout(pending.timer);
    pendingIntents.delete(userId);

    // Remove buttons from the confirmation message
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: pending.chatId, message_id: pending.msgId }
    ).catch(() => {});

    if (action === 'confirm') {
      await bot.answerCallbackQuery(query.id, { text: '✅ Wykonuję…' });
      const fakeMsg = { chat: { id: pending.chatId }, from: { id: Number(userId) } };
      await executeIntent(bot, fakeMsg, pending.intent);
    } else {
      await bot.answerCallbackQuery(query.id, { text: '❌ Anulowano.' });
      await bot.sendMessage(pending.chatId,
        '_Anulowano. Potraktuję to jako zwykłe pytanie._',
        { parse_mode: 'Markdown' }
      );
    }
  });
}

module.exports = { register };
