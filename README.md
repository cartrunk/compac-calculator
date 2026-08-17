# Scraper Sentry

Anti-scalping instrumentation for a site you control: detect automated
inventory/ticket-grabbing traffic, correlate it back to a single actor even
when they rotate accounts, cookies, and IPs, and produce a clean incident
report — evidence you can hand to your ticketing platform's trust & safety
team, your payment processor, or law enforcement.

## The problem this solves

A scalping bot rarely runs once. It creates dozens of accounts, cycles
session cookies, and rotates IPs (proxies, VPNs, residential proxy pools)
specifically so that no single request, account, or IP looks abnormal on
its own. Naive detection (rate-limit an IP, ban an account) treats each of
those as independent noise and never sees the pattern.

This system is built around one idea: **the actor's tooling is harder to
rotate than their accounts or IPs.** The TLS ClientHello fingerprint (JA3)
of a given script/library/browser-automation stack stays constant across
however many accounts or proxies it cycles through. So instead of scoring
requests in isolation, everything here is correlated by that fingerprint —
turning "20 different accounts each made a few suspicious requests" into
"one actor made 200 requests and attempted to acquire 68 units of
drop-item-1, here's the full timeline."

## What it produces

1. **A per-request bot-likelihood score**, from header/TLS/rate/behavioral
   signals (see "How detection works" below).
2. **An actor cluster**, grouping every session/IP that shares a JA3
   fingerprint — `GET /__admin/actors` lists them, ranked by how many
   distinct IPs/accounts they've cycled through.
3. **An incident report** per actor — `GET /__admin/actors/:ja3/report`
   — a chronological timeline of every flagged request and every
   inventory-acquisition attempt, with total units targeted per item,
   every account and IP involved, and (optionally) IP ownership/ASN
   lookups. Add `?format=markdown` for a document you can actually attach
   to a complaint.
