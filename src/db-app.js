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
      // snapshot podmínek vstupu (provozní den, instruktáž, dokumenty, totožnost)
      day: row.day || null,
      provozni_den_id: row.provozni_den_id || null,
      day_verdict: row.day_verdict || null,
      instruction_id: row.instruction_id || null,
      instruction_ok: row.instruction_ok ? 1 : 0,
      documents_ok: row.documents_ok ? 1 : 0,
      identity_check: row.identity_check || '',
      blocking: row.blocking || '',
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('entries')}
        (id, facility_code, member_id, person_name, person_no, kind, entitlement_kind,
         access_ok, reason, source, recorded_by, recorded_by_name, valid_until,
         member_kind, note, day, provozni_den_id, day_verdict, instruction_id,
         instruction_ok, documents_ok, identity_check, blocking, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.facility_code, r.member_id, r.person_name, r.person_no, r.kind,
       r.entitlement_kind, r.access_ok, r.reason, r.source, r.recorded_by,
       r.recorded_by_name, r.valid_until, r.member_kind, r.note, r.day,
       r.provozni_den_id, r.day_verdict, r.instruction_id, r.instruction_ok,
       r.documents_ok, r.identity_check, r.blocking, r.created_at]
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

// ---------------------------------------------------------------------------
// 5) PRAKTICKÁ INSTRUKTÁŽ (2026-09-28)
//    Záznam vytváří POVĚŘENÝ DOZOR až po skutečné instruktáži. Není to
//    „odkliknutí“ dokumentů: účastník se tím dostane do stavu připravenosti.
// ---------------------------------------------------------------------------
const Instructions = {
  async add(row) {
    const r = {
      id: uuid(),
      facility_code: row.facility_code || 'airbag',
      member_id: row.member_id || null,
      participant_name: row.participant_name || '',
      participant_no: row.participant_no != null ? row.participant_no : null,
      participant_birth: row.participant_birth || null,
      is_minor: row.is_minor ? 1 : 0,
      dozor_id: row.dozor_id || null,
      dozor_name: row.dozor_name || '',
      dozor_role: row.dozor_role || '',
      instructed_at: row.instructed_at || now(),
      recorded_at: now(),
      doc_key: row.doc_key || 'instruktaz_airbag',
      doc_version: row.doc_version != null ? row.doc_version : 0,
      content_hash: row.content_hash || '',
      result: row.result === 'neabsolvoval' ? 'neabsolvoval' : 'absolvoval',
      reason: row.reason || '',
      note: row.note || '',
      source: row.source || 'app',
      offline_ref: row.offline_ref || null,
      synced_at: row.synced_at || null,
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('instructions')}
        (id, facility_code, member_id, participant_name, participant_no, participant_birth,
         is_minor, dozor_id, dozor_name, dozor_role, instructed_at, recorded_at, doc_key,
         doc_version, content_hash, result, reason, note, source, offline_ref, synced_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.facility_code, r.member_id, r.participant_name, r.participant_no, r.participant_birth,
        r.is_minor, r.dozor_id, r.dozor_name, r.dozor_role, r.instructed_at, r.recorded_at, r.doc_key,
        r.doc_version, r.content_hash, r.result, r.reason, r.note, r.source, r.offline_ref, r.synced_at, r.created_at]
    );
    return r;
  },

  async listForMember(memberId, limit = 20) {
    if (!memberId) return [];
    return D.raw.all(
      `SELECT * FROM ${TBL('instructions')} WHERE member_id = ?
        ORDER BY instructed_at DESC LIMIT ${Number(limit) || 20}`,
      [memberId]
    );
  },

  // Poslední ÚSPĚŠNÁ instruktáž daného člověka (pro posouzení připravenosti).
  async lastPassedFor(memberId) {
    if (!memberId) return null;
    return D.raw.get(
      `SELECT * FROM ${TBL('instructions')}
        WHERE member_id = ? AND result = 'absolvoval'
        ORDER BY instructed_at DESC LIMIT 1`,
      [memberId]
    );
  },

  async lastFor(memberId) {
    if (!memberId) return null;
    return D.raw.get(
      `SELECT * FROM ${TBL('instructions')} WHERE member_id = ?
        ORDER BY instructed_at DESC LIMIT 1`,
      [memberId]
    );
  },

  async listForDay(day, facilityCode = 'airbag') {
    return D.raw.all(
      `SELECT * FROM ${TBL('instructions')}
        WHERE facility_code = ? AND substr(instructed_at, 1, 10) = ?
        ORDER BY instructed_at DESC`,
      [facilityCode, day]
    );
  },

  async recent(limit = 50) {
    return D.raw.all(
      `SELECT * FROM ${TBL('instructions')} ORDER BY instructed_at DESC LIMIT ${Number(limit) || 50}`
    );
  },

  async count(day, facilityCode = 'airbag') {
    const r = await D.raw.get(
      `SELECT COUNT(*) AS c FROM ${TBL('instructions')}
        WHERE facility_code = ? AND substr(instructed_at, 1, 10) = ? AND result = 'absolvoval'`,
      [facilityCode, day]
    );
    return r ? Number(r.c) : 0;
  },
};

