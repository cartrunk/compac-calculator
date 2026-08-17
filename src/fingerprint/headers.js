'use strict';

// Known non-browser HTTP client signatures. Trivially spoofed, but the vast
// majority of scraping traffic never bothers — cheap signal, cheap to compute.
const KNOWN_BOT_UA_PATTERNS = [
  /python-requests/i,
  /python-urllib/i,
  /\bscrapy\b/i,
  /\bcurl\//i,
  /\bwget\//i,
  /node-fetch/i,
  /\baxios\//i,
  /go-http-client/i,
  /okhttp/i,
  /\bjava\//i,
  /\bapache-httpclient/i,
  /headlesschrome/i,
  /phantomjs/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /\bbot\b/i,
  /\bcrawler\b/i,
  /\bspider\b/i,
];

// Headers a real, modern browser sends on essentially every navigation.
// Their absence doesn't prove a bot, but it removes a browser's benefit of
// the doubt.
const EXPECTED_BROWSER_HEADERS = ['accept', 'accept-language', 'accept-encoding'];

// Fetch metadata headers (Sec-Fetch-*) are sent by all modern browsers
// (Chrome 76+, Firefox 90+, Safari 16.4+) and are hard for simple HTTP
// clients to remember to add.
const SEC_FETCH_HEADERS = ['sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest'];

// User-Agent Client Hints — Chromium-family only, but when a UA string
// claims to be Chrome and these are absent, that's a mismatch worth noting.
const CLIENT_HINT_HEADERS = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

function analyzeHeaders(headers) {
  const reasons = [];
  let score = 0;

  const ua = headers['user-agent'] || '';

  if (!ua) {
    score += 35;
    reasons.push('missing User-Agent header');
  } else if (KNOWN_BOT_UA_PATTERNS.some((re) => re.test(ua))) {
    score += 40;
    reasons.push(`User-Agent matches known non-browser client: "${ua}"`);
  }

  for (const h of EXPECTED_BROWSER_HEADERS) {
    if (!headers[h]) {
      score += 12;
      reasons.push(`missing expected browser header: ${h}`);
    }
  }

  const claimsChromium = /chrome|chromium|edg\//i.test(ua) && !/headlesschrome/i.test(ua);
  if (claimsChromium) {
    const missingHints = CLIENT_HINT_HEADERS.filter((h) => !headers[h]);
    if (missingHints.length === CLIENT_HINT_HEADERS.length) {
      score += 15;
      reasons.push('UA claims Chromium but sends no Sec-CH-UA client hints');
    }
  }

  const looksLikeBrowserUA = /mozilla/i.test(ua);
  if (looksLikeBrowserUA) {
    const missingFetch = SEC_FETCH_HEADERS.filter((h) => !headers[h]);
    if (missingFetch.length === SEC_FETCH_HEADERS.length) {
      score += 15;
      reasons.push('browser-style UA but no Sec-Fetch-* metadata headers');
    }
  }

  if (headers['accept-language'] === '') {
    score += 8;
    reasons.push('empty Accept-Language');
  }

  // A raw '*/*' Accept header on a document navigation is what most HTTP
  // client libraries default to; real browsers send a rich, ordered list.
  if (headers['accept'] === '*/*' && looksLikeBrowserUA) {
    score += 10;
    reasons.push('Accept: */* on a browser-claiming UA (library default)');
  }

  return { score: Math.min(score, 100), reasons };
}

module.exports = { analyzeHeaders, KNOWN_BOT_UA_PATTERNS };
