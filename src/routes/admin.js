'use strict';

const express = require('express');
const { listRecentFlagged, findSessionsByCanary, listActors, getActorReport } = require('../logging/logger');
const { lookupIP } = require('../ipintel');
const { buildIncidentReportMarkdown } = require('../report');

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

router.get('/actors', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json(listActors(limit));
});

router.get('/actors/:ja3/report', async (req, res) => {
  const actorReport = getActorReport(req.params.ja3);
  if (!actorReport.flaggedRequests.length && !actorReport.attempts.length) {
    res.status(404).json({ error: 'no activity recorded for this JA3 fingerprint' });
    return;
  }

  const ips = [
    ...new Set(actorReport.flaggedRequests.map((r) => r.ip).concat(actorReport.attempts.map((a) => a.ip)).filter(Boolean)),
  ];
  const ipIntelByIp = {};
  await Promise.all(
    ips.map(async (ip) => {
      const intel = await lookupIP(ip);
      if (intel) ipIntelByIp[ip] = intel;
    })
  );

  if (req.query.format === 'markdown') {
    res.set('Content-Type', 'text/markdown');
    res.send(buildIncidentReportMarkdown(actorReport, { ipIntelByIp }));
    return;
  }

  res.json({ ...actorReport, ipIntelByIp });
});

module.exports = router;