// ---------------------------------------------------------------------------
// 6) PROVOZNÍ KNIHA — provozní den + jeho kontroly a přerušení provozu
// ---------------------------------------------------------------------------
const CHECKS = ['mattress', 'pressure', 'anchoring', 'ramp', 'surroundings'];
const CHECK_LABELS = {
  mattress: 'Matrace',
  pressure: 'Tlak / nafouknutí',
  anchoring: 'Kotvení',
  ramp: 'Nájezd',
  surroundings: 'Okolí',
};

/** Vyhovuje kontrola? Všechny povinné položky musí být 'ok'. */
function checkVerdict(row) {
  const items = CHECKS.map((k) => ({
    key: k,
    label: CHECK_LABELS[k],
    value: row[`check_${k}`] || 'neprovedeno',
    ok: (row[`check_${k}`] || 'neprovedeno') === 'ok',
  }));
  const failed = items.filter((i) => i.value === 'zavada');
  const notDone = items.filter((i) => !i.ok && i.value !== 'zavada');
  return {
    items,
    failed,
    notDone,
    verdict: failed.length ? 'nevyhovuje' : notDone.length ? 'ceka' : 'vyhovuje',
  };
}

const ProvozniDen = {
  async getByDay(day, facilityCode = 'airbag') {
    return D.raw.get(
      `SELECT * FROM ${TBL('provozni_dny')} WHERE facility_code = ? AND day = ?`,
      [facilityCode, day]
    );
  },

  async getById(id) {
    return D.raw.get(`SELECT * FROM ${TBL('provozni_dny')} WHERE id = ?`, [id]);
  },

  /**
   * Otevření provozního dne (idempotentní upsert na facility+den).
   * Zapisuje kontroly, verdikt, potvrzení přítomnosti dozoru a čas otevření.
   */
  async open(row) {
    const day = row.day;
    const facility = row.facility_code || 'airbag';
    const existing = await this.getByDay(day, facility);
    const checks = {
      check_mattress: row.check_mattress || 'neprovedeno',
      check_pressure: row.check_pressure || 'neprovedeno',
      check_anchoring: row.check_anchoring || 'neprovedeno',
      check_ramp: row.check_ramp || 'neprovedeno',
      check_surroundings: row.check_surroundings || 'neprovedeno',
      check_note: row.check_note || '',
      defects: row.defects || '',
    };
    const verdict = checkVerdict(checks).verdict;
    const ts = now();
    const at = row.at || ts;
    if (existing) {
      await D.raw.run(
        `UPDATE ${TBL('provozni_dny')} SET
           dozor_id = ?, dozor_name = ?, dozor_present = ?,
           check_mattress = ?, check_pressure = ?, check_anchoring = ?, check_ramp = ?,
           check_surroundings = ?, check_note = ?, defects = ?, verdict = ?, verdict_note = ?,
           opened_at = COALESCE(opened_at, ?), opened_confirmed = 1,
           -- opětovné otevření dne ruší předchozí ukončení provozu
           closed_at = NULL, source = ?, offline_ref = ?, synced_at = ?, recorded_at = ?, updated_at = ?
         WHERE id = ?`,
        [row.dozor_id || null, row.dozor_name || '', row.dozor_present === false ? 0 : 1,
          checks.check_mattress, checks.check_pressure, checks.check_anchoring, checks.check_ramp,
          checks.check_surroundings, checks.check_note, checks.defects, verdict, row.verdict_note || '',
          at, row.source || 'app', row.offline_ref || null, row.synced_at || null, at, ts, existing.id]
      );
      return this.getById(existing.id);
    }
    const id = uuid();
    await D.raw.run(
      `INSERT INTO ${TBL('provozni_dny')}
        (id, facility_code, day, dozor_id, dozor_name, dozor_present,
         check_mattress, check_pressure, check_anchoring, check_ramp, check_surroundings,
         check_note, defects, verdict, verdict_note, opened_at, opened_confirmed,
         source, offline_ref, synced_at, recorded_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, facility, day, row.dozor_id || null, row.dozor_name || '', row.dozor_present === false ? 0 : 1,
        checks.check_mattress, checks.check_pressure, checks.check_anchoring, checks.check_ramp,
        checks.check_surroundings, checks.check_note, checks.defects, verdict, row.verdict_note || '',
        at, 1, row.source || 'app', row.offline_ref || null, row.synced_at || null, at, ts, ts]
    );
    return this.getById(id);
  },

  async interrupt(id, { reason, at, dozorName }) {
    const ts = now();
    await D.raw.run(
      `UPDATE ${TBL('provozni_dny')}
          SET interrupted_at = ?, interrupt_reason = ?, resumed_at = NULL, resumed_note = '',
              dozor_name = COALESCE(NULLIF(?, ''), dozor_name), updated_at = ?
        WHERE id = ?`,
      [at || ts, reason || '', dozorName || '', ts, id]
    );
    return this.getById(id);
  },

  async resume(id, { note, at, dozorName }) {
    const ts = now();
    await D.raw.run(
      `UPDATE ${TBL('provozni_dny')}
          SET resumed_at = ?, resumed_note = ?, interrupted_at = NULL, interrupt_reason = '',
              dozor_name = COALESCE(NULLIF(?, ''), dozor_name), updated_at = ?
        WHERE id = ?`,
      [at || ts, note || '', dozorName || '', ts, id]
    );
    return this.getById(id);
  },

  async close(id) {
    await D.raw.run(
      `UPDATE ${TBL('provozni_dny')} SET closed_at = ?, updated_at = ? WHERE id = ?`,
      [now(), now(), id]
    );
    return this.getById(id);
  },

  async recent(limit = 30, facilityCode = 'airbag') {
    return D.raw.all(
      `SELECT * FROM ${TBL('provozni_dny')} WHERE facility_code = ?
        ORDER BY day DESC LIMIT ${Number(limit) || 30}`,
      [facilityCode]
    );
  },
};

const ProvozniZaznamy = {
  async add(row) {
    const r = {
      id: uuid(),
      provozni_den_id: row.provozni_den_id || null,
      facility_code: row.facility_code || 'airbag',
      day: row.day,
      type: row.type || 'poznamka',
      text: row.text || '',
      severity: row.severity || 'info',
      dozor_id: row.dozor_id || null,
      dozor_name: row.dozor_name || '',
      at: row.at || now(),
      source: row.source || 'app',
      offline_ref: row.offline_ref || null,
      synced_at: row.synced_at || null,
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('provozni_zaznamy')}
        (id, provozni_den_id, facility_code, day, type, text, severity, dozor_id, dozor_name,
         at, source, offline_ref, synced_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.provozni_den_id, r.facility_code, r.day, r.type, r.text, r.severity, r.dozor_id,
        r.dozor_name, r.at, r.source, r.offline_ref, r.synced_at, r.created_at]
    );
    return r;
  },

  async listForDay(day, facilityCode = 'airbag', limit = 200) {
    return D.raw.all(
      `SELECT * FROM ${TBL('provozni_zaznamy')}
        WHERE facility_code = ? AND day = ? ORDER BY at ASC LIMIT ${Number(limit) || 200}`,
      [facilityCode, day]
    );
  },

  async recent(limit = 100, facilityCode = 'airbag') {
    return D.raw.all(
      `SELECT * FROM ${TBL('provozni_zaznamy')} WHERE facility_code = ?
        ORDER BY at DESC LIMIT ${Number(limit) || 100}`,
      [facilityCode]
    );
  },
};

// ---------------------------------------------------------------------------
// 7) OVĚŘENÍ VAZBY ZÁKONNÉHO ZÁSTUPCE (u nezletilých)
// ---------------------------------------------------------------------------
const GuardianVerifications = {
  async add(row) {
    const r = {
      id: uuid(),
      member_id: row.member_id,
      child_name: row.child_name || '',
      guardian_name: row.guardian_name || '',
      guardian_relation: row.guardian_relation || '',
      method: row.method || 'jine',
      method_note: row.method_note || '',
      verified_by: row.verified_by || null,
      verified_by_name: row.verified_by_name || '',
      verified_at: row.verified_at || now(),
      source: row.source || 'app',
      created_at: now(),
    };
    await D.raw.run(
      `INSERT INTO ${TBL('guardian_verifications')}
        (id, member_id, child_name, guardian_name, guardian_relation, method, method_note,
         verified_by, verified_by_name, verified_at, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.member_id, r.child_name, r.guardian_name, r.guardian_relation, r.method,
        r.method_note, r.verified_by, r.verified_by_name, r.verified_at, r.source, r.created_at]
    );
    return r;
  },

  async lastFor(memberId) {
    if (!memberId) return null;
    return D.raw.get(
      `SELECT * FROM ${TBL('guardian_verifications')} WHERE member_id = ?
        ORDER BY verified_at DESC LIMIT 1`,
      [memberId]
    );
  },

  async listFor(memberId) {
    if (!memberId) return [];
    return D.raw.all(
      `SELECT * FROM ${TBL('guardian_verifications')} WHERE member_id = ?
        ORDER BY verified_at DESC LIMIT 20`,
      [memberId]
    );
  },
};

