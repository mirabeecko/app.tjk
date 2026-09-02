// db-postgres.js — datová vrstva pro PRODUKCI (Supabase/Postgres přes `pg`).
// Stejná signatura metod jako db-sqlite.js (repo pattern) — výběr řídí db.js
// dle env DB_DRIVER=postgres. Všechny metody jsou ASYNC (vrací Promise).
//
// Tabulky žijí ve schématu `app` (NE public!) — public.members je členská
// evidence TJ Krupka (import z IS ČUS), se kterou se nesmí kolidovat.
// Schéma: supabase/schema-app.sql (aplikujte v Supabase SQL editoru).
//
// Konfigurace: DATABASE_URL = Supabase pooler connection string, např.
//   postgresql://postgres.<ref>:<heslo>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true
//
// Dialekt: `?` placeholders se převádí na `$1..$n` (sdílený kód se seed.js).
// Boolean sloupce se vrací jako 1/0 (jako u SQLite), aby kód nemusel řešit
// rozdíl true/false vs 1/0.
'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  throw new Error('DB_DRIVER=postgres vyžaduje DATABASE_URL (Supabase pooler connection string).');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// eslint-disable-next-line no-console
pool.on('error', (err) => console.error('[pg] chyba idle klienta:', err.message));

// ? → $1..$n (parametry SQLite stylu → pg styl)
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Boolean sloupce → 1/0 (parita se SQLite)
const BOOL_COLS = new Set(['requires_guardian', 'access', 'size_required', 'active']);
function normalize(row) {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    if (BOOL_COLS.has(k) && typeof row[k] === 'boolean') row[k] = row[k] ? 1 : 0;
  }
  return row;
}

// ---------- nízkotrovňový přístup (seed + ojedinělé dotazy) ----------
const raw = {
  async all(sql, params = []) {
    const { rows } = await pool.query(toPg(sql), params);
    return rows.map(normalize);
  },
  async get(sql, params = []) {
    const rows = await raw.all(sql, params);
    return rows[0] || null;
  },
  async run(sql, params = []) {
    const r = await pool.query(toPg(sql), params);
    return { changes: r.rowCount ?? 0 };
  },
};

function uuid() {
  // eslint-disable-next-line global-require
  return require('crypto').randomUUID();
}
function now() {
  return new Date().toISOString();
}

const T = (t) => `app.${t}`;

// ---------- member types ----------
const MemberTypes = {
  async list() {
    return raw.all(`SELECT * FROM ${T('member_types')} ORDER BY sort_order`);
  },
  async get(code) {
    return raw.get(`SELECT * FROM ${T('member_types')} WHERE code = $1`, [code]);
  },
};

// ---------- members ----------
const Members = {
  async create(data) {
    const id = uuid();
    const ts = now();
    await raw.run(
      `INSERT INTO ${T('members')}
        (id, member_no, first_name, last_name, birth_date, street, city, zip,
         email, phone, membership_type, role, status, guardian_name, guardian_relation,
         guardian_email, guardian_phone, guardian_token, guardian_token_expires, guardian_status,
         valid_from, valid_until, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [id, data.memberNo ?? null, data.firstName, data.lastName, data.birthDate,
        data.street || '', data.city || '', data.zip || '', data.email, data.phone || '',
        data.membershipType, data.role || 'member', data.status || 'registered',
        data.guardianName ?? null, data.guardianRelation ?? null,
        data.guardianEmail ?? null, data.guardianPhone ?? null,
        data.guardianToken ?? null, data.guardianTokenExpires ?? null,
        data.guardianStatus || 'not_required', data.validFrom ?? null, data.validUntil ?? null,
        ts, ts]
    );
    return this.getById(id);
  },
  async nextMemberNo() {
    const row = await raw.get(`SELECT COALESCE(MAX(member_no), 0) AS m FROM ${T('members')}`);
    return (row ? row.m : 0) + 1;
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('members')} WHERE id = $1`, [id]);
  },
  async getByEmail(email) {
    return raw.get(`SELECT * FROM ${T('members')} WHERE lower(email) = lower($1)`, [email]);
  },
  async getByGuardianToken(token) {
    return raw.get(`SELECT * FROM ${T('members')} WHERE guardian_token = $1`, [token]);
  },
  async update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return this.getById(id);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const params = keys.map((k) => fields[k]);
    await raw.run(
      `UPDATE ${T('members')} SET ${sets}, updated_at = now() WHERE id = $${keys.length + 1}`,
      [...params, id]
    );
    return this.getById(id);
  },
  async listAll() {
    return raw.all(`SELECT * FROM ${T('members')} ORDER BY member_no`);
  },
  async searchByNo(no) {
    return raw.get(`SELECT * FROM ${T('members')} WHERE member_no = $1`, [no]);
  },
  async activeCount() {
    const row = await raw.get(`SELECT COUNT(*) AS c FROM ${T('members')} WHERE status = 'active'`);
    return row ? row.c : 0;
  },
  async countByType(code) {
    const row = await raw.get(`SELECT COUNT(*) AS n FROM ${T('members')} WHERE membership_type = $1`, [code]);
    return row ? row.n : 0;
  },
};

