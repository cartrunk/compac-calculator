'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHeaders } = require('../src/fingerprint/headers');

test('scores a realistic Chrome navigation as low-risk', () => {
  const { score, reasons } = analyzeHeaders({
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-dest': 'document',
    'sec-ch-ua': '"Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });
  assert.equal(score, 0);
  assert.deepEqual(reasons, []);
});

test('flags a bare python-requests client', () => {
  const { score, reasons } = analyzeHeaders({ 'user-agent': 'python-requests/2.31.0' });
  assert.ok(score >= 60, `expected high score, got ${score}`);
  assert.ok(reasons.some((r) => r.includes('non-browser client')));
});

test('flags a missing User-Agent', () => {
  const { score, reasons } = analyzeHeaders({});
  assert.ok(score >= 35);
  assert.ok(reasons.some((r) => r.includes('missing User-Agent')));
});

test('flags a Chromium UA with no client hints', () => {
  const { score, reasons } = analyzeHeaders({
    'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
    accept: 'text/html',
    'accept-language': 'en-US',
    'accept-encoding': 'gzip',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-dest': 'document',
  });
  assert.ok(reasons.some((r) => r.includes('client hints')));
  assert.ok(score > 0);
});

test('score is capped at 100', () => {
  const { score } = analyzeHeaders({});
  assert.ok(score <= 100);
});
