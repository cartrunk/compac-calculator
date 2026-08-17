'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { RateTracker } = require('./fingerprint/rate');
const { createDetectMiddleware } = require('./middleware/detect');
const { canaryMiddleware, canaryBeaconRoute } = require('./middleware/canary');
const demoRoutes = require('./routes/demo');
const telemetryRoutes = require('./routes/telemetry');
const adminRoutes = require('./routes/admin');

function loadJA3Lists() {
  const file = path.join(__dirname, '..', 'config', 'ja3-lists.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      denylist: new Set(raw.denylist || []),
      allowlist: new Set(raw.allowlist || []),
    };
  } catch {
    return { denylist: new Set(), allowlist: new Set() };
  }
}

function createApp({ rateTracker = new RateTracker() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  const ja3Lists = loadJA3Lists();

  app.use(createDetectMiddleware({ rateTracker, ja3Lists }));
  app.use(canaryMiddleware((req) => req.sessionId));

  app.get('/__canary/beacon/:token', canaryBeaconRoute);
  app.use('/__telemetry', telemetryRoutes);
  app.use('/__admin', adminRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/', demoRoutes);

  app.use((req, res) => res.status(404).send('Not found'));

  return app;
}

module.exports = { createApp };