4. **Watermarked pages**, so if scraped content resurfaces elsewhere
   (resale listing, a bot's own site) it traces back to the session that
   took it.

## What this evidence proves — and what it doesn't

Be precise about this when you hand a report to someone else:

- A shared JA3 fingerprint across many accounts/IPs is strong evidence
  they're running the same automation tooling — that's the load-bearing
  claim of this whole system, and it's a real, well-established forensic
  signal (it's why JA3 exists as a standard).
- It is **not**, by itself, proof of a specific person's identity. A JA3
  hash can be shared by many independent installations of the same
  popular tool. Treat it as the thread that ties a cluster of accounts/IPs
  together, then corroborate identity through account records, payment
  data, or a lawful process (e.g. a subpoena to the IPs' ISPs/hosting
  providers) — not as a standalone identification.
- This tool does not itself contact authorities, file complaints, or make
  legal determinations. It produces the evidence bundle; what you do with
  it (report to the platform, your payment processor, local police, or
  file a BOTS Act complaint with the FTC/your state AG if this is ticket
  scalping in the US) is a decision to make with your own judgment or
  counsel, not something this README can substitute for.
- Every detection signal below is individually spoofable by a determined
  actor (see "Limitations"). This raises the cost of scalping your site
  and builds a paper trail — it doesn't guarantee catching everyone.

## How detection works

```
request ──► detect middleware ──► canary middleware ──► routes
              │                     │
              ├─ headers.js         └─ watermarks HTML responses,
              ├─ ja3.js                serves /__canary/beacon/:token
              ├─ rate.js (per-session AND per-actor)
              ├─ telemetry (async, from a prior /__telemetry/report)
              │
              └─ scoring.js combines all of the above → req.detection
                 { score, verdict, reasons, breakdown }
                 verdict 'flag' → full request/response logged to SQLite,
                 tagged with JA3 so it joins the actor's cluster
```

- **`src/fingerprint/headers.js`** — known non-browser User-Agent strings,
  missing `Accept-*`/`Sec-Fetch-*`/`Sec-CH-UA` headers a real browser
  always sends.
- **`src/fingerprint/ja3.js`** — computes a [JA3](https://github.com/salesforce/ja3)
  TLS ClientHello fingerprint, the backbone of the actor-clustering above.
  This is the hard part: Node's `https`/`tls` server consumes the
  ClientHello at the native layer, so a normal
  `server.on('connection', ...)` listener never sees the raw bytes. This
  module instead terminates TLS itself — a raw `net.Server` peeks the
  first bytes in paused mode, computes JA3, unshifts the bytes back onto
  the socket, then manually constructs a `tls.TLSSocket` and hands the
  now-negotiating connection to a plain `http.Server`. Verified against a
  real handshake (see `test/ja3.test.js`, fixture captured from a live
  `curl` request against this exact code path).
- **`src/fingerprint/rate.js`** — sliding-window request velocity, path
  diversity, and inter-arrival jitter. Tracked on *two* independent keys
  (see `src/middleware/detect.js`): per-session, and per-actor (JA3, or IP
  when no TLS fingerprint is available) — the second one specifically so
  that cycling session cookies to reset the per-session window doesn't
  also reset the clock on the underlying tooling.
- **`src/fingerprint/telemetry.js`** — scores client-reported behavioral
  signals (`public/telemetry-client.js`): `navigator.webdriver`, mouse
  activity before interaction, language/hardware/screen anomalies.
- **`src/fingerprint/scoring.js`** — weighted combination into one
  `{ score, verdict, reasons, breakdown }`. A signal that hasn't reported
  yet (e.g. telemetry, before the async beacon lands) is excluded from the
  weighted average rather than counted as zero.
- **`src/logging/logger.js`** — SQLite (`better-sqlite3`) store for
  flagged requests (full headers + response body, capped at 200KB, tagged
  with JA3), inventory-acquisition `attempts` (item/quantity/outcome), and
  canary sightings. `listActors()`/`getActorReport()` do the JA3 grouping.
- **`src/ipintel.js`** — optional ASN/org/country lookup for IPs in a
  report. Off by default, returns nothing rather than guessing — a
  fabricated location in something meant for a complaint to authorities is
  worse than no location. Set `IPINFO_TOKEN` to enable real lookups.
- **`src/report.js`** — turns an actor's raw evidence bundle into the
  Markdown incident report.
- **`src/middleware/canary.js`** — injects a per-session token into every
  HTML response as both an invisible tracking pixel (`/__canary/beacon/:token`)
  and hidden watermark text.

## Running it

```
npm install
npm run cert     # generates certs/{key,cert}.pem — self-signed, local dev only
ADMIN_TOKEN=some-secret npm start
```

Without `certs/`, the server falls back to plain HTTP — everything works
except JA3 (there's no TLS handshake to fingerprint, so actor clustering
degrades to per-IP grouping). `ADMIN_TOKEN` gates `/__admin/*`; without
it, those routes return `503` rather than serving unauthenticated access
to logged evidence.

Visit `https://localhost:8443/` (self-signed — your browser/curl needs
`-k`/"proceed anyway"). The page shows your own live score/reasons/JA3.
`/data/1` … `/data/10` simulate a paginated dataset — crawl them quickly to
trigger the rate signal. `/checkout/drop-item-1` simulates hitting limited
inventory — this is what shows up as an "attempt" in the incident report,
distinct from ordinary page views.

```
GET /__admin/flagged                       # recent flagged requests
GET /__admin/actors                        # JA3 clusters, ranked by distinct IPs
GET /__admin/actors/:ja3/report            # full evidence bundle (JSON)
GET /__admin/actors/:ja3/report?format=markdown   # the document you attach to a complaint
GET /__admin/canary/:token                 # sessions a given canary token traces back to
```

(all require `X-Admin-Token: <ADMIN_TOKEN>`)

```
npm test    # node's built-in test runner, no extra deps
```

## Tuning

Weights (`src/fingerprint/scoring.js`) and per-signal thresholds
(`src/fingerprint/headers.js`, `rate.js`, `telemetry.js`) are heuristic
starting points, not calibrated against real traffic. Watch
`/__admin/flagged` and `/__admin/actors` against your actual visitors
before enforcing anything stricter than logging — the `reasons` array on
every scored request tells you exactly which signal fired and why.

`config/ja3-lists.json` starts empty by design: an unverified "known bot
JA3 hash" list creates false confidence, so nothing is pre-populated.
Populate it from your own flagged-session logs (every logged request
records its JA3) or a public corpus you've vetted yourself.

To wire this into a real checkout/reservation flow, call
`logAttempt({ sessionId, ip, ja3, itemId, quantity, score, verdict, outcome })`
(from `src/logging/logger.js`) right next to wherever inventory actually
gets decremented — see `src/routes/demo.js`'s `/checkout/:itemId` for the
pattern.

## Deliberately not implemented, and why

- **No MITM / interception of third-party network traffic.** Reading a
  scalper's own network traffic, on a path you don't control, or breaking
  TLS you don't hold the private key for, requires either a privileged
  network position or defeating certificate validation on someone else's
  client. Outside a narrow, explicitly-authorized pentest, that's illegal
  in most jurisdictions and out of scope here regardless of intent — even
  a good reason (building a case against scalpers) doesn't change what's
  on the other side of that line. The actor-clustering and evidence
  reporting above get you the practical outcome (who did it, from where,
  what they targeted) from data your own server legitimately collected.
- **No client-side compromise.** This doesn't attempt to exploit,
  sandbox-escape, or otherwise compromise a scalper's browser/process.
- **No claim of adversarial robustness.** Every signal is individually
  beatable (spoofed headers, `curl-impersonate`/`utls` for TLS,
  stealth-patched `navigator.webdriver`, large residential proxy pools
  with distinct-enough tooling per pool to defeat JA3 clustering too).
  This raises the cost and leaves a trail; it isn't a guarantee.

## Limitations

- **JA3 needs the whole ClientHello in one TCP segment.** A ClientHello
  split across segments (large ones, e.g. from padding extensions some
  stealth tools add specifically to evade this) isn't reassembled — it's
  treated as "no fingerprint," not a false positive, but it does mean
  some clients evade the TLS signal, and therefore actor clustering, for
  free.
- **In-memory rate/telemetry state doesn't share across processes.** Fine
  for a single instance; running this behind a load balancer with
  multiple instances needs a shared store (Redis, etc.) behind the same
  interface.
- **A sophisticated actor can vary their TLS stack per proxy/account,**
  defeating JA3 clustering the same way IP rotation defeats naive rate
  limiting. There's no signal in here immune to a well-resourced,
  adaptive adversary — see "Deliberately not implemented" above for where
  the line is and why it stays there.
