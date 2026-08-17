'use strict';

const express = require('express');

const router = express.Router();

function layout(title, body) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; background:#0b0f14; color:#d7e2ea; }
  a { color: #6cb6ff; }
  code { background: #14202a; padding: 2px 5px; border-radius: 3px; }
  .score { padding: 12px; border-radius: 6px; margin: 16px 0; }
  .score.allow { background: #123420; }
  .score.challenge { background: #3a3512; }
  .score.flag { background: #3a1414; }
  ul { line-height: 1.8; }
</style>
</head>
<body>
${body}
<script src="/telemetry-client.js"></script>
</body>
</html>`;
}

router.get('/', (req, res) => {
  const d = req.detection;
  const body = `
  <h1>Scraper Sentry — demo</h1>
  <p>This page runs the full detection pipeline: header analysis, TLS(JA3) fingerprinting,
  request-rate/pattern tracking, and (after a moment) client telemetry. Every response is
  watermarked with a per-session canary token.</p>
  <div class="score ${d.verdict}">
    <strong>Your current score:</strong> ${d.score}/100 &mdash; verdict: <strong>${d.verdict}</strong><br>
    session: <code>${d.sessionId}</code><br>
    ${d.ja3 ? `JA3: <code>${d.ja3}</code><br>` : 'JA3: unavailable (fragmented ClientHello or plain HTTP)<br>'}
    ${d.reasons.length ? '<ul>' + d.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>' : '<em>no signals triggered</em>'}
  </div>
  <p>Simulated dataset (crawl these in quick succession to trigger rate signals):</p>
  <ul>
    ${Array.from({ length: 10 }, (_, i) => `<li><a href="/data/${i + 1}">/data/${i + 1}</a></li>`).join('\n    ')}
  </ul>
  <p>Reload this page after a couple seconds and the score may change once client telemetry reports in.</p>
  `;
  res.set('Content-Type', 'text/html');
  res.send(layout('Scraper Sentry', body));
});

router.get('/data/:id', (req, res) => {
  const id = req.params.id;
  const body = `
  <h1>Record #${escapeHtml(id)}</h1>
  <p>This simulates a page of protected data. A real deployment would render actual content
  here; a scraper hitting many of these in a tight loop is exactly what the rate-tracking
  signal (src/fingerprint/rate.js) is meant to catch.</p>
  <p><a href="/">&larr; back</a></p>
  <p>score: ${req.detection.score}/100 (${req.detection.verdict})</p>
  `;
  res.set('Content-Type', 'text/html');
  res.send(layout(`Record ${id}`, body));
});

router.get('/__debug/score', (req, res) => {
  res.json(req.detection);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = router;