// ---------- doc versions ----------
const DocVersions = {
  async create(docKey, version, title, content, effectiveFrom) {
    const id = uuid();
    const hash = require('crypto').createHash('sha256').update(content, 'utf8').digest('hex');
    await raw.run(
      `INSERT INTO ${T('doc_versions')} (id, doc_key, version, title, content, content_hash, effective_from, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [id, docKey, version, title, content, hash, effectiveFrom]
    );
    return { id, docKey, version, title, contentHash: hash, effectiveFrom };
  },
  async latest(docKey) {
    return raw.get(
      `SELECT * FROM ${T('doc_versions')} WHERE doc_key = $1 ORDER BY version DESC LIMIT 1`,
      [docKey]
    );
  },
  async latestAll() {
    const keys = await raw.all(`SELECT DISTINCT doc_key FROM ${T('doc_versions')}`);
    const out = [];
    for (const k of keys) {
      const latest = await this.latest(k.doc_key);
      if (latest) out.push(latest);
    }
    return out;
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('doc_versions')} WHERE id = $1`, [id]);
  },
  async createNext({ docKey, title, content, effectiveFrom }) {
    const latest = await this.latest(docKey);
    if (latest && latest.content === content) return latest;
    const version = latest ? latest.version + 1 : 1;
    return this.create(docKey, version, title || (latest && latest.title) || docKey, content, effectiveFrom || new Date().toISOString());
  },
};

// ---------- consents (audit trail) ----------
const Consents = {
  async create({ memberId, docKey, docVersion, contentHash, signerType, identity, ip, userAgent }) {
    const id = uuid();
    // NOVÁ VERZE dokumentu => souhlas se upsertuje (audit ukazuje aktuální verzi)
    await raw.run(
      `INSERT INTO ${T('consents')} (id, member_id, doc_key, doc_version, content_hash, signer_type, identity, granted_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9)
       ON CONFLICT (member_id, doc_key, signer_type) DO UPDATE SET
         doc_version = EXCLUDED.doc_version,
         content_hash = EXCLUDED.content_hash,
         identity = EXCLUDED.identity,
         granted_at = now(),
         ip = EXCLUDED.ip,
         user_agent = EXCLUDED.user_agent`,
      [id, memberId, docKey, docVersion, contentHash, signerType, identity, ip, userAgent]
    );
    const row = await raw.get(
      `SELECT * FROM ${T('consents')} WHERE member_id = $1 AND doc_key = $2 AND signer_type = $3`,
      [memberId, docKey, signerType]
    );
    return row;
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('consents')} WHERE id = $1`, [id]);
  },
  async listForMember(memberId) {
    return raw.all(`SELECT * FROM ${T('consents')} WHERE member_id = $1 ORDER BY granted_at`, [memberId]);
  },
  async has(memberId, docKey, signerType) {
    return raw.get(
      `SELECT * FROM ${T('consents')} WHERE member_id = $1 AND doc_key = $2 AND signer_type = $3`,
      [memberId, docKey, signerType]
    );
  },
  async missingForMember(memberId, requiredKeys, signerType) {
    const rows = await this.listForMember(memberId);
    const have = new Set(
      rows.filter((c) => c.signer_type === signerType).map((c) => c.doc_key)
    );
    return requiredKeys.filter((k) => !have.has(k));
  },
  async countForMember(memberId) {
    const row = await raw.get(`SELECT COUNT(*) AS n FROM ${T('consents')} WHERE member_id = $1`, [memberId]);
    return row ? row.n : 0;
  },
};

// ---------- payments ----------
const Payments = {
  async create({ memberId, amountCzk, purpose, gateway, productCode }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('payments')} (id, member_id, amount_czk, purpose, product_code, status, gateway, created_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,now())`,
      [id, memberId, amountCzk, purpose, productCode || null, gateway || 'test']
    );
    return this.getById(id);
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('payments')} WHERE id = $1`, [id]);
  },
  async markPaid(id, gatewayRef) {
    const receiptNo = `TK-${new Date().getFullYear()}-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
    await raw.run(
      `UPDATE ${T('payments')} SET status = 'paid', gateway_ref = $1, receipt_no = $2, paid_at = now() WHERE id = $3`,
      [gatewayRef || null, receiptNo, id]
    );
    return this.getById(id);
  },
  async markFailed(id) {
    await raw.run(`UPDATE ${T('payments')} SET status = 'failed' WHERE id = $1`, [id]);
    return this.getById(id);
  },
  async listForMember(memberId) {
    return raw.all(`SELECT * FROM ${T('payments')} WHERE member_id = $1 ORDER BY created_at DESC`, [memberId]);
  },
  async setGatewayRef(id, ref) {
    return raw.run(`UPDATE ${T('payments')} SET gateway_ref = $1 WHERE id = $2`, [ref, id]);
  },
  async sumPaid() {
    const row = await raw.get(
      `SELECT COALESCE(SUM(amount_czk), 0) AS s, COUNT(*) AS c FROM ${T('payments')} WHERE status = 'paid'`
    );
    return row || { s: 0, c: 0 };
  },
  async countPaidContributionsForMember(memberId) {
    const row = await raw.get(
      `SELECT COUNT(*) AS n FROM ${T('payments')} WHERE member_id = $1 AND purpose = 'prispevek' AND status = 'paid'`,
      [memberId]
    );
    return row ? row.n : 0;
  },
  async hasPaidMembership(memberId) {
    const row = await raw.get(
      `SELECT id FROM ${T('payments')} WHERE member_id = $1 AND purpose = 'prispevek' AND status = 'paid' LIMIT 1`,
      [memberId]
    );
    return !!row;
  },
};

