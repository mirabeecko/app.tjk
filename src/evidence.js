// evidence.js — DŮKAZNÍ VRSTVA E-SOUHLASŮ.
//
// Odpovídá na otázku „co se stane, když se něco stane“: kdo, s jakým ZNĚNÍM
// dokumentu, kdy a odkud souhlasil — a jestli je to zpětně ověřitelné.
//
// Principy:
//  1. Souhlas (tabulka consents) drží OTISK ZNĚNÍ (SHA-256), se kterým člen
//     souhlasil — ne jen „souhlasil se souborem provozni_rad.docx“.
//  2. Znění každé verze je uložené v doc_versions → dá se kdykoli vytisknout
//     PŘESNĚ to znění, které člen podepsal (i když je dnes platná novější verze).
//  3. Integrita se ověřuje PŘEPOČTEM: sha256(uložené znění) === otisk v souhlasu.
//     Když se text v DB dodatečně změní, kontrola to odhalí.
//  4. Protokol (protocolHtml) je tisknutelný/sebeobsažný doklad — dá se založit
//     do spisu nebo uložit jako PDF, takže důkaz přežije i ztrátu aplikace.
'use strict';

const crypto = require('crypto');
const D = require('./db');

// Lidské názvy dokumentů (server posílá klíče; v dokladu musí být česky).
const DOC_TITLES = {
  stanovy: 'Stanovy spolku',
  gdpr: 'Souhlas se zpracováním osobních údajů (GDPR)',
  provozni_rad: 'Provozní řád dopadové matrace',
  cestne_prohlaseni: 'Čestné prohlášení o zdravotní způsobilosti',
  vzdani_prava: 'Vzdání se práva na náhradu újmy (§ 2925 OZ)',
  guardian_souhlas: 'Souhlas zákonného zástupce',
};

function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex');
}

// Kvalifikace tabulky v syrových dotazech: postgres (produkce) má vše ve schématu
// `app`, sqlite (vývoj) bez schématu. Bez tohoto by kontrola souhlasů na produkci
// spadla na „relation consents does not exist“ (500).
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
    signerLabel: consent.signer_type === 'guardian' ? 'zákonný zástupce' : 'člen',
    identity: consent.identity,
    grantedAt: consent.granted_at,
    grantedAtLabel: fmtCz(consent.granted_at),
    ip: consent.ip,
    userAgent: consent.user_agent || null,
    contentHash: consent.content_hash,
    recomputedHash: recomputed,
    // 'OK' = text v systému odpovídá tomu, co člen podepsal
    // 'NESOUHLASI' = text se od podpisu změnil (nebo byl zásah do DB)
    // 'CHYBI_TEXT' = znění dané verze v systému chybí (nedá se prokázat)
    integrity: text == null ? 'CHYBI_TEXT' : (matches ? 'OK' : 'NESOUHLASI'),
    text,
  };
}

// ── 2) CELÝ BALÍK PRO JEDNOHO ČLENA (co se tiskne do protokolu) ─────────────
async function evidenceBundle(member) {
  if (!member) return null;
  const rows = await D.Consents.listForMember(member.id);
  const consents = [];
  for (const c of rows) consents.push(await consentEvidence(c));
  // pořadí: nejdřív podepsané (dle času), pak podle názvu
  consents.sort((a, b) => String(a.grantedAt).localeCompare(String(b.grantedAt)));

  const summary = {
    signed: consents.length,
    ok: consents.filter((c) => c.integrity === 'OK').length,
    broken: consents.filter((c) => c.integrity === 'NESOUHLASI').length,
    missingText: consents.filter((c) => c.integrity === 'CHYBI_TEXT').length,
    byGuardian: consents.filter((c) => c.signerType === 'guardian').length,
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
      status: member.status,
      validFrom: member.valid_from,
      validUntil: member.valid_until,
      guardianName: member.guardian_name || null,
      guardianEmail: member.guardian_email || null,
      guardianStatus: member.guardian_status,
    },
    consents,
    summary,
  };
  bundle.protocolNo = protocolNo(bundle);
  bundle.fingerprint = fingerprint(bundle);
  return bundle;
}

// Otisk celého balíku: mění se, když se změní COKOLI v důkazech (člen, znění,
// otisky, časy). Slouží k porovnání dvou vyhotovení protokolu mezi sebou.
function fingerprint(bundle) {
  const canon = JSON.stringify({
    member: { id: bundle.member.id, name: bundle.member.name, birthDate: bundle.member.birthDate },
    consents: bundle.consents.map((c) => [c.docKey, c.version, c.signerType, c.identity, c.grantedAt, c.contentHash, c.integrity]),
  });
  return sha256(canon);
}

