// readiness.js — „JE ÚČASTNÍK PŘIPRAVEN KE SKOKU?“
//
// Jeden zdroj pravdy pro stav připravenosti, který kontroluje dozor u vstupu
// i aplikace v profilu účastníka. Záměrně ODDĚLUJE tři různé skutečnosti:
//
//   1) DOKUMENT POTVRZEN      — elektronické potvrzení dokumentů (consents)
//                               v AKTUÁLNÍ verzi dokumentu; u nezletilého
//                               navíc samostatný souhlas zákonného zástupce
//                               a ověření jeho vazby k dítěti.
//   2) INSTRUKTÁŽ ABSOLVOVÁNA — praktický nácvik pod dohledem dozora, zapsaný
//                               dozorem (tabulka instructions), s verzí instruktáže.
//   3) VSTUP/PROVOZ POVOLEN   — splnění provozních podmínek dne: otevřený
//                               provozní den, vyhovující denní kontrola, přítomný
//                               dozor, nepřerušený provoz, ověřená totožnost.
//
// „Potvrzené dokumenty“ samy o sobě NIKDY nestačí — to je jádro požadavku,
// aby účastník nezískal stav připravenosti jen odklikáním textů.
'use strict';

const D = require('./db');
const X = require('./db-app');
const E = require('./eligibility');

const INSTRUCTION_DOC_KEY = 'instruktaz_airbag';

/** Místní provozní den (YYYY-MM-DD) — bez posunu časového pásma. */
function dayOf(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 1) DOKUMENTY (potvrzení v aktuální verzi) ───────────────────────────────
async function documentState(member, stIn) {
  const st = stIn || await E.userState(member);
  const req = await E.requiredDocUnion(member, st);
  const signedMember = await E.signedDocKeysPublic(member.id, 'member');
  const signedGuardian = st.isMinor ? await E.signedDocKeysPublic(member.id, 'guardian') : {};

  const items = [];
  for (const key of req.userKeys) {
    const latest = await D.DocVersions.latest(key);
    if (!latest || latest.status === 'retired') continue;
    items.push({
      docKey: key,
      title: latest.title,
      version: latest.version,
      signer: 'member',
      signed: !!signedMember[key],
    });
  }
  if (st.isMinor) {
    for (const key of req.guardianKeys) {
      const latest = await D.DocVersions.latest(key);
      if (!latest || latest.status === 'retired') continue;
      items.push({
        docKey: key,
        title: latest.title,
        version: latest.version,
        signer: 'guardian',
        signed: !!signedGuardian[key],
      });
    }
  }

  const missing = items.filter((i) => !i.signed);
  return {
    ok: missing.length === 0 && (!st.isMinor || st.guardianGranted),
    items,
    missing,
    missingCount: missing.length,
    guardianGranted: st.guardianGranted,
    guardianMissing: st.isMinor && !st.guardianGranted,
    isMinor: st.isMinor,
    intent: member.intent || 'clenstvi',
  };
}

// ── 2) INSTRUKTÁŽ (praktický nácvik pod dohledem) ───────────────────────────
async function instructionState(member) {
  const latest = await D.DocVersions.latest(INSTRUCTION_DOC_KEY);
  const last = await X.Instructions.lastFor(member.id);
  const passed = await X.Instructions.lastPassedFor(member.id);
  const expectedVersion = latest ? latest.version : null;
  const ok = !!passed && (expectedVersion == null || passed.doc_version === expectedVersion);
  let message;
  if (!ok && passed) message = 'Instruktáž byla absolvována pro starší verzi instruktáže — je potřeba nová.';
  else if (!ok && last && last.result === 'neabsolvoval') message = 'Poslední instruktáž skončila výsledkem „neabsolvoval“.';
  else if (!ok) message = 'Praktická instruktáž zatím není zaznamenána.';
  return {
    ok,
    title: latest ? latest.title : 'Instruktáž před použitím dopadové matrace',
    expectedVersion,
    expectedHash: latest ? latest.content_hash : null,
    last: last
      ? {
        result: last.result,
        at: last.instructed_at,
        dozor: last.dozor_name,
        version: last.doc_version,
        note: last.note || last.reason || '',
        source: last.source,
      }
      : null,
    message,
  };
}

// ── 3) ZÁKONNÝ ZÁSTUPCE (souhlas s účastí + ověření vazby k dítěti) ─────────
async function guardianState(member, st) {
  const age = st ? st.age : X.ageFrom(member.birth_date);
  const isMinor = age !== null && age < 18;
  if (!isMinor) return { required: false, ok: true };
  const verification = await X.GuardianVerifications.lastFor(member.id);
  const consented = member.guardian_status === 'granted';
  const relationVerified = !!verification;
  return {
    required: true,
    consented,
    consentedAt: member.guardian_granted_at || null,
    guardianName: member.guardian_name || null,
    guardianRelation: member.guardian_relation || null,
    guardianEmail: member.guardian_email || null,
    relationVerified,
    verification: verification
      ? {
        method: verification.method,
        methodNote: verification.method_note || '',
        by: verification.verified_by_name || '',
        at: verification.verified_at,
      }
      : null,
    verificationMethodDeclared: member.guardian_verified_method || 'email_odkaz',
    ok: consented && relationVerified,
    message: !consented
      ? 'Chybí samostatný souhlas zákonného zástupce s účastí.'
      : !relationVerified
        ? 'Vazba zákonného zástupce k nezletilému není ověřená — ověřte na místě podle dokladu.'
        : undefined,
  };
}

