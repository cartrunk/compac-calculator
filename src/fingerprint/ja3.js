'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

// GREASE values (RFC 8701) — reserved cipher/extension/group/version IDs of
// the form 0x?A?A that clients randomize to prevent ossification. JA3
// excludes them so the hash reflects the client's real capability set.
const GREASE_VALUES = new Set([
  0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a, 0x5a5a, 0x6a6a, 0x7a7a,
  0x8a8a, 0x9a9a, 0xaaaa, 0xbaba, 0xcaca, 0xdada, 0xeaea, 0xfafa,
]);

function isGrease(v) {
  return GREASE_VALUES.has(v);
}

/**
 * Parse a raw TLS record buffer expected to hold a single ClientHello
 * handshake message. Returns null (never throws) if the buffer isn't a
 * ClientHello or is truncated — e.g. split across TCP segments, which a
 * single-chunk capture can't reassemble. That's a known limitation, not a
 * bug: see README for why full defragmentation is out of scope here.
 */
function parseClientHello(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 9) return null;
  if (buf[0] !== 0x16) return null; // TLS handshake record

  const recordLen = buf.readUInt16BE(3);
  if (buf.length < 5 + recordLen) return null; // fragmented, bail

  let o = 5;
  if (buf[o] !== 0x01) return null; // not a ClientHello message
  const hsLen = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
  o += 4;
  const hsEnd = o + hsLen;
  if (buf.length < hsEnd) return null;

  const clientVersion = buf.readUInt16BE(o);
  o += 2;
  o += 32; // random

  const sessionIdLen = buf[o];
  o += 1 + sessionIdLen;
  if (o > hsEnd) return null;

  const cipherSuitesLen = buf.readUInt16BE(o);
  o += 2;
  const ciphers = [];
  for (let i = 0; i + 1 < cipherSuitesLen; i += 2) {
    const v = buf.readUInt16BE(o + i);
    if (!isGrease(v)) ciphers.push(v);
  }
  o += cipherSuitesLen;
  if (o > hsEnd) return null;

  const compLen = buf[o];
  o += 1 + compLen;
  if (o > hsEnd) return null;

  const extensions = [];
  let curves = [];
  let pointFormats = [];

  if (o + 1 < hsEnd) {
    const extTotalLen = buf.readUInt16BE(o);
    o += 2;
    const extEnd = Math.min(o + extTotalLen, hsEnd);

    while (o + 3 < extEnd) {
      const extType = buf.readUInt16BE(o);
      const extLen = buf.readUInt16BE(o + 2);
      const dataStart = o + 4;
      if (dataStart + extLen > extEnd) break; // malformed/truncated

      if (!isGrease(extType)) extensions.push(extType);

      if (extType === 10 && extLen >= 2) {
        // supported_groups (elliptic curves)
        const listLen = buf.readUInt16BE(dataStart);
        for (let i = 0; i + 1 < listLen && dataStart + 2 + i + 1 < dataStart + extLen; i += 2) {
          const v = buf.readUInt16BE(dataStart + 2 + i);
          if (!isGrease(v)) curves.push(v);
        }
      } else if (extType === 11 && extLen >= 1) {
        // ec_point_formats
        const listLen = buf[dataStart];
        for (let i = 0; i < listLen && dataStart + 1 + i < dataStart + extLen; i++) {
          pointFormats.push(buf[dataStart + 1 + i]);
        }
      }

      o = dataStart + extLen;
    }
  }

  return { clientVersion, ciphers, extensions, curves, pointFormats };
}

function ja3StringFromHello(hello) {
  return [
    hello.clientVersion,
    hello.ciphers.join('-'),
    hello.extensions.join('-'),
    hello.curves.join('-'),
    hello.pointFormats.join('-'),
  ].join(',');
}

const ALPN_EXTENSION = 16;

function fingerprintClientHello(buf) {
  try {
    const hello = parseClientHello(buf);
    if (!hello) return null;
    const ja3Str = ja3StringFromHello(hello);
    const hash = crypto.createHash('md5').update(ja3Str).digest('hex');
    return {
      ja3: hash,
      ja3Str,
      extensionCount: hello.extensions.length,
      cipherCount: hello.ciphers.length,
      hasALPN: hello.extensions.includes(ALPN_EXTENSION),
    };
  } catch {
    // Malformed/unexpected input off the wire must never crash the server.
    return null;
  }
}

const fingerprintsBySocket = new WeakMap();

/**
 * Creates a raw TCP listener that terminates TLS itself instead of letting
 * Node's https/tls.Server do it, purely so it can peek the ClientHello
 * bytes before the handshake consumes them (Node's TLS engine reads off the
 * native handle directly, bypassing the JS 'data' event — a plain listener
 * on an https.Server never sees these bytes). Once JA3 is captured, the
 * bytes are unshifted back onto the socket and handed to a real
 * tls.TLSSocket, then fed into `httpServer` (a plain http.Server) as if it
 * had accepted the connection natively.
 */
function createJA3TerminatingServer(httpServer, tlsOptions) {
  const secureContext = tls.createSecureContext(tlsOptions);

  const rawServer = net.createServer({ pauseOnConnect: true }, (socket) => {
    const onReadable = () => {
      const chunk = socket.read();
      if (chunk === null) return; // wait for more bytes
      socket.removeListener('readable', onReadable);

      const fp = fingerprintClientHello(chunk);
      socket.unshift(chunk);

      const tlsSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext,
        ALPNProtocols: tlsOptions.ALPNProtocols,
      });

      if (fp) fingerprintsBySocket.set(tlsSocket, fp);

      tlsSocket.on('error', () => socket.destroy());
      tlsSocket.on('secure', () => httpServer.emit('connection', tlsSocket));
    };
    socket.on('readable', onReadable);
    socket.on('error', () => socket.destroy());
    socket.resume();
  });

  rawServer.on('error', (err) => httpServer.emit('error', err));

  return rawServer;
}

function getJA3(req) {
  return fingerprintsBySocket.get(req.socket) || null;
}

/**
 * Structural analysis only — no fabricated "known bot fingerprint"
 * database is baked in here, because an unverified list is worse than no
 * list (false confidence). `denylist`/`allowlist` are hashes the operator
 * supplies (see config/ja3-lists.json), sourced from their own traffic or
 * a public JA3 corpus they trust.
 */
function analyzeJA3(fp, { denylist = new Set(), allowlist = new Set() } = {}) {
  if (!fp) {
    // No TLS in use (plain HTTP) or a fragmented ClientHello — neither
    // implies a bot. Treat as a weak, non-actionable signal on its own.
    return { score: 0, reasons: ['no TLS fingerprint captured (plain HTTP, or a fragmented ClientHello)'] };
  }

  if (allowlist.has(fp.ja3)) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  if (denylist.has(fp.ja3)) {
    score += 50;
    reasons.push(`JA3 ${fp.ja3} matches operator-supplied denylist`);
  }

  if (fp.extensionCount < 5) {
    score += 20;
    reasons.push(`only ${fp.extensionCount} TLS extensions (bare/minimal TLS client)`);
  }

  if (!fp.hasALPN) {
    score += 10;
    reasons.push('no ALPN extension (most browsers advertise h2/http1.1)');
  }

  if (fp.cipherCount <= 2) {
    score += 10;
    reasons.push(`only ${fp.cipherCount} cipher suites offered`);
  }

  return { score: Math.min(score, 100), reasons };
}

module.exports = {
  createJA3TerminatingServer,
  getJA3,
  analyzeJA3,
  parseClientHello,
  ja3StringFromHello,
  fingerprintClientHello,
  isGrease,
};
