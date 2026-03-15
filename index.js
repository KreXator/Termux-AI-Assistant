/**
 * index.js — Entry point for Termux AI Assistant
 * Boot sequence: load env → check Ollama → start Telegram bot
 */
'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const ollama      = require('./src/llm/ollama');
const commands    = require('./src/handlers/commands');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

async function main() {
  console.log('🔄 Checking Ollama...');
  const alive = await ollama.isOllamaRunning();
  if (!alive) {
    console.warn('⚠️  Ollama is not responding at', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    console.warn('   Start it in Termux with: ollama serve');
    console.warn('   Continuing anyway — bot will report errors to Telegram.\n');
  } else {
    console.log('✅ Ollama is running.');
  }

  // Long-polling mode — works fine without root / without opening ports
  const bot = new TelegramBot(TOKEN, { polling: true });

  commands.register(bot);

  // Generic error handler so the process doesn't crash on network glitches
  bot.on('polling_error', err => {
    console.error('[Polling error]', err.code, err.message);
  });

  bot.on('error', err => {
    console.error('[Bot error]', err.message);
  });

  console.log('🤖 Termux AI Assistant is running. Send /start on Telegram.');
  console.log(`   Small model : ${process.env.MODEL_SMALL || 'llama3.2:3b'}`);
  console.log(`   Large model : ${process.env.MODEL_LARGE || 'llama3:8b'}`);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