// ---------------------------------------------------------------------------
// 8) PARAMETRY PROVOZU ČEKAJÍCÍ NA POTVRZENÍ
//    Hodnoty se NIKDY nedoplňují odhadem — jen z dokumentace výrobce nebo
//    z posouzení skutečného místa (viz provozní řád čl. 12).
// ---------------------------------------------------------------------------
const PARAMETER_DEFAULTS = [
  { key: 'vyrobce', label: 'Výrobce, typ a výrobní číslo zařízení', source_required: 'dokumentace_vyrobce', sort_order: 1 },
  { key: 'rozmery', label: 'Rozměry zařízení', unit: 'm', source_required: 'dokumentace_vyrobce', sort_order: 2 },
  { key: 'tlak', label: 'Provozní tlak a tolerance, způsob měření', unit: 'kPa', source_required: 'dokumentace_vyrobce', sort_order: 3 },
  { key: 'hmotnost', label: 'Maximální hmotnost účastníka', unit: 'kg', source_required: 'dokumentace_vyrobce', sort_order: 4 },
  { key: 'vek', label: 'Věkové omezení dle výrobce', unit: 'roky', source_required: 'dokumentace_vyrobce', sort_order: 5 },
  { key: 'pocasi', label: 'Povětrnostní limity (vítr, déšť, námraza, vlhkost)', source_required: 'dokumentace_vyrobce_a_posouzeni_mista', sort_order: 6 },
  { key: 'kotveni', label: 'Způsob kotvení, počet a únosnost kotevních bodů', source_required: 'dokumentace_vyrobce_a_posouzeni_mista', sort_order: 7 },
  { key: 'sporty', label: 'Povolené sporty', source_required: 'dokumentace_vyrobce', sort_order: 8 },
  { key: 'najezd', label: 'Parametry nájezdu (výška, sklon, dopadová zóna)', source_required: 'vyrobce_a_posouzeni_mista', sort_order: 9 },
  { key: 'revize', label: 'Termíny pravidelné kontroly a revize', source_required: 'dokumentace_vyrobce', sort_order: 10 },
  { key: 'umisteni', label: 'Umístění zařízení (pozemek, přístup)', source_required: 'provozovatel', sort_order: 11 },
  { key: 'pojisteni', label: 'Pojištění odpovědnosti spolku (smlouva, limit, krytí airbagu)', source_required: 'pojistovna', sort_order: 12 },
  { key: 'schvaleni', label: 'Osoba schvalující provozní řád (jméno, funkce, datum)', source_required: 'vybor_spolku', sort_order: 13 },
];

