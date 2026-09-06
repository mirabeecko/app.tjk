// db-sqlite.js — datová vrstva pro SQLite (better-sqlite3) — LOKÁLNÍ VÝVOJ / TESTY.
// Repository pattern: všechny funkce vracejí plain objekty/arraye.
// Pro produkci (Supabase/Postgres) se použije db-postgres.js se STEJNOU
// signaturou metod — výběr řídí fasáda db.js dle env DB_DRIVER.
//
// POZNÁMKA k asynchronitě: metody zde jsou SYNCHRONNÍ (better-sqlite3 je sync).
// Volající (routes.js) je může klidně volat s `await` — await na ne-Promise
// hodnotě je no-op. db-postgres.js vrací Promise; `await` funguje pro obojí.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'airbag.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- init ----------
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ---------- migrace existujících DB (přidání nových sloupců) ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('bookings', 'facility_id', 'facility_id TEXT REFERENCES facilities(id)');
ensureColumn('events', 'facility_id', 'facility_id TEXT REFERENCES facilities(id)');
ensureColumn('members', 'guardian_token_expires', 'guardian_token_expires TEXT');

// Migrace dat: oprava překlepu v účelu plateb „príspevek" → „prispevek"
// (staré řádky vzniklé před opravou by se jinak nepropojily s novým kódem).
db.prepare("UPDATE payments SET purpose = 'prispevek' WHERE purpose = 'príspevek'").run();
ensureColumn('payments', 'product_code', 'product_code TEXT');

function uuid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

// Nízkotrovňový přístup pro seed a ojedinělé dotazy (dialekt SQLite).
// Parametry: `?` placeholders (postgres driver je přeloží na $1..$n).
const raw = {
  all: (sql, params = []) => db.prepare(sql).all(...params),
  get: (sql, params = []) => db.prepare(sql).get(...params),
  run: (sql, params = []) => db.prepare(sql).run(...params),
};

// ---------- member types ----------
const MemberTypes = {
  list: () => db.prepare('SELECT * FROM member_types ORDER BY sort_order').all(),
  get: (code) => db.prepare('SELECT * FROM member_types WHERE code = ?').get(code),
};

