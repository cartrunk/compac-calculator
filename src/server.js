'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');
const { createJA3TerminatingServer } = require('./fingerprint/ja3');

const PORT = parseInt(process.env.PORT, 10) || 8443;
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

const app = createApp();
const httpServer = http.createServer(app);

if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
  const tlsOptions = {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
    ALPNProtocols: ['http/1.1'],
  };
  const listener = createJA3TerminatingServer(httpServer, tlsOptions);
  listener.listen(PORT, () => {
    console.log(`scraper-sentry listening on https://localhost:${PORT} (JA3 capture active)`);
  });
} else {
  console.warn(`No TLS cert found in ${CERT_DIR} — falling back to plain HTTP on port ${PORT}.`);
  console.warn('Run "npm run cert" to generate a local self-signed cert and enable JA3 fingerprinting.');
  httpServer.listen(PORT, () => {
    console.log(`scraper-sentry listening on http://localhost:${PORT} (JA3 disabled, no TLS)`);
  });
}

module.exports = { app, httpServer };
