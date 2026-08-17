# Scraper Sentry

Bot/scraper detection middleware for a site you control: header, TLS
(JA3), request-rate/behavioral, and client-telemetry signals combined into
a per-request score, full request/response logging for flagged sessions,
and per-session canary watermarking so reused content can be traced back
to the session that took it.

## Scope — what this is and isn't

Detecting and blocking scraper traffic against your own origin, and
recording what you served to sessions you scored as automated, is a
tractable, legal engineering problem. This repo does that.

**Deliberately not implemented, and why:**

- **No MITM / interception of third-party network traffic.** Reading a
  scraper's traffic on a network path you don't control (or breaking TLS
  you don't hold the private key for) requires either a privileged network
  position or defeating certificate validation on someone else's client.
  Outside a narrow, explicitly-authorized pentest, that's illegal in most
  jurisdictions and out of scope here regardless of authorization.
- **No client-side compromise.** This doesn't attempt to exploit, sandbox-
  escape, or otherwise compromise a scraper's browser/process to exfiltrate
  its parsed/extracted dataset. The canary-watermarking approach here gets
  a comparable practical outcome (proof your content was taken and by
  which session) without needing to break out of the page's own sandbox.
- **No claim of adversarial robustness.** Every signal below is
  individually beatable by a sufficiently motivated scraper (spoofed
  headers, `curl-impersonate`/`utls` for TLS, stealth-patched
  `navigator.webdriver`, residential proxies against rate limiting). This
  is a detection *baseline* you tune against your own traffic, not a
  solved arms race — see "Limitations" below.

## Architecture

```
request ──► detect middleware ──► canary middleware ──► routes
              │                     │
              ├─ headers.js         └─ watermarks HTML responses,
              ├─ ja3.js                serves /__canary/beacon/:token
              ├─ rate.js
              ├─ telemetry (async, from a prior /__telemetry/report)
              │
              └─ scoring.js combines all of the above → req.detection
                 { score, verdict, reasons, breakdown }
                 verdict 'flag' → full request/response logged to SQLite
```

- **`src/fingerprint/headers.js`** — known non-browser User-Agent strings,
  missing `Accept-*`/`Sec-Fetch-*`/`Sec-CH-UA` headers a real browser
  always sends.
- **`src/fingerprint/ja3.js`** — computes a [JA3](https://github.com/salesforce/ja3)
  TLS ClientHello fingerprint. This is the hard part: Node's `https`/`tls`
  server consumes the ClientHello at the native layer, so a normal
  `server.on('connection', ...)` listener never sees the raw bytes. This
  module instead terminates TLS itself — a raw `net.Server` peeks the
  first bytes in paused mode, computes JA3, unshifts the bytes back onto
  the socket, then manually constructs a `tls.TLSSocket` and hands the
  now-negotiating connection to a plain `http.Server`. Verified against a
  real handshake (see `test/ja3.test.js`, fixture captured from a live
  `curl` request against this exact code path).
- **`src/fingerprint/rate.js`** — in-memory, per-client sliding-window
  request velocity, path diversity, and inter-arrival jitter (near-zero
  timing variance is a strong scripted-pacing signal).
- **`src/fingerprint/telemetry.js`** — scores client-reported behavioral
  signals (`public/telemetry-client.js`): `navigator.webdriver`, mouse
  activity before interaction, language/hardware/screen anomalies.
- **`src/fingerprint/scoring.js`** — weighted combination into one
  `{ score, verdict, reasons, breakdown }`. A signal that hasn't reported
  yet (e.g. telemetry, before the async beacon lands) is excluded from the
  weighted average rather than counted as zero.
- **`src/logging/logger.js`** — SQLite (`better-sqlite3`) store for
  flagged requests (full headers + response body, capped at 200KB) and
  canary beacon sightings.
- **`src/middleware/canary.js`** — injects a per-session token into every
  HTML response as both an invisible tracking pixel (`/__canary/beacon/:token`,
  fires if the fetcher renders the page) and hidden watermark text (survives
  a scrape that never executes JS/loads images at all).

## Running it

```
npm install
npm run cert     # generates certs/{key,cert}.pem — self-signed, local dev only
ADMIN_TOKEN=some-secret npm start
```

Without `certs/`, the server falls back to plain HTTP — everything works
except JA3 (there's no TLS handshake to fingerprint). `ADMIN_TOKEN` gates
`/__admin/*`; without it, those routes return `503` rather than serving
unauthenticated access to logged request/response data.

Visit `https://localhost:8443/` (self-signed — your browser/curl needs
`-k`/"proceed anyway"). The page shows your own live score/reasons/JA3.
`/data/1` … `/data/10` simulate a paginated dataset — crawl them quickly to
trigger the rate signal.

```
npm test    # node's built-in test runner, no extra deps
```

## Tuning

Weights (`src/fingerprint/scoring.js`) and per-signal thresholds
(`src/fingerprint/headers.js`, `rate.js`, `telemetry.js`) are heuristic
starting points, not calibrated against real traffic. Watch
`/__admin/flagged` against your actual visitors before enforcing anything
stricter than logging — the `reasons` array on every scored request tells
you exactly which signal fired and why.

`config/ja3-lists.json` starts empty by design: an unverified "known bot
JA3 hash" list creates false confidence, so nothing is pre-populated.
Populate it from your own flagged-session logs (every logged request
records its JA3) or a public corpus you've vetted yourself.

## Limitations

- **JA3 needs the whole ClientHello in one TCP segment.** A ClientHello
  split across segments (large ones, e.g. from padding extensions some
  stealth tools add specifically to evade this) isn't reassembled — it's
  treated as "no fingerprint," not a false positive, but it does mean
  some clients evade the TLS signal for free. Full defragmentation would
  need to buffer and reassemble across multiple `readable` events.
- **In-memory state (`rate.js`, `telemetryStore.js`) doesn't share across
  processes.** Fine for a single instance; running this behind a load
  balancer with multiple instances needs a shared store (Redis, etc.)
  behind the same interface.
- **Every signal is individually spoofable.** See "Scope" above — this is
  a documented, tunable baseline, not a claim of winning the arms race
  against a well-resourced adversary.