// ---------- members ----------
const Members = {
  create(data) {
    const id = uuid();
    const ts = now();
    const row = {
      ...data,
      id,
      role: 'member',
      passwordHash: data.passwordHash ?? null,
      status: data.status || 'registered',
      membershipKind: data.membershipKind || 'sportovni',
      gender: data.gender ?? null,
      photo: data.photo ?? null,
      guardianName: data.guardianName ?? null,
      guardianRelation: data.guardianRelation ?? null,
      guardianEmail: data.guardianEmail ?? null,
      guardianPhone: data.guardianPhone ?? null,
      guardianToken: data.guardianToken ?? null,
      guardianTokenExpires: data.guardianTokenExpires ?? null,
      guardianStatus: data.guardianStatus || 'not_required',
      validFrom: data.validFrom ?? null,
      validUntil: data.validUntil ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    db.prepare(
      `INSERT INTO members (id, member_no, first_name, last_name, birth_date, street, city, zip,
        email, password_hash, phone, membership_type, membership_kind, gender, photo, role, status, guardian_name, guardian_relation,
        guardian_email, guardian_phone, guardian_token, guardian_token_expires, guardian_status, valid_from, valid_until,
        created_at, updated_at)
      VALUES (@id, @memberNo, @firstName, @lastName, @birthDate, @street, @city, @zip,
        @email, @passwordHash, @phone, @membershipType, @membershipKind, @gender, @photo, @role, @status, @guardianName, @guardianRelation,
        @guardianEmail, @guardianPhone, @guardianToken, @guardianTokenExpires, @guardianStatus, @validFrom, @validUntil,
        @createdAt, @updatedAt)`
    ).run(row);
    return this.getById(id);
  },
  nextMemberNo() {
    const row = db.prepare('SELECT COALESCE(MAX(member_no), 0) AS m FROM members').get();
    return row.m + 1;
  },
  getById: (id) => db.prepare('SELECT * FROM members WHERE id = ?').get(id),
  getByEmail: (email) =>
    db.prepare('SELECT * FROM members WHERE lower(email) = lower(?)').get(email),
  getByGuardianToken: (token) =>
    db.prepare('SELECT * FROM members WHERE guardian_token = ?').get(token),
  update(id, fields) {
    const sets = Object.keys(fields)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    db.prepare(`UPDATE members SET ${sets}, updated_at = @ts WHERE id = @id`).run({
      ...fields,
      id,
      ts: now(),
    });
    return this.getById(id);
  },
  listAll: () => db.prepare('SELECT * FROM members ORDER BY member_no').all(),
  searchByNo: (no) => db.prepare('SELECT * FROM members WHERE member_no = ?').get(no),
  activeCount: () =>
    db.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").get().c,
  countByType: (code) =>
    db.prepare('SELECT COUNT(*) AS n FROM members WHERE membership_type = ?').get(code).n,
};

// ---------- doc versions ----------
const DocVersions = {
  create(docKey, version, title, content, effectiveFrom) {
    const id = uuid();
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    db.prepare(
      `INSERT INTO doc_versions (id, doc_key, version, title, content, content_hash, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, docKey, version, title, content, hash, effectiveFrom, now());
    return { id, docKey, version, title, contentHash: hash, effectiveFrom };
  },
  latest(docKey) {
    return db
      .prepare(
        'SELECT * FROM doc_versions WHERE doc_key = ? ORDER BY version DESC LIMIT 1'
      )
      .get(docKey);
  },
  // Nová verze dokumentu (nebo v1) — content shodný => vrací aktuální beze změny
  createNext({ docKey, title, content, effectiveFrom }) {
    const latest = this.latest(docKey);
    if (latest && latest.content === content) return latest;
    const version = latest ? latest.version + 1 : 1;
    return this.create(docKey, version, title || (latest && latest.title) || docKey, content, effectiveFrom || now());
  },
  latestAll() {
    const keys = db.prepare('SELECT DISTINCT doc_key FROM doc_versions').all();
    return keys.map((k) => this.latest(k.doc_key));
  },
  getById: (id) => db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(id),
};

// ---------- consents (audit trail) ----------
const Consents = {
  create({ memberId, docKey, docVersion, contentHash, signerType, identity, ip, userAgent }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO consents (id, member_id, doc_key, doc_version, content_hash, signer_type, identity, granted_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, memberId, docKey, docVersion, contentHash, signerType, identity, now(), ip, userAgent);
    return this.getById(id);
  },
  getById: (id) => db.prepare('SELECT * FROM consents WHERE id = ?').get(id),
  listForMember: (memberId) =>
    db.prepare('SELECT * FROM consents WHERE member_id = ? ORDER BY granted_at').all(memberId),
  has: (memberId, docKey, signerType) =>
    db
      .prepare(
        'SELECT * FROM consents WHERE member_id = ? AND doc_key = ? AND signer_type = ?'
      )
      .get(memberId, docKey, signerType),
  missingForMember(memberId, requiredKeys, signerType) {
    const have = new Set(
      this.listForMember(memberId)
        .filter((c) => c.signer_type === signerType)
        .map((c) => c.doc_key)
    );
    return requiredKeys.filter((k) => !have.has(k));
  },
  countForMember: (memberId) =>
    db.prepare('SELECT COUNT(*) AS n FROM consents WHERE member_id = ?').get(memberId).n,
};

// ---------- payments ----------
const Payments = {
  create({ memberId, amountCzk, purpose, gateway, productCode }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO payments (id, member_id, amount_czk, purpose, product_code, status, gateway, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, memberId, amountCzk, purpose, productCode || null, gateway || 'test', now());
    return this.getById(id);
  },
  getById: (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(id),
  markPaid(id, gatewayRef) {
    const receiptNo = `TK-${new Date().getFullYear()}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;
    db.prepare(
      `UPDATE payments SET status = 'paid', gateway_ref = ?, receipt_no = ?, paid_at = ? WHERE id = ?`
    ).run(gatewayRef || null, receiptNo, now(), id);
    return this.getById(id);
  },
  markFailed: (id) =>
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(id),
  listForMember: (memberId) =>
    db.prepare('SELECT * FROM payments WHERE member_id = ? ORDER BY created_at DESC').all(memberId),
  setGatewayRef: (id, ref) =>
    db.prepare('UPDATE payments SET gateway_ref = ? WHERE id = ?').run(ref, id),
  sumPaid: () =>
    db.prepare("SELECT COALESCE(SUM(amount_czk), 0) AS s, COUNT(*) AS c FROM payments WHERE status = 'paid'").get(),
  countPaidContributionsForMember: (memberId) =>
    db.prepare("SELECT COUNT(*) AS n FROM payments WHERE member_id = ? AND purpose = 'prispevek' AND status = 'paid'").get(memberId).n,
  hasPaidMembership: (memberId) =>
    !!db
      .prepare("SELECT id FROM payments WHERE member_id = ? AND purpose = 'prispevek' AND status = 'paid' LIMIT 1")
      .get(memberId),
};

// ---------- messages (stub outbox) ----------
const Messages = {
  create({ memberId, channel, to, subject, body }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO messages (id, member_id, channel, to_address, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, memberId || null, channel, to, subject || null, body, now());
    return this.getById(id);
  },
  getById: (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id),
  list: () => db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100').all(),
};

// ---------- sessions ----------
const Sessions = {
  create(memberId, role, ttlHours = 24 * 30) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    db.prepare(
      'INSERT INTO sessions (id, member_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(token, memberId, role, now(), expires);
    return token;
  },
  get: (token) =>
    db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
      .get(token, now()),
  delete: (token) => db.prepare('DELETE FROM sessions WHERE id = ?').run(token),
};

// ---------- cards ----------
const Cards = {
  upsert(memberId, payload) {
    db.prepare(
      `INSERT INTO cards (member_id, qr_payload, issued_at) VALUES (?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET qr_payload = excluded.qr_payload, issued_at = excluded.issued_at`
    ).run(memberId, payload, now());
  },
  getByMember: (memberId) =>
    db.prepare('SELECT * FROM cards WHERE member_id = ?').get(memberId),
  getByPayload: (payload) =>
    db.prepare('SELECT * FROM cards WHERE qr_payload = ?').get(payload),
};

// ---------- merch ----------
const Merch = {
  listProducts: () => db.prepare('SELECT * FROM merch_products ORDER BY price_czk').all(),
  getProduct: (id) => db.prepare('SELECT * FROM merch_products WHERE id = ?').get(id),
  createOrder({ memberId, items, totalCzk }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO merch_orders (id, member_id, items, total_czk, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, memberId, JSON.stringify(items), totalCzk, now());
    return db.prepare('SELECT * FROM merch_orders WHERE id = ?').get(id);
  },
  getOrder: (id) => db.prepare('SELECT * FROM merch_orders WHERE id = ?').get(id),
  linkPayment: (orderId, paymentId) =>
    db.prepare('UPDATE merch_orders SET payment_id = ? WHERE id = ?').run(paymentId, orderId),
};

// ---------- facilities (členské výhody / zařízení spolku) ----------
const Facilities = {
  listActive() {
    return db
      .prepare('SELECT * FROM facilities WHERE active = 1 ORDER BY created_at')
      .all()
      .map((f) => ({ ...f, short_name: f.short_name || f.name }));
  },
  getByCode(code) {
    return db.prepare('SELECT * FROM facilities WHERE code = ?').get(code) || null;
  },
  getById(id) {
    return db.prepare('SELECT * FROM facilities WHERE id = ?').get(id) || null;
  },
  create({ code, name, shortName, description, icon }) {
    const id = uuid();
    db.prepare(
      'INSERT INTO facilities (id, code, name, short_name, description, icon, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(id, code, name, shortName || null, description || '', icon || 'ticket', now());
    return db.prepare('SELECT * FROM facilities WHERE id = ?').get(id);
  },
};

// ---------- bookings ----------
const Bookings = {
  slotsFor(dateStr, facilityId) {
    // Provozní doba 9:00–19:00, sloty po 60 min. (MVP: pevný rozvrh)
    const slots = [];
    for (let h = 9; h <= 18; h++) {
      const start = `${dateStr}T${String(h).padStart(2, '0')}:00:00`;
      const end = `${dateStr}T${String(h + 1).padStart(2, '0')}:00:00`;
      slots.push({ start, end, taken: false, bookedBy: null });
    }
    const taken = db
      .prepare(
        "SELECT * FROM bookings WHERE slot_start LIKE ? AND status = 'confirmed' AND facility_id = ?"
      )
      .all(`${dateStr}T%`, facilityId);
    for (const b of taken) {
      const s = slots.find(
        (x) => x.start === b.slot_start && x.end === b.slot_end
      );
      if (s) {
        s.taken = true;
        s.bookedBy = b.member_id;
      }
    }
    return slots;
  },
  create({ memberId, facilityId, slotStart, slotEnd }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO bookings (id, member_id, facility_id, slot_start, slot_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, memberId, facilityId, slotStart, slotEnd, now());
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  },
  listForMember(memberId) {
    return db
      .prepare('SELECT * FROM bookings WHERE member_id = ? ORDER BY slot_start')
      .all(memberId);
  },
};
// ---------- events (akce spolku + přihlášení) ----------
const Events = {
  listPublished() {
    return db
      .prepare(
        `SELECT e.*, f.name AS facility_name, f.icon AS facility_icon,
                (SELECT COUNT(*) FROM event_signups s WHERE s.event_id = e.id) AS signup_count
         FROM events e
         LEFT JOIN facilities f ON f.id = e.facility_id
         WHERE e.status = 'published'
         ORDER BY e.starts_at`
      )
      .all()
      .map((e) => ({ ...e, capacity: e.capacity || null }));
  },
  getById(id) {
    return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  },
  signupCount(eventId) {
    return db
      .prepare('SELECT COUNT(*) AS n FROM event_signups WHERE event_id = ?')
      .get(eventId).n;
  },
  hasSignedUp(eventId, memberId) {
    return !!db
      .prepare('SELECT id FROM event_signups WHERE event_id = ? AND member_id = ?')
      .get(eventId, memberId);
  },
  signup(eventId, memberId) {
    const id = uuid();
    db.prepare(
      'INSERT INTO event_signups (id, event_id, member_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, eventId, memberId, now());
    return id;
  },
  cancel(eventId, memberId) {
    return db
      .prepare('DELETE FROM event_signups WHERE event_id = ? AND member_id = ?')
      .run(eventId, memberId);
  },
  listForMember(memberId) {
    return db
      .prepare('SELECT event_id FROM event_signups WHERE member_id = ?')
      .all(memberId)
      .map((r) => r.event_id);
  },
  create({ title, description, facilityId, startsAt, endsAt, location, capacity, signupDeadline }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO events (id, title, description, facility_id, starts_at, ends_at, location, capacity, signup_deadline, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
    ).run(id, title, description || '', facilityId || null, startsAt, endsAt || null, location || '', capacity || null, signupDeadline || null, now());
    return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  },
};

// ---------- products (jednorázové vstupy — členská/nečlenská cena) ----------
const Products = {
  listActive: () =>
    db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order, created_at').all(),
  listAll: () =>
    db.prepare('SELECT * FROM products ORDER BY sort_order, created_at').all(),
  getByCode: (code) => db.prepare('SELECT * FROM products WHERE code = ?').get(code) || null,
  getById: (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) || null,
  create({ code, name, unit, validityHours }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO products (id, code, name, unit, member_price_czk, nonmember_price_czk, validity_hours, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, 1, 0, ?)`
    ).run(id, code, name, unit || 'den', validityHours || 1, now());
    return this.getByCode(code);
  },
};

// ---------- product variants (eligibilita: audience/age/price/docs) ----------
const ProductVariants = {
  listForProduct(productId) {
    return db
      .prepare("SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order, price_czk")
      .all(productId);
  },
  getById(id) { return db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id) || null; },
  create({ productId, audience, ageType, priceCzk, docKeys, guardianDocKeys, active, sortOrder }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO product_variants (id, product_id, audience, age_type, price_czk, doc_keys, guardian_doc_keys, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, productId, audience || 'PUBLIC', ageType || 'ANY', priceCzk,
      JSON.stringify(docKeys || []), guardianDocKeys ? JSON.stringify(guardianDocKeys) : null,
      active === undefined || active ? 1 : 0, sortOrder || 0, now());
    return this.getById(id);
  },
  update(id, fields) {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE product_variants SET ${sets} WHERE id = @id`).run({ ...fields, id });
    return this.getById(id);
  },
  parseDocs(v) {
    const parse = (s) => {
      try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    };
    return {
      userDocs: parse(v.doc_keys),
      // prázdný guardian_doc_keys => zástupce podepisuje userDocs
      guardianDocs: v.guardian_doc_keys ? parse(v.guardian_doc_keys) : null,
    };
  },
};

// ---------- entitlements (zakoupená oprávnění k jednorázovým produktům) ----------
const Entitlements = {
  create({ memberId, productId, paymentId, validFrom, validUntil }) {
    const id = uuid();
    db.prepare(
      `INSERT INTO entitlements (id, member_id, product_id, payment_id, valid_from, valid_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, memberId, productId, paymentId || null, validFrom, validUntil, now());
    return this.getById(id);
  },
  getById: (id) => db.prepare('SELECT * FROM entitlements WHERE id = ?').get(id),
  listForMember: (memberId) =>
    db.prepare('SELECT * FROM entitlements WHERE member_id = ? ORDER BY created_at DESC').all(memberId),
  // má člen alespoň jedno platné oprávnění (přístupové právo k produktu)?
  hasActive: (memberId) =>
    !!db
      .prepare('SELECT id FROM entitlements WHERE member_id = ? AND valid_until > ? LIMIT 1')
      .get(memberId, now()),
};

const Notifications = {
  create({ memberId, type, title, body }) {
    const id = uuid();
    const ts = now();
    db.prepare(
      `INSERT INTO notifications (id, member_id, type, title, body, read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(id, memberId, type, title, body, ts);
    return this.getById(id);
  },
  getById: (id) => db.prepare('SELECT * FROM notifications WHERE id = ?').get(id),
  listForMember(memberId) {
    return db.prepare('SELECT * FROM notifications WHERE member_id = ? ORDER BY created_at DESC').all(memberId);
  },
  countUnread(memberId) {
    const r = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE member_id = ? AND read = 0').get(memberId);
    return r ? r.c : 0;
  },
  markRead(id, memberId) {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND member_id = ?').run(id, memberId);
    return this.getById(id);
  },
  markAllRead(memberId) {
    db.prepare('UPDATE notifications SET read = 1 WHERE member_id = ? AND read = 0').run(memberId);
  },
};

module.exports = {
  db,
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
  Notifications,
};