// ── 4) PROVOZNÍ DEN (provozní kniha) ───────────────────────────────────────
async function operationalDayState(day, facilityCode = 'airbag') {
  const d = day || dayOf();
  const row = await X.ProvozniDen.getByDay(d, facilityCode);
  const checks = row ? X.checkVerdict(row) : null;
  const opened = !!(row && row.opened_at);
  const interrupted = !!(row && row.interrupted_at && !row.resumed_at);
  const closed = !!(row && row.closed_at);
  const verdictOk = !!(row && row.verdict === 'vyhovuje');
  const ok = opened && verdictOk && !interrupted && !closed;
  let message;
  if (!row) message = 'Provozní den není otevřen — chybí denní kontrola zařízení.';
  else if (!opened) message = 'Provozní den ještě nebyl otevřen dozorem.';
  else if (closed) message = 'Provozní den byl ukončen — vstup je možný až po novém otevření dne s kontrolou.';
  else if (!verdictOk) message = 'Denní kontrola nevyhovuje — provoz nelze zahájit.';
  else if (interrupted) message = 'Provoz je přerušen — vstup není možný.';
  return {
    day: d,
    exists: !!row,
    opened,
    openedAt: row ? row.opened_at : null,
    dozorName: row ? row.dozor_name : null,
    dozorPresent: !!(row && Number(row.dozor_present) === 1),
    verdict: row ? row.verdict : 'ceka',
    checks,
    defects: row ? row.defects : '',
    checkNote: row ? row.check_note : '',
    interrupted,
    interruptedAt: row ? row.interrupted_at : null,
    interruptReason: row ? row.interrupt_reason : '',
    closed,
    closedAt: row ? row.closed_at : null,
    source: row ? row.source : null,
    ok,
    message,
  };
}

// ── 5) OVĚŘENÍ TOTOŽNOSTI (aby za jiného neklikal někdo další) ─────────────
function identityState(member) {
  const pinSet = !!member.entry_pin_hash;
  return {
    pinSet,
    pinSetAt: member.entry_pin_set_at || null,
    // Bez PINu je vstup možný jen s porovnáním fotografie dozorem (a je to
    // v záznamu o vstupu výslovně uvedeno). S PINem jej musí zadat účastník sám.
    method: pinSet ? 'qr+foto+pin' : 'qr+foto',
    ok: true,
    warning: pinSet ? undefined : 'Účastník nemá nastavený vstupní PIN — totožnost ověřena jen podle fotografie.',
  };
}

/**
 * Kompletní stav připravenosti.
 * Vrací `ready` = smí vstoupit (vše splněno) + seznam podmínek s důvody,
 * aby dozor i účastník viděli PŘESNĚ, co chybí.
 */
async function readiness(member, { day, facilityCode = 'airbag', includeIdentity = true, state } = {}) {
  if (!member) return null;
  // `state` se předává z volajícího, aby se stav uživatele nepočítal víckrát.
  const st = state || await E.userState(member);
  const [documents, instruction, guardian, dayState] = await Promise.all([
    documentState(member, st),
    instructionState(member),
    guardianState(member, st),
    operationalDayState(day, facilityCode),
  ]);
  const identity = identityState(member);
  const membershipOk = st.isMember || (await D.Entitlements.hasActive(member.id));

  const checks = [
    {
      key: 'membership',
      label: 'Členství nebo jednorázový vstup',
      ok: !!membershipOk,
      state: st.membershipStatus,
      message: membershipOk ? undefined : 'Chybí platné členství i jednorázový vstup.',
    },
    {
      key: 'documents',
      label: 'Potvrzené dokumenty v aktuální verzi',
      ok: documents.ok,
      message: documents.ok
        ? undefined
        : documents.guardianMissing
          ? 'Chybí souhlas zákonného zástupce.'
          : `Nepotvrzené dokumenty: ${documents.missing.map((m) => m.title).join(', ')}`,
    },
    {
      key: 'instruction',
      label: 'Absolvovaná praktická instruktáž',
      ok: instruction.ok,
      message: instruction.ok ? undefined : instruction.message,
    },
    {
      key: 'guardian',
      label: 'Souhlas zástupce a ověřená vazba k dítěti',
      ok: guardian.ok,
      message: guardian.ok ? undefined : guardian.message,
    },
    {
      key: 'day',
      label: 'Vyhovující kontrola a otevřený provoz pro dnešní den',
      ok: dayState.ok,
      message: dayState.ok ? undefined : dayState.message,
    },
    {
      key: 'identity',
      label: 'Ověření totožnosti',
      ok: includeIdentity ? identity.ok : true,
      message: identity.warning,
    },
  ];

  const blocking = checks.filter((c) => !c.ok);
  return {
    ready: blocking.length === 0,
    day: dayState.day,
    checks,
    blocking,
    documents,
    instruction,
    guardian,
    dayState,
    identity,
    state: st,
    // Tři oddělené skutečnosti pro protokol (nesmějí se slévat do jedné věty):
    statements: {
      documentsConfirmed: documents.ok,
      instructionCompleted: instruction.ok,
      entryAllowed: blocking.length === 0,
    },
  };
}

module.exports = {
  dayOf,
  documentState,
  instructionState,
  guardianState,
  operationalDayState,
  identityState,
  readiness,
  INSTRUCTION_DOC_KEY,
};
