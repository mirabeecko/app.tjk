// evidence.js — DŮKAZNÍ VRSTVA POTVRZENÍ A PROVOZNÍ EVIDENCE.
//
// Odpovídá na otázku „co se stane, když se něco stane“: kdo, s jakým ZNĚNÍM
// dokumentu, kdy a odkud potvrdil dokumenty; kdo a kdy provedl praktickou
// instruktáž; a za jakých podmínek byl povolen vstup.
//
// Principy:
//  1. Souhlas (tabulka consents) drží OTISK ZNĚNÍ (SHA-256), se kterým člen
//     souhlasil — ne jen „souhlasil se souborem provozni_rad.docx“.
//  2. Znění každé verze je uložené v doc_versions → dá se kdykoli vytisknout
//     PŘESNĚ to znění, které člen podepsal (i když je dnes platná novější verze).
//  3. Integrita se ověřuje PŘEPOČTEM: sha256(uložené znění) === otisk v souhlasu.
//  4. Protokol je tisknutelný/sebeobsažný doklad — dá se založit do spisu.
//
// CO PROTOKOL VÝSLOVNĚ NEDOKLÁDÁ (aby nevznikl klamavý dojem):
//  · není vlastnoruční podpis a neobsahuje podpisové linky k podpisu,
//  · není kvalifikované elektronické časové razítko (eIDAS/TSA) — systém vede
//    pouze čas serveru,
//  · neprokazuje totožnost osoby u zařízení — prokazuje, jaký záznam vznikl
//    a jaké ověření (heslo, PIN, kontrola fotografie dozorem) u něj proběhlo.
'use strict';

const crypto = require('crypto');
const D = require('./db');
const X = require('./db-app');
const R = require('./readiness');

// Lidské názvy dokumentů (server posílá klíče; v dokladu musí být česky).
const DOC_TITLES = {
  stanovy: 'Stanovy spolku',
  gdpr: 'Souhlas se zpracováním osobních údajů (GDPR)',
  provozni_rad: 'Provozní řád dopadové matrace',
  cestne_prohlaseni: 'Čestné prohlášení o zdravotní způsobilosti',
  // Dokument platný od 2026-09-28 (nahradil „Vzdání se práva na náhradu újmy“)
  pouceni_rizika: 'Poučení o rizicích a potvrzení pravidel účasti',
  // Obsah praktické instruktáže (verzovaný; záznam o instruktáži se váže na verzi)
  instruktaz_airbag: 'Instruktáž před použitím dopadové matrace',
  guardian_souhlas: 'Souhlas zákonného zástupce s účastí nezletilého',
  // HISTORICKÝ dokument (vyřazen 2026-09-28) — zůstává kvůli starším souhlasům
  vzdani_prava: 'Vzdání se práva na náhradu újmy (§ 2925 OZ) — historický, vyřazený dokument',
};

// Jak bylo potvrzení ověřeno (nesmí se zaměňovat s vlastnoručním podpisem).
const AUTH_LABELS = {
  password: 'opakované zadání hesla účtu v aplikaci',
  email_code: 'jednorázový ověřovací kód zaslaný na e-mail účtu',
  session: 'přihlášená relace (bez dalšího ověření)',
  guardian_email: 'jednorázový odkaz na e-mail zákonného zástupce',
};

const IDENTITY_LABELS = {
  'qr+foto': 'QR karta + porovnání fotografie dozorem',
  'qr+foto+pin': 'QR karta + porovnání fotografie + osobně zadaný vstupní PIN',
  'manual+doklad': 'ruční záznam dozoru + ověření dokladu',
};

function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex');
}

// Kvalifikace tabulky v syrových dotazech: postgres (produkce) má vše ve schématu
// `app`, sqlite (vývoj) bez schématu.
const TBL = (name) => (D.driver === 'postgres' ? `app.${name}` : name);

function docTitle(docKey, version) {
  if (version && version.title) return version.title;
  return DOC_TITLES[docKey] || docKey;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCz(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'medium' });
}

