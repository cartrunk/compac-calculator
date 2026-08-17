'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClientHello,
  fingerprintClientHello,
  ja3StringFromHello,
  isGrease,
} = require('../src/fingerprint/ja3');

// Real ClientHello bytes captured from a live `curl -k https://...` TLS
// handshake against this project's own JA3-terminating listener (see
// scripts/gen-cert.sh + src/fingerprint/ja3.js). This is a regression
// fixture, not an independently-sourced RFC test vector — it pins the
// parser's behavior against real wire bytes rather than a hand-built
// buffer, but correctness of the JA3 spec itself isn't re-verified
// against a third-party implementation here.
const CURL_CLIENT_HELLO_B64 =
  'FgMBAgABAAH8AwMuJJeZOi819LCLaT2Nuo+MKxKN312Jpk/E1m8A6OB6tCCTQ+y5Muz+Q+aPwhTBMD9/Tbd2hGy9cCbuwHL9nG2aHgA+EwITAxMBwCzAMACfzKnMqMyqwCvALwCewCTAKABrwCPAJwBnwArAFAA5wAnAEwAzAJ0AnAA9ADwANQAvAP8BAAF1AAAADgAMAAAJbG9jYWxob3N0AAsABAMAAQIACgAWABQAHQAXAB4AGQAYAQABAQECAQMBBAAQAA4ADAJoMghodHRwLzEuMQAWAAAAFwAAADEAAAANACoAKAQDBQMGAwgHCAgICQgKCAsIBAgFCAYEAQUBBgEDAwMBAwIEAgUCBgIAKwAFBAMEAwMALQACAQEAMwAmACQAHQAgXz5naH/nnf2LWROMGV66shOMSMdXCzt06ixBcX59yV4AFQC4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

test('parses a real ClientHello and extracts sane fields', () => {
  const buf = Buffer.from(CURL_CLIENT_HELLO_B64, 'base64');
  const hello = parseClientHello(buf);
  assert.ok(hello);
  assert.equal(hello.clientVersion, 0x0303); // TLS 1.2 legacy version field
  assert.ok(hello.ciphers.length > 0);
  assert.ok(hello.extensions.length > 0);
});

test('excludes GREASE values from ciphers/extensions/curves', () => {
  const buf = Buffer.from(CURL_CLIENT_HELLO_B64, 'base64');
  const hello = parseClientHello(buf);
  for (const v of [...hello.ciphers, ...hello.extensions, ...hello.curves]) {
    assert.equal(isGrease(v), false, `${v} should have been filtered as GREASE`);
  }
});

test('fingerprintClientHello is deterministic', () => {
  const buf = Buffer.from(CURL_CLIENT_HELLO_B64, 'base64');
  const a = fingerprintClientHello(buf);
  const b = fingerprintClientHello(buf);
  assert.equal(a.ja3, b.ja3);
  assert.match(a.ja3, /^[0-9a-f]{32}$/);
});

test('ja3StringFromHello joins fields in JA3 field order', () => {
  const hello = { clientVersion: 771, ciphers: [1, 2], extensions: [3], curves: [4, 5], pointFormats: [0] };
  assert.equal(ja3StringFromHello(hello), '771,1-2,3,4-5,0');
});

test('rejects non-TLS-handshake buffers without throwing', () => {
  assert.equal(parseClientHello(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x01, 0x00])), null); // app data, not handshake
  assert.equal(parseClientHello(Buffer.alloc(0)), null);
  assert.equal(parseClientHello(null), null);
  assert.equal(fingerprintClientHello(Buffer.from('garbage')), null);
});

test('bails out cleanly on a truncated ClientHello (simulated TCP fragmentation)', () => {
  const buf = Buffer.from(CURL_CLIENT_HELLO_B64, 'base64');
  const truncated = buf.subarray(0, 40);
  assert.equal(parseClientHello(truncated), null);
});
