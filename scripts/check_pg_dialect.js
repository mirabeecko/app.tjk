// Ověření opravy dialektu proti reálné produkční DB (jen SELECT, nic nemění).
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.log('CHYBÍ DATABASE_URL v .env');
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });

const dnes = "to_char(now() AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD')";

const queries = [
  ['instructions pro dnešní den (dřív 500)',
    `SELECT ${dnes} AS dnes, COUNT(*) AS c
       FROM app.instructions
      WHERE facility_code = $1 AND ${dnes} = ${dnes}`],
  ['instructions listForDay',
    `SELECT COUNT(*) AS c
       FROM app.instructions
      WHERE facility_code = $1
        AND to_char(instructed_at AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD') = $2`],
  ['entries byDay (graf)',
    `SELECT to_char(created_at AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD') AS day, COUNT(*) AS c
       FROM app.entries
      GROUP BY to_char(created_at AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD')
      ORDER BY day DESC
      LIMIT 5`],
];

(async () => {
  for (const [label, sql] of queries) {
    try {
      const params = label.includes('listForDay') ? ['airbag', new Date().toISOString().slice(0, 10)] : label.includes('entries') ? [] : ['airbag'];
      const r = await pool.query(sql, params);
      console.log('OK  ', label, '→', JSON.stringify(r.rows));
    } catch (e) {
      console.log('FAIL', label, '→', e.message);
    }
  }
  await pool.end();
})();
