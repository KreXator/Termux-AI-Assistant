/**
 * index.js — Entry point for Windows AI Assistant
 * Boot sequence: load env → check Ollama → start Telegram bot → init scheduler
 */
'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const ollama      = require('./src/llm/ollama');
const openrouter  = require('./src/llm/openrouter');
const commands    = require('./src/handlers/commands');
const scheduler   = require('./src/scheduler/scheduler');
const reminder    = require('./src/tools/reminder');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

async function main() {
  const orKey = !!process.env.OPENROUTER_API_KEY;

  if (orKey) {
    console.log('🔄 Checking OpenRouter...');
    const orAlive = await openrouter.isReachable();
    console.log(orAlive ? '✅ OpenRouter is reachable (primary).' : '⚠️  OpenRouter unreachable — will use Ollama fallback.');
  }

  console.log('🔄 Checking Ollama' + (orKey ? ' (fallback)' : '') + '...');
  const alive = await ollama.isOllamaRunning();
  if (!alive) {
    if (!orKey) {
      console.warn('⚠️  Ollama is not responding at', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
      console.warn('   Start Ollama with: ollama serve');
      console.warn('   Continuing anyway — bot will report errors to Telegram.\n');
    } else {
      console.warn('⚠️  Ollama offline — OpenRouter will be the only provider.');
    }
  } else {
    console.log('✅ Ollama is running' + (orKey ? ' (fallback).' : '.'));
  }

  const bot = new TelegramBot(TOKEN, { polling: true });

  commands.register(bot);

  // Restore scheduled searches and reminders from disk
  scheduler.init(bot);
  reminder.init(bot);

  bot.on('polling_error', err => {
    console.error('[Polling error]', err.code, err.message);
  });

  bot.on('error', err => {
    console.error('[Bot error]', err.message);
  });

  const searchMode = process.env.SERPER_API_KEY ? 'Serper (Google)' : 'DuckDuckGo (fallback)';

  console.log('🤖 Windows AI Assistant is running. Send /start on Telegram.');
  if (orKey) {
    console.log(`   Provider:          OpenRouter (primary) + Ollama (fallback)`);
    console.log(`   Fast   model (💬): ${openrouter.OR_MODEL_SMALL}`);
    console.log(`   Medium model (⚡): ${openrouter.OR_MODEL_MEDIUM}`);
    console.log(`   High   model (🧠): ${openrouter.OR_MODEL_LARGE}`);
    console.log(`   Premium    (💰): ${openrouter.OR_MODEL_PREMIUM}  (/model premium)`);
    console.log(`   Vision:            ${openrouter.OR_VISION_MODEL}`);
  } else {
    console.log(`   Provider:          Ollama (local)`);
    console.log(`   Fast   model (💬): ${process.env.MODEL_SMALL  || 'qwen2.5:3b-instruct-q4_K_M'}`);
    console.log(`   Medium model (⚡): ${process.env.MODEL_MEDIUM || 'qwen2.5:7b-instruct-q4_K_M'}`);
    console.log(`   High   model (🧠): ${process.env.MODEL_LARGE  || 'qwen3:8b'}`);
  }
  console.log(`   Web search:        ${searchMode}`);
  console.log(`   Timezone:          ${process.env.TZ || 'Europe/Warsaw'}`);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
