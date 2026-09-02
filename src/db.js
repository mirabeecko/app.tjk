// db.js — FASÁDA datové vrstvy. Výběr driveru dle env DB_DRIVER:
//   sqlite   (výchozí) — lokální vývoj a testy (better-sqlite3, sync metody)
//   postgres — produkce (Supabase/Postgres přes `pg`, async metody)
//
// OBA drivery mají STEJNOU signaturu metod (repo pattern). Volající v routes.js
// používají `await` — u sqlite (sync) je await no-op, u postgres čeká na Promise.
'use strict';

const DRIVER = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

let impl;
if (DRIVER === 'postgres' || DRIVER === 'supabase') {
  impl = require('./db-postgres');
} else {
  impl = require('./db-sqlite');
}

// Poznámka: `driver` se připojí na exportovaný objekt — je to informativní
// (seed / logy / superadmin UI), ne funkcionální přepínač.
module.exports = { ...impl, driver: DRIVER };
