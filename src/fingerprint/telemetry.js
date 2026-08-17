'use strict';

// Scores client-reported behavioral/environment telemetry (see
// public/telemetry-client.js for what's collected and why). All of this
// runs inside the page the visitor loaded, so a sufficiently determined
// scraper can patch it out (stealth plugins routinely spoof
// navigator.webdriver) — treat it as a soft signal, weighted accordingly
// in scoring.js, not a verdict on its own.
function analyzeTelemetry(report) {
  if (!report) return null;

  const reasons = [];
  let score = 0;

  if (report.webdriver === true) {
    score += 50;
    reasons.push('navigator.webdriver === true (automation flag set)');
  }

  const noMouseActivity = (report.mouseMoves || 0) === 0;
  const fastInteraction = typeof report.timeToFirstInteractionMs === 'number' && report.timeToFirstInteractionMs < 50;
  if (noMouseActivity && fastInteraction) {
    score += 20;
    reasons.push('zero mouse movement before a sub-50ms interaction');
  } else if (noMouseActivity && report.hadInteraction) {
    score += 10;
    reasons.push('interaction occurred with zero recorded mouse movement');
  }

  if (Array.isArray(report.languages) && report.languages.length === 0) {
    score += 10;
    reasons.push('navigator.languages is empty');
  }

  if (typeof report.hardwareConcurrency === 'number' && report.hardwareConcurrency === 0) {
    score += 10;
    reasons.push('navigator.hardwareConcurrency reports 0');
  }

  if (report.screenWidth === 0 || report.screenHeight === 0) {
    score += 15;
    reasons.push('zero-dimension screen (headless default in some stacks)');
  }

  return { score: Math.min(score, 100), reasons };
}

module.exports = { analyzeTelemetry };
