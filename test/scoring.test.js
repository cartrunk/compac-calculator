'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeScore, THRESHOLDS } = require('../src/fingerprint/scoring');

test('no signals present yields allow with score 0', () => {
  const result = computeScore({});
  assert.equal(result.score, 0);
  assert.equal(result.verdict, 'allow');
  assert.deepEqual(result.reasons, []);
});

test('absent telemetry does not drag the score toward allow', () => {
  const withTelemetry = computeScore({
    headers: { score: 80, reasons: ['bot ua'] },
    ja3: { score: 80, reasons: ['bare client'] },
    rate: { score: 80, reasons: ['burst'] },
    telemetry: { score: 80, reasons: ['webdriver'] },
  });
  const withoutTelemetry = computeScore({
    headers: { score: 80, reasons: ['bot ua'] },
    ja3: { score: 80, reasons: ['bare client'] },
    rate: { score: 80, reasons: ['burst'] },
  });
  assert.equal(withTelemetry.score, withoutTelemetry.score);
});

test('verdict thresholds', () => {
  const allow = computeScore({ headers: { score: 10, reasons: [] } });
  assert.equal(allow.verdict, 'allow');

  const challenge = computeScore({ headers: { score: THRESHOLDS.challenge, reasons: [] } });
  assert.equal(challenge.verdict, 'challenge');

  const flag = computeScore({ headers: { score: THRESHOLDS.flag, reasons: [] } });
  assert.equal(flag.verdict, 'flag');
});

test('reasons are prefixed by signal name and aggregated across signals', () => {
  const result = computeScore({
    headers: { score: 40, reasons: ['missing UA'] },
    rate: { score: 40, reasons: ['burst'] },
  });
  assert.ok(result.reasons.includes('[headers] missing UA'));
  assert.ok(result.reasons.includes('[rate] burst'));
});

test('breakdown reports the raw per-signal score', () => {
  const result = computeScore({ headers: { score: 55, reasons: [] } });
  assert.equal(result.breakdown.headers, 55);
  assert.equal(result.breakdown.ja3, undefined);
});
