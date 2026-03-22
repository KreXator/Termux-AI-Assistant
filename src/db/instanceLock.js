/**
 * instanceLock.js — Distributed instance lock via Turso
 *
 * Only one instance may poll Telegram at a time.
 * Lock expires if heartbeat is not updated for EXPIRY_MS.
 * Standby instances poll every POLL_MS and take over on expiry.
 */
'use strict';

const turso = require('./turso');

const HEARTBEAT_MS = 15_000;
const EXPIRY_MS    = 45_000;
const POLL_MS      = 30_000;

let _heartbeatTimer = null;

/**
 * Try to acquire the lock.
 * Returns true if this instance is now active, false if another instance holds it.
 */
async function acquire(instanceId) {
  const now    = new Date().toISOString();
  const expiry = new Date(Date.now() - EXPIRY_MS).toISOString();

  // Remove expired lock (only 1 row ever exists — lock_slot = 1)
  await turso.execute({
    sql:  'DELETE FROM instance_lock WHERE heartbeat < ?',
    args: [expiry],
  });

  // Try to claim the single lock slot
  try {
    await turso.execute({
      sql:  'INSERT INTO instance_lock (lock_slot, instance_id, acquired_at, heartbeat) VALUES (1, ?, ?, ?)',
      args: [instanceId, now, now],
    });
    console.log(`[lock] Acquired by ${instanceId}`);
    return true;
  } catch {
    // Slot taken by another instance with a fresh heartbeat
    const r = await turso.execute(
      'SELECT instance_id, heartbeat FROM instance_lock WHERE lock_slot = 1'
    );
    if (r.rows.length) {
      console.log(`[lock] Held by ${r.rows[0][0]}, heartbeat ${r.rows[0][1]}`);
    }
    return false;
  }
}

/**
 * Release the lock on graceful shutdown.
 */
async function release(instanceId) {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  await turso.execute({
    sql:  'DELETE FROM instance_lock WHERE lock_slot = 1 AND instance_id = ?',
    args: [instanceId],
  });
  console.log(`[lock] Released by ${instanceId}`);
}

/**
 * Start sending heartbeats every HEARTBEAT_MS.
 */
function startHeartbeat(instanceId) {
  _heartbeatTimer = setInterval(async () => {
    try {
      await turso.execute({
        sql:  'UPDATE instance_lock SET heartbeat = ? WHERE lock_slot = 1 AND instance_id = ?',
        args: [new Date().toISOString(), instanceId],
      });
    } catch (err) {
      console.error('[lock] Heartbeat failed:', err.message);
    }
  }, HEARTBEAT_MS);
}

/**
 * Standby mode: poll until the lock expires, then take over and start bot.
 * @param {string} instanceId
 * @param {Function} onTakeover — called when this instance becomes primary
 */
async function waitForTakeover(instanceId, onTakeover) {
  console.log(`[lock] Standby. Polling every ${POLL_MS / 1000}s…`);
  return new Promise(resolve => {
    const timer = setInterval(async () => {
      try {
        const ok = await acquire(instanceId);
        if (ok) {
          clearInterval(timer);
          startHeartbeat(instanceId);
          console.log(`[lock] Took over as primary.`);
          await onTakeover();
          resolve();
        }
      } catch (err) {
        console.error('[lock] Takeover poll error:', err.message);
      }
    }, POLL_MS);
  });
}

module.exports = { acquire, release, startHeartbeat, waitForTakeover };
