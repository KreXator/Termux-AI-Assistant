/**
 * start.js — Self-restarting wrapper for index.js
 *
 * Run with: node start.js
 * Bot restarts automatically on exit (e.g. after /update).
 * Ctrl+C stops completely.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ENTRY   = path.join(__dirname, 'index.js');
const RESTART_DELAY_MS = 2000;

let stopping = false;

process.on('SIGINT',  () => { stopping = true; process.exit(0); });
process.on('SIGTERM', () => { stopping = true; process.exit(0); });

function start() {
  console.log('[wrapper] Starting bot…');

  const child = spawn(process.execPath, [ENTRY], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(`[wrapper] Bot exited (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY_MS / 1000}s…`);
    setTimeout(start, RESTART_DELAY_MS);
  });
}

start();
