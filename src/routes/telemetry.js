'use strict';

const express = require('express');
const { analyzeTelemetry } = require('../fingerprint/telemetry');
const telemetryStore = require('../middleware/telemetryStore');
const { parseCookies, SESSION_COOKIE } = require('../middleware/detect');

const router = express.Router();

router.post('/report', express.json({ limit: '10kb' }), (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    const signal = analyzeTelemetry(req.body);
    if (signal) telemetryStore.set(sessionId, signal);
  }
  res.status(204).end();
});

module.exports = router;
