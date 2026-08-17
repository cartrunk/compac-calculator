'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentReportMarkdown } = require('../src/report');

test('summarizes a multi-session, single-IP actor cluster', () => {
  const actorReport = {
    ja3: 'abc123',
    flaggedRequests: [
      { id: 1, ts: 1000, session_id: 's1', ip: '1.2.3.4', method: 'GET', path: '/data/1', user_agent: 'python-requests', score: 60, verdict: 'flag', reasons: ['bot ua'], response_status: 200, canary_token: 'tok1' },
    ],
    attempts: [
      { id: 1, ts: 900, session_id: 's1', ip: '1.2.3.4', item_id: 'drop-1', quantity: 4, score: 40, verdict: 'challenge', outcome: 'allowed' },
      { id: 2, ts: 1100, session_id: 's2', ip: '1.2.3.4', item_id: 'drop-1', quantity: 6, score: 60, verdict: 'flag', outcome: 'blocked-for-demo' },
    ],
  };

  const md = buildIncidentReportMarkdown(actorReport);

  assert.match(md, /Distinct IP addresses: 1/);
  assert.match(md, /Distinct sessions\/accounts: 2/);
  assert.match(md, /drop-1: 10 unit\(s\)/);
  assert.match(md, /not as a claim of legal identity/);
  assert.match(md, /1\.2\.3\.4.*no IP intelligence available/);
  // timeline sorted chronologically regardless of input order
  const firstIdx = md.indexOf('acquisition attempt on "drop-1" x4');
  const secondIdx = md.indexOf('GET /data/1');
  const thirdIdx = md.indexOf('acquisition attempt on "drop-1" x6');
  assert.ok(firstIdx < secondIdx && secondIdx < thirdIdx);
});

test('uses provided IP intelligence when available', () => {
  const actorReport = {
    ja3: 'abc123',
    flaggedRequests: [],
    attempts: [{ id: 1, ts: 1000, session_id: 's1', ip: '9.9.9.9', item_id: 'x', quantity: 1, score: 60, verdict: 'flag', outcome: 'blocked-for-demo' }],
  };
  const md = buildIncidentReportMarkdown(actorReport, {
    ipIntelByIp: { '9.9.9.9': { org: 'AS1234 Example Hosting', country: 'US', region: 'CA', city: 'SF' } },
  });
  assert.match(md, /AS1234 Example Hosting/);
});
