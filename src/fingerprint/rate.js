'use strict';

// In-memory request-pattern tracker, keyed per client (IP+session). Bounded
// memory: a periodic sweep evicts stale entries and a hard cap evicts the
// oldest entries if the sweep can't keep up (e.g. under a distributed
// scrape from many IPs). Swap this for a Redis-backed store if the process
// needs to scale beyond a single instance — the interface (`track`) is the
// seam to do that behind.
const WINDOW_MS = 60_000;
const MAX_TIMESTAMPS_PER_KEY = 200;
const MAX_TRACKED_KEYS = 50_000;
const STALE_AFTER_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

class RateTracker {
  constructor({ windowMs = WINDOW_MS, maxKeys = MAX_TRACKED_KEYS } = {}) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map(); // key -> { timestamps: number[], paths: string[], firstSeen, lastSeen }
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeen > STALE_AFTER_MS) this.entries.delete(key);
    }
  }

  _getOrCreate(key) {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        // Evict the oldest-inserted entry (Map preserves insertion order).
        const oldestKey = this.entries.keys().next().value;
        this.entries.delete(oldestKey);
      }
      entry = { timestamps: [], paths: [], firstSeen: Date.now(), lastSeen: Date.now() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Records one request for `key` and returns pattern signals computed over
   * the trailing window: request velocity, path repetition/diversity, and
   * inter-arrival regularity (a very low-jitter cadence is a strong bot
   * signal — humans don't click at machine-precise intervals).
   */
  track(key, path) {
    const now = Date.now();
    const entry = this._getOrCreate(key);
    entry.lastSeen = now;

    entry.timestamps.push(now);
    entry.paths.push(path);
    if (entry.timestamps.length > MAX_TIMESTAMPS_PER_KEY) {
      entry.timestamps.shift();
      entry.paths.shift();
    }

    const windowStart = now - this.windowMs;
    const recentTimestamps = entry.timestamps.filter((t) => t >= windowStart);
    const requestsInWindow = recentTimestamps.length;

    const gaps = [];
    for (let i = 1; i < recentTimestamps.length; i++) {
      gaps.push(recentTimestamps[i] - recentTimestamps[i - 1]);
    }
    const jitterMs = stddev(gaps);
    const meanGapMs = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

    const recentPaths = entry.paths.slice(-recentTimestamps.length || -1);
    const uniquePaths = new Set(recentPaths).size;

    return {
      requestsInWindow,
      windowMs: this.windowMs,
      meanGapMs,
      jitterMs,
      uniquePathsInWindow: uniquePaths,
      totalRequests: entry.timestamps.length,
      ageMs: now - entry.firstSeen,
    };
  }

  size() {
    return this.entries.size;
  }

  dispose() {
    clearInterval(this.sweepTimer);
  }
}

function stddev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Turns raw pattern signals into a bot-likelihood contribution. Thresholds
 * are heuristic starting points, not calibrated against real traffic — tune
 * against your own logs (see README).
 */
function analyzeRate(signals) {
  const reasons = [];
  let score = 0;

  if (signals.requestsInWindow > 120) {
    score += 40;
    reasons.push(`${signals.requestsInWindow} requests in the last ${Math.round(signals.windowMs / 1000)}s`);
  } else if (signals.requestsInWindow > 40) {
    score += 20;
    reasons.push(`elevated request rate: ${signals.requestsInWindow} in ${Math.round(signals.windowMs / 1000)}s`);
  }

  // Machine-precise cadence: enough samples, and near-zero variance in gap
  // length relative to the mean gap (humans are bursty and irregular).
  if (signals.jitterMs !== null && signals.meanGapMs !== null && signals.meanGapMs > 0) {
    const coefficientOfVariation = signals.jitterMs / signals.meanGapMs;
    if (coefficientOfVariation < 0.05 && signals.requestsInWindow >= 5) {
      score += 25;
      reasons.push(`near-zero timing jitter (cv=${coefficientOfVariation.toFixed(3)}) suggests scripted pacing`);
    }
  }

  if (signals.uniquePathsInWindow > 30) {
    score += 15;
    reasons.push(`${signals.uniquePathsInWindow} distinct paths hit in-window (crawl-like breadth)`);
  }

  return { score: Math.min(score, 100), reasons };
}

module.exports = { RateTracker, analyzeRate, stddev };
