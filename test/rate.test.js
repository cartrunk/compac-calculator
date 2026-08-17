'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { RateTracker, analyzeRate, stddev } = require('../src/fingerprint/rate');

test('stddev handles edge cases', () => {
  assert.equal(stddev([]), null);
  assert.equal(stddev([5]), null);
  assert.equal(stddev([10, 10, 10]), 0);
});

test('tracks request velocity within the window', () => {
  const tracker = new RateTracker({ windowMs: 60_000 });
  after(() => tracker.dispose());

  let last;
  for (let i = 0; i < 5; i++) {
    last = tracker.track('client-a', '/x');
  }
  assert.equal(last.requestsInWindow, 5);
  assert.equal(last.totalRequests, 5);
});

test('analyzeRate flags high-volume bursts', () => {
  const { score, reasons } = analyzeRate({
    requestsInWindow: 150,
    windowMs: 60_000,
    meanGapMs: 400,
    jitterMs: 5,
    uniquePathsInWindow: 10,
  });
  assert.ok(score >= 40);
  assert.ok(reasons.some((r) => r.includes('requests in the last')));
});

test('analyzeRate flags machine-precise cadence', () => {
  const { score, reasons } = analyzeRate({
    requestsInWindow: 10,
    windowMs: 60_000,
    meanGapMs: 1000,
    jitterMs: 2, // cv = 0.002, far below the 0.05 threshold
    uniquePathsInWindow: 3,
  });
  assert.ok(score > 0);
  assert.ok(reasons.some((r) => r.includes('jitter')));
});

test('analyzeRate does not flag light, irregular traffic', () => {
  const { score, reasons } = analyzeRate({
    requestsInWindow: 3,
    windowMs: 60_000,
    meanGapMs: 8000,
    jitterMs: 4000,
    uniquePathsInWindow: 2,
  });
  assert.equal(score, 0);
  assert.deepEqual(reasons, []);
});

test('caps score at 100', () => {
  const { score } = analyzeRate({
    requestsInWindow: 1000,
    windowMs: 60_000,
    meanGapMs: 1,
    jitterMs: 0,
    uniquePathsInWindow: 500,
  });
  assert.ok(score <= 100);
});
