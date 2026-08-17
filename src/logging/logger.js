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

  CREATE TABLE IF NOT EXISTS canary_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    canary_token TEXT NOT NULL,
    source TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sightings_token ON canary_sightings(canary_token);
`);

const insertFlagged = db.prepare(`
  INSERT INTO flagged_requests
    (ts, session_id, ip, method, path, user_agent, score, verdict, reasons, request_headers, response_status, response_body, canary_token)
  VALUES
    (@ts, @sessionId, @ip, @method, @path, @userAgent, @score, @verdict, @reasons, @requestHeaders, @responseStatus, @responseBody, @canaryToken)
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

module.exports = {
  db,
  logFlaggedRequest,
  logCanarySighting,
  listRecentFlagged,
  findSessionsByCanary,
};