// ── 1) EVIDENCE JEDNOHO SOUHLASU ────────────────────────────────────────────
// Vrací přesné znění podepsané verze + přepočtený otisk + výsledek kontroly.
async function consentEvidence(consent) {
  const version = await D.DocVersions.byKeyVersion(consent.doc_key, consent.doc_version);
  const text = version ? version.content : null;
  const recomputed = text == null ? null : sha256(text);
  const matches = recomputed != null && recomputed === consent.content_hash;
  return {
    docKey: consent.doc_key,
    title: docTitle(consent.doc_key, version),
    version: consent.doc_version,
    signerType: consent.signer_type,                       // member | guardian
    signerLabel: consent.signer_type === 'guardian' ? 'zákonný zástupce' : 'účastník (vlastní účet)',
    identity: consent.identity,
    grantedAt: consent.granted_at,
    grantedAtLabel: fmtCz(consent.granted_at),
    ip: consent.ip,
    userAgent: consent.user_agent || null,
    // Jak bylo potvrzení ověřeno (heslo / relace / odkaz rodiče)
    authMethod: consent.auth_method || 'session',
    authLabel: AUTH_LABELS[consent.auth_method || 'session'] || consent.auth_method || 'neuvedeno',
    authNote: consent.auth_note || '',
    contentHash: consent.content_hash,
    recomputedHash: recomputed,
    // Je dokument vyřazený (historický)? U historických dokumentů se uvádí, že
    // se už nevyžadují — znění i souhlas ale zůstávají dohledatelné.
    docStatus: version ? (version.status || 'active') : 'CHYBI',
    supersededBy: version ? version.superseded_by || null : null,
    // 'OK' = text v systému odpovídá tomu, co člen podepsal
    // 'NESOUHLASI' = text se od podpisu změnil (nebo byl zásah do DB)
    // 'CHYBI_TEXT' = znění dané verze v systému chybí (nedá se prokázat)
    integrity: text == null ? 'CHYBI_TEXT' : (matches ? 'OK' : 'NESOUHLASI'),
    text,
  };
}

// ── 2) PRAKTICKÁ INSTRUKTÁŽ ─────────────────────────────────────────────────
async function instructionEvidence(instruction) {
  if (!instruction) return null;
  const version = await D.DocVersions.byKeyVersion(instruction.doc_key, instruction.doc_version);
  const text = version ? version.content : null;
  const recomputed = text == null ? null : sha256(text);
  return {
    id: instruction.id,
    participantName: instruction.participant_name,
    participantNo: instruction.participant_no,
    isMinor: Number(instruction.is_minor) === 1,
    dozorName: instruction.dozor_name,
    dozorRole: instruction.dozor_role,
    instructedAt: instruction.instructed_at,
    instructedAtLabel: fmtCz(instruction.instructed_at),
    recordedAt: instruction.recorded_at,
    recordedAtLabel: fmtCz(instruction.recorded_at),
    docKey: instruction.doc_key,
    title: docTitle(instruction.doc_key, version),
    version: instruction.doc_version,
    contentHash: instruction.content_hash,
    recomputedHash: recomputed,
    integrity: text == null ? 'CHYBI_TEXT' : (recomputed === instruction.content_hash ? 'OK' : 'NESOUHLASI'),
    result: instruction.result,                            // absolvoval | neabsolvoval
    resultLabel: instruction.result === 'absolvoval' ? 'absolvoval' : 'neabsolvoval',
    reason: instruction.reason || '',
    note: instruction.note || '',
    source: instruction.source || 'app',
    offline: instruction.source === 'offline',
  };
}

// ── 3) VSTUPY (a podmínky, za kterých byly povoleny) ────────────────────────
function entryEvidence(entry) {
  let blocking = [];
  try {
    const parsed = JSON.parse(entry.blocking || '[]');
    if (Array.isArray(parsed)) blocking = parsed;
  } catch (e) { blocking = entry.blocking ? [String(entry.blocking)] : []; }
  return {
    id: entry.id,
    at: entry.created_at,
    atLabel: fmtCz(entry.created_at),
    personName: entry.person_name,
    personNo: entry.person_no,
    kind: entry.kind,
    kindLabel: entry.kind === 'clen' ? 'člen' : 'nečlen / host',
    accessOk: Number(entry.access_ok) === 1,
    accessLabel: Number(entry.access_ok) === 1 ? 'vstup povolen' : 'vstup zamítnut',
    reason: entry.reason || '',
    source: entry.source,
    dozorName: entry.recorded_by_name || '',
    day: entry.day || null,
    dayVerdict: entry.day_verdict || null,
    documentsOk: Number(entry.documents_ok) === 1,
    instructionOk: Number(entry.instruction_ok) === 1,
    identityCheck: entry.identity_check || '',
    identityLabel: IDENTITY_LABELS[entry.identity_check] || entry.identity_check || 'neuvedeno',
    blocking,
  };
}

