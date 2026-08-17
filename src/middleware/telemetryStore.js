'use strict';

// Session-keyed store for client-reported telemetry signals. In-memory and
// single-process, same scaling caveat as rate.js — swap for a shared store
// (Redis, etc.) to run this behind a load balancer with multiple instances.
const TTL_MS = 30 * 60_000;
const store = new Map(); // sessionId -> { signal, expiresAt }

function set(sessionId, signal) {
  store.set(sessionId, { signal, expiresAt: Date.now() + TTL_MS });
}

function get(sessionId) {
  const entry = store.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(sessionId);
    return null;
  }
  return entry.signal;
}

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60_000);
sweepTimer.unref?.();

module.exports = { set, get };
