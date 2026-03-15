/**
 * coder.js — Safe code execution tool (Termux sandboxed)
 *
 * Allows the agent to write and run JS code snippets/scripts
 * inside the Termux process and return stdout/stderr results.
 *
 * SAFETY: only runs if the user explicitly asks, code is sandboxed via
 * a child process with a hard 10-second timeout.
 */
'use strict';

const { execFile } = require('child_process');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');

const TIMEOUT_MS = 10_000;

/**
 * Executes arbitrary JS code string in a sandboxed child process.
 * @param {string} code — JS code to run
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function runCode(code) {
  // Write code to a temp file
  const tmpFile = path.join(os.tmpdir(), `agent_code_${Date.now()}.js`);
  fs.writeFileSync(tmpFile, code, 'utf8');

  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,  // path to node binary
      [tmpFile],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 64 },
      (err, stdout, stderr) => {
        // cleanup temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        resolve({
          stdout: stdout?.trim() || '',
          stderr: stderr?.trim() || (err && !err.killed ? err.message : ''),
          exitCode: err?.code ?? 0,
          timedOut: err?.killed ?? false,
        });
      }
    );
  });
}

/**
 * Format execution result for Telegram markdown output.
 */
function formatResult({ stdout, stderr, exitCode, timedOut }) {
  if (timedOut) return '⏱ Code execution timed out (10s limit).';
  let out = '';
  if (stdout) out += `📤 Output:\n\`\`\`\n${stdout}\n\`\`\``;
  if (stderr) out += `\n⚠️ Stderr:\n\`\`\`\n${stderr}\n\`\`\``;
  if (!stdout && !stderr) out = exitCode === 0 ? '✅ Executed with no output.' : `❌ Exit code ${exitCode}`;
  return out;
}

module.exports = { runCode, formatResult };
