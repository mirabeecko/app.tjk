// api/index.js — VERCEL serverless entry (Express app).
// Seed se spustí automaticky přes middleware ensureSeed (src/app.js)
// před prvním requestem — idempotentní, na produkci bez demo účtů (SEED_DEMO=false).
'use strict';

const { buildApp } = require('../src/app');

module.exports = buildApp();
