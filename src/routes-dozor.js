// routes-dozor.js — DOZOR + SUPERADMIN (2026-09-27)
//
// Pokrývá požadavky:
//   • QR kontrola dozorem s KOMPLETNÍMI informacemi (členství, platnost, vstupy,
//     dokumenty/souhlasy s ověřením, fotografie)
//   • evidence VŠECH vstupů (člen i nečlen) pro další analýzy
//   • účty DOZORU: vytváří výhradně superadmin pozvánkou na e-mail; dozor
//     nemusí být členem
//   • superadmin: přehled členské základny, správa dozoru, blokace účtů,
//     upozornění na nezaplacený příspěvek
//   • OKAMŽITÁ AKTIVACE po zaplacení (aby QR nehlásil „chybí platba“)
'use strict';

const express = require('express');

const A = require('./auth');
const D = require('./db');
const X = require('./db-app');
const R = require('./readiness');
const Pwd = require('./password');
const mailer = require('./mailer');
const payments = require('./payments');
const routes = require('./routes');

const { asyncRoute, effectiveStatus, isClubMember, TBL } = routes.shared;

const router = express.Router();

// ---------------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------------
const s = (v) => (v == null ? '' : String(v));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s(v));

/** Základ URL aplikace (odkazy v e-mailech a QR detailech). */
function appOrigin(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

/**
 * OKAMŽITÁ AKTIVACE — jádro požadavku „po zaplacení nesmí QR hlásit chybějící platbu“.
 *
 * Webhook od Stripe může dorazit se zpožděním a uživatel u vstupu naskenuje QR
 * dřív. Před každým zamítnutím proto ověříme rozpracované platby přímo u brány
 * a při úhradě členství/vstup aktivujeme — kontrola dozora tak vidí aktuální stav.
 * Ošetřeno časovým stropem, aby QR kontrola nemohla viset.
 */
async function settlePendingPayments(member, { limit = 3, budgetMs = 4000 } = {}) {
  if (!member) return false;
  const started = Date.now();
  let activated = false;
  let pending = [];
  try {
    pending = await D.raw.all(
      `SELECT * FROM ${TBL('payments')}
        WHERE member_id = ? AND status <> 'paid'
        ORDER BY created_at DESC LIMIT ${Number(limit) || 3}`,
      [member.id]
    );
  } catch (err) {
    console.error('[dozor] čtení plateb selhalo:', err.message);
    return false;
  }
  for (const p of pending) {
    if (Date.now() - started > budgetMs) break;
    if (!p.gateway_ref) continue;
    try {
      const verified = await payments.verifyStripePayment(p);
      if (verified && verified.status === 'paid') {
        await routes.shared.activateMembership(verified);
        activated = true;
      }
    } catch (err) {
      console.error('[dozor] ověření platby u brány selhalo:', err.message);
    }
  }
  return activated;
}

/** Souhlasy člena včetně ověření proti uložené verzi dokumentu. */
async function memberDocuments(memberId) {
  let rows = [];
  try {
    rows = await D.raw.all(
      `SELECT * FROM ${TBL('consents')} WHERE member_id = ? ORDER BY granted_at DESC`,
      [memberId]
    );
  } catch (err) {
    return [];
  }
  const out = [];
  for (const c of rows) {
    let verified = false;
    let title = c.doc_key;
    try {
      const dv = await D.DocVersions.byKeyVersion(c.doc_key, c.doc_version);
      if (dv) {
        title = dv.title || c.doc_key;
        // Ověřeno = hash uloženého znění odpovídá tomu, s čím člen souhlasil.
        verified = !!dv.content_hash && dv.content_hash === c.content_hash;
      }
    } catch (err) { /* neověřeno */ }
    out.push({
      docKey: c.doc_key,
      title,
      version: c.doc_version,
      signerType: c.signer_type,
      signedBy: c.identity,
      grantedAt: c.granted_at,
      ip: c.ip,
      contentHash: c.content_hash,
      verified,
    });
  }
  return out;
}

/**
 * Kompletní karta pro dozora (a pro superadmina).
 * Vrací identitu, stav členství, platnost, historii vstupů, dokumenty, fotku
 * a PŘIPRAVENOST KE SKOKU (potvrzené dokumenty × instruktáž × podmínky dne).
 */
async function buildMemberCard(member, { origin, refresh = false, day, identityPin } = {}) {
  const st = effectiveStatus(member);
  let isMember = await isClubMember(member);
  let entitlement = null;
  try {
    entitlement = await D.Entitlements.hasActive(member.id);
  } catch (err) { entitlement = null; }

  // Když členství nevychází, zkusit dorovnat platbu (okamžitá aktivace)
  if (refresh && !isMember && !entitlement) {
    const activated = await settlePendingPayments(member);
    if (activated) {
      const fresh = await D.Members.getById(member.id);
      if (fresh) {
        member = fresh;
        isMember = await isClubMember(fresh);
        try { entitlement = await D.Entitlements.hasActive(fresh.id); } catch (err) { /* ignore */ }
      }
    }
  }

  // ---- PŘIPRAVENOST: dokumenty + instruktáž + provozní den + totožnost ----
  const ready = await R.readiness(member, { day });

  // ---- OVĚŘENÍ TOTOŽNOSTI U VSTUPU ----
  // Přiměřené ověření: QR karta účtu + porovnání fotografie dozorem, a pokud má
  // účastník nastavený vstupní PIN, musí jej zadat OSOBNĚ (bez něj vstup ne).
  const identity = { method: 'qr+foto', pinRequired: ready ? ready.identity.pinSet : false, pinOk: null, note: '' };
  if (identity.pinRequired) {
    if (identityPin == null || String(identityPin) === '') {
      identity.pinOk = false;
      identity.note = 'Účastník má nastavený vstupní PIN — vyzvěte jej, aby jej zadal osobně.';
    } else if (!Pwd.verify(String(identityPin), member.entry_pin_hash)) {
      identity.pinOk = false;
      identity.note = 'Zadaný vstupní PIN nesouhlasí — vstup nelze povolit.';
    } else {
      identity.pinOk = true;
      identity.method = 'qr+foto+pin';
    }
  } else if (ready && !ready.identity.pinSet) {
    identity.note = 'Účastník nemá nastavený vstupní PIN — totožnost ověřena jen podle fotografie (doporučte mu PIN nastavit).';
  }
  const identityOk = !identity.pinRequired || identity.pinOk === true;

  const allowed = !!(ready && ready.ready && identityOk);
  const kind = isMember ? 'clen' : 'neclen';
  const memberNo = member.member_no;

  // Platnost: členství → valid_until; jednorázový vstup → valid_until oprávnění
  let validUntil = member.valid_until || null;
  let validFrom = member.valid_from || null;
  if (!isMember && entitlement) {
    validUntil = entitlement.valid_until || validUntil;
    validFrom = entitlement.valid_from || validFrom;
  }

  const nowMs = Date.now();
  const vu = validUntil ? new Date(validUntil) : null;
  const daysLeft = vu ? Math.ceil((vu.getTime() - nowMs) / 86400000) : null;

  const entriesRecent = await X.Entries.listForMember(member.id, 20);
  const entriesTotal = await X.Entries.count(member.id);
  const auditRows = await X.MembershipAudit.listForMember(member.id, 10);
  const docs = await memberDocuments(member.id);

  // Poslední zaplacený příspěvek
  let lastPaid = null;
  try {
    const r = await D.raw.get(
      `SELECT MAX(paid_at) AS last_paid FROM ${TBL('payments')}
        WHERE member_id = ? AND status = 'paid' AND purpose = 'prispevek'`,
      [member.id]
    );
    lastPaid = r ? r.last_paid : null;
  } catch (err) { lastPaid = null; }

  const blocked = Number(member.blocked) === 1;

  let message;
  if (blocked) message = 'Přístup do účtu pozastaven vlastníkem — ověřte u správy spolku.';
  else if (!identityOk) message = identity.note || 'Totožnost se nepodařilo ověřit.';
  else if (ready && !ready.ready) {
    message = `Vstup zatím není možný: ${ready.blocking.map((c) => c.message || c.label).join(' ')}`.trim();
  } else if (allowed) {
    message = isMember
      ? 'Členství aktivní, dokumenty i instruktáž v pořádku, dnešní kontrola vyhovuje — vstup povolen.'
      : 'Jednorázový vstup platný, dokumenty i instruktáž v pořádku, dnešní kontrola vyhovuje — vstup povolen.';
  } else if (st === 'expired' || (vu && vu < new Date())) message = 'Členství vypršelo — vstup zamítnut.';
  else message = 'Žádné platné členství ani vstup — zamítnuto.';

  const age = X.ageFrom(member.birth_date);
  const isMinor = age !== null && age < 18;

  return {
    identity: {
      memberId: member.id,
      memberNo,
      firstName: member.first_name,
      lastName: member.last_name,
      // 5. pád — „Dobrý den, Petře“ (viz public/js/czech.js na klientu)
      fullName: `${member.first_name} ${member.last_name}`.trim(),
      email: member.email,
      phone: member.phone || '',
      birthDate: member.birth_date || null,
      age,
      minor: isMinor,
      gender: member.gender || null,
      role: member.role,
      roleLabel: ({ member: 'člen', dozor: 'dozor', vybor: 'výbor', superadmin: 'vlastník' })[member.role] || member.role,
      blocked,
      blockedReason: member.blocked_reason || null,
    },
    membership: {
      active: isMember,
      status: st,
      statusLabel: ({
        registered: 'Registrován',
        consent_pending: 'Čeká na souhlasy',
        payment_pending: 'Čeká na platbu',
        review: 'Ke schválení',
        active: 'Aktivní',
        expired: 'Vypršelo',
        rejected: 'Zamítnuto',
        deferred: 'Odloženo',
      })[st] || st,
      kind: member.membership_kind || 'sportovni',
      kindLabel: member.membership_kind === 'radne' ? 'Řádné členství' : 'Sportovní členství',
      typeLabel: member.membership_type || null,
      validFrom,
      validUntil,
      daysLeft,
      // Kdo/kde/kdy členství zapsal (požadavek na dohledatelnost)
      recorded: {
        source: member.membership_kind_source || 'app.tjkrupka.cz',
        setBy: member.membership_kind_set_by || null,
        setAt: member.membership_kind_set_at || null,
      },
      lastPaidAt: lastPaid,
      paid: !!lastPaid,
    },
    access: {
      allowed,
      reason: blocked ? 'blocked' : isMember ? 'membership' : entitlement ? 'entitlement' : 'none',
      message,
      entitlementUntil: entitlement ? entitlement.valid_until : null,
      // Tři ODDĚLENÉ skutečnosti — v UI i v protokolu se nesmějí slévat:
      documentsConfirmed: ready ? ready.statements.documentsConfirmed : false,
      instructionCompleted: ready ? ready.statements.instructionCompleted : false,
      entryAllowed: allowed,
      blocking: ready ? ready.blocking.map((c) => ({ key: c.key, label: c.label, message: c.message })) : [],
    },
    instruction: ready
      ? {
        ok: ready.instruction.ok,
        expectedVersion: ready.instruction.expectedVersion,
        title: ready.instruction.title,
        last: ready.instruction.last,
        message: ready.instruction.message,
      }
      : null,
    day: ready
      ? {
        day: ready.dayState.day,
        opened: ready.dayState.opened,
        openedAt: ready.dayState.openedAt,
        dozorName: ready.dayState.dozorName,
        verdict: ready.dayState.verdict,
        checks: ready.dayState.checks,
        defects: ready.dayState.defects,
        interrupted: ready.dayState.interrupted,
        interruptReason: ready.dayState.interruptReason,
        source: ready.dayState.source,
        message: ready.dayState.message,
      }
      : null,
    identityCheck: identity,
    entries: {
      total: entriesTotal,
      recent: entriesRecent.map((e) => ({
        at: e.created_at,
        ok: Number(e.access_ok) === 1,
        kind: e.kind,
        source: e.source,
        dozor: e.recorded_by_name || null,
        reason: e.reason || null,
      })),
    },
    documents: docs,
    documentsVerified: docs.length > 0 && docs.every((d) => d.verified),
    photo: member.photo
      ? { url: `${origin}/api/dozor/photo/${member.id}`, verified: Number(member.photo_verified) === 1 }
      : null,
    guardian: isMinor ? {
      name: member.guardian_name || null,
      relation: member.guardian_relation || null,
      email: member.guardian_email || null,
      phone: member.guardian_phone || null,
      consentStatus: member.guardian_status || 'not_required',
      grantedAt: member.guardian_granted_at || null,
      // Vazba k dítěti: elektronický odkaz ji neprokazuje — ověřuje ji dozor
      verificationMethod: ready && ready.guardian ? ready.guardian.verificationMethodDeclared : null,
      relationVerified: ready && ready.guardian ? ready.guardian.relationVerified : false,
      verification: ready && ready.guardian ? ready.guardian.verification : null,
      message: ready && ready.guardian ? ready.guardian.message : null,
    } : null,
    audit: auditRows.map((a) => ({
      action: a.action,
      kindFrom: a.kind_from,
      kindTo: a.kind_to,
      source: a.source,
      actor: a.actor_name || a.actor_email || 'systém',
      at: a.created_at,
    })),
    generatedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// DOZOR — QR kontrola
// ===========================================================================

/**
 * Načtení QR kódu dozorem. Vrací kompletní informace o členovi/nečlenovi
 * a ZÁROVEŇ zakládá záznam o vstupu (evidence pro analýzy).
 * Tělo: { qrPayload, record = true, note }
 */
router.post('/dozor/lookup', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const payload = s(b.qrPayload).trim();
  if (!payload) return res.status(400).json({ error: 'VALIDACE', message: 'Chybí QR kód.' });

  const card = await D.Cards.getByPayload(payload);
  const origin = appOrigin(req);
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();

  // ---- Neznámý QR: zaznamenat jako neúspěšný pokus a vrátit jasnou zprávu ----
  if (!card) {
    const entry = await X.Entries.add({
      person_name: s(b.personName) || 'neznámý QR',
      kind: 'neclen',
      access_ok: 0,
      reason: 'Karta nebyla nalezena.',
      source: 'qr',
      recorded_by: dozor.id,
      recorded_by_name: dozorName,
    });
    return res.status(404).json({
      error: 'NEPLATNA_KARTA',
      message: 'Karta nebyla nalezena — jde o cizí nebo neplatný QR kód.',
      entryId: entry.id,
    });
  }

  const member = await D.Members.getById(card.member_id);
  if (!member) {
    return res.status(404).json({ error: 'NEPLATNA_KARTA', message: 'Karta nepatří žádnému účtu.' });
  }

  const info = await buildMemberCard(member, {
    origin,
    refresh: b.refresh !== false,
    day: b.day ? s(b.day) : undefined,
    identityPin: b.identityPin != null ? b.identityPin : null,
  });

  // ---- Záznam o vstupu (člen i nečlen) — včetně podmínek, za kterých padl verdikt
  let entryId = null;
  if (b.record !== false) {
    const entry = await X.Entries.add({
      member_id: info.identity.memberId,
      person_name: info.identity.fullName,
      person_no: info.identity.memberNo,
      kind: info.access.reason === 'membership' ? 'clen' : info.access.reason === 'entitlement' ? 'clen' : 'neclen',
      entitlement_kind: info.access.reason,
      access_ok: info.access.allowed ? 1 : 0,
      reason: info.access.message,
      source: 'qr',
      recorded_by: dozor.id,
      recorded_by_name: dozorName,
      valid_until: info.membership.validUntil || info.access.entitlementUntil || null,
      member_kind: info.membership.kind,
      note: s(b.note),
      // snapshot podmínek vstupu (provozní řád čl. 3 + čl. 9)
      day: info.day ? info.day.day : null,
      provozni_den_id: info.day && info.day.opened ? (await X.ProvozniDen.getByDay(info.day.day))?.id || null : null,
      day_verdict: info.day ? info.day.verdict : null,
      instruction_id: info.instruction && info.instruction.last && info.instruction.ok
        ? (await X.Instructions.lastPassedFor(info.identity.memberId))?.id || null
        : null,
      instruction_ok: info.access.instructionCompleted ? 1 : 0,
      documents_ok: info.access.documentsConfirmed ? 1 : 0,
      identity_check: info.identityCheck.method,
      blocking: info.access.blocking && info.access.blocking.length
        ? JSON.stringify(info.access.blocking.map((x) => x.message || x.label))
        : (info.access.allowed ? '' : ''),
    });
    entryId = entry.id;
    info.entries.total += 1;
    info.entries.recent.unshift({
      at: entry.created_at,
      ok: info.access.allowed,
      kind: entry.kind,
      source: 'qr',
      dozor: dozorName,
      reason: entry.reason,
    });
  }

  res.json({ ok: info.access.allowed, entryId, card: info });
}));

/**
 * Manuální záznam vstupu (host bez QR, dohodnutá návštěva, offline zápis).
 * POZOR: i ruční záznam podléhá provozním podmínkám — bez zaznamenané
 * vyhovující denní kontroly a otevřeného provozu se vstup NEPOVOLÍ (jen se
 * eviduje zamítnutý pokus). Tělo: { personName, kind, note, identityCheck,
 * identityDoc, override?, overrideReason?, source?, offlineRef?, at? }
 */
router.post('/dozor/entry', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = s(b.personName).trim();
  if (!name) return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte jméno návštěvníka.' });
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const dayState = await R.operationalDayState(b.day ? s(b.day) : undefined);
  const override = b.override === true && s(b.overrideReason).trim().length >= 5;
  const allowed = dayState.ok || override;
  const reason = allowed
    ? (override && !dayState.ok
      ? `Výjimka dozoru při nesplněné denní kontrole: ${s(b.overrideReason)}`
      : 'Ruční záznam dozoru.')
    : dayState.message || 'Vstup není možný — chybí vyhovující denní kontrola.';
  const entry = await X.Entries.add({
    member_id: b.memberId || null,
    person_name: name,
    person_no: b.memberNo || null,
    kind: b.kind === 'clen' ? 'clen' : 'neclen',
    entitlement_kind: b.entitlementKind || null,
    access_ok: allowed ? 1 : 0,
    reason,
    source: s(b.source) || 'manual',
    recorded_by: dozor.id,
    recorded_by_name: dozorName,
    note: s(b.note),
    day: dayState.day,
    day_verdict: dayState.verdict,
    identity_check: s(b.identityCheck) || 'manual+doklad',
    blocking: allowed ? '' : JSON.stringify([reason]),
  });
  if (!allowed) {
    return res.status(409).json({
      error: 'PROVOZ_NEPRIPRAVEN',
      message: reason,
      entryId: entry.id,
      day: { day: dayState.day, opened: dayState.opened, verdict: dayState.verdict },
      hint: 'Nejprve v Provozní knize otevřete provozní den se zaznamenanou vyhovující kontrolou.',
    });
  }
  res.json({ ok: true, entry, day: { day: dayState.day, verdict: dayState.verdict, openedAt: dayState.openedAt } });
}));

