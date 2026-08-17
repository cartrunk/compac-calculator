'use strict';

const crypto = require('crypto');
const { analyzeHeaders } = require('../fingerprint/headers');
const { getJA3, analyzeJA3 } = require('../fingerprint/ja3');
const { analyzeRate } = require('../fingerprint/rate');
const { computeScore } = require('../fingerprint/scoring');
const { logFlaggedRequest } = require('../logging/logger');
const telemetryStore = require('./telemetryStore');

const SESSION_COOKIE = 'ss_id';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function getOrCreateSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

  const id = crypto.randomBytes(16).toString('hex');
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
  });
  return id;
}

/**
 * Builds the Express middleware that runs every configured signal for each
 * request, combines them into a score/verdict via scoring.js, attaches the
 * result to `req.detection`, and — for verdict 'flag' — logs the full
 * request/response to SQLite once the response finishes sending. Wiring
 * (see server.js) puts this middleware *before* the canary middleware so
 * the response body it logs is the final, watermark-injected one.
 */
function createDetectMiddleware({ rateTracker, ja3Lists = {} }) {
  return (req, res, next) => {
    const sessionId = getOrCreateSessionId(req, res);
    req.sessionId = sessionId;

    const headerSignal = analyzeHeaders(req.headers);

    const ja3fp = getJA3(req);
    const ja3Signal = analyzeJA3(ja3fp, ja3Lists);

    const rateKey = `${req.ip}:${sessionId}`;
    const rateRaw = rateTracker.track(rateKey, req.path);
    const rateSignal = analyzeRate(rateRaw);

    const telemetrySignal = telemetryStore.get(sessionId);

    const result = computeScore({
      headers: headerSignal,
      ja3: ja3Signal,
      rate: rateSignal,
      telemetry: telemetrySignal,
    });

    req.detection = { ...result, ja3: ja3fp ? ja3fp.ja3 : null, sessionId };

    // Capture the body actually sent (after any downstream middleware,
    // e.g. canary watermarking, has had a chance to transform it) without
    // altering it — this wrapper only observes.
    const realSend = res.send.bind(res);
    res.send = (body) => {
      res.locals._sentBody = body;
      return realSend(body);
    };

    res.on('finish', () => {
      if (result.verdict !== 'flag') return;
      logFlaggedRequest({
        sessionId,
        ip: req.ip,
        method: req.method,
        path: req.originalUrl,
        userAgent: req.headers['user-agent'] || null,
        score: result.score,
        verdict: result.verdict,
        reasons: result.reasons,
        requestHeaders: req.headers,
        responseStatus: res.statusCode,
        responseBody: typeof res.locals._sentBody === 'string' ? res.locals._sentBody : null,
        canaryToken: req.canaryToken || null,
      });
    });

    next();
  };
}

module.exports = { createDetectMiddleware, SESSION_COOKIE, parseCookies };
