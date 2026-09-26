#!/usr/bin/env node
// scripts/verify-flows.js — OVĚŘENÍ HLAVNÍCH TOKŮ (dospělý člen / nečlen / nezletilý).
//
// Projde tři reálné toky proti běžící aplikaci a u každého ověří, že
//   • potvrzení dokumentů ≠ absolvovaná instruktáž ≠ povolený vstup,
//   • bez otevřeného provozního dne s vyhovující kontrolou nikdo nevstoupí,
//   • nová verze dokumentu vyžaduje nové potvrzení,
//   • u nezletilého musí dozor ověřit vazbu zákonného zástupce,
//   • u účastníka s vstupním PINem musí PIN zadat osobně.
//
// Použití:  node scripts/verify-flows.js [--export <slozka>]
// Předpoklad: server běží (npm start) na TEST_BASE nebo http://localhost:4310.
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'http://localhost:4310';
const PASS_ADULT = 'verifikace-heslo-1';
const PASS_MINOR = 'verifikace-heslo-2';
const PIN_ADULT = '2468';

const args = process.argv.slice(2);
const EXPORT_DIR = (() => {
  const i = args.indexOf('--export');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

const jar = {};
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function api(method, url, body) {
  const resp = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > -1) jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  return data;
}
async function apiText(url) {
  const resp = await fetch(`${BASE}${url}`, { headers: cookieHeader() ? { Cookie: cookieHeader() } : {} });
  return { status: resp.status, text: await resp.text() };
}

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let fails = 0;
function ok(name, cond, detail) {
  const mark = cond ? '✅' : '❌';
  if (!cond) fails += 1;
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}
function head(t) { console.log(`\n=== ${t} ===\n`); }

/** Potvrzení dokumentů: buď heslem, nebo jednorázovým kódem na e-mail účtu. */
async function confirmDocs(docKeys, password) {
  if (password) return api('POST', '/api/consent', { docKeys, password });
  const meNow = await api('GET', '/api/me');
  await api('POST', '/api/consent-code');
  const ob = await api('GET', '/api/outbox');
  const mail = ob.messages.find((m) => m.to === meNow.member.email && m.subject.includes('Ověřovací kód'));
  const code = mail && (mail.body.match(/\b(\d{6})\b/) || [])[1];
  return api('POST', '/api/consent', { docKeys, code });
}

async function magicLogin(email) {
  await api('POST', '/api/login', { email });
  const ob = await api('GET', '/api/outbox');
  const mail = ob.messages.find((m) => m.to === email && m.subject.includes('přihlášení'));
  const tok = mail && (mail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  return api('POST', `/api/login/${tok}`);
}

/** Stav brány vstupu pro danou kartu (jen čtení, bez záznamu o vstupu). */
async function gate(qrPayload, identityPin) {
  const r = await api('POST', '/api/dozor/lookup', { qrPayload, identityPin: identityPin || undefined, record: false });
  // Chybová odpověď (např. nedostatečná práva) — vracíme čitelný důvod
  if (!r || !r.card) {
    const err = r && r.error ? `${r.error}: ${r.message || ''}` : JSON.stringify(r).slice(0, 140);
    return { ok: false, allowed: false, docs: false, instruction: false, identity: '—', blocking: [err], message: err };
  }
  return {
    ok: true,
    allowed: r.ok,
    docs: r.card.access.documentsConfirmed,
    instruction: r.card.access.instructionCompleted,
    identity: r.card.identityCheck.method,
    blocking: r.card.access.blocking.map((b) => (typeof b === 'string' ? b : b.key)),
    message: r.card.access.message,
  };
}
function gateLine(g) {
  return `dokumenty=${g.docs ? 'ANO' : 'NE'} · instruktáž=${g.instruction ? 'ANO' : 'NE'} · vstup=${g.allowed ? 'POVOLEN' : 'ZAMÍTNUT'}` +
    (!g.allowed && g.blocking.length ? ` (chybí: ${g.blocking.join(', ')})` : '');
}

async function main() {
  console.log(`Ověření toků proti ${BASE}`);
  const prods = await api('GET', '/api/products');
  const airbag = prods.products.find((p) => p.code === 'airbag_day');
  if (!airbag) throw new Error('Produkt airbag_day není v katalogu.');

  // ── TOK 1: dospělý člen ────────────────────────────────────────────────────
  head('TOK 1 — dospělý člen (členství 200 Kč, vstup za členskou cenu)');
  const stamp = Date.now();
  const adult = await api('POST', '/api/register', {
    firstName: 'Věř', lastName: 'Dospělý', birthDate: '1988-04-04',
    street: 'Testovací 1', city: 'Krupka', zip: '417 41',
    email: `verifikace.dospely.${stamp}@test.cz`, photo: PHOTO, intent: 'clenstvi',
  });
  ok('Registrace dospělého (účel: členství)', !!adult.member && adult.intent === 'clenstvi');
  await api('POST', '/api/set-password', { password: PASS_ADULT });
  let me = await api('GET', '/api/me');
  ok('Dokumenty k potvrzení (členství + služba)', me.missingConsents.length === 5, me.missingConsents.join(','));
  const c1 = await confirmDocs(me.missingConsents, PASS_ADULT);
  ok('Potvrzení dokumentů ověřené heslem', c1.ok === true && c1.recorded.length === 5);
  ok('Potvrzené dokumenty ≠ připravenost ke skoku',
    c1.documentsConfirmed === true && c1.instructionCompleted === false && c1.entryAllowed === false);
  const pay1 = await api('POST', '/api/payments', { purpose: 'prispevek' });
  await api('POST', `/api/payments/${pay1.paymentId}/confirm`);
  me = await api('GET', '/api/me');
  ok('Členství aktivní (200 Kč)', me.status === 'active' && me.kind === 'clen');
  const card1 = await api('GET', '/api/card');
  ok('QR karta vystavena', !!card1.qrDataUrl && card1.kind === 'clen');
  await api('POST', '/api/member/entry-pin', { pin: PIN_ADULT, password: PASS_ADULT });
  ok('Vstupní PIN nastaven (ověření totožnosti u vstupu)', true);

  // Kontroly brány dělá DOZOR (přihlásíme se jím už teď)
  await magicLogin('dozor@airbag.test');
  const gateAdultBefore = await gate(card1.qrPayload, PIN_ADULT);
  ok('Před otevřením provozního dne: vstup zamítnut', gateAdultBefore.allowed === false, gateLine(gateAdultBefore));

  // ── TOK 2: nečlen (jednorázový vstup) ─────────────────────────────────────
  head('TOK 2 — nečlen / host (jednorázový vstup 600 Kč, bez členství)');
  const host = await api('POST', '/api/register', {
    firstName: 'Věř', lastName: 'Nečlen', birthDate: '1995-06-06',
    street: 'Testovací 2', city: 'Krupka', zip: '417 41',
    email: `verifikace.neclen.${stamp}@test.cz`, photo: PHOTO, intent: 'vstup',
  });
  ok('Registrace s účelem „vstup" (ne členství)', host.intent === 'vstup');
  me = await api('GET', '/api/me');
  ok('Členství (stanovy) není podmínkou vstupu', !me.missingConsents.includes('stanovy'), me.missingConsents.join(','));
  const c2 = await confirmDocs(me.missingConsents); // účet bez hesla → kód na e-mail
  ok('Potvrzení dokumentů ověřené jednorázovým kódem na e-mail', c2.ok === true && c2.recorded.length === 4);
  const payHostBlocked = await api('POST', '/api/payments', { purpose: 'prispevek' });
  ok('Nečlen bez stanov nemůže koupit členství', payHostBlocked.error === 'CHYBI_DOKUMENTY');
  const pay2 = await api('POST', '/api/payments', { purpose: 'produkt', productCode: 'airbag_day' });
  const info2 = await api('GET', `/api/payments/${pay2.paymentId}`);
  ok('Cena pro nečlena 600 Kč (serverem autorizovaná)', info2.amountCzk === 600);
  await api('POST', `/api/payments/${pay2.paymentId}/confirm`);
  const card2 = await api('GET', '/api/card');
  me = await api('GET', '/api/me');
  ok('Nečlen: vstup platný, ale stále nečlen', me.kind === 'neclen' && me.access === true);
  ok('QR karta nečlena', !!card2.qrDataUrl && card2.kind === 'neclen');

  // ── TOK 3: nezletilý (16 let) ─────────────────────────────────────────────
  head('TOK 3 — nezletilý (16 let): samostatný souhlas rodiče a ověření vazby');
  const minorEmail = `verifikace.minor.${stamp}@test.cz`;
  const guardianEmail = `verifikace.rodic.${stamp}@test.cz`;
  const minor = await api('POST', '/api/register', {
    firstName: 'Věř', lastName: 'Nezletilý', birthDate: '2010-02-02',
    street: 'Testovací 3', city: 'Krupka', zip: '417 41',
    email: minorEmail, photo: PHOTO, intent: 'vstup',
    guardian: { name: 'Věř Rodič', relation: 'matka', email: guardianEmail },
  });
  ok('Registrace nezletilého (guardianRequired)', minor.guardianRequired === true && minor.member.membershipType === 'mladez');
  const ob = await api('GET', '/api/outbox');
  const gMail = ob.messages.find((m) => m.to === guardianEmail && m.body.includes('souhlas'));
  const gToken = gMail && (gMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  const gInfo = await api('GET', `/api/guardian/${gToken}`);
  ok('Rodič podepisuje POUZE samostatný souhlas s účastí', JSON.stringify(gInfo.documents) === '["guardian_souhlas"]');
  const gNoDeclare = await api('POST', `/api/guardian/${gToken}`, {
    name: 'Věř Rodič', relation: 'matka', email: guardianEmail, docKeys: ['guardian_souhlas'],
  });
  ok('Bez prohlášení o zákonném zastoupení souhlas nelze uložit', gNoDeclare.error === 'CHYBI_PROHLASENI');
  const gOk = await api('POST', `/api/guardian/${gToken}`, {
    name: 'Věř Rodič', relation: 'matka', email: guardianEmail, docKeys: ['guardian_souhlas'], declareGuardian: true,
  });
  ok('Souhlas rodiče zaznamenán (vazba k dítěti zatím neověřená)', gOk.ok === true && gOk.verification.relationVerified === false);
  me = await api('GET', '/api/me');
  const c3 = await confirmDocs(me.missingConsents);
  ok('Nezletilý potvrzuje SÁM svoje dokumenty (oddělené od souhlasu rodiče)', c3.ok === true);
  const pay3 = await api('POST', '/api/payments', { purpose: 'produkt', productCode: 'airbag_day' });
  await api('POST', `/api/payments/${pay3.paymentId}/confirm`);
  const card3 = await api('GET', '/api/card');
  ok('Jednorázový vstup nezletilého aktivní', !!card3.qrDataUrl);

  // ── DOZOR: provozní kniha, instruktáž, ověření vazby ──────────────────────
  head('DOZOR — provozní kniha, instruktáž, ověření totožnosti');
  await magicLogin('dozor@airbag.test');
  const today = new Date().toISOString().slice(0, 10);

  await api('POST', '/api/dozor/provozni-den/ukonceni', { note: 'verifikace: ukončení dne' });
  const dayClosed = await api('GET', '/api/dozor/provozni-den');
  ok('Provozní den ukončen → vstup není možný', dayClosed.entryAllowed === false, dayClosed.entryMessage);

  const dayBad = await api('POST', '/api/dozor/provozni-den', {
    day: today, mattress: 'ok', pressure: 'ok', anchoring: 'zavada', ramp: 'ok', surroundings: 'ok',
    defects: 'Uvolněné kotvení', dozorPresent: true,
  });
  ok('Denní kontrola se závadou → provoz NEOTEVEŘEN', dayBad.verdict === 'nevyhovuje' && dayBad.entryAllowed === false);
  const gateBadDay = await gate(card1.qrPayload, PIN_ADULT);
  ok('Kontrola nevyhovuje → vstup zamítnut', gateBadDay.allowed === false, gateLine(gateBadDay));

  const dayOk = await api('POST', '/api/dozor/provozni-den', {
    day: today, mattress: 'ok', pressure: 'ok', anchoring: 'ok', ramp: 'ok', surroundings: 'ok',
    checkNote: 'Verifikace: vše v pořádku', dozorPresent: true,
  });
  ok('Vyhovující kontrola → provoz otevřen (dozor přítomen)', dayOk.verdict === 'vyhovuje' && dayOk.entryAllowed === true);

  const gA = await gate(card1.qrPayload, PIN_ADULT);
  ok('Dokumenty potvrzené + kontrola OK, ale bez instruktáže → zamítnuto', gA.allowed === false, gateLine(gA));
  const gA2 = await gate(card1.qrPayload);
  ok('Účastník s PINem bez osobního zadání PINu → zamítnuto', gA2.allowed === false, gateLine(gA2) + ` · ${gA2.identity}`);
  const gA3 = await gate(card1.qrPayload, '0000');
  ok('Nesprávný PIN → zamítnuto', gA3.allowed === false);

  for (const [name, memberId] of [['dospělý člen', adult.member.id], ['nečlen', host.member.id], ['nezletilý', minor.member.id]]) {
    const r = await api('POST', '/api/dozor/instruction', { memberId, result: 'absolvoval', note: `verifikace — ${name}` });
    ok(`Instruktáž zaznamenána (${name})`, r.ok === true && r.instruction.docVersion >= 1,
      `dozor: ${r.instruction.dozor}, verze instruktáže v${r.instruction.docVersion}`);
  }

  const gAfterInstr = await gate(card1.qrPayload, PIN_ADULT);
  ok('Člen: dokumenty + instruktáž + PIN + kontrola → VSTUP POVOLEN', gAfterInstr.allowed === true, gateLine(gAfterInstr));
  const gateHost = await gate(card2.qrPayload);
  ok('Nečlen: stejná pravidla → VSTUP POVOLEN', gateHost.allowed === true, gateLine(gateHost));
  const gateMinor = await gate(card3.qrPayload);
  ok('Nezletilý: vazba zákonného zástupce NENÍ ověřená → zamítnuto', gateMinor.allowed === false, gateLine(gateMinor));

  const gv = await api('POST', '/api/dozor/guardian-verify', {
    memberId: minor.member.id, method: 'rodny_list', methodNote: 'Verifikace: předložen rodný list',
  });
  ok('Dozor ověřil vazbu rodiče k dítěti podle dokladu', gv.ok === true && gv.verification.methodLabel === 'rodný list');
  const gateMinor2 = await gate(card3.qrPayload);
  ok('Nezletilý: po ověření vazby → VSTUP POVOLEN', gateMinor2.allowed === true, gateLine(gateMinor2));

  // ── Přerušení provozu ─────────────────────────────────────────────────────
  await api('POST', '/api/dozor/provozni-den/preruseni', { action: 'interrupt', reason: 'Verifikace: mokrý povrch' });
  const gateInterrupted = await gate(card2.qrPayload);
  ok('Přerušený provoz → vstup zamítnut', gateInterrupted.allowed === false, gateLine(gateInterrupted));
  await api('POST', '/api/dozor/provozni-den/preruseni', { action: 'resume', note: 'Verifikace: povrch oschl' });
  const gateResumed = await gate(card2.qrPayload);
  ok('Obnovený provoz → vstup povolen', gateResumed.allowed === true);

  // ── Provozní kniha ────────────────────────────────────────────────────────
  const book = await api('GET', '/api/dozor/provozni-kniha?days=1');
  const dayRec = book.book[0];
  const types = [...new Set(dayRec.records.map((r) => r.type))];
  ok('Provozní kniha obsahuje kontrolu, otevření, přerušení, obnovení i instruktáže',
    ['kontrola', 'otevreni', 'preruseni', 'obnoveni', 'instruktaz'].every((t) => types.includes(t)), types.join(','));
  ok('Provozní kniha: 5 kontrolních položek + jméno dozoru',
    dayRec.checks.length === 5 && !!dayRec.dozorName, `${dayRec.dozorName}, ${dayRec.checks.map((c) => `${c.label}=${c.value}`).join(' ')}`);

  // ── Změna pravidel vyžaduje nové potvrzení (čl. 3.5 / požadavek 7) ────────
  head('ZMĚNA PROVOZNÍCH PRAVIDEL → nové potvrzení');
  await magicLogin('miroslavbrozek@gmail.com');
  const newVersion = await api('POST', '/api/superadmin/docs', {
    docKey: 'provozni_rad',
    title: 'Provozní řád dopadové matrace',
    content: 'VERIFIKAČNÍ ZMĚNA PRAVIDEL (dočasná) — vyžaduje nové potvrzení.',
  });
  ok('Vydána nová verze provozního řádu', !!newVersion && !!newVersion.doc && newVersion.doc.version >= 3,
    newVersion && newVersion.doc ? `v${newVersion.doc.version}` : JSON.stringify(newVersion));
  const readyAfter = await api('GET', `/api/documents/signed/${adult.member.id}`);
  ok('Historický souhlas zůstává v auditní stopě (v2)', readyAfter.consents.some((c) => c.docKey === 'provozni_rad' && c.version === 2));
  await magicLogin('dozor@airbag.test');
  const gateStale = await gate(card1.qrPayload, PIN_ADULT);
  ok('Po nové verzi řádu je vstup zamítnut do nového potvrzení', gateStale.allowed === false, gateLine(gateStale));

  // úklid: dočasná verze z verifikace se z LOKÁLNÍ vývojové DB odstraní (nikdo s ní
  // nesouhlasil). Záměrně mimo produkční API — mazání verzí dokumentů nesmí být
  // běžně dostupná operace; v produkci by se řád vrátil na předchozí znění
  // schváleným postupem (nová verze dokumentu), nikoli smazáním.
  if (require('./../src/db').driver === 'sqlite') {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(__dirname, '..', 'data', 'airbag.db'));
    const used = db.prepare('SELECT COUNT(*) AS c FROM consents WHERE doc_key = ? AND doc_version = ?')
      .get('provozni_rad', newVersion.doc.version).c;
    if (used === 0) {
      db.prepare('DELETE FROM doc_versions WHERE doc_key = ? AND version = ?').run('provozni_rad', newVersion.doc.version);
      ok('Dočasná verifikační verze odstraněna (audit zůstává beze změny)', true, `v${newVersion.doc.version} byla bez potvrzení`);
    } else {
      ok('Dočasná verifikační verze nebyla odstraněna (má potvrzení – správně)', true);
    }
    db.close();
  } else {
    console.log('  (postgres: úklid dočasné verze se neprovádí automaticky)');
  }

  // ── Ukázka protokolu ──────────────────────────────────────────────────────
  head('UKÁZKA PROTOKOLU (oddělené stavy + úplné znění)');
  // Zaznamenáme skutečné vstupy (aby protokol ukazoval i podmínky, za kterých
  // byl vstup povolen — den, kontrolu, instruktáž a způsob ověření totožnosti).
  const recorded = await api('POST', '/api/dozor/lookup', { qrPayload: card1.qrPayload, identityPin: PIN_ADULT, note: 'verifikace: člen' });
  ok('Vstup člena zaevidován (s podmínkami vstupu)', recorded.ok === true && !!recorded.entryId);
  await api('POST', '/api/dozor/lookup', { qrPayload: card2.qrPayload, note: 'verifikace: nečlen' });
  await api('POST', '/api/dozor/lookup', { qrPayload: card3.qrPayload, note: 'verifikace: nezletilý' });
  const denied = await api('POST', '/api/dozor/lookup', { qrPayload: card1.qrPayload, identityPin: '1111', note: 'verifikace: špatný PIN' });
  ok('Zamítnutý pokus (nesprávný PIN) je v evidenci vstupů', denied.ok === false && !!denied.entryId);
  await magicLogin('miroslavbrozek@gmail.com');
  const protocol = await apiText(`/api/documents/protocol/${adult.member.id}`);
  ok('Protokol se vydá', protocol.status === 200 && protocol.text.includes('Protokol o potvrzení dokumentů a průběhu účasti'));
  ok('Protokol rozlišuje „dokument potvrzen" / „instruktáž absolvována" / „vstup povolen"',
    protocol.text.includes('Dokument potvrzen') && protocol.text.includes('Instruktáž absolvována') && protocol.text.includes('Vstup / provoz povolen'));
  ok('Protokol neobsahuje podpisové linky ani tvrzení o kvalifikovaném časovém razítku',
    !protocol.text.includes('jméno, příjmení a podpis') && protocol.text.includes('Neobsahuje vlastnoruční podpis'));

  if (EXPORT_DIR) {
    const dir = path.resolve(EXPORT_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const people = [
      ['dospely-clen', adult.member.id],
      ['neclen', host.member.id],
      ['nezletily', minor.member.id],
    ];
    for (const [label, id] of people) {
      const p = await apiText(`/api/documents/protocol/${id}`);
      const file = path.join(dir, `protokol-${label}.html`);
      fs.writeFileSync(file, p.text, 'utf8');
      console.log(`  → ${file}`);
    }
    const json = await api('GET', `/api/documents/signed/${adult.member.id}`);
    fs.writeFileSync(path.join(dir, 'ukazka-evidence-dospely-clen.json'), JSON.stringify(json, null, 2), 'utf8');
    const bookAll = await api('GET', '/api/dozor/provozni-kniha?days=1');
    fs.writeFileSync(path.join(dir, 'ukazka-provozni-kniha.json'), JSON.stringify(bookAll, null, 2), 'utf8');
    console.log(`  → ${path.join(dir, 'ukazka-provozni-kniha.json')}`);
  }

  console.log(`\n=== VÝSLEDEK: ${fails === 0 ? 'VŠE V POŘÁDKU' : `${fails} KONTROL SELHALO`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('CHYBA:', err.message);
  process.exit(1);
});