// ===========================================================================
// PROVOZNÍ KNIHA (provozní den, kontroly, závady, přerušení, mimořádné události)
// ===========================================================================

/** Stav provozního dne + jeho záznamy (co má dozor před sebou). */
router.get('/dozor/provozni-den', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const day = req.query.day ? s(req.query.day) : R.dayOf();
  const row = await X.ProvozniDen.getByDay(day);
  const zaznamy = await X.ProvozniZaznamy.listForDay(day);
  const kontroly = row ? X.checkVerdict(row) : null;
  // Jediný zdroj pravdy pro „je vstup možný“ = readiness.operationalDayState
  // (zahrnuje i ukončený den a přerušení) — nesmí se počítat na dvou místech.
  const state = await R.operationalDayState(day);
  res.json({
    day,
    exists: !!row,
    opened: state.opened,
    openedAt: state.openedAt,
    dozorName: state.dozorName,
    verdict: state.verdict,
    verdictNote: row ? row.verdict_note : '',
    checks: kontroly ? kontroly.items : null,
    checkNote: row ? row.check_note : '',
    defects: row ? row.defects : '',
    interrupted: state.interrupted,
    interruptedAt: state.interruptedAt,
    interruptReason: state.interruptReason,
    resumedAt: row ? row.resumed_at : null,
    closed: state.closed,
    closedAt: state.closedAt,
    source: row ? row.source : null,
    entryAllowed: state.ok,
    entryMessage: state.message,
    records: zaznamy.map((z) => ({
      id: z.id, type: z.type, text: z.text, severity: z.severity,
      dozor: z.dozor_name, at: z.at, source: z.source, offline: z.source === 'offline',
    })),
    instructionsToday: await X.Instructions.count(day),
  });
}));