// ---------- products (jednorázové vstupy) ----------
const Products = {
  async listActive() {
    return raw.all(`SELECT * FROM ${T('products')} WHERE active = true ORDER BY sort_order, created_at`);
  },
  async listAll() {
    return raw.all(`SELECT * FROM ${T('products')} ORDER BY sort_order, created_at`);
  },
  async create({ code, name, unit, validityHours }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('products')} (id, code, name, unit, member_price_czk, nonmember_price_czk, validity_hours, active, sort_order, created_at)
       VALUES ($1,$2,$3,$4,0,0,$5,true,0,now())`,
      [id, code, name, unit || 'den', validityHours || 1]
    );
    return this.getByCode(code);
  },
  async getByCode(code) {
    return raw.get(`SELECT * FROM ${T('products')} WHERE code = $1`, [code]);
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('products')} WHERE id = $1`, [id]);
  },
};

// ---------- product variants ----------
const ProductVariants = {
  async listForProduct(productId) {
    return raw.all(
      `SELECT * FROM ${T('product_variants')} WHERE product_id = $1 ORDER BY sort_order, price_czk`,
      [productId]
    );
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('product_variants')} WHERE id = $1`, [id]);
  },
  async create({ productId, audience, ageType, priceCzk, docKeys, guardianDocKeys, active, sortOrder }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('product_variants')} (id, product_id, audience, age_type, price_czk, doc_keys, guardian_doc_keys, active, sort_order, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [id, productId, audience || 'PUBLIC', ageType || 'ANY', priceCzk,
        JSON.stringify(docKeys || []), guardianDocKeys ? JSON.stringify(guardianDocKeys) : null,
        active === undefined || active ? true : false, sortOrder || 0]
    );
    return this.getById(id);
  },
  async update(id, fields) {
    const allowed = ['audience', 'age_type', 'price_czk', 'doc_keys', 'guardian_doc_keys', 'active', 'sort_order', 'active_from', 'active_until'];
    const keys = allowed.filter((k) => fields[k] !== undefined);
    if (!keys.length) return this.getById(id);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const params = keys.map((k) => (k === 'doc_keys' || k === 'guardian_doc_keys') && fields[k] !== null
      ? JSON.stringify(fields[k]) : fields[k]);
    await raw.run(`UPDATE ${T('product_variants')} SET ${sets} WHERE id = $${keys.length + 1}`, [...params, id]);
    return this.getById(id);
  },
  parseDocs(v) {
    const asArr = (x) => (Array.isArray(x) ? x : []);
    return {
      userDocs: asArr(v.doc_keys),
      guardianDocs: v.guardian_doc_keys ? asArr(v.guardian_doc_keys) : null,
    };
  },
};

// ---------- entitlements ----------
const Entitlements = {
  async create({ memberId, productId, paymentId, validFrom, validUntil }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('entitlements')} (id, member_id, product_id, payment_id, valid_from, valid_until, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [id, memberId, productId, paymentId || null, validFrom, validUntil]
    );
    return this.getById(id);
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('entitlements')} WHERE id = $1`, [id]);
  },
  async listForMember(memberId) {
    return raw.all(`SELECT * FROM ${T('entitlements')} WHERE member_id = $1 ORDER BY created_at DESC`, [memberId]);
  },
  async hasActive(memberId) {
    const row = await raw.get(
      `SELECT id FROM ${T('entitlements')} WHERE member_id = $1 AND valid_until > now() LIMIT 1`,
      [memberId]
    );
    return !!row;
  },
};