// Číslo protokolu: lidsky dohledatelné (kdo + kdy byl protokol vyhotoven).
function protocolNo(bundle) {
  const d = new Date(bundle.generatedAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TJK-SOUHLAS-${ymd}-${String(bundle.member.id).slice(0, 8).toUpperCase()}`;
}

function protocolFileName(bundle) {
  const safe = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `protokol-souhlasy-${safe(bundle.member.lastName) || 'clen'}-${safe(bundle.member.firstName)}-${String(bundle.member.id).slice(0, 8)}.html`;
}

// ── 3) TISKNUTELNÝ PROTOKOL (HTML → PDF tiskem) ─────────────────────────────
// Záměrně serverem vykreslené samostatné HTML: funguje bez JS i bez aplikace,
// drží se v prohlížeči i v archivu a jde z něj udělat PDF (Cmd+P).
function protocolHtml(bundle, opts) {
  const o = opts || {};
  const nonce = o.nonce || '';
  const m = bundle.member;

  const integrityLabel = (c) => (c.integrity === 'OK'
    ? '<span class="ok">OTISK ODPOVÍDÁ — znění nebylo od podpisu změněno</span>'
    : c.integrity === 'CHYBI_TEXT'
      ? '<span class="bad">CHYBÍ ZNĚNÍ TÉTO VERZE — nelze prokázat</span>'
      : '<span class="bad">OTISK NESOUHLASÍ — znění se od podpisu změnilo</span>');

  const rows = bundle.consents.map((c) => `
      <tr>
        <td>${esc(c.title)}<div class="mono hash-inline">SHA-256 ${esc(c.contentHash)}</div></td>
        <td class="c">v${esc(c.version)}</td>
        <td>${esc(c.signerLabel)}</td>
        <td>${esc(c.grantedAtLabel)}</td>
        <td class="mono">${esc(c.identity)}</td>
        <td class="mono">${esc(c.ip)}</td>
        <td class="${c.integrity === 'OK' ? 'ok' : 'bad'}">${c.integrity === 'OK' ? 'v pořádku' : (c.integrity === 'CHYBI_TEXT' ? 'chybí znění' : 'nesouhlasí')}</td>
      </tr>`).join('');

  const docs = bundle.consents.map((c) => `
    <section class="doc">
      <h2>${esc(c.title)} <span class="ver">verze ${esc(c.version)}</span></h2>
      <table class="meta">
        <tr><th>Kdo potvrdil</th><td>${esc(c.signerLabel)} — ${esc(c.identity)}</td></tr>
        <tr><th>Datum a čas</th><td>${esc(c.grantedAtLabel)} (${esc(c.grantedAt)})</td></tr>
        <tr><th>Odkud</th><td class="mono">IP ${esc(c.ip)}${c.userAgent ? ' · ' + esc(c.userAgent) : ''}</td></tr>
        <tr><th>Otisk znění (SHA-256)</th><td class="mono">${esc(c.contentHash)}</td></tr>
        <tr><th>Kontrola integrity</th><td>${integrityLabel(c)}</td></tr>
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
<title>Protokol o elektronickém souhlasu — ${esc(m.name)} — ${esc(bundle.protocolNo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #f1f3f7; color: #14181f;
         font: 11pt/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
  .sheet { max-width: 860px; margin: 0 auto 22px; background: #fff; padding: 30px 34px;
           box-shadow: 0 10px 30px rgba(0,0,0,.12); border-radius: 6px; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -.01em; }
  h2 { font-size: 12.5pt; margin: 0 0 8px; }
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
  .ok { color: #0b6b45; font-weight: 700; }
  .bad { color: #b3261e; font-weight: 700; }
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
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin: 26px 0 4px; }
  .sign-line { border-bottom: 1px solid #111; height: 48px; }
  .sign-label { font-size: 8.5pt; color: #5a6472; margin-top: 5px; }
  .sign-sub { font-size: 9.5pt; font-weight: 600; margin-top: 2px; }
  @media print { .sign { page-break-inside: avoid; } }
  .toolbar { max-width: 860px; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; }
  .toolbar button, .toolbar a { font: inherit; font-size: 10pt; padding: 9px 16px; border-radius: 8px;
        border: 1px solid #111; background: #111; color: #fff; cursor: pointer; text-decoration: none; font-weight: 600; }
  .toolbar a.ghost { background: #fff; color: #111; }
  .toolbar span { font-size: 9pt; color: #5a6472; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; margin: 0; }
    .toolbar { display: none; }
    .doc { page-break-before: always; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
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
      <h1>Protokol o elektronickém souhlasu</h1>
      <div class="sub">Doklad o tom, jaké znění dokumentů člen potvrdil, kdy a odkud — s ověřením integrity.</div>
      <div class="sub no">Číslo protokolu: ${esc(bundle.protocolNo)} · vyhotoveno ${esc(fmtCz(bundle.generatedAt))}</div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Člen</h3>
        <dl>
          <div><dt>Jméno a příjmení</dt><dd>${esc(m.name)}</dd></div>
          <div><dt>Datum narození</dt><dd>${esc(m.birthDate || '—')}</dd></div>
          <div><dt>E-mail</dt><dd class="mono">${esc(m.email || '—')}</dd></div>
          <div><dt>Telefon</dt><dd>${esc(m.phone || '—')}</dd></div>
          <div><dt>Typ členství</dt><dd>${esc(m.membershipType || '—')}</dd></div>
        </dl>
      </div>
      <div class="box">
        <h3>Identifikace v systému</h3>
        <dl>
          <div><dt>ID člena</dt><dd class="mono">${esc(m.id)}</dd></div>
          <div><dt>Stav</dt><dd>${esc(m.status || '—')}</dd></div>
          <div><dt>Členství platné</dt><dd>${esc(fmtCz(m.validFrom))} – ${esc(fmtCz(m.validUntil))}</dd></div>
          <div><dt>Zákonný zástupce</dt><dd>${esc(m.guardianName ? m.guardianName + ' (' + (m.guardianEmail || '') + ')' : 'nevyžaduje se')}</dd></div>
          <div><dt>Potvrzených dokumentů</dt><dd>${esc(bundle.summary.signed)}</dd></div>
        </dl>
      </div>
    </div>

    <h2 style="margin-top:20px">1. Přehled potvrzených dokumentů</h2>
    ${bundle.consents.length ? `<table>
      <thead><tr><th>Dokument</th><th>Verze</th><th>Potvrdil</th><th>Datum a čas</th><th>Identita</th><th>IP adresa</th><th>Integrita</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p class="note">Člen zatím nepotvrdil žádný dokument.</p>'}

    <h2>2. Úplné znění potvrzených dokumentů</h2>
    <p class="note">Každý dokument je uveden ve znění verze, kterou člen potvrdil (ne v případném novějším znění).
      V tištěné/uložené podobě je tak znění zachováno i tehdy, kdyby aplikace nebo její databáze zanikla.</p>
    ${docs || '<p class="note">—</p>'}

    <h2 style="margin-top:22px">3. Prohlášení o způsobu potvrzení</h2>
    <p class="note">
      Člen potvrdil výše uvedené dokumenty elektronicky ve členské aplikaci Tělovýchovné jednoty Krupka, z.s.,
      po přihlášení do svého účtu (identita: ${esc(m.email || '—')}). Systém u každého souhlasu ukládá verzi
      dokumentu, otisk znění (SHA-256), datum a čas potvrzení, e-mailovou identitu podepisujícího a IP adresu,
      ze které byl souhlas udělen — viz přehled v části 1. Otisk se počítá ze znění v okamžiku podpisu, proto
      se každá dodatečná změna textu projeví rozporem, který odhalí kontrola podle části 4.
      U nezletilých potvrzuje příslušné dokumenty zákonný zástupce (uveden u jednotlivých souhlasů).
    </p>

    <div class="sign">
      <div>
        <div class="sign-line"></div>
        <div class="sign-label">Člen — jméno, příjmení a podpis</div>
        <div class="sign-sub">${esc(m.name)}</div>
      </div>
      <div>
        <div class="sign-line"></div>
        <div class="sign-label">Za Tělovýchovnou jednotu Krupka, z.s. — jméno, funkce a podpis</div>
        <div class="sign-sub">${esc(o.issuedBy || '')}</div>
      </div>
    </div>

    <div class="foot">
      <h2 style="margin-top:22px">4. Jak protokol ověřit</h2>
      <strong>Postup:</strong> u každého dokumentu je otisk SHA-256 znění. Ověření spočívá v přepočtu
      tohoto otisku ze znění uloženého v systému a v porovnání s otiskem v okamžiku podpisu — v aplikaci to provede
      kontrola <span class="mono">#/souhlasy → Moje dokumenty</span> nebo administrátorská kontrola
      <span class="mono">GET /api/documents/verify</span> (skript <span class="mono">node scripts/verify-consents.js</span>).
      Přepisovat znění ručně a počítat otisk z přepisu nedoporučujeme — otisk je vypočten ze znakové podoby
      (včetně zlomů řádků), kterou tisk buď zachová, nebo ne.
      <br /><br />
      Otisk tohoto vyhotovení protokolu: <span class="mono">${esc(bundle.fingerprint)}</span><br />
      Vyhotovil(a): ${esc(o.issuedBy || 'aplikace členské evidence Tělovýchovná jednota Krupka, z.s.')} · ${esc(fmtCz(bundle.generatedAt))}
    </div>
  </div>

  <script nonce="${esc(nonce)}">
    document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
  </script>
</body>
</html>`;
}

// ── 4) SOUHRNNÁ KONTROLA VŠECH SOUHLASŮ („je to pořád v pořádku?“) ──────────
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
  consentEvidence,
  evidenceBundle,
  protocolHtml,
  protocolFileName,
  protocolNo,
  fingerprint,
  verifyAll,
};
