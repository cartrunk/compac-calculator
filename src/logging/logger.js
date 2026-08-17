'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sentry.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS flagged_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    session_id TEXT,
    ip TEXT,
    ja3 TEXT,
    method TEXT,
    path TEXT,
    user_agent TEXT,
    score INTEGER,
    verdict TEXT,
    reasons TEXT,
    request_headers TEXT,
    response_status INTEGER,
    response_body TEXT,
    canary_token TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_flagged_ts ON flagged_requests(ts);
  CREATE INDEX IF NOT EXISTS idx_flagged_session ON flagged_requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_flagged_canary ON flagged_requests(canary_token);
  CREATE INDEX IF NOT EXISTS idx_flagged_ja3 ON flagged_requests(ja3);

  CREATE TABLE IF NOT EXISTS canary_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    canary_token TEXT NOT NULL,
    source TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sightings_token ON canary_sightings(canary_token);

  -- Scalping-specific: a "hit" against limited inventory (checkout,
  -- reservation, cart-add on a drop item), as opposed to ordinary page
  -- views. This is what turns "bot browsed the site" into "bot attempted
  -- to acquire N units of item X at time T" — the fact pattern that
  -- actually matters for a scalping complaint.
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    session_id TEXT,
    ip TEXT,
    ja3 TEXT,
    item_id TEXT,
    quantity INTEGER,
    score INTEGER,
    verdict TEXT,
    outcome TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_ts ON attempts(ts);
  CREATE INDEX IF NOT EXISTS idx_attempts_ja3 ON attempts(ja3);
  CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
`);

// Older databases created before the ja3 column existed — add it in place
// rather than requiring a manual migration. Safe to run on every boot.
try {
  db.exec('ALTER TABLE flagged_requests ADD COLUMN ja3 TEXT');
} catch {
  // already has the column
}

const insertFlagged = db.prepare(`
  INSERT INTO flagged_requests
    (ts, session_id, ip, ja3, method, path, user_agent, score, verdict, reasons, request_headers, response_status, response_body, canary_token)
  VALUES
    (@ts, @sessionId, @ip, @ja3, @method, @path, @userAgent, @score, @verdict, @reasons, @requestHeaders, @responseStatus, @responseBody, @canaryToken)
`);

// Response bodies for flagged sessions can be large across a full crawl;
// this cap keeps a single page's DB footprint bounded while still
// preserving enough of the payload to prove what was served.
const MAX_LOGGED_BODY_BYTES = 200_000;

function logFlaggedRequest(entry) {
  const responseBody =
    typeof entry.responseBody === 'string' && entry.responseBody.length > MAX_LOGGED_BODY_BYTES
      ? entry.responseBody.slice(0, MAX_LOGGED_BODY_BYTES) + '…[truncated]'
      : entry.responseBody || null;

  insertFlagged.run({
    ts: Date.now(),
    sessionId: entry.sessionId || null,
    ip: entry.ip || null,
    ja3: entry.ja3 || null,
    method: entry.method || null,
    path: entry.path || null,
    userAgent: entry.userAgent || null,
    score: entry.score ?? null,
    verdict: entry.verdict || null,
    reasons: JSON.stringify(entry.reasons || []),
    requestHeaders: JSON.stringify(entry.requestHeaders || {}),
    responseStatus: entry.responseStatus ?? null,
    responseBody,
    canaryToken: entry.canaryToken || null,
  });
}

const insertAttempt = db.prepare(`
  INSERT INTO attempts (ts, session_id, ip, ja3, item_id, quantity, score, verdict, outcome)
  VALUES (@ts, @sessionId, @ip, @ja3, @itemId, @quantity, @score, @verdict, @outcome)
`);

function logAttempt(entry) {
  insertAttempt.run({
    ts: Date.now(),
    sessionId: entry.sessionId || null,
    ip: entry.ip || null,
    ja3: entry.ja3 || null,
    itemId: entry.itemId || null,
    quantity: entry.quantity ?? null,
    score: entry.score ?? null,
    verdict: entry.verdict || null,
    outcome: entry.outcome || null,
  });
}

const insertSighting = db.prepare(`
  INSERT INTO canary_sightings (ts, canary_token, source, detail)
  VALUES (@ts, @canaryToken, @source, @detail)
`);

function logCanarySighting({ canaryToken, source, detail }) {
  insertSighting.run({ ts: Date.now(), canaryToken, source: source || null, detail: detail || null });
}

const listFlaggedStmt = db.prepare(`
  SELECT id, ts, session_id, ip, method, path, user_agent, score, verdict, reasons, response_status, canary_token
  FROM flagged_requests
  ORDER BY ts DESC
  LIMIT @limit
`);

function listRecentFlagged(limit = 100) {
  return listFlaggedStmt.all({ limit }).map((row) => ({
    ...row,
    reasons: JSON.parse(row.reasons || '[]'),
  }));
}

const findByCanaryStmt = db.prepare(`
  SELECT id, ts, session_id, ip, path, user_agent, canary_token
  FROM flagged_requests
  WHERE canary_token = @token
  ORDER BY ts DESC
`);

function findSessionsByCanary(token) {
  return findByCanaryStmt.all({ token });
}

// Groups flagged activity by JA3 fingerprint — the whole point being that
// an actor rotating IPs/accounts/proxies to evade rate limiting usually
// keeps reusing the same TLS client (same automation tooling), so the
// fingerprint is what ties their attempts back together even when the IP
// and session cookie change on every request. This is correlation
// evidence, not proof of identity on its own — see README.
const listActorsStmt = db.prepare(`
  SELECT
    ja3,
    COUNT(*) AS flaggedRequests,
    COUNT(DISTINCT session_id) AS distinctSessions,
    COUNT(DISTINCT ip) AS distinctIps,
    MIN(ts) AS firstSeen,
    MAX(ts) AS lastSeen,
    AVG(score) AS avgScore
  FROM flagged_requests
  WHERE ja3 IS NOT NULL
  GROUP BY ja3
  ORDER BY distinctIps DESC, flaggedRequests DESC
  LIMIT @limit
`);

function listActors(limit = 100) {
  return listActorsStmt.all({ limit });
}

const actorFlaggedStmt = db.prepare(`
  SELECT id, ts, session_id, ip, method, path, user_agent, score, verdict, reasons, response_status, canary_token
  FROM flagged_requests
  WHERE ja3 = @ja3
  ORDER BY ts ASC
`);

const actorAttemptsStmt = db.prepare(`
  SELECT id, ts, session_id, ip, item_id, quantity, score, verdict, outcome
  FROM attempts
  WHERE ja3 = @ja3
  ORDER BY ts ASC
`);

/**
 * Full evidence bundle for one actor (JA3 cluster): every flagged request
 * and every inventory-attempt tied to that fingerprint, across whatever
 * IPs/session cookies they used. This is the raw material for an incident
 * report — see src/routes/admin.js for the formatted version.
 */
function getActorReport(ja3) {
  return {
    ja3,
    flaggedRequests: actorFlaggedStmt.all({ ja3 }).map((row) => ({ ...row, reasons: JSON.parse(row.reasons || '[]') })),
    attempts: actorAttemptsStmt.all({ ja3 }),
  };
}

module.exports = {
  db,
  logFlaggedRequest,
  logCanarySighting,
  logAttempt,
  listRecentFlagged,
  findSessionsByCanary,
  listActors,
  getActorReport,
};