// ── 4) CELÝ BALÍK PRO JEDNOHO ÚČASTNÍKA (co se tiskne do protokolu) ─────────
async function evidenceBundle(member) {
  if (!member) return null;
  const rows = await D.Consents.listForMember(member.id);
  const consents = [];
  for (const c of rows) consents.push(await consentEvidence(c));
  // pořadí: nejdřív podepsané (dle času), pak podle názvu
  consents.sort((a, b) => String(a.grantedAt).localeCompare(String(b.grantedAt)));

  // Praktická instruktáž (může být více záznamů — poslední rozhoduje o stavu)
  const instrRows = await X.Instructions.listForMember(member.id, 20);
  const instructions = [];
  for (const i of instrRows) instructions.push(await instructionEvidence(i));

  // Vstupy (jen skutečně evidované vstupy tohoto účastníka)
  const entryRows = await X.Entries.listForMember(member.id, 50);
  const entries = entryRows.map(entryEvidence).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // Ověření vazby zákonného zástupce (u nezletilých)
  const guardianVerifications = (await X.GuardianVerifications.listFor(member.id)).map((v) => ({
    method: v.method,
    methodNote: v.method_note || '',
    by: v.verified_by_name || '',
    at: v.verified_at,
    atLabel: fmtCz(v.verified_at),
  }));

  // Aktuální stav: tři ODDĚLENÉ skutečnosti + co případně blokuje vstup
  const ready = await R.readiness(member);

  const summary = {
    signed: consents.length,
    ok: consents.filter((c) => c.integrity === 'OK').length,
    broken: consents.filter((c) => c.integrity === 'NESOUHLASI').length,
    missingText: consents.filter((c) => c.integrity === 'CHYBI_TEXT').length,
    byGuardian: consents.filter((c) => c.signerType === 'guardian').length,
    retired: consents.filter((c) => c.docStatus === 'retired').length,
    instructions: instructions.length,
    instructionsPassed: instructions.filter((i) => i.result === 'absolvoval').length,
    entries: entries.length,
    entriesAllowed: entries.filter((e) => e.accessOk).length,
  };
  summary.verdict = summary.broken === 0 && summary.missingText === 0 ? 'OK' : 'PROBLEM';

  const bundle = {
    generatedAt: new Date().toISOString(),
    member: {
      id: member.id,
      memberNo: member.member_no,
      name: `${member.first_name || ''} ${member.last_name || ''}`.trim(),
      firstName: member.first_name,
      lastName: member.last_name,
      birthDate: member.birth_date,
      email: member.email,
      phone: member.phone,
      membershipType: member.membership_type,
      intent: member.intent || 'clenstvi',
      entryPinSet: !!member.entry_pin_hash,
      status: member.status,
      validFrom: member.valid_from,
      validUntil: member.valid_until,
      guardianName: member.guardian_name || null,
      guardianRelation: member.guardian_relation || null,
      guardianEmail: member.guardian_email || null,
      guardianStatus: member.guardian_status,
      guardianVerifiedMethod: member.guardian_verified_method || null,
      guardianVerifiedAt: member.guardian_verified_at || null,
    },
    consents,
    instructions,
    entries,
    guardianVerifications,
    statements: ready
      ? {
        documentsConfirmed: ready.statements.documentsConfirmed,
        instructionCompleted: ready.statements.instructionCompleted,
        entryAllowed: ready.statements.entryAllowed,
      }
      : { documentsConfirmed: false, instructionCompleted: false, entryAllowed: false },
    readiness: ready
      ? {
        day: ready.day,
        blocking: ready.blocking.map((b) => ({ key: b.key, label: b.label, message: b.message })),
        documents: ready.documents.items.map((d) => ({ ...d })),
        instruction: {
          ok: ready.instruction.ok,
          expectedVersion: ready.instruction.expectedVersion,
          message: ready.instruction.message,
        },
        guardian: ready.guardian,
        identity: { pinSet: ready.identity.pinSet, method: ready.identity.method, warning: ready.identity.warning },
        dayState: {
          day: ready.dayState.day,
          opened: ready.dayState.opened,
          openedAt: ready.dayState.openedAt,
          dozorName: ready.dayState.dozorName,
          verdict: ready.dayState.verdict,
          interrupted: ready.dayState.interrupted,
          message: ready.dayState.message,
        },
      }
      : null,
    summary,
  };
  bundle.protocolNo = protocolNo(bundle);
  bundle.fingerprint = fingerprint(bundle);
  return bundle;
}