// ---------- messages (stub outbox) ----------
const Messages = {
  async create({ memberId, channel, to, subject, body }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('messages')} (id, member_id, channel, to_address, subject, body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [id, memberId || null, channel, to, subject || null, body]
    );
    return this.getById(id);
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('messages')} WHERE id = $1`, [id]);
  },
  async list() {
    return raw.all(`SELECT * FROM ${T('messages')} ORDER BY created_at DESC LIMIT 100`);
  },
};

// ---------- sessions ----------
const Sessions = {
  async create(memberId, role, ttlHours = 24 * 30) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    await raw.run(
      `INSERT INTO ${T('sessions')} (id, member_id, role, created_at, expires_at) VALUES ($1,$2,$3,now(),$4)`,
      [token, memberId, role, expires]
    );
    return token;
  },
  async get(token) {
    return raw.get(
      `SELECT * FROM ${T('sessions')} WHERE id = $1 AND expires_at > now()`,
      [token]
    );
  },
  async delete(token) {
    return raw.run(`DELETE FROM ${T('sessions')} WHERE id = $1`, [token]);
  },
};

// ---------- cards ----------
const Cards = {
  async upsert(memberId, payload) {
    await raw.run(
      `INSERT INTO ${T('cards')} (member_id, qr_payload, issued_at) VALUES ($1,$2,now())
       ON CONFLICT (member_id) DO UPDATE SET qr_payload = EXCLUDED.qr_payload, issued_at = EXCLUDED.issued_at`,
      [memberId, payload]
    );
  },
  async getByMember(memberId) {
    return raw.get(`SELECT * FROM ${T('cards')} WHERE member_id = $1`, [memberId]);
  },
  async getByPayload(payload) {
    return raw.get(`SELECT * FROM ${T('cards')} WHERE qr_payload = $1`, [payload]);
  },
};

// ---------- merch ----------
const Merch = {
  async listProducts() {
    return raw.all(`SELECT * FROM ${T('merch_products')} ORDER BY price_czk`);
  },
  async getProduct(id) {
    return raw.get(`SELECT * FROM ${T('merch_products')} WHERE id = $1`, [id]);
  },
  async createOrder({ memberId, items, totalCzk }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('merch_orders')} (id, member_id, items, total_czk, created_at)
       VALUES ($1,$2,$3::jsonb,$4,now())`,
      [id, memberId, JSON.stringify(items), totalCzk]
    );
    return this.getOrder(id);
  },
  async getOrder(id) {
    return raw.get(`SELECT * FROM ${T('merch_orders')} WHERE id = $1`, [id]);
  },
  async linkPayment(orderId, paymentId) {
    return raw.run(`UPDATE ${T('merch_orders')} SET payment_id = $1 WHERE id = $2`, [paymentId, orderId]);
  },
};

// ---------- facilities ----------
const Facilities = {
  async listActive() {
    const rows = await raw.all(`SELECT * FROM ${T('facilities')} WHERE active = true ORDER BY created_at`);
    return rows.map((f) => ({ ...f, short_name: f.short_name || f.name }));
  },
  async getByCode(code) {
    return raw.get(`SELECT * FROM ${T('facilities')} WHERE code = $1`, [code]);
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('facilities')} WHERE id = $1`, [id]);
  },
  async create({ code, name, shortName, description, icon }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('facilities')} (id, code, name, short_name, description, icon, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,now())`,
      [id, code, name, shortName || null, description || '', icon || 'ticket']
    );
    return this.getById(id);
  },
};

