'use strict';

/**
 * Formats an actor's raw evidence bundle (from logger.getActorReport) into
 * a human-readable incident report — the thing you'd actually attach to a
 * complaint to a ticketing platform's trust & safety team, or a report to
 * law enforcement / your state AG's office under consumer-protection or
 * anti-bot-ticketing statutes (e.g. the US BOTS Act).
 *
 * This deliberately states what the evidence is and isn't: JA3 + IP + rate
 * correlation is strong supporting evidence that the same tooling/operator
 * is behind a cluster of attempts, but it is not, by itself, legal proof
 * of a specific person's identity. Say that plainly in the document you're
 * handing to someone else, rather than overstating it.
 */
function buildIncidentReportMarkdown(actorReport, { ipIntelByIp = {} } = {}) {
  const { ja3, flaggedRequests, attempts } = actorReport;

  const ips = uniq(flaggedRequests.map((r) => r.ip).concat(attempts.map((a) => a.ip)));
  const sessions = uniq(flaggedRequests.map((r) => r.session_id).concat(attempts.map((a) => a.session_id)));
  const allTs = flaggedRequests.map((r) => r.ts).concat(attempts.map((a) => a.ts));
  const firstSeen = allTs.length ? new Date(Math.min(...allTs)).toISOString() : 'n/a';
  const lastSeen = allTs.length ? new Date(Math.max(...allTs)).toISOString() : 'n/a';

  const itemTotals = new Map();
  for (const a of attempts) {
    const key = a.item_id || '(unknown item)';
    itemTotals.set(key, (itemTotals.get(key) || 0) + (a.quantity || 0));
  }

  const timeline = [
    ...flaggedRequests.map((r) => ({
      ts: r.ts,
      kind: 'request',
      detail: `${r.method} ${r.path} — score ${r.score} (${r.verdict}) — ${r.reasons.join('; ') || 'no reasons recorded'}`,
      ip: r.ip,
      sessionId: r.session_id,
    })),
    ...attempts.map((a) => ({
      ts: a.ts,
      kind: 'attempt',
      detail: `acquisition attempt on "${a.item_id}" x${a.quantity} — score ${a.score} (${a.verdict}) — outcome: ${a.outcome}`,
      ip: a.ip,
      sessionId: a.session_id,
    })),
  ].sort((a, b) => a.ts - b.ts);

  const lines = [];
  lines.push(`# Incident report — actor ${ja3}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## What this document is');
  lines.push('');
  lines.push(
    'This report groups activity by TLS (JA3) fingerprint: requests that reused the same ' +
      'underlying TLS client configuration, even when the IP address and session cookie ' +
      'changed between requests. That pattern — same tooling, rotating IPs/accounts — is ' +
      'characteristic of automated inventory/ticket acquisition ("scalping"), and is offered ' +
      'here as supporting evidence, not as a claim of legal identity. A JA3 hash identifies a ' +
      'TLS client configuration (which can be shared by many installations of the same tool), ' +
      'not a specific person. Corroborate with account records, payment data, or a lawful ' +
      'process (e.g. an ISP subpoena for the listed IPs) before relying on this for a legal ' +
      'conclusion, and consult counsel or your platform\'s trust & safety team on how to submit it.'
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- JA3 fingerprint: \`${ja3}\``);
  lines.push(`- Distinct IP addresses: ${ips.length}`);
  lines.push(`- Distinct sessions/accounts: ${sessions.length}`);
  lines.push(`- Flagged requests: ${flaggedRequests.length}`);
  lines.push(`- Acquisition attempts: ${attempts.length}`);
  lines.push(`- First seen: ${firstSeen}`);
  lines.push(`- Last seen: ${lastSeen}`);
  if (itemTotals.size) {
    lines.push(`- Items targeted:`);
    for (const [item, qty] of itemTotals) lines.push(`  - ${item}: ${qty} unit(s) across attempts`);
  }
  lines.push('');
  lines.push('## IP addresses observed');
  lines.push('');
  for (const ip of ips) {
    const intel = ipIntelByIp[ip];
    if (intel && !intel.note) {
      lines.push(`- \`${ip}\` — ${intel.org || 'unknown org'}, ${[intel.city, intel.region, intel.country].filter(Boolean).join(', ') || 'unknown location'}`);
    } else if (intel && intel.note) {
      lines.push(`- \`${ip}\` — ${intel.note}`);
    } else {
      lines.push(`- \`${ip}\` — no IP intelligence available (set IPINFO_TOKEN to enable lookups)`);
    }
  }
  lines.push('');
  lines.push('## Sessions/accounts observed');
  lines.push('');
  for (const s of sessions) lines.push(`- \`${s}\``);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  for (const e of timeline) {
    lines.push(`- ${new Date(e.ts).toISOString()} [${e.kind}] ip=${e.ip} session=${e.sessionId} — ${e.detail}`);
  }
  lines.push('');
  lines.push('## Preserving this evidence');
  lines.push('');
  lines.push(
    'The full underlying records (including raw request headers and response bodies for each ' +
      'flagged request) are in `data/sentry.db` (SQLite). Export a copy alongside this report ' +
      'rather than relying on this summary alone — the raw table preserves what this document ' +
      'necessarily condenses, and having both matters if this is going to be relied on later.'
  );

  return lines.join('\n');
}

function uniq(arr) {
  return [...new Set(arr.filter((v) => v != null))];
}

module.exports = { buildIncidentReportMarkdown };
