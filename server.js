// server.js — lokální vývoj / produkce na VPS: Express + listen.
// Pro Vercel (serverless) se používá api/index.js (exportuje aplikaci).
'use strict';

const { buildApp, ensureSeed } = require('./src/app');

const PORT = process.env.PORT || 4310;

const app = buildApp();

ensureSeed()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`AIRBAG PWA běží na http://localhost:${PORT} (driver: ${require('./src/db').driver})`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Nepodařilo se spustit server:', err);
    process.exit(1);
  });