// Otisk celého balíku: mění se, když se změní COKOLI v důkazech (člen, znění,
// otisky, časy, instruktáže, vstupy). Slouží k porovnání dvou vyhotovení.
function fingerprint(bundle) {
  const canon = JSON.stringify({
    member: { id: bundle.member.id, name: bundle.member.name, birthDate: bundle.member.birthDate },
    consents: bundle.consents.map((c) => [c.docKey, c.version, c.signerType, c.identity, c.grantedAt, c.contentHash, c.integrity, c.authMethod]),
    instructions: bundle.instructions.map((i) => [i.id, i.docVersion, i.instructedAt, i.result, i.dozorName]),
    entries: bundle.entries.map((e) => [e.id, e.at, e.accessOk, e.identityCheck, e.day]),
  });
  return sha256(canon);
}

// Číslo protokolu: lidsky dohledatelné (kdo + kdy byl protokol vyhotoven).
function protocolNo(bundle) {
  const d = new Date(bundle.generatedAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TJK-EVIDENCE-${ymd}-${String(bundle.member.id).slice(0, 8).toUpperCase()}`;
}

function protocolFileName(bundle) {
  const safe = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `protokol-evidence-${safe(bundle.member.lastName) || 'clen'}-${safe(bundle.member.firstName)}-${String(bundle.member.id).slice(0, 8)}.html`;
}

// ── 5) TISKNUTELNÝ PROTOKOL (HTML → PDF tiskem) ─────────────────────────────
function protocolHtml(bundle, opts) {
  const o = opts || {};
  const nonce = o.nonce || '';
  const m = bundle.member;
  const S = bundle.statements;

  const yn = (v) => (v
    ? '<span class="ok">ANO</span>'
    : '<span class="bad">NE</span>');

  const integrityLabel = (c) => (c.integrity === 'OK'
    ? '<span class="ok">OTISK ODPOVÍDÁ — znění nebylo od potvrzení změněno</span>'
    : c.integrity === 'CHYBI_TEXT'
      ? '<span class="bad">CHYBÍ ZNĚNÍ TÉTO VERZE — nelze prokázat</span>'
      : '<span class="bad">OTISK NESOUHLASÍ — znění se od potvrzení změnilo</span>');

  const rows = bundle.consents.map((c) => `
      <tr>
        <td>${esc(c.title)}<div class="mono hash-inline">SHA-256 ${esc(c.contentHash)}</div>${c.docStatus === 'retired' ? '<div class="retired">historický dokument — už se nevyžaduje</div>' : ''}</td>
        <td class="c">v${esc(c.version)}</td>
        <td>${esc(c.signerLabel)}</td>
        <td>${esc(c.grantedAtLabel)}</td>
        <td class="mono">${esc(c.identity)}</td>
        <td>${esc(c.authLabel)}</td>
        <td class="mono">${esc(c.ip)}</td>
        <td class="${c.integrity === 'OK' ? 'ok' : 'bad'}">${c.integrity === 'OK' ? 'v pořádku' : (c.integrity === 'CHYBI_TEXT' ? 'chybí znění' : 'nesouhlasí')}</td>
      </tr>`).join('');

  const instrRows = bundle.instructions.map((i) => `
      <tr>
        <td>${esc(i.instructedAtLabel)}</td>
        <td>${esc(i.dozorName)}${i.dozorRole ? ` <span class="muted">(${esc(i.dozorRole)})</span>` : ''}</td>
        <td class="c">v${esc(i.version)}</td>
        <td class="${i.result === 'absolvoval' ? 'ok' : 'bad'}">${esc(i.resultLabel)}</td>
        <td>${esc(i.reason || i.note || '—')}</td>
        <td>${i.offline ? '<span class="warn">offline zápis</span>' : 'v aplikaci'}</td>
        <td class="${i.integrity === 'OK' ? 'ok' : 'bad'}">${i.integrity === 'OK' ? 'otisk OK' : (i.integrity === 'CHYBI_TEXT' ? 'chybí znění' : 'nesouhlasí')}</td>
      </tr>`).join('');

  const entryRows = bundle.entries.map((e) => `
      <tr>
        <td>${esc(e.atLabel)}</td>
        <td>${esc(e.personName)}${e.personNo ? ` <span class="muted">(č. ${esc(e.personNo)})</span>` : ''}</td>
        <td class="c">${esc(e.kindLabel)}</td>
        <td>${esc(e.day || '—')}${e.dayVerdict ? ` <span class="muted">(${esc(e.dayVerdict)})</span>` : ''}</td>
        <td>${esc(e.dozorName || '—')}</td>
        <td>${esc(e.identityLabel)}</td>
        <td class="c">${yn(e.documentsOk)} / ${yn(e.instructionOk)}</td>
        <td class="${e.accessOk ? 'ok' : 'bad'}">${esc(e.accessLabel)}</td>
      </tr>`).join('');

  const guardRows = bundle.guardianVerifications.map((v) => `
      <tr><td>${esc(v.atLabel)}</td><td>${esc(v.method)}</td><td>${esc(v.by)}</td><td>${esc(v.methodNote || '—')}</td></tr>`).join('');

  const blockingList = bundle.readiness && bundle.readiness.blocking.length
    ? `<ul class="blocking">${bundle.readiness.blocking.map((b) => `<li><strong>${esc(b.label)}</strong> — ${esc(b.message || '')}</li>`).join('')}</ul>`
    : '<p class="note">Žádná nesplněná podmínka podle evidence aplikace.</p>';

  const docs = bundle.consents.map((c) => `
    <section class="doc">
      <h2>${esc(c.title)} <span class="ver">verze ${esc(c.version)}</span></h2>
      <table class="meta">
        <tr><th>Kdo potvrdil</th><td>${esc(c.signerLabel)} — ${esc(c.identity)}</td></tr>
        <tr><th>Datum a čas</th><td>${esc(c.grantedAtLabel)} (${esc(c.grantedAt)})</td></tr>
        <tr><th>Způsob ověření</th><td>${esc(c.authLabel)}${c.authNote ? ` — ${esc(c.authNote)}` : ''}</td></tr>
        <tr><th>Odkud</th><td class="mono">IP ${esc(c.ip)}${c.userAgent ? ' · ' + esc(c.userAgent) : ''}</td></tr>
        <tr><th>Otisk znění (SHA-256)</th><td class="mono">${esc(c.contentHash)}</td></tr>
        <tr><th>Kontrola integrity</th><td>${integrityLabel(c)}</td></tr>
        ${c.docStatus === 'retired' ? `<tr><th>Stav dokumentu</th><td class="warn">historický dokument — vyřazen, nahrazen dokumentem „${esc(c.supersededBy || '')}“</td></tr>` : ''}
      </table>
      <p class="note">Níže je úplné znění dokumentu v podobě, v jaké je uložené v systému
        (včetně zlomů řádků). Právě z tohoto znění byl vypočten otisk výše.</p>
      <pre class="doc-text">${esc(c.text == null ? '(znění se v systému nepodařilo dohledat)' : c.text)}</pre>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Protokol o potvrzení dokumentů a průběhu účasti — ${esc(m.name)} — ${esc(bundle.protocolNo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #f1f3f7; color: #14181f;
         font: 11pt/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
  .sheet { max-width: 900px; margin: 0 auto 22px; background: #fff; padding: 30px 34px;
           box-shadow: 0 10px 30px rgba(0,0,0,.12); border-radius: 6px; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -.01em; }
  h2 { font-size: 12.5pt; margin: 18px 0 8px; }
  .head { border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .org { font-size: 10pt; text-transform: uppercase; letter-spacing: .14em; color: #5a6472; }
  .sub { font-size: 10pt; color: #5a6472; margin-top: 4px; }
  .no { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dfe3ea; vertical-align: top; font-size: 9.5pt; }
  thead th { background: #f4f6fa; border-bottom: 2px solid #b9c0cc; font-size: 8.5pt;
             text-transform: uppercase; letter-spacing: .08em; color: #48505e; }
  td.c { text-align: center; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.5pt; word-break: break-all; }
  .hash-inline { font-size: 7.2pt; color: #6b7280; margin-top: 2px; }
  .muted { color: #5a6472; }
  .ok { color: #0b6b45; font-weight: 700; }
  .bad { color: #b3261e; font-weight: 700; }
  .warn { color: #8a5a00; font-weight: 700; }
  .retired { font-size: 8pt; color: #8a5a00; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .box { border: 1px solid #dfe3ea; border-radius: 6px; padding: 12px 14px; }
  .box h3 { margin: 0 0 6px; font-size: 9pt; text-transform: uppercase; letter-spacing: .1em; color: #5a6472; }
  dl { margin: 0; }
  dl div { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dashed #e6e9ef; font-size: 9.5pt; }
  dl div:last-child { border-bottom: none; }
  dt { color: #5a6472; }
  dd { margin: 0; font-weight: 600; text-align: right; }
  .note { font-size: 9pt; color: #5a6472; margin: 6px 0 8px; }
  .doc { border-top: 2px solid #111; padding-top: 14px; margin-top: 18px; }
  .doc h2 .ver { font-size: 9pt; font-weight: 600; color: #5a6472; }
  .doc-text { white-space: pre-wrap; font-family: ui-monospace, Menlo, Consolas, monospace;
              font-size: 8pt; line-height: 1.45; border: 1px solid #dfe3ea; background: #fafbfd;
              padding: 12px; border-radius: 5px; max-height: none; }
  .meta th { width: 190px; background: none; border-bottom: 1px solid #dfe3ea; text-transform: none; letter-spacing: 0; font-size: 9.5pt; color: #5a6472; }
  .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #dfe3ea; font-size: 8.5pt; color: #5a6472; }
  .states { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 10px 0 6px; }
  .state { border: 1px solid #dfe3ea; border-radius: 6px; padding: 10px 12px; }
  .state .st-k { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #5a6472; }
  .state .st-v { font-size: 12pt; font-weight: 700; margin-top: 4px; }
  .state .st-s { font-size: 8.5pt; color: #5a6472; margin-top: 2px; }
  ul.blocking { margin: 6px 0 10px; padding-left: 18px; font-size: 9.5pt; }
  .disclaimer { border: 1px solid #b9c0cc; background: #f8f9fc; border-radius: 6px; padding: 12px 14px; font-size: 9.5pt; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; margin: 0; }
    .toolbar { display: none; }
    .doc { page-break-before: always; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
  .toolbar { max-width: 900px; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .toolbar button, .toolbar a { font: inherit; font-size: 10pt; padding: 9px 16px; border-radius: 8px;
        border: 1px solid #111; background: #111; color: #fff; cursor: pointer; text-decoration: none; font-weight: 600; }
  .toolbar a.ghost { background: #fff; color: #111; }
  .toolbar span { font-size: 9pt; color: #5a6472; }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" id="print-btn">Vytisknout / uložit jako PDF</button>
    <a class="ghost" href="?download=1">Uložit jako soubor (.html)</a>
    <span>Rada: v tiskovém dialogu zvolte „Uložit jako PDF“ a zaškrtněte „Záhlaví a zápatí“ (datum tisku).</span>
  </div>

  <div class="sheet">
    <div class="head">
      <div class="org">Tělovýchovná jednota Krupka, z.s.</div>
      <h1>Protokol o potvrzení dokumentů a průběhu účasti</h1>
      <div class="sub">Doklad o tom, které znění dokumentů účastník potvrdil, kdo a kdy provedl praktickou instruktáž
        a za jakých podmínek byl povolen vstup na zařízení — s ověřením integrity otisků.</div>
      <div class="sub no">Číslo protokolu: ${esc(bundle.protocolNo)} · vyhotoveno ${esc(fmtCz(bundle.generatedAt))}</div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Účastník</h3>
        <dl>
          <div><dt>Jméno a příjmení</dt><dd>${esc(m.name)}</dd></div>
          <div><dt>Datum narození</dt><dd>${esc(m.birthDate || '—')}</dd></div>
          <div><dt>E-mail</dt><dd class="mono">${esc(m.email || '—')}</dd></div>
          <div><dt>Telefon</dt><dd>${esc(m.phone || '—')}</dd></div>
          <div><dt>Typ členství</dt><dd>${esc(m.membershipType || '—')}</dd></div>
          <div><dt>Účel registrace</dt><dd>${esc(m.intent === 'vstup' ? 'jednorázový vstup (nečlen)' : 'členství')}</dd></div>
        </dl>
      </div>
      <div class="box">
        <h3>Identifikace v systému</h3>
        <dl>
          <div><dt>ID účtu</dt><dd class="mono">${esc(m.id)}</dd></div>
          <div><dt>Stav</dt><dd>${esc(m.status || '—')}</dd></div>
          <div><dt>Členství platné</dt><dd>${esc(fmtCz(m.validFrom))} – ${esc(fmtCz(m.validUntil))}</dd></div>
          <div><dt>Zákonný zástupce</dt><dd>${esc(m.guardianName ? `${m.guardianName} (${m.guardianRelation || ''})` : 'nevyžaduje se')}</dd></div>
          <div><dt>Ověření vazby k dítěti</dt><dd>${esc(m.guardianVerifiedMethod ? `${m.guardianVerifiedMethod} · ${fmtCz(m.guardianVerifiedAt)}` : '—')}</dd></div>
          <div><dt>Vstupní PIN nastaven</dt><dd>${m.entryPinSet ? 'ano' : 'ne'}</dd></div>
        </dl>
      </div>
    </div>

    <h2>1. Aktuální stav — tři samostatné skutečnosti</h2>
    <div class="states">
      <div class="state">
        <div class="st-k">Dokument potvrzen</div>
        <div class="st-v">${S.documentsConfirmed ? '<span class="ok">ANO</span>' : '<span class="bad">NE</span>'}</div>
        <div class="st-s">potvrzení dokumentů v aktuální verzi${S.documentsConfirmed ? '' : ' — něco chybí nebo je potřeba potvrdit novou verzi'}</div>
      </div>
      <div class="state">
        <div class="st-k">Instruktáž absolvována</div>
        <div class="st-v">${S.instructionCompleted ? '<span class="ok">ANO</span>' : '<span class="bad">NE</span>'}</div>
        <div class="st-s">${bundle.readiness && bundle.readiness.instruction.expectedVersion != null ? `požadovaná verze instruktáže: v${esc(bundle.readiness.instruction.expectedVersion)}` : 'praktická instruktáž pod dohledem dozora'}</div>
      </div>
      <div class="state">
        <div class="st-k">Vstup / provoz povolen</div>
        <div class="st-v">${S.entryAllowed ? '<span class="ok">ANO</span>' : '<span class="bad">NE</span>'}</div>
        <div class="st-s">stav podle evidence aplikace v době vyhotovení protokolu</div>
      </div>
    </div>
    <p class="note">Potvrzení dokumentů v aplikaci <strong>není</strong> totéž co absolvovaná praktická instruktáž.
      Stav „připraven ke skoku“ vyžaduje obojí a navíc splnění provozních podmínek dne.</p>
    ${blockingList}

    <h2>2. Přehled potvrzených dokumentů</h2>
    ${bundle.consents.length ? `<table>
      <thead><tr><th>Dokument</th><th>Verze</th><th>Potvrdil</th><th>Datum a čas</th><th>Identita</th><th>Způsob ověření</th><th>IP adresa</th><th>Integrita</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p class="note">Účastník zatím nepotvrdil žádný dokument.</p>'}

    <h2>3. Praktická instruktáž (zaznamenává dozor)</h2>
    ${bundle.instructions.length ? `<table>
      <thead><tr><th>Datum a čas</th><th>Dozor</th><th>Verze instruktáže</th><th>Výsledek</th><th>Důvod / poznámka</th><th>Zdroj</th><th>Integrita</th></tr></thead>
      <tbody>${instrRows}</tbody>
    </table>` : '<p class="note">Praktická instruktáž zatím není zaznamenána (účastník tedy nemá stav „připraven ke skoku“).</p>'}

    <h2>4. Vstupy na zařízení a podmínky, za kterých byly povoleny</h2>
    ${bundle.entries.length ? `<table>
      <thead><tr><th>Datum a čas</th><th>Účastník</th><th>Typ</th><th>Provozní den (kontrola)</th><th>Dozor</th><th>Ověření totožnosti</th><th>Dokumenty / instruktáž</th><th>Výsledek</th></tr></thead>
      <tbody>${entryRows}</tbody>
    </table>
    <p class="note">Sloupce „Dokumenty / instruktáž“ uvádějí stav v okamžiku vstupu (ANO/NE). Zamítnuté pokusy jsou uvedeny také.</p>`
      : '<p class="note">V evidenci není žádný zaznamenaný vstup tohoto účastníka.</p>'}

    ${bundle.guardianVerifications.length ? `<h2>5. Ověření vazby zákonného zástupce k nezletilému</h2>
    <table>
      <thead><tr><th>Datum a čas</th><th>Způsob ověření</th><th>Ověřil (dozor)</th><th>Poznámka</th></tr></thead>
      <tbody>${guardRows}</tbody>
    </table>
    <p class="note">Elektronický souhlas rodiče ověřuje jen přístup k e-mailové schránce; vztah k dítěti ověřuje dozor podle dokladu.</p>` : ''}

    <h2>6. Úplné znění potvrzených dokumentů</h2>
    <p class="note">Každý dokument je uveden ve znění verze, kterou účastník potvrdil (ne v případném novějším znění).
      V tištěné/uložené podobě je tak znění zachováno i tehdy, kdyby aplikace nebo její databáze zanikla.</p>
    ${docs || '<p class="note">—</p>'}

    <h2 style="margin-top:22px">7. Co tento protokol je a co není</h2>
    <div class="disclaimer">
      <p><strong>Tento protokol je výpis z elektronické evidence</strong> Tělovýchovné jednoty Krupka, z.s.
        Vznikl z dat uložených v členské aplikaci (elektronické potvrzení dokumentů, záznamy dozoru o instruktáži
        a o vstupech na zařízení).</p>
      <p><strong>Neobsahuje vlastnoruční podpis</strong> a nemá podpisové linky k podpisu: potvrzení dokumentů
        proběhlo elektronicky v aplikaci po přihlášení do vlastního účtu (způsob ověření je uveden u každého
        potvrzení).</p>
      <p><strong>Neobsahuje kvalifikované elektronické časové razítko</strong> ve smyslu nařízení eIDAS.
        Uvedené časy jsou časy serveru aplikace (systémové hodiny) v okamžiku zápisu. U offline zápisů dozora
        je uveden čas skutečného zápisu i jeho pozdější přenos do systému — takový záznam se nevydává za záznam
        pořízený v okamžiku s připojením.</p>
      <p><strong>Neprokazuje totožnost osoby u zařízení.</strong> Dokládá, jaký záznam vznikl a jaké ověření
        u něj proběhlo (způsob ověření totožnosti je uveden u jednotlivých vstupů).</p>
      <p><strong>Nenahrazuje posouzení odpovědnosti za újmu.</strong> Potvrzení dokumentů v aplikaci neomezuje
        zákonná práva účastníka (ani nezletilého) při vzniku újmy; texty dokumentů to výslovně uvádějí.</p>
    </div>

    <div class="foot">
      <h2 style="margin-top:22px">8. Jak protokol ověřit</h2>
      <strong>Postup:</strong> u každého dokumentu je otisk SHA-256 znění. Ověření spočívá v přepočtu
      tohoto otisku ze znění uloženého v systému a v porovnání s otiskem v okamžiku potvrzení — v aplikaci to provede
      kontrola <span class="mono">#/souhlasy → Moje dokumenty</span> nebo administrátorská kontrola
      <span class="mono">GET /api/documents/verify</span> (skript <span class="mono">node scripts/verify-consents.js</span>).
      Totéž platí pro otisk znění praktické instruktáže.
      <br /><br />
      Otisk tohoto vyhotovení protokolu: <span class="mono">${esc(bundle.fingerprint)}</span><br />
      Doklad vyhotovil (přihlášený uživatel aplikace): ${esc(o.issuedBy || 'aplikace členské evidence Tělovýchovná jednota Krupka, z.s.')} · ${esc(fmtCz(bundle.generatedAt))}<br />
      Potvrzených dokumentů: ${esc(bundle.summary.signed)} · záznamů o instruktáži: ${esc(bundle.summary.instructions)}
      (absolvováno: ${esc(bundle.summary.instructionsPassed)}) · vstupů: ${esc(bundle.summary.entries)} (povoleno: ${esc(bundle.summary.entriesAllowed)})
    </div>
  </div>

  <script nonce="${esc(nonce)}">
    document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
  </script>
</body>
</html>`;
}

// ── 6) SOUHRNNÁ KONTROLA VŠECH SOUHLASŮ („je to pořád v pořádku?“) ──────────
async function verifyAll() {
  const rows = await D.raw.all(`SELECT * FROM ${TBL('consents')} ORDER BY granted_at`);
  const out = [];
  for (const c of rows) {
    const ev = await consentEvidence(c);
    out.push({
      consentsId: c.id,
      memberId: c.member_id,
      docKey: ev.docKey,
      title: ev.title,
      version: ev.version,
      signerType: ev.signerType,
      identity: ev.identity,
      grantedAt: ev.grantedAt,
      authMethod: ev.authMethod,
      docStatus: ev.docStatus,
      integrity: ev.integrity,
    });
  }
  const broken = out.filter((r) => r.integrity !== 'OK');
  return {
    checkedAt: new Date().toISOString(),
    total: out.length,
    ok: out.length - broken.length,
    problems: broken.length,
    verdict: broken.length === 0 ? 'OK' : 'PROBLEM',
    rows: out,
    problemsDetail: broken,
  };
}

module.exports = {
  sha256,
  docTitle,
  DOC_TITLES,
  AUTH_LABELS,
  IDENTITY_LABELS,
  consentEvidence,
  instructionEvidence,
  entryEvidence,
  evidenceBundle,
  protocolHtml,
  protocolFileName,
  protocolNo,
  fingerprint,
  verifyAll,
};
