'use strict';

// Weighted combination of independent signals into one bot-likelihood
// score (0-100) and a verdict. Weights and thresholds are heuristic
// starting points — tune them against your own labeled traffic (see
// README "Tuning" section). Nothing here claims to be adversarially
// robust on its own; the point is a documented, adjustable baseline
// rather than a black box.
const WEIGHTS = {
  headers: 0.3,
  ja3: 0.25,
  rate: 0.25,
  telemetry: 0.2,
};

const THRESHOLDS = {
  challenge: 30,
  flag: 60,
};

/**
 * `signals` is a partial object: { headers, ja3, rate, telemetry }, each
 * either `{ score, reasons }` or absent (e.g. telemetry hasn't reported
 * yet on the first request of a session — that signal is simply excluded
 * rather than treated as zero, so an empty-but-legitimate signal doesn't
 * silently drag the score toward "not a bot").
 */
function computeScore(signals) {
  let weightedSum = 0;
  let weightTotal = 0;
  const reasons = [];
  const breakdown = {};

  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const signal = signals[name];
    if (!signal) continue;
    weightedSum += signal.score * weight;
    weightTotal += weight;
    breakdown[name] = signal.score;
    for (const r of signal.reasons || []) reasons.push(`[${name}] ${r}`);
  }

  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  let verdict = 'allow';
  if (score >= THRESHOLDS.flag) verdict = 'flag';
  else if (score >= THRESHOLDS.challenge) verdict = 'challenge';

  return { score, verdict, reasons, breakdown };
}

module.exports = { computeScore, WEIGHTS, THRESHOLDS };
