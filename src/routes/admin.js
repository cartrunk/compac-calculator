'use strict';

const express = require('express');
const { listRecentFlagged, findSessionsByCanary } = require('../logging/logger');

const router = express.Router();

// Fail closed: with no ADMIN_TOKEN configured, these routes (flagged-session
// logs, which can contain full response bodies and headers) are disabled
// rather than left open. Set ADMIN_TOKEN and send it as `X-Admin-Token`.
router.use((req, res, next) => {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) {
    res.status(503).json({ error: 'admin API disabled: set ADMIN_TOKEN to enable' });
    return;
  }
  if (req.get('X-Admin-Token') !== configured) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

router.get('/flagged', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json(listRecentFlagged(limit));
});

router.get('/canary/:token', (req, res) => {
  res.json(findSessionsByCanary(req.params.token));
});

module.exports = router;
