// src/app.js — stavba Express aplikace (sdílená pro server.js i Vercel).
// Seed se spustí jednou: lokálně před listenem, na Vercelu před prvním
// requestem (middleware ensureSeed — memoizovaný Promise).
'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const A = require('./auth');
const routes = require('./routes');
const { seed } = require('./seed');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Seed spustíme maximálně jednou; při chybě se dá opakovat.
let seedPromise = null;
function ensureSeed() {
  if (!seedPromise) {
    seedPromise = seed().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Seed CHYBA:', err);
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');

  // request log (lokální vývoj)
  app.use((req, res, next) => {
    // eslint-disable-next-line no-console
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  app.use(A.loadSession);

  // Seed před prvním zpracováním requestu (idempotentní; po prvním běhu no-op)
  app.use((req, res, next) => {
    ensureSeed().then(() => next()).catch(next);
  });

  // PWA + bezpečnostní hlavičky (audit Fáze 1)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // CSP: jen same-origin skripty (inline SW registrace byla přesunuta do api.js),
    // inline styly povoleny (JS pohledy používají style atributy), QR obrázky = data:,
    // Google Fonts povoleny pro písma.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://accounts.google.com",
      "frame-src 'self' https://accounts.google.com https://accounts.google.com/gsi/",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
    next();
  });

  // Stripe webhook musí dostat RAW body (express.raw), aby šel ověřit podpis —
  // montujeme ho PŘED globální express.json (jinak by byl stream už přečtený).
  app.use('/api', routes.webhookRouter);

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', routes);

  // statické soubory PWA
  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      if (filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA fallback (Express 5 — wildcard route syntax se změnila, použijeme middleware)
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('CHYBA:', err);
    res.status(500).json({ error: 'SERVER_CHYBA', message: 'Došlo k neočekávané chybě serveru.' });
  });

  return app;
}

module.exports = { buildApp, ensureSeed };