/**
 * OTEVŘENÍ / AKTUALIZACE PROVOZNÍHO DNE (denní kontrola zařízení).
 * Dokud kontrola nevyhovuje, aplikace vstup nepovolí.
 * Tělo: { day?, mattress, pressure, anchoring, ramp, surroundings,
 *         checkNote, defects, dozorPresent, source?, offlineRef?, at? }
 */
router.post('/dozor/provozni-den', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const day = b.day ? s(b.day) : R.dayOf();
  const norm = (v) => (['ok', 'zavada', 'neprovedeno'].includes(s(v)) ? s(v) : 'neprovedeno');
  const checks = {
    check_mattress: norm(b.mattress),
    check_pressure: norm(b.pressure),
    check_anchoring: norm(b.anchoring),
    check_ramp: norm(b.ramp),
    check_surroundings: norm(b.surroundings),
  };
  const row = await X.ProvozniDen.open({
    day,
    dozor_id: dozor.id,
    dozor_name: dozorName,
    dozor_present: b.dozorPresent !== false,
    ...checks,
    check_note: s(b.checkNote),
    defects: s(b.defects),
    verdict_note: s(b.verdictNote),
    source: s(b.source) || 'app',
    offline_ref: s(b.offlineRef) || null,
    synced_at: s(b.source) === 'offline' ? D.now() : null,
    at: s(b.at) || undefined,
  });
  const verdict = X.checkVerdict(row);
  await X.ProvozniZaznamy.add({
    provozni_den_id: row.id,
    day,
    type: 'kontrola',
    text: `Denní kontrola: ${verdict.items.map((i) => `${i.label} = ${i.value}`).join(', ')}${s(b.checkNote) ? ` — ${s(b.checkNote)}` : ''}. Verdikt: ${verdict.verdict}.`,
    severity: verdict.verdict === 'vyhovuje' ? 'info' : 'critical',
    dozor_id: dozor.id,
    dozor_name: dozorName,
    at: s(b.at) || undefined,
    source: s(b.source) || 'app',
    offline_ref: s(b.offlineRef) || null,
  });
  if (verdict.verdict !== 'vyhovuje') {
    await X.ProvozniZaznamy.add({
      provozni_den_id: row.id,
      day,
      type: 'zavada',
      text: s(b.defects) || verdict.items.filter((i) => i.value === 'zavada').map((i) => `${i.label}: závada`).join(', ') || 'Kontrola nevyhovuje — provoz nezahájen.',
      severity: 'critical',
      dozor_id: dozor.id,
      dozor_name: dozorName,
      at: s(b.at) || undefined,
      source: s(b.source) || 'app',
    });
  } else {
    await X.ProvozniZaznamy.add({
      provozni_den_id: row.id,
      day,
      type: 'otevreni',
      text: `Provoz otevřen dozorem ${dozorName} (potvrzena přítomnost dozoru).`,
      dozor_id: dozor.id,
      dozor_name: dozorName,
      at: s(b.at) || undefined,
      source: s(b.source) || 'app',
    });
  }
  res.json({
    ok: true,
    day,
    verdict: verdict.verdict,
    entryAllowed: verdict.verdict === 'vyhovuje',
    checks: verdict.items,
    message: verdict.verdict === 'vyhovuje'
      ? 'Kontrola vyhovuje — provoz je otevřen, vstupy lze povolit.'
      : 'Kontrola NEVYHOVUJE — provoz nezahajujte a závadu odstraňte.',
    row,
  });
}));

