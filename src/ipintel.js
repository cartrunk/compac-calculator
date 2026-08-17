'use strict';

// Optional "where did this come from" enrichment (ASN/org/country) for
// incident reports. Disabled by default and returns null rather than
// guessing — fabricated geolocation data in something meant for a
// complaint to authorities is worse than no data at all. Set IPINFO_TOKEN
// to enable a real lookup against ipinfo.io; swap the fetch below for
// MaxMind GeoLite2 or another provider if you'd rather not depend on a
// live external call.
const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map(); // ip -> { data, expiresAt }

async function lookupIP(ip) {
  const token = process.env.IPINFO_TOKEN;
  if (!token || !ip) return null;
  if (isPrivateOrLoopback(ip)) return { note: 'private/loopback address, no public IP intelligence available' };

  const cached = cache.get(ip);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const resp = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const data = {
      ip,
      org: json.org || null, // typically "ASxxxx Provider Name"
      country: json.country || null,
      region: json.region || null,
      city: json.city || null,
      hostname: json.hostname || null,
    };
    cache.set(ip, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    // Network hiccup or provider outage — never let enrichment break the
    // report it's attached to.
    return null;
  }
}

function isPrivateOrLoopback(ip) {
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

module.exports = { lookupIP, isEnabled: () => !!process.env.IPINFO_TOKEN };
