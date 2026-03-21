/**
 * autostart.js — Windows autostart setup via Task Scheduler
 *
 * Usage:
 *   node scripts/autostart.js install   — register task (runs on Windows login)
 *   node scripts/autostart.js remove    — unregister task
 *   node scripts/autostart.js status    — check if task is registered
 *
 * Or via npm:
 *   npm run autostart:install
 *   npm run autostart:remove
 *   npm run autostart:status
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const TASK_NAME  = 'WindowsAIAssistant';
const PROJECT_DIR = path.resolve(__dirname, '..');
const LOGS_DIR   = path.join(PROJECT_DIR, 'logs');
const VBS_PATH   = path.join(PROJECT_DIR, 'scripts', 'launch.vbs');
const LOG_FILE   = path.join(LOGS_DIR, 'bot.log');
const NODE_EXE   = process.execPath;
const ENTRY      = path.join(PROJECT_DIR, 'index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return err.stdout || err.stderr || '';
  }
}

function taskExists() {
  const out = run(`schtasks /query /tn "${TASK_NAME}" 2>&1`);
  return out.includes(TASK_NAME);
}

// ─── VBScript launcher ────────────────────────────────────────────────────────
// Runs the bot silently (no console window) and redirects output to log file.

function writeVbs() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  const vbs = [
    `' launch.vbs — starts the AI assistant silently`,
    `Dim shell`,
    `Set shell = CreateObject("WScript.Shell")`,
    `shell.CurrentDirectory = "${PROJECT_DIR.replace(/\\/g, '\\\\')}"`,
    `shell.Run "cmd /c """"${NODE_EXE.replace(/\\/g, '\\\\')}"""" """"${ENTRY.replace(/\\/g, '\\\\')}"""" >> """"${LOG_FILE.replace(/\\/g, '\\\\')}"""" 2>&1", 0, False`,
    `Set shell = Nothing`,
  ].join('\r\n');

  fs.writeFileSync(VBS_PATH, vbs, 'utf8');
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function install() {
  console.log('📋 Setting up autostart...');
  console.log(`   Project:  ${PROJECT_DIR}`);
  console.log(`   Node:     ${NODE_EXE}`);
  console.log(`   Log file: ${LOG_FILE}`);

  // Remove old task if present
  if (taskExists()) {
    console.log(`   Removing old task "${TASK_NAME}"...`);
    run(`schtasks /delete /tn "${TASK_NAME}" /f`);
  }

  // Write the VBScript launcher
  writeVbs();
  console.log(`   Launcher: ${VBS_PATH}`);

  // Register Task Scheduler task — ONLOGON, run at highest available privilege
  // wscript.exe runs the .vbs silently (no console window)
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const cmd = [
    'schtasks /create',
    `/tn "${TASK_NAME}"`,
    `/tr "\\"${wscript}\\" \\"${VBS_PATH}\\""`,
    `/sc ONLOGON`,
    `/delay 0000:30`,   // 30-second delay after login (lets system settle)
    `/rl HIGHEST`,
    `/f`,
  ].join(' ');

  const result = run(cmd);

  if (taskExists()) {
    console.log(`\n✅ Autostart installed successfully!`);
    console.log(`   Task name: ${TASK_NAME}`);
    console.log(`   Trigger:   On login (30s delay)`);
    console.log(`   Logs:      ${LOG_FILE}`);
    console.log(`\n   The bot will start automatically on next Windows login.`);
    console.log(`   To start it now without rebooting:`);
    console.log(`   npm start`);
  } else {
    console.error('\n❌ Failed to register task. Output:');
    console.error(result);
    console.error('\nTry running as Administrator:');
    console.error('   Right-click on Terminal → "Run as administrator"');
    console.error('   Then run: npm run autostart:install');
    process.exit(1);
  }
}

function remove() {
  if (!taskExists()) {
    console.log(`ℹ️  Task "${TASK_NAME}" not found — nothing to remove.`);
    return;
  }
  run(`schtasks /delete /tn "${TASK_NAME}" /f`);
  if (taskExists()) {
    console.error(`❌ Could not remove task. Try running as Administrator.`);
    process.exit(1);
  }
  console.log(`✅ Autostart removed. Task "${TASK_NAME}" deleted.`);

  // Optionally remove VBS launcher
  if (fs.existsSync(VBS_PATH)) {
    fs.unlinkSync(VBS_PATH);
    console.log(`   Launcher script removed: ${VBS_PATH}`);
  }
}

function status() {
  if (!taskExists()) {
    console.log(`⚪ Status: NOT installed`);
    console.log(`   Run "npm run autostart:install" to set up autostart.`);
    return;
  }

  // Get detailed task info
  const info = run(`schtasks /query /tn "${TASK_NAME}" /fo LIST`);
  const lines = info.split('\n').filter(l => l.trim());
  const relevant = lines.filter(l =>
    /Task To Run|Status|Next Run Time|Last Run Time|Last Result/i.test(l)
  );

  console.log(`✅ Status: INSTALLED`);
  console.log(`   Task: ${TASK_NAME}`);
  relevant.forEach(l => console.log(`   ${l.trim()}`));
  console.log(`\n   Logs: ${LOG_FILE}`);
  if (fs.existsSync(LOG_FILE)) {
    const stat = fs.statSync(LOG_FILE);
    console.log(`   Log size: ${(stat.size / 1024).toFixed(1)} KB — last modified: ${stat.mtime.toLocaleString()}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const command = process.argv[2];
switch (command) {
  case 'install': install(); break;
  case 'remove':  remove();  break;
  case 'status':  status();  break;
  default:
    console.log('Usage: node scripts/autostart.js <install|remove|status>');
    console.log('  install — register autostart on Windows login');
    console.log('  remove  — unregister autostart');
    console.log('  status  — show current status');
    process.exit(1);
}