/** Přerušení / obnovení provozu. Tělo: { action: 'interrupt'|'resume', reason|note, day?, source?, at? } */
router.post('/dozor/provozni-den/preruseni', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const day = b.day ? s(b.day) : R.dayOf();
  const row = await X.ProvozniDen.getByDay(day);
  if (!row) return res.status(409).json({ error: 'DEN_NEEXISTUJE', message: 'Provozní den není otevřen.' });
  const action = b.action === 'resume' ? 'resume' : 'interrupt';
  if (action === 'interrupt') {
    if (!s(b.reason).trim()) return res.status(400).json({ error: 'VALIDACE', message: 'Uveďte důvod přerušení provozu.' });
    await X.ProvozniDen.interrupt(row.id, { reason: s(b.reason), at: s(b.at) || undefined, dozorName });
    await X.ProvozniZaznamy.add({
      provozni_den_id: row.id, day, type: 'preruseni', text: s(b.reason), severity: 'warning',
      dozor_id: dozor.id, dozor_name: dozorName, at: s(b.at) || undefined, source: s(b.source) || 'app',
    });
  } else {
    await X.ProvozniDen.resume(row.id, { note: s(b.note), at: s(b.at) || undefined, dozorName });
    await X.ProvozniZaznamy.add({
      provozni_den_id: row.id, day, type: 'obnoveni', text: s(b.note) || 'Provoz obnoven.', severity: 'info',
      dozor_id: dozor.id, dozor_name: dozorName, at: s(b.at) || undefined, source: s(b.source) || 'app',
    });
  }
  const fresh = await X.ProvozniDen.getById(row.id);
  res.json({
    ok: true,
    interrupted: !!(fresh.interrupted_at && !fresh.resumed_at),
    interruptedAt: fresh.interrupted_at,
    interruptReason: fresh.interrupt_reason,
    resumedAt: fresh.resumed_at,
    entryAllowed: fresh.verdict === 'vyhovuje' && !(fresh.interrupted_at && !fresh.resumed_at),
  });
}));

/** Ukončení provozního dne. */
router.post('/dozor/provozni-den/ukonceni', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const day = b.day ? s(b.day) : R.dayOf();
  const row = await X.ProvozniDen.getByDay(day);
  if (!row) return res.status(409).json({ error: 'DEN_NEEXISTUJE', message: 'Provozní den není otevřen.' });
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  await X.ProvozniDen.close(row.id);
  await X.ProvozniZaznamy.add({
    provozni_den_id: row.id, day, type: 'ukonceni',
    text: s(b.note) || `Provoz ukončen dozorem ${dozorName}.`, severity: 'info',
    dozor_id: dozor.id, dozor_name: dozorName, source: s(b.source) || 'app',
  });
  res.json({ ok: true, closedAt: D.now() });
}));

/** Obecný záznam do provozní knihy (mimořádná událost, poznámka, závada…). */
router.post('/dozor/provozni-den/zaznam', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const text = s(b.text).trim();
  if (!text) return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte text záznamu.' });
  const type = ['mimoradna_udalost', 'zavada', 'poznamka', 'preruseni', 'obnoveni', 'ukonceni', 'instruktaz', 'vstup', 'kontrola', 'otevreni'].includes(s(b.type))
    ? s(b.type)
    : 'poznamka';
  const day = b.day ? s(b.day) : R.dayOf();
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const row = await X.ProvozniDen.getByDay(day);
  const zaznam = await X.ProvozniZaznamy.add({
    provozni_den_id: row ? row.id : null,
    day,
    type,
    text,
    severity: ['mimoradna_udalost', 'zavada'].includes(type) ? 'critical' : s(b.severity) || 'info',
    dozor_id: dozor.id,
    dozor_name: dozorName,
    at: s(b.at) || undefined,
    source: s(b.source) || 'app',
    offline_ref: s(b.offlineRef) || null,
    synced_at: s(b.source) === 'offline' ? D.now() : null,
  });
  res.json({ ok: true, record: zaznam });
}));

