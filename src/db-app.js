// db-app.js — ROZŠÍŘENÍ datové vrstvy (2026-09-27).
//
// Vstupy na airbag, audit členství, pozvánky dozoru a přehled členské základny.
//
// ZÁMĚRNĚ driver-agnostické: místo duplikace do db-sqlite.js i db-postgres.js
// používají tyto repozitáře fasádu D.raw (obě implementace mají stejné
// rozhraní all/get/run a překládají `?` placeholdery; postgres navíc řeší
// prefix schématu přes TBL). Jedna implementace = jeden zdroj pravdy.
'use strict';

const D = require('./db');

// Prefix schématu: postgres má tabulky v `app.`, sqlite v hlavním schématu.
const TBL = (n) => (D.driver === 'postgres' ? `app.${n}` : n);

const uuid = () => D.uuid();
const now = () => D.now();

// ---------------------------------------------------------------------------
// Pomocné: věk z data narození (počítá se v JS — SQL dialekty se liší)
// ---------------------------------------------------------------------------
function ageFrom(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// 1) VSTUPY NA AIRBAG — evidence členů i nečlenů pro další analýzy
// ---------------------------------------------------------------------------
const Entries = {
  async add(row) {
    const r = {
      id: uuid(),
      facility_code: row.facility_code || 'airbag',
      member_id: row.member_id || null,
      person_name: row.person_name || '',
      person_no: row.person_no != null ? row.person_no : null,
      kind: row.kind || 'neclen',
      entitlement_kind: row.entitlement_kind || null,
      access_ok: row.access_ok ? 1 : 0,
      reason: row.reason || '',
      source: row.source || 'qr',
      recorded_by: row.recorded_by || null,
      recorded_by_name: row.recorded_by_name || '',
      valid_until: row.valid_until || null,
      member_kind: row.member_kind || null,
      note: row.note || '',
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('entries')}
        (id, facility_code, member_id, person_name, person_no, kind, entitlement_kind,
         access_ok, reason, source, recorded_by, recorded_by_name, valid_until,
         member_kind, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.facility_code, r.member_id, r.person_name, r.person_no, r.kind,
       r.entitlement_kind, r.access_ok, r.reason, r.source, r.recorded_by,
       r.recorded_by_name, r.valid_until, r.member_kind, r.note, r.created_at]
    );
    return r;
  },

  // Historie vstupů jednoho člověka (pro QR detail dozora)
  async listForMember(memberId, limit = 50) {
    if (!memberId) return [];
    return D.raw.all(
      `SELECT * FROM ${TBL('entries')}
        WHERE member_id = ?
        ORDER BY created_at DESC
        LIMIT ${Number(limit) || 50}`,
      [memberId]
    );
  },

  // Historie podle jména (nečlenové bez member_id) — rozpozná opakované vstupy hosta
  async listForName(name, limit = 20) {
    if (!name) return [];
    return D.raw.all(
      `SELECT * FROM ${TBL('entries')}
        WHERE member_id IS NULL AND lower(person_name) = lower(?)
        ORDER BY created_at DESC
        LIMIT ${Number(limit) || 20}`,
      [name]
    );
  },

  async count(memberId) {
    if (!memberId) return 0;
    const r = await D.raw.get(
      `SELECT COUNT(*) AS c FROM ${TBL('entries')} WHERE member_id = ? AND access_ok = 1`,
      [memberId]
    );
    return r ? Number(r.c) : 0;
  },

  // Poslední vstupy (přehled dozora / superadmina)
  async recent(limit = 100, facilityCode = null) {
    const lim = Number(limit) || 100;
    if (facilityCode) {
      return D.raw.all(
        `SELECT * FROM ${TBL('entries')} WHERE facility_code = ? ORDER BY created_at DESC LIMIT ${lim}`,
        [facilityCode]
      );
    }
    return D.raw.all(
      `SELECT * FROM ${TBL('entries')} ORDER BY created_at DESC LIMIT ${lim}`
    );
  },

  // Agregáty za období (od ISO data) — podklad pro analýzy
  async summary(sinceIso) {
    const rows = await D.raw.all(
      `SELECT kind, access_ok, COUNT(*) AS c
         FROM ${TBL('entries')}
        WHERE created_at >= ?
        GROUP BY kind, access_ok`,
      [sinceIso]
    );
    const out = { total: 0, clen: 0, neclen: 0, denied: 0, since: sinceIso };
    for (const r of rows) {
      const c = Number(r.c);
      out.total += c;
      if (Number(r.access_ok) === 0) out.denied += c;
      if (r.kind === 'clen') out.clen += c;
      else out.neclen += c;
    }
    return out;
  },

  // Den s největším provozem + rozložení po hodinách (pro grafy)
  async byDay(days = 30) {
    return D.raw.all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c
         FROM ${TBL('entries')}
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day DESC
        LIMIT ${Number(days) || 30}`
    );
  },

  // Člen s nejvyšším počtem vstupů (požadavek superadmina)
  async topMember() {
    const r = await D.raw.get(
      `SELECT e.member_id, e.person_name, e.person_no, COUNT(*) AS c
         FROM ${TBL('entries')} e
        WHERE e.member_id IS NOT NULL AND e.access_ok = 1
        GROUP BY e.member_id, e.person_name, e.person_no
        ORDER BY c DESC
        LIMIT 1`
    );
    return r ? { memberId: r.member_id, name: r.person_name, memberNo: r.person_no, count: Number(r.c) } : null;
  },
};

// ---------------------------------------------------------------------------
// 2) AUDIT ČLENSTVÍ — kdo, kde, kdy zapsal člena / změnil typ
// ---------------------------------------------------------------------------
const MembershipAudit = {
  async add(row) {
    const r = {
      id: uuid(),
      member_id: row.member_id,
      action: row.action || 'created',
      kind_from: row.kind_from || null,
      kind_to: row.kind_to || null,
      status_from: row.status_from || null,
      status_to: row.status_to || null,
      source: row.source || 'app.tjkrupka.cz',
      actor_email: row.actor_email || '',
      actor_id: row.actor_id || null,
      actor_name: row.actor_name || '',
      note: row.note || '',
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('membership_audit')}
        (id, member_id, action, kind_from, kind_to, status_from, status_to,
         source, actor_email, actor_id, actor_name, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.member_id, r.action, r.kind_from, r.kind_to, r.status_from, r.status_to,
       r.source, r.actor_email, r.actor_id, r.actor_name, r.note, r.created_at]
    );
    return r;
  },

  async listForMember(memberId, limit = 50) {
    return D.raw.all(
      `SELECT * FROM ${TBL('membership_audit')}
        WHERE member_id = ? ORDER BY created_at DESC LIMIT ${Number(limit) || 50}`,
      [memberId]
    );
  },

  async recent(limit = 50) {
    return D.raw.all(
      `SELECT * FROM ${TBL('membership_audit')} ORDER BY created_at DESC LIMIT ${Number(limit) || 50}`
    );
  },
};

// ---------------------------------------------------------------------------
// 3) POZVÁNKY PRO ÚČTY DOZORU (vytváří výhradně superadmin)
// ---------------------------------------------------------------------------
const DOZOR_INVITE_DAYS = 14;

const DozorInvites = {
  async create(row) {
    const token = (D.uuid().replace(/-/g, '') + D.uuid().replace(/-/g, '')).slice(0, 32);
    const created = now();
    const expires = new Date(Date.now() + DOZOR_INVITE_DAYS * 86400 * 1000).toISOString();
    const r = {
      id: uuid(),
      email: String(row.email || '').trim().toLowerCase(),
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      phone: row.phone || '',
      token,
      expires_at: expires,
      used_at: null,
      revoked_at: null,
      invited_by: row.invited_by || '',
      note: row.note || '',
      created_at: created,
    };
    await D.raw.run(
      `INSERT INTO ${TBL('dozor_invites')}
        (id, email, first_name, last_name, phone, token, expires_at, used_at,
         revoked_at, invited_by, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.email, r.first_name, r.last_name, r.phone, r.token, r.expires_at,
       r.used_at, r.revoked_at, r.invited_by, r.note, r.created_at]
    );
    return r;
  },

  async getByToken(token) {
    if (!token) return null;
    return D.raw.get(`SELECT * FROM ${TBL('dozor_invites')} WHERE token = ?`, [token]);
  },

  async getById(id) {
    return D.raw.get(`SELECT * FROM ${TBL('dozor_invites')} WHERE id = ?`, [id]);
  },

  async list() {
    return D.raw.all(`SELECT * FROM ${TBL('dozor_invites')} ORDER BY created_at DESC LIMIT 200`);
  },

  // Poslední aktivní (nevyčerpaná, nezrušená, neexpirovaná) pozvánka na e-mail
  async activeByEmail(email) {
    if (!email) return null;
    return D.raw.get(
      `SELECT * FROM ${TBL('dozor_invites')}
        WHERE lower(email) = lower(?) AND used_at IS NULL AND revoked_at IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
      [email, now()]
    );
  },

  async markUsed(id) {
    await D.raw.run(`UPDATE ${TBL('dozor_invites')} SET used_at = ? WHERE id = ?`, [now(), id]);
  },

  async revoke(id) {
    await D.raw.run(`UPDATE ${TBL('dozor_invites')} SET revoked_at = ? WHERE id = ?`, [now(), id]);
  },

  // Stav pozvánky slovem (pro UI superadmina)
  status(inv) {
    if (!inv) return 'neznama';
    if (inv.revoked_at) return 'zrusena';
    if (inv.used_at) return 'vyuzita';
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return 'expirovana';
    return 'ceka';
  },
};

// ---------------------------------------------------------------------------
// 4) PŘEHLED ČLENSKÉ ZÁKLADNY (jen superadmin)
//    Jeden dotaz na členy + jeden na souhrn vstupů (žádné N+1).
// ---------------------------------------------------------------------------
async function memberOverview() {
  // Pozor: NEPOSÍLÁME sloupec `photo` (base64) — viz výkonový pitfall.
  const cols = [
    'id', 'member_no', 'first_name', 'last_name', 'email', 'birth_date',
    'membership_type', 'membership_kind', 'membership_kind_source',
    'membership_kind_set_by', 'membership_kind_set_at', 'role', 'status',
    'valid_from', 'valid_until', 'blocked', 'blocked_at', 'blocked_reason',
    'created_at',
  ].join(', ');
  const members = await D.raw.all(
    `SELECT ${cols} FROM ${TBL('members')} ORDER BY member_no`
  );

  // Poslední zaplacený příspěvek pro každého člena (jeden dotaz)
  const paidRows = await D.raw.all(
    `SELECT member_id, MAX(paid_at) AS last_paid
       FROM ${TBL('payments')}
      WHERE status = 'paid' AND purpose = 'prispevek'
      GROUP BY member_id`
  );
  const lastPaid = new Map(paidRows.map((r) => [String(r.member_id), r.last_paid]));

  const top = await Entries.topMember();
  const entriesTotal = await D.raw.get(`SELECT COUNT(*) AS c FROM ${TBL('entries')}`);
  const since30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const e30 = await Entries.summary(since30);

  const t = new Date();
  const acc = {
    total: 0, radne: 0, sportovni: 0, minor: 0, adult: 0,
    active: 0, expired: 0, pending: 0, blocked: 0,
    byRole: { member: 0, dozor: 0, vybor: 0, superadmin: 0 },
    dozorAccounts: 0,      // účty dozoru, které NEJSOU členy (nezapočítávají se do členské základny)
    topVisitor: top,
    entriesTotal: entriesTotal ? Number(entriesTotal.c) : 0,
    entries30: e30,
    unpaid: [],
  };

  for (const m of members) {
    const lp = lastPaid.get(String(m.id)) || null;

    // Účet dozoru bez zaplaceného členství = obsluha, ne člen. Do členské
    // základny se nepočítá (jinak by statistiky lhaly), ale evidujeme ho zvlášť.
    const dozorOnly = m.role === 'dozor' && !lp;
    if (dozorOnly) {
      acc.dozorAccounts++;
      if (m.role && acc.byRole[m.role] !== undefined) acc.byRole[m.role]++;
      if (Number(m.blocked) === 1) acc.blocked++;
      continue;
    }

    acc.total++;
    if (m.membership_kind === 'radne') acc.radne++;
    else acc.sportovni++;
    const age = ageFrom(m.birth_date);
    if (age !== null && age < 18) acc.minor++; else acc.adult++;
    if (Number(m.blocked) === 1) acc.blocked++;
    if (m.role && acc.byRole[m.role] !== undefined) acc.byRole[m.role]++;

    const vu = m.valid_until ? new Date(m.valid_until) : null;
    const isActive = m.status === 'active' && vu && vu >= t;
    if (m.status === 'active' && !isActive) acc.expired++;
    else if (m.status === 'active') acc.active++;
    else acc.pending++;

    // Nezaplacený / propadlý členský příspěvek.
    // Vlastníkovi aplikace se upomínka neposílá (spravuje ji sám).
    if (!isActive && m.status !== 'rejected' && m.status !== 'deferred' && m.role !== 'superadmin') {
      acc.unpaid.push({
        id: m.id,
        memberNo: m.member_no,
        name: `${m.first_name} ${m.last_name}`.trim(),
        email: m.email,
        status: m.status,
        validUntil: m.valid_until || null,
        lastPaidAt: lp,
        neverPaid: !lp,
        role: m.role,
        membershipKind: m.membership_kind || 'sportovni',
      });
    }
  }
  acc.unpaidCount = acc.unpaid.length;
  return acc;
}

module.exports = {
  TBL,
  ageFrom,
  Entries,
  MembershipAudit,
  DozorInvites,
  DOZOR_INVITE_DAYS,
  memberOverview,
};