const OpParameters = {
  /** Doplní chybějící definice parametrů (nikdy nepřepíše potvrzenou hodnotu). */
  async ensureSeeded() {
    const ts = now();
    for (const p of PARAMETER_DEFAULTS) {
      const existing = await D.raw.get(`SELECT key FROM ${TBL('op_parameters')} WHERE key = ?`, [p.key]);
      if (existing) continue;
      await D.raw.run(
        `INSERT INTO ${TBL('op_parameters')}
          (key, label, unit, value, source_required, status, source_note, note, sort_order, created_at, updated_at)
         VALUES (?,?,?,NULL,?,?, '', ?, ?, ?, ?)`,
        [p.key, p.label, p.unit || '', p.source_required, 'ceka_na_doplneni', p.note || '', p.sort_order, ts, ts]
      );
    }
  },

  async list() {
    return D.raw.all(`SELECT * FROM ${TBL('op_parameters')} ORDER BY sort_order`);
  },

  async get(key) {
    return D.raw.get(`SELECT * FROM ${TBL('op_parameters')} WHERE key = ?`, [key]);
  },

  /** Potvrzení hodnoty — vyžaduje zdroj a osobu (auditní stopa, kdo co potvrdil). */
  async confirm(key, { value, sourceNote, byId, byName }) {
    if (!value) throw new Error('Hodnotu nelze potvrdit prázdnou.');
    if (!sourceNote) throw new Error('Chybí zdroj potvrzení (dokumentace výrobce / posouzení místa).');
    const ts = now();
    await D.raw.run(
      `UPDATE ${TBL('op_parameters')}
          SET value = ?, status = 'potvrzeno', source_note = ?, confirmed_by = ?,
              confirmed_by_name = ?, confirmed_at = ?, updated_at = ?
        WHERE key = ?`,
      [String(value), sourceNote, byId || null, byName || '', ts, ts, key]
    );
    return this.get(key);
  },
};