/** Výpis provozní knihy za poslední dny (pro dozora i pro tisk). */
router.get('/dozor/provozni-kniha', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
  const rows = await X.ProvozniDen.recent(days);
  const out = [];
  for (const r of rows) {
    const v = X.checkVerdict(r);
    out.push({
      day: r.day,
      dozorName: r.dozor_name,
      openedAt: r.opened_at,
      verdict: r.verdict,
      checks: v.items,
      checkNote: r.check_note,
      defects: r.defects,
      interruptedAt: r.interrupted_at,
      interruptReason: r.interrupt_reason,
      resumedAt: r.resumed_at,
      closedAt: r.closed_at,
      source: r.source,
      offline: r.source === 'offline',
      records: (await X.ProvozniZaznamy.listForDay(r.day)).map((z) => ({
        type: z.type, text: z.text, severity: z.severity, dozor: z.dozor_name, at: z.at, source: z.source,
      })),
      instructions: await X.Instructions.count(r.day),
    });
  }
  res.json({ days, count: out.length, book: out });
}));

// ===========================================================================
// PRAKTICKÁ INSTRUKTÁŽ (zaznamenává POVĚŘENÝ DOZOR až po instruktáži)
// ===========================================================================

/**
 * Záznam o praktické instruktáži. NENÍ to potvrzení dokumentů: účastník se
 * tímto dostane do stavu „absolvovaná instruktáž“, který je podmínkou vstupu.
 * Tělo: { memberId, participantName?, result: 'absolvoval'|'neabsolvoval',
 *         reason?, note?, day?, at?, source?, offlineRef? }
 */
router.post('/dozor/instruction', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const result = b.result === 'neabsolvoval' ? 'neabsolvoval' : 'absolvoval';
  const doc = await D.DocVersions.latest(R.INSTRUCTION_DOC_KEY);
  if (!doc) return res.status(500).json({ error: 'CHYBI_INSTRUKTACE', message: 'Verze instruktáže není v systému.' });
  if (result === 'neabsolvoval' && !s(b.reason).trim()) {
    return res.status(400).json({ error: 'VALIDACE', message: 'U výsledku „neabsolvoval“ uveďte důvod.' });
  }

  let member = null;
  if (b.memberId) {
    member = await D.Members.getById(b.memberId);
    if (!member) return res.status(404).json({ error: 'NENALEZENO', message: 'Účastník nebyl nalezen.' });
  }
  const name = member
    ? `${member.first_name} ${member.last_name}`.trim()
    : s(b.participantName).trim();
  if (!name) return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte účastníka instruktáže (člena nebo hosta).' });

  // U hosta bez účtu se připouští jen záznam s alespoň jménem (evidence dozoru).
  const age = member ? X.ageFrom(member.birth_date) : null;
  const rec = await X.Instructions.add({
    member_id: member ? member.id : null,
    participant_name: name,
    participant_no: member ? member.member_no : (b.participantNo || null),
    participant_birth: member ? member.birth_date : null,
    is_minor: age !== null && age < 18 ? 1 : 0,
    dozor_id: dozor.id,
    dozor_name: dozorName,
    dozor_role: dozor.role,
    instructed_at: s(b.at) || D.now(),
    doc_key: R.INSTRUCTION_DOC_KEY,
    doc_version: doc.version,
    content_hash: doc.content_hash,
    result,
    reason: s(b.reason),
    note: s(b.note),
    source: s(b.source) || 'app',
    offline_ref: s(b.offlineRef) || null,
    synced_at: s(b.source) === 'offline' ? D.now() : null,
  });

  // Zápis do provozní knihy (instruktáž je provozní skutečnost).
  const day = s(b.day) || R.dayOf(rec.instructed_at);
  const dayRow = await X.ProvozniDen.getByDay(day);
  await X.ProvozniZaznamy.add({
    provozni_den_id: dayRow ? dayRow.id : null,
    day,
    type: 'instruktaz',
    text: `Instruktáž ${result === 'absolvoval' ? 'absolvována' : 'NEabsolvována'}: ${name}${s(b.reason) ? ` — ${s(b.reason)}` : ''} (dozor ${dozorName}, verze instruktáže ${doc.version}).`,
    severity: result === 'absolvoval' ? 'info' : 'warning',
    dozor_id: dozor.id,
    dozor_name: dozorName,
    at: rec.instructed_at,
    source: s(b.source) || 'app',
    offline_ref: s(b.offlineRef) || null,
  });

  const ready = member ? await R.readiness(member, { day }) : null;
  res.json({
    ok: true,
    instruction: {
      id: rec.id,
      memberId: rec.member_id,
      participantName: rec.participant_name,
      dozor: rec.dozor_name,
      instructedAt: rec.instructed_at,
      docVersion: rec.doc_version,
      docKey: rec.doc_key,
      contentHash: rec.content_hash,
      result: rec.result,
      source: rec.source,
    },
    documentsConfirmed: ready ? ready.statements.documentsConfirmed : false,
    instructionCompleted: ready ? ready.statements.instructionCompleted : result === 'absolvoval',
    entryAllowed: ready ? ready.ready : null,
    blocking: ready ? ready.blocking.map((x) => ({ key: x.key, label: x.label, message: x.message })) : [],
    note: 'Instruktáž je samostatný záznam — potvrzení dokumentů v aplikaci ji nenahrazuje.',
  });
}));

/** Výpis instruktáží (účastníka nebo dne). */
router.get('/dozor/instructions', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const memberId = s(req.query.memberId);
  const day = s(req.query.day);
  const rows = memberId
    ? await X.Instructions.listForMember(memberId, 50)
    : day
      ? await X.Instructions.listForDay(day)
      : await X.Instructions.recent(100);
  res.json({
    count: rows.length,
    instructions: rows.map((r) => ({
      id: r.id,
      memberId: r.member_id,
      participantName: r.participant_name,
      participantNo: r.participant_no,
      dozor: r.dozor_name,
      instructedAt: r.instructed_at,
      recordedAt: r.recorded_at,
      docKey: r.doc_key,
      docVersion: r.doc_version,
      result: r.result,
      reason: r.reason,
      source: r.source,
      offline: r.source === 'offline',
    })),
  });
}));

// ===========================================================================
// OVĚŘENÍ VAZBY ZÁKONNÉHO ZÁSTUPCE (u nezletilých) — ověřuje DOZOR na místě
// ===========================================================================

/**
 * Dozor zapisuje, že ověřil vazbu zákonného zástupce k nezletilému podle dokladu.
 * Bez tohoto záznamu nezletilý na zařízení nevstoupí (elektronický odkaz vztah
 * k dítěti neprokazuje).
 * Tělo: { memberId, method, methodNote?, at?, source? }
 */
