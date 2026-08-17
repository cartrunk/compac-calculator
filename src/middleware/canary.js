'use strict';

const crypto = require('crypto');
const { logCanarySighting } = require('../logging/logger');

// 1x1 transparent PNG, used as an invisible beacon. Real browsers (and
// headless browsers rendering a full page, including most scraping stacks
// built on Puppeteer/Playwright) fetch every referenced resource; a scraper
// that only fetches raw HTML over `requests`/`curl` never triggers this at
// all — that's expected and fine, the watermark text below covers that case
// instead.
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function generateCanaryToken() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Marks an HTML response with two independent, low-visibility watermarks
 * tied to `token`:
 *  1. an invisible beacon <img> — fires if the fetcher renders the page
 *     (headless browser) rather than just downloading raw HTML;
 *  2. a hidden text marker — survives a scrape that extracts/republishes
 *     the DOM text or full-page HTML even without executing JS or images.
 * Both are best-effort string insertion, not full HTML parsing — fine for
 * a page you control, and it degrades safely (falls back to unmodified
 * HTML) if `</body>` isn't found.
 */
function injectCanary(html, token) {
  const marker = [
    `<img src="/__canary/beacon/${token}" alt="" width="1" height="1" style="position:absolute;opacity:0;pointer-events:none" aria-hidden="true">`,
    `<span style="position:absolute;left:-9999px" aria-hidden="true" data-canary="${token}">${token}</span>`,
  ].join('\n');

  if (html.includes('</body>')) {
    return html.replace('</body>', `${marker}\n</body>`);
  }
  return html + marker;
}

/**
 * Express middleware: assigns req.canaryToken (stable per session cookie)
 * and transparently watermarks any text/html response the route sends via
 * res.send()/res.end(). Routes don't need to opt in per-call.
 */
function canaryMiddleware(sessionIdFor) {
  return (req, res, next) => {
    const token = generateCanaryToken();
    req.canaryToken = token;
    req.canarySessionId = sessionIdFor(req);

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      try {
        const contentType = res.get('Content-Type') || '';
        if (typeof body === 'string' && contentType.includes('html')) {
          body = injectCanary(body, token);
        }
      } catch {
        // Never let watermarking break the actual response.
      }
      return originalSend(body);
    };

    next();
  };
}

function canaryBeaconRoute(req, res) {
  const token = req.params.token;
  logCanarySighting({
    canaryToken: token,
    source: 'beacon-request',
    detail: JSON.stringify({ ip: req.ip, userAgent: req.headers['user-agent'] || null }),
  });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(TRANSPARENT_PIXEL);
}

module.exports = { generateCanaryToken, injectCanary, canaryMiddleware, canaryBeaconRoute, TRANSPARENT_PIXEL };