// ---------------------------------------------------------------------------
// 9) ŽIVOTNÍ CYKLUS DOKUMENTŮ (aktivní × historická verze)
//    Historické verze se NEmažou ani nepřepisují — jen se označí jako
//    nahrazené, aby se z nich nestala povinnost a aby zůstaly dohledatelné.
// ---------------------------------------------------------------------------
const DocLifecycle = {
  async retire(docKey, { supersededBy, note } = {}) {
    await D.raw.run(
      `UPDATE ${TBL('doc_versions')}
          SET status = 'retired', superseded_by = ?, status_note = ?
        WHERE doc_key = ?`,
      [supersededBy || null, note || 'Historická verze — nahrazena novějším dokumentem.', docKey]
    );
  },

  async activate(docKey) {
    await D.raw.run(
      `UPDATE ${TBL('doc_versions')} SET status = 'active' WHERE doc_key = ?`,
      [docKey]
    );
  },

  /** Je dokument vyřazený (historický)? */
  async isRetired(docKey) {
    const row = await D.raw.get(
      `SELECT status FROM ${TBL('doc_versions')} WHERE doc_key = ? ORDER BY version DESC LIMIT 1`,
      [docKey]
    );
    return !!row && row.status === 'retired';
  },
};

// ---------------------------------------------------------------------------
// 9b) OVĚŘOVACÍ KÓDY PRO POTVRZENÍ DOKUMENTŮ
//     Potvrzení dokumentů nesmí proběhnout jen „protože je někdo přihlášený“.
//     Účastník zadá heslo účtu, nebo jednorázový kód zaslaný na e-mail účtu.
// ---------------------------------------------------------------------------
const CONSENT_CODE_TTL_MIN = 10;
const CONSENT_CODE_MAX_ATTEMPTS = 5;