router.post('/dozor/guardian-verify', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const memberId = s(b.memberId);
  if (!memberId) return res.status(400).json({ error: 'VALIDACE', message: 'Chybí účastník (memberId).' });
  const member = await D.Members.getById(memberId);
  if (!member) return res.status(404).json({ error: 'NENALEZENO', message: 'Nezletilý účastník nebyl nalezen.' });
  const method = ['rodny_list', 'doklad_totoznosti', 'pribuzensky_doklad', 'jine'].includes(s(b.method)) ? s(b.method) : null;
  if (!method) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Uveďte způsob ověření (rodný list / doklad totožnosti / jiný doklad).' });
  }
  if (member.guardian_status !== 'granted') {
    return res.status(409).json({
      error: 'CHYBI_SOUHLAS',
      message: 'Zákonný zástupce nejprve musí udělit souhlas s účastí (e-mailem), teprve pak lze ověřit vazbu k dítěti.',
    });
  }
  const dozor = req.member;
  const dozorName = `${dozor.first_name} ${dozor.last_name}`.trim();
  const rec = await X.GuardianVerifications.add({
    member_id: member.id,
    child_name: `${member.first_name} ${member.last_name}`.trim(),
    guardian_name: member.guardian_name || '',
    guardian_relation: member.guardian_relation || '',
    method,
    method_note: s(b.methodNote),
    verified_by: dozor.id,
    verified_by_name: dozorName,
    verified_at: s(b.at) || D.now(),
    source: s(b.source) || 'app',
  });
  await D.Members.update(member.id, {
    guardian_verified_method: method,
    guardian_verified_by: dozor.id,
    guardian_verified_at: rec.verified_at,
    guardian_verified_note: s(b.methodNote) || `Vazba ověřena dozorem ${dozorName} (${method}).`,
  });
  const methodLabel = ({
    rodny_list: 'rodný list',
    doklad_totoznosti: 'doklad totožnosti',
    pribuzensky_doklad: 'doklad o příbuzenském vztahu',
    jine: 'jiný doklad',
  })[method];
  const day = s(b.day) || R.dayOf();
  const dayRow = await X.ProvozniDen.getByDay(day);
  await X.ProvozniZaznamy.add({
    provozni_den_id: dayRow ? dayRow.id : null,
    day,
    type: 'poznamka',
    text: `Ověřena vazba zákonného zástupce (${member.guardian_name || 'neuvedeno'}) k nezletilému ${rec.child_name} podle dokladu: ${methodLabel}. Ověřil ${dozorName}.`,
    severity: 'info',
    dozor_id: dozor.id,
    dozor_name: dozorName,
    at: rec.verified_at,
    source: s(b.source) || 'app',
  });
  const ready = await R.readiness(member, { day });
  res.json({
    ok: true,
    verification: {
      method,
      methodLabel,
      note: rec.method_note,
      by: dozorName,
      at: rec.verified_at,
    },
    entryAllowed: ready.ready,
    blocking: ready.blocking.map((x) => ({ key: x.key, label: x.label, message: x.message })),
  });
}));

/** Poslední vstupy — přehled dozora na směně. */
router.get('/dozor/entries', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const rows = await X.Entries.recent(limit, s(req.query.facility) || null);
  res.json({
    count: rows.length,
    entries: rows.map((e) => ({
      id: e.id,
      at: e.created_at,
      name: e.person_name,
      memberNo: e.person_no,
      kind: e.kind,
      ok: Number(e.access_ok) === 1,
      reason: e.reason,
      source: e.source,
      dozor: e.recorded_by_name,
    })),
  });
}));

/** Souhrn vstupů za období (dny) — podklad pro analýzy a grafy. */
router.get('/dozor/entries/summary', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const [summary, byDay, top] = await Promise.all([
    X.Entries.summary(since),
    X.Entries.byDay(days),
    X.Entries.topMember(),
  ]);
  res.json({ summary, byDay, topMember: top });
}));

/** Fotografie člena pro vizuální kontrolu dozorem. */
router.get('/dozor/photo/:memberId', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.memberId);
  if (!m || !m.photo) return res.status(404).json({ error: 'BEZ_FOTOGRAFIE', message: 'Člen nemá fotografii.' });
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(m.photo);
  if (!match) return res.status(415).json({ error: 'NEPODPOROVANY_FORMAT' });
  const buf = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}));

// ===========================================================================
// POZVÁNKA DOZORA — veřejné (token v odkazu z e-mailu)
// ===========================================================================

/** Ověření pozvánky před vytvořením účtu (co uvidí pozvaný při otevření odkazu). */
router.get('/dozor/invite/:token', asyncRoute(async (req, res) => {
  const inv = await X.DozorInvites.getByToken(req.params.token);
  if (!inv) return res.status(404).json({ error: 'NEZNAMA_POZVANKA', message: 'Odkaz není platný.' });
  const status = X.DozorInvites.status(inv);
  const existing = await D.Members.getByEmail(inv.email);
  res.json({
    ok: status === 'ceka',
    status,
    email: inv.email,
    firstName: inv.first_name,
    lastName: inv.last_name,
    expiresAt: inv.expires_at,
    hasAccount: !!existing,
    message: ({
      ceka: 'Pozvánka je platná — dokončete vytvoření účtu dozoru.',
      vyuzita: 'Pozvánka už byla použita. Přihlaste se nebo požádejte o novou.',
      zrusena: 'Pozvánka byla vlastníkem zrušena.',
      expirovana: 'Platnost pozvánky vypršela — požádejte vlastníka o novou.',
    })[status] || 'Pozvánka není platná.',
  });
}));

/** Vytvoření účtu dozoru z pozvánky (jméno, příjmení, telefon, heslo). */
router.post('/dozor/invite/:token/accept', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const inv = await X.DozorInvites.getByToken(req.params.token);
  if (!inv) return res.status(404).json({ error: 'NEZNAMA_POZVANKA', message: 'Odkaz není platný.' });
  const status = X.DozorInvites.status(inv);
  if (status !== 'ceka') {
    return res.status(409).json({ error: 'POZVANKA_NEPLATNA', message: 'Pozvánka už není platná.' });
  }
  const password = s(b.password);
  if (password.length < 8) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Heslo musí mít alespoň 8 znaků.' });
  }
  const firstName = s(b.firstName) || inv.first_name;
  const lastName = s(b.lastName) || inv.last_name;
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte jméno a příjmení.' });
  }

  const passwordLib = require('./password');

  // Účet už může existovat (např. člen, kterému vlastník rozšiřuje práva)
  let member = await D.Members.getByEmail(inv.email);
  if (member) {
    await D.Members.update(member.id, {
      role: 'dozor',
      password_hash: passwordLib.hash(password),
      dozor_granted_at: D.now(),
      dozor_granted_by: inv.invited_by || A.SUPERADMIN_EMAIL,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(s(b.phone) ? { phone: s(b.phone) } : {}),
    });
  } else {
    member = await D.Members.create({
      memberNo: await D.Members.nextMemberNo(),
      firstName,
      lastName,
      birthDate: s(b.birthDate) || '1900-01-01',
      street: s(b.street),
      city: s(b.city),
      zip: s(b.zip),
      email: inv.email,
      phone: s(b.phone) || inv.phone || '',
      // POZOR: membership_type má cizí klíč na member_types(code), takže musí být
      // platný kód. Dozor NEMUSÍ být člen — proto zakládáme účet s běžnou
      // kategorií, ale BEZ zaplaceného členství: v evidenci se pak počítá jako
      // „nečlen s právy dozoru“ (membership.active = false, přístup má z role).
      membershipType: 'dospele',
      membershipKind: 'sportovni',
      passwordHash: passwordLib.hash(password),
      status: 'active',
    });
    await D.Members.update(member.id, {
      role: 'dozor',
      dozor_granted_at: D.now(),
      dozor_granted_by: inv.invited_by || A.SUPERADMIN_EMAIL,
    });
  }

  await X.DozorInvites.markUsed(inv.id);
  await X.MembershipAudit.add({
    member_id: member.id,
    action: 'created',
    kind_to: 'sportovni',
    status_to: 'active',
    source: 'app.tjkrupka.cz',
    actor_email: inv.invited_by || A.SUPERADMIN_EMAIL,
    actor_name: 'pozvánka dozoru',
    note: `Účet dozoru vytvořen z pozvánky (${inv.email}).`,
  });

  res.json({ ok: true, email: inv.email, message: 'Účet dozoru je vytvořen. Přihlaste se e-mailem a heslem.' });
}));

