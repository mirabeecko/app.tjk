// scripts/apply-schema.js — aplikuje supabase/schema-app.sql na produkční DB.
// Použití: node scripts/apply-schema.js [--direct]
//   výchozí: DATABASE_URL z .env (Supabase pooler, port 6543)
//   --direct: přímé připojení (port 5432, bez pgbouncer) — doporučeno pro DDL
// (heslo se nikdy neloguje; bere se z .env)
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  let url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL chybí v .env');
  if (process.argv.includes('--direct')) {
    url = url.replace(/:6543\//, ':5432/').replace(/\?pgbouncer=true/, '');
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema-app.sql'), 'utf8');
  const client = new Client({ connectionString: url });
  await client.connect();
  // eslint-disable-next-line no-console
  console.log('Připojeno — aplikuji schema-app.sql (idempotentní)...');
  await client.query(sql);
  // eslint-disable-next-line no-console
  console.log('Schema OK — schéma `app` je připravené.');
  await client.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('CHYBA:', e.message);
  process.exit(1);
});