const ConsentCodes = {
  async issue(memberId, { purpose = 'consent', ttlMinutes = CONSENT_CODE_TTL_MIN } = {}) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const id = uuid();
    const created = now();
    const expires = new Date(Date.now() + ttlMinutes * 60000).toISOString();
    await D.raw.run(
      `INSERT INTO ${TBL('consent_codes')} (id, member_id, code_hash, purpose, created_at, expires_at, used_at, attempts)
       VALUES (?,?,?,?,?,?,NULL,0)`,
      [id, memberId, D.sha256 ? D.sha256(code) : require('crypto').createHash('sha256').update(code).digest('hex'),
        purpose, created, expires]
    );
    return { id, code, createdAt: created, expiresAt: expires, ttlMinutes };
  },

  async verify(memberId, code, { purpose = 'consent' } = {}) {
    if (!code) return { ok: false, reason: 'CHYBI_KOD' };
    const hash = require('crypto').createHash('sha256').update(String(code)).digest('hex');
    const row = await D.raw.get(
      `SELECT * FROM ${TBL('consent_codes')}
        WHERE member_id = ? AND purpose = ? AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [memberId, purpose]
    );
    if (!row) return { ok: false, reason: 'KOD_NEEXISTUJE' };
    if (row.expires_at && new Date(row.expires_at) < new Date()) return { ok: false, reason: 'KOD_EXPIROVAL' };
    if (Number(row.attempts) >= CONSENT_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'PRILIS_POKUSU' };
    if (row.code_hash !== hash) {
      await D.raw.run(`UPDATE ${TBL('consent_codes')} SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
      return { ok: false, reason: 'KOD_NESOUHLASI' };
    }
    await D.raw.run(`UPDATE ${TBL('consent_codes')} SET used_at = ? WHERE id = ?`, [now(), row.id]);
    return { ok: true, id: row.id };
  },
};

// Čtení v rámci jednoho requestu se cachuje (reqcache) — viz src/reqcache.js.
module.exports = require('./reqcache').wrapModule({
  TBL,
  ageFrom,
  Entries,
  MembershipAudit,
  DozorInvites,
  DOZOR_INVITE_DAYS,
  memberOverview,
  Instructions,
  ProvozniDen,
  ProvozniZaznamy,
  CHECKS,
  CHECK_LABELS,
  checkVerdict,
  GuardianVerifications,
  OpParameters,
  PARAMETER_DEFAULTS,
  ConsentCodes,
  CONSENT_CODE_TTL_MIN,
  DocLifecycle,
});