// ===========================================================================
// SUPERADMIN — přehled členské základny
// ===========================================================================

/** Kompletní aktuální přehled členské základny (jen vlastník). */
router.get('/superadmin/overview', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const overview = await X.memberOverview();
  res.json(overview);
}));

/** Historie zápisů členství (kdo/kde/kdy) — auditní stopa. */
router.get('/superadmin/audit', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const rows = await X.MembershipAudit.recent(limit);
  res.json({ count: rows.length, audit: rows });
}));

/** Historie členství jednoho člena. */
router.get('/superadmin/members/:id/audit', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  res.json({ audit: await X.MembershipAudit.listForMember(req.params.id, 100) });
}));

/**
 * Upozornění na nezaplacený členský příspěvek — e-mailem, s odkazem na platbu.
 * Tělo: { memberIds?: [id], all?: true, dryRun?: true }
 */
router.post('/superadmin/unpaid/notify', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const overview = await X.memberOverview();
  let targets = overview.unpaid;
  if (Array.isArray(b.memberIds) && b.memberIds.length) {
    const set = new Set(b.memberIds.map(String));
    targets = targets.filter((u) => set.has(String(u.id)));
  }
  if (!targets.length) {
    return res.json({ ok: true, sent: 0, message: 'Žádný člen s nezaplaceným příspěvkem.' });
  }
  if (b.dryRun) {
    return res.json({ ok: true, dryRun: true, wouldSend: targets.length, targets });
  }
  const origin = appOrigin(req);
  const payLink = `${origin}/#/platba`;
  let sent = 0;
  const errors = [];
  for (const u of targets) {
    try {
      const subject = 'Členský příspěvek TJ Krupka — výzva k úhradě';
      const body = [
        `Dobrý den,`,
        ``,
        `v naší evidenci nemáte uhrazený členský příspěvek na aktuální období`
          + (u.validUntil ? ` (členství platné do ${String(u.validUntil).slice(0, 10)})` : '')
          + `.`,
        ``,
        `Členský příspěvek uhradíte po přihlášení do členské aplikace:`,
        payLink,
        ``,
        `Pokud jste příspěvek už platil(a) a jde o omyl, odpovězte prosím na tento e-mail.`,
        ``,
        `Děkujeme,`,
        `Tělovýchovná jednota Krupka, z.s.`,
      ].join('\n');
      await mailer.sendEmail(u.id, u.email, subject, body);
      sent++;
    } catch (err) {
      errors.push({ id: u.id, email: u.email, error: err.message });
    }
  }
  res.json({ ok: true, sent, failed: errors.length, errors, link: payLink });
}));

// ===========================================================================
// SUPERADMIN — správa účtů DOZORU
// ===========================================================================

/** Seznam účtů dozoru + pozvánek. */
router.get('/superadmin/dozor', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const members = await D.raw.all(
    `SELECT id, member_no, first_name, last_name, email, phone, role, status,
            blocked, dozor_granted_at, dozor_granted_by, created_at
       FROM ${TBL('members')}
      WHERE role IN ('dozor','vybor','superadmin')
      ORDER BY role, last_name`
  );
  const invites = await X.DozorInvites.list();
  res.json({
    accounts: members.map((m) => ({
      id: m.id,
      memberNo: m.member_no,
      name: `${m.first_name} ${m.last_name}`.trim(),
      email: m.email,
      phone: m.phone || '',
      role: m.role,
      roleLabel: ({ dozor: 'Dozor', vybor: 'Výbor', superadmin: 'Vlastník' })[m.role] || m.role,
      status: m.status,
      blocked: Number(m.blocked) === 1,
      grantedAt: m.dozor_granted_at,
      grantedBy: m.dozor_granted_by,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      name: `${i.first_name} ${i.last_name}`.trim(),
      status: X.DozorInvites.status(i),
      expiresAt: i.expires_at,
      usedAt: i.used_at,
      revokedAt: i.revoked_at,
      createdAt: i.created_at,
    })),
    inviteDays: X.DOZOR_INVITE_DAYS,
  });
}));

/** Vytvoření pozvánky pro nový účet dozoru + odeslání odkazu e-mailem. */
router.post('/superadmin/dozor/invite', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const email = s(b.email).trim().toLowerCase();
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte platný e-mail dozora.' });
  }
  // Zrušit starší nevyčerpané pozvánky na stejný e-mail (ať je vždy jen jedna platná)
  const existing = await X.DozorInvites.activeByEmail(email);
  if (existing) await X.DozorInvites.revoke(existing.id);

  const inv = await X.DozorInvites.create({
    email,
    first_name: s(b.firstName),
    last_name: s(b.lastName),
    phone: s(b.phone),
    invited_by: req.member.email,
    note: s(b.note),
  });

  const origin = appOrigin(req);
  const link = `${origin}/#/dozor-pozvanka/${inv.token}`;

  let mailSent = false;
  let mailError = null;
  try {
    await mailer.sendEmail(
      req.member.id,
      email,
      'Pozvánka dozoru — členská aplikace TJ Krupka',
      [
        `Dobrý den,`,
        ``,
        `${req.member.first_name} ${req.member.last_name} Vám zakládá přístup DOZORU`
          + ` do členské aplikace Tělovýchovné jednoty Krupka.`,
        ``,
        `Odkaz pro vytvoření účtu (platnost ${X.DOZOR_INVITE_DAYS} dní):`,
        link,
        ``,
        `V účtu dozoru budete moci načítat QR kódy a zobrazovat údaje o členech`,
        `i nečlenech (stav členství, platnost, historii vstupů).`,
        ``,
        `Pokud odkaz vyprší, požádejte o nový.`,
        ``,
        `Tělovýchovná jednota Krupka, z.s.`,
      ].join('\n')
    );
    mailSent = true;
  } catch (err) {
    mailError = err.message;
    console.error('[dozor] pozvánku se nepodařilo odeslat:', err.message);
  }

  res.json({ ok: true, invite: { id: inv.id, email: inv.email, expiresAt: inv.expires_at }, link, mailSent, mailError });
}));