// ---------- bookings ----------
const Bookings = {
  async slotsFor(dateStr, facilityId) {
    const slots = [];
    for (let h = 9; h <= 18; h++) {
      const start = `${dateStr}T${String(h).padStart(2, '0')}:00:00`;
      const end = `${dateStr}T${String(h + 1).padStart(2, '0')}:00:00`;
      slots.push({ start, end, taken: false, bookedBy: null });
    }
    // Postgres: slot_start je timestamptz — LIKE na text by selhal, použijeme rozsah.
    const dayStart = `${dateStr}T00:00:00`;
    const dayEnd = `${dateStr}T23:59:59`;
    const taken = await raw.all(
      `SELECT * FROM ${T('bookings')} WHERE slot_start >= $1 AND slot_start <= $2 AND status = 'confirmed' AND facility_id = $3`,
      [dayStart, dayEnd, facilityId]
    );
    for (const b of taken) {
      // normalizace ISO (timestamptz → UTC string) pro porovnání se sloty
      const startIso = new Date(b.slot_start).toISOString().slice(0, 19);
      const s = slots.find((x) => x.start === startIso);
      if (s) {
        s.taken = true;
        s.bookedBy = b.member_id;
      }
    }
    return slots;
  },
  async create({ memberId, facilityId, slotStart, slotEnd }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('bookings')} (id, member_id, facility_id, slot_start, slot_end, created_at)
       VALUES ($1,$2,$3,$4,$5,now())`,
      [id, memberId, facilityId, slotStart, slotEnd]
    );
    return raw.get(`SELECT * FROM ${T('bookings')} WHERE id = $1`, [id]);
  },
  async listForMember(memberId) {
    return raw.all(`SELECT * FROM ${T('bookings')} WHERE member_id = $1 ORDER BY slot_start`, [memberId]);
  },
};

// ---------- events ----------
const Events = {
  async listPublished() {
    return raw.all(
      `SELECT e.*, f.name AS facility_name, f.icon AS facility_icon,
              (SELECT COUNT(*) FROM ${T('event_signups')} s WHERE s.event_id = e.id) AS signup_count
       FROM ${T('events')} e
       LEFT JOIN ${T('facilities')} f ON f.id = e.facility_id
       WHERE e.status = 'published'
       ORDER BY e.starts_at`
    ).then((rows) => rows.map((e) => ({ ...e, capacity: e.capacity || null })));
  },
  async getById(id) {
    return raw.get(`SELECT * FROM ${T('events')} WHERE id = $1`, [id]);
  },
  async signupCount(eventId) {
    const row = await raw.get(`SELECT COUNT(*) AS n FROM ${T('event_signups')} WHERE event_id = $1`, [eventId]);
    return row ? row.n : 0;
  },
  async hasSignedUp(eventId, memberId) {
    const row = await raw.get(
      `SELECT id FROM ${T('event_signups')} WHERE event_id = $1 AND member_id = $2`,
      [eventId, memberId]
    );
    return !!row;
  },
  async signup(eventId, memberId) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('event_signups')} (id, event_id, member_id, created_at) VALUES ($1,$2,$3,now())`,
      [id, eventId, memberId]
    );
    return id;
  },
  async cancel(eventId, memberId) {
    return raw.run(
      `DELETE FROM ${T('event_signups')} WHERE event_id = $1 AND member_id = $2`,
      [eventId, memberId]
    );
  },
  async listForMember(memberId) {
    const rows = await raw.all(`SELECT event_id FROM ${T('event_signups')} WHERE member_id = $1`, [memberId]);
    return rows.map((r) => r.event_id);
  },
  async create({ title, description, facilityId, startsAt, endsAt, location, capacity, signupDeadline }) {
    const id = uuid();
    await raw.run(
      `INSERT INTO ${T('events')} (id, title, description, facility_id, starts_at, ends_at, location, capacity, signup_deadline, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published',now())`,
      [id, title, description || '', facilityId || null, startsAt, endsAt || null, location || '', capacity || null, signupDeadline || null]
    );
    return raw.get(`SELECT * FROM ${T('events')} WHERE id = $1`, [id]);
  },
};

module.exports = {
  pool,
  raw,
  uuid,
  now,
  MemberTypes,
  Members,
  DocVersions,
  Consents,
  Payments,
  Messages,
  Sessions,
  Cards,
  Merch,
  Bookings,
  Events,
  Facilities,
  Products,
  ProductVariants,
  Entitlements,
};