/** Znovuodeslání pozvánky (nový token, stejný e-mail). */
router.post('/superadmin/dozor/invite/:id/resend', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const inv = await X.DozorInvites.getById(req.params.id);
  if (!inv) return res.status(404).json({ error: 'NENALEZENO' });
  await X.DozorInvites.revoke(inv.id);
  const fresh = await X.DozorInvites.create({
    email: inv.email,
    first_name: inv.first_name,
    last_name: inv.last_name,
    phone: inv.phone,
    invited_by: req.member.email,
    note: 'Opakované odeslání pozvánky.',
  });
  const origin = appOrigin(req);
  const link = `${origin}/#/dozor-pozvanka/${fresh.token}`;
  let mailSent = false;
  try {
    await mailer.sendEmail(
      req.member.id,
      fresh.email,
      'Pozvánka dozoru (opakovaně) — členská aplikace TJ Krupka',
      `Dobrý den,\n\nzasíláme nový odkaz pro vytvoření účtu dozoru (platnost ${X.DOZOR_INVITE_DAYS} dní):\n${link}\n\nTělovýchovná jednota Krupka, z.s.`
    );
    mailSent = true;
  } catch (err) { /* vrátíme link i tak */ }
  res.json({ ok: true, invite: { id: fresh.id, email: fresh.email, expiresAt: fresh.expires_at }, link, mailSent });
}));

/** Zrušení pozvánky. */
router.post('/superadmin/dozor/invite/:id/revoke', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const inv = await X.DozorInvites.getById(req.params.id);
  if (!inv) return res.status(404).json({ error: 'NENALEZENO' });
  await X.DozorInvites.revoke(inv.id);
  res.json({ ok: true, message: 'Pozvánka zrušena.' });
}));

/**
 * Rozšíření STÁVAJÍCÍHO účtu (člena i nečlena) o funkce dozoru.
 * Superadmin tak může z člena udělat dozora, aniž by zakládal nový účet.
 */
router.post('/superadmin/dozor/grant/:memberId', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'NENALEZENO', message: 'Účet nenalezen.' });
  if (m.role === 'superadmin') {
    return res.status(400).json({ error: 'VALIDACE', message: 'Vlastníkovi nelze měnit roli.' });
  }
  await D.Members.update(m.id, {
    role: 'dozor',
    dozor_granted_at: D.now(),
    dozor_granted_by: req.member.email,
  });
  await X.MembershipAudit.add({
    member_id: m.id,
    action: 'kind_changed',
    kind_from: m.membership_kind,
    kind_to: m.membership_kind,
    status_from: m.status,
    status_to: m.status,
    source: 'app.tjkrupka.cz',
    actor_email: req.member.email,
    actor_id: req.member.id,
    actor_name: `${req.member.first_name} ${req.member.last_name}`.trim(),
    note: 'Účtu rozšířena práva DOZORU.',
  });
  res.json({ ok: true, message: `Účet ${m.email} má nyní práva dozoru.` });
}));

/** Odebrání funkce dozoru (účet se neruší, vrací se na běžného člena). */
router.post('/superadmin/dozor/revoke/:memberId', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  if (m.role === 'superadmin') {
    return res.status(400).json({ error: 'VALIDACE', message: 'Vlastníkovi nelze odebrat roli.' });
  }
  await D.Members.update(m.id, { role: 'member', dozor_granted_at: null, dozor_granted_by: null });
  await X.MembershipAudit.add({
    member_id: m.id,
    action: 'kind_changed',
    source: 'app.tjkrupka.cz',
    actor_email: req.member.email,
    actor_id: req.member.id,
    actor_name: `${req.member.first_name} ${req.member.last_name}`.trim(),
    note: 'Funkce DOZORU odebrána.',
  });
  res.json({ ok: true, message: `Účtu ${m.email} byla funkce dozoru odebrána.` });
}));

// ===========================================================================
// SUPERADMIN — přístup do účtu (zrušit / obnovit) + typ členství
// ===========================================================================

/** Pozastavení přístupu do účtu (blokace) — superadmin, kdykoliv. */
router.post('/superadmin/members/:id/block', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  if (m.role === 'superadmin') {
    return res.status(400).json({ error: 'VALIDACE', message: 'Vlastníkovi nelze zablokovat přístup.' });
  }
  const reason = s((req.body || {}).reason) || 'Pozastaveno vlastníkem aplikace.';
  await D.Members.update(m.id, { blocked: 1, blocked_at: D.now(), blocked_reason: reason });
  await X.MembershipAudit.add({
    member_id: m.id, action: 'blocked', status_from: m.status, status_to: m.status,
    source: 'app.tjkrupka.cz', actor_email: req.member.email, actor_id: req.member.id,
    actor_name: `${req.member.first_name} ${req.member.last_name}`.trim(), note: reason,
  });
  res.json({ ok: true, message: `Přístup do účtu ${m.email} pozastaven.` });
}));

/** Obnovení přístupu do účtu. */
router.post('/superadmin/members/:id/unblock', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  await D.Members.update(m.id, { blocked: 0, blocked_at: null, blocked_reason: null });
  await X.MembershipAudit.add({
    member_id: m.id, action: 'unblocked', source: 'app.tjkrupka.cz',
    actor_email: req.member.email, actor_id: req.member.id,
    actor_name: `${req.member.first_name} ${req.member.last_name}`.trim(),
    note: 'Přístup do účtu obnoven.',
  });
  res.json({ ok: true, message: `Přístup do účtu ${m.email} obnoven.` });
}));

/**
 * Změna typu členství (sportovní ↔ řádné) u účtu v aplikaci.
 * Řádné členství NIKDY nevzniká automaticky — jen tímto explicitním krokem,
 * a proto se vždy zapisuje kdo/kde/kdy (membership_audit).
 */
router.patch('/superadmin/members/:id/membership-kind', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  const kind = s((req.body || {}).kind);
  if (!['radne', 'sportovni'].includes(kind)) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Typ členství musí být „radne“ nebo „sportovni“.' });
  }
  const actor = `${req.member.first_name} ${req.member.last_name}`.trim();
  await D.Members.update(m.id, {
    membership_kind: kind,
    membership_kind_source: 'app.tjkrupka.cz',
    membership_kind_set_by: req.member.email,
    membership_kind_set_at: D.now(),
  });
  await X.MembershipAudit.add({
    member_id: m.id, action: 'kind_changed', kind_from: m.membership_kind, kind_to: kind,
    source: 'app.tjkrupka.cz', actor_email: req.member.email, actor_id: req.member.id,
    actor_name: actor, note: s((req.body || {}).note),
  });
  res.json({ ok: true, kind, message: `Typ členství změněn na ${kind === 'radne' ? 'řádné' : 'sportovní'}.` });
}));

/** Ověření fotografie člena (dozor pak vidí, že fotka je potvrzená). */
router.post('/superadmin/members/:id/verify-photo', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  if (!m.photo) return res.status(400).json({ error: 'BEZ_FOTOGRAFIE', message: 'Člen nemá nahranou fotografii.' });
  await D.Members.update(m.id, { photo_verified: 1, photo_verified_at: D.now() });
  res.json({ ok: true, message: 'Fotografie označena jako ověřená.' });
}));

module.exports = router;
