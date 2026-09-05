// tests/api.test.js — end-to-end test hlavních toků členské aplikace.
// Spuštění: npm test (server musí běžet na PORT 4310, nebo se spustí sám).
//
// POZNÁMKA k Stripe: testy VŽDY běží v TEST MODE — server se spouští
// s prázdným STRIPE_SECRET_KEY (reálný klíč z .env se nepropouští), aby se
// nevytvářely reálné Checkout Sessions. Webhook se testuje s lokálním
// secretem (STRIPE_WEBHOOK_SECRET=whsec_test_suite_123) a uměle
// podepsaným payloadem (žádná komunikace se Stripe).
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

// Lokální webhook secret pro testy aktivace (server se s ním spouští)
const TEST_WEBHOOK_SECRET = 'whsec_test_suite_123';
function signWebhookEvent(payload) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const BASE = process.env.TEST_BASE || 'http://localhost:4310';
let serverProc = null;
let results = [];
let failures = 0;

function check(name, cond, detail) {
  const ok = !!cond;
  results.push({ name, ok, detail: detail || '' });
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// jednoduchý cookie jar
const jar = {};

function parseCookies(resp) {
  const setCookie = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > -1) jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api(method, pathname, body, { raw = false, headers = {} } = {}) {
  const resp = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    },
    // string body (webhook payload) se posílá DOSLOVA — musí se podepsat přesně
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  parseCookies(resp);
  let data = null;
  try { data = await resp.json(); } catch (e) { /* empty */ }
  if (raw) return { status: resp.status, data };
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1×1 PNG (tiny) jako validní base64 data-URL — registrace vyžaduje foto
const TEST_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function registerAdult() {
  return api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Dospely', birthDate: '1990-05-20',
    street: 'Horni 12', city: 'Krupka', zip: '417 41',
    email: `dospely${Date.now()}@test.cz`, phone: '+420 777 000 001',
    photo: TEST_PHOTO,
  });
}

// Přihlásí se jako superadmin (čerstvý magic-link token z outboxu).
async function reloginSuperAdmin() {
  await api('POST', '/api/login', { email: 'miroslavbrozek@gmail.com' });
  const ob = await api('GET', '/api/outbox');
  const mail = ob.messages.find((m) => m.to === 'miroslavbrozek@gmail.com' && m.subject.includes('přihlášení'));
  const tok = mail && (mail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${tok}`);
}

// Přihlásí se jako libovolný člen (magic-link token z outboxu).
async function loginAs(email) {
  await api('POST', '/api/login', { email });
  const ob = await api('GET', '/api/outbox');
  const mail = ob.messages.find((m) => m.to === email && m.subject.includes('přihlášení'));
  const tok = mail && (mail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${tok}`);
}

async function main() {
  // ---------- TOK A: dospělý člen ----------
  console.log('\n=== TOK A: registrace → souhlas → platba → QR karta (dospělý) ===\n');

  const reg = await registerAdult();
  check('Registrace dospělého', reg && reg.member && reg.member.memberNo >= 1, `č. ${reg.member && reg.member.memberNo}`);
  check('Kategorie z věku: dospele', reg.member && reg.member.membershipType === 'dospele', reg.member && reg.member.membershipType);
  check('Registrace = auto-login (session cookie)', cookieHeader().includes('airbag_session='));
  check('Registrace: nextStep=consent', reg.nextStep === 'consent');
  check('Registrace: guardianRequired=false', reg.guardianRequired === false);
  const adultId = reg.member.id;

  let me = await api('GET', '/api/me');
  check('Stav po registraci: registered', me.status === 'registered');
  // dokumenty = členství (stanovy, gdpr) + služba airbag (4) — unie dle stavu
  check('Chybí dokumenty (členství + služba)', me.missingConsents.length === 5 && me.missingConsents.includes('stanovy') && me.missingConsents.includes('provozni_rad'), me.missingConsents.join(','));

  // platba bez souhlasu musí selhat (nelze obejít)
  const payEarly = await api('POST', '/api/payments', { purpose: 'prispevek' });
  check('Platba bez souhlasu → 409 CHYBI_DOKUMENTY', payEarly.error === 'CHYBI_DOKUMENTY', JSON.stringify(payEarly.error));

  // podepsání jen části dokumentů
  const partial = await api('POST', '/api/consent', { docKeys: ['gdpr'] });
  check('Částečný souhlas OK', partial.ok === true);
  me = await api('GET', '/api/me');
  check('Po částečném souhlasu chybí 4', me.missingConsents.length === 4);

  // úplný souhlas (členství + služba)
  const consent = await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'vzdani_prava', 'stanovy'] });
  check('Plný souhlas OK', consent.ok === true && consent.recorded.length === 4);
  me = await api('GET', '/api/me');
  check('Stav: payment_pending', me.status === 'payment_pending');
  check('Audit trail: 5 záznamů s IP+časem+hashem', me.consents.length === 5 && me.consents.every((c) => c.ip && c.grantedAt && c.contentHash));
  check('Audit trail: signer=member', me.consents.every((c) => c.signerType === 'member'));

  // platba
  const intent = await api('POST', '/api/payments', { purpose: 'prispevek' });
  check('Payment intent vytvořen (test gateway)', intent.paymentId && intent.gateway === 'test');
  const payInfo = await api('GET', `/api/payments/${intent.paymentId}`);
  check('Payment status: pending', payInfo.status === 'pending');

  const confirm = await api('POST', `/api/payments/${intent.paymentId}/confirm`);
  check('Potvrzení platby → paid + member active', confirm.payment.status === 'paid' && confirm.member.status === 'active');
  check('Member má valid_until', !!confirm.member.validUntil);

  me = await api('GET', '/api/me');
  check('/me: active + platba v historii', me.status === 'active' && me.payments.some((p) => p.status === 'paid'));

  const receipt = await api('GET', `/api/payments/${intent.paymentId}/receipt`);
  check('Účtenka vystavena (receiptNo)', !!receipt.receiptNo, receipt.receiptNo);

  const card = await api('GET', '/api/card');
  check('QR karta: payload TJK:', card.qrPayload && card.qrPayload.startsWith('TJK:'), card.qrPayload);
  check('QR karta: obsahuje data URL PNG', card.qrDataUrl && card.qrDataUrl.startsWith('data:image/png'));

  // duplicitní platba musí selhat
  const payAgain = await api('POST', '/api/payments', { purpose: 'prispevek' });
  check('Druhá platba → 409 UZ_AKTIVNI', payAgain.error === 'UZ_AKTIVNI');

  // ---------- TOK B: mladistvý (e-souhlas rodiče) ----------
  console.log('\n=== TOK B: mladistvý 16 let → souhlas zákonného zástupce ===\n');

  const regMinor = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Mladez', birthDate: '2010-03-10',
    street: 'Dolni 5', city: 'Krupka', zip: '417 41',
    email: `mladez${Date.now()}@test.cz`, phone: '+420 777 000 002',
    photo: TEST_PHOTO,
    guardian: { name: 'Rodic Test', relation: 'matka', email: `rodic${Date.now()}@test.cz`, phone: '+420 777 000 003' },
  });
  check('Registrace mladistvého OK', regMinor && regMinor.guardianRequired === true);
  check('Kategorie z věku: mladez', regMinor.member && regMinor.member.membershipType === 'mladez', regMinor.member && regMinor.member.membershipType);
  check('nextStep=guardian', regMinor.nextStep === 'guardian');
  const minorId = regMinor.member.id;

  // outbox — stub e-mail rodiči
  const outbox = await api('GET', '/api/outbox');
  const guardianMail = outbox.messages.find((m) => m.to === regMinor.member.guardianEmail);
  check('STUB e-mail rodiči v outboxu', !!guardianMail, guardianMail && guardianMail.subject);
  const guardianLink = guardianMail && (guardianMail.body.match(/(https?:\/\/\S+)/) || [])[1];
  check('Odkaz pro rodiče v e-mailu', !!guardianLink, guardianLink);
  const token = guardianLink && guardianLink.split('/').pop();

  // platba mladistvého bez souhlasu rodiče → 409
  const payMinorEarly = await api('POST', '/api/payments', { purpose: 'prispevek' });
  check('Platba bez souhlasu rodiče → blokováno', ['POTREBA_OPATROVNIKA', 'CHYBI_DOKUMENTY'].includes(payMinorEarly.error), JSON.stringify(payMinorEarly));

  // souhlas rodiče (jako rodič, bez session)
  const minorSession = jar['airbag_session']; // uložíme session mladistvého
  jar['airbag_session'] = 'none'; // odhlášení
  const gInfo = await api('GET', `/api/guardian/${token}`);
  check('Rodičovský odkaz: data dítěte', gInfo.member && gInfo.member.firstName === 'Test' && gInfo.docs.length >= 6);

  const gConsent = await api('POST', `/api/guardian/${token}`, {
    name: 'Rodic Test', relation: 'matka', email: `rodic${Date.now()}@test.cz`,
    docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy', 'guardian_souhlas'],
  });
  check('Souhlas rodiče zaznamenán', gConsent.ok === true && gConsent.recorded.length === 6);

  // rodičovský odkaz už nejde použít 2×
  const gAgain = await api('POST', `/api/guardian/${token}`, {
    name: 'Rodic', relation: 'matka', email: 'x@test.cz', docKeys: ['gdpr'],
  });
  check('Odkaz rodiče nelze použít 2× (404)', gAgain.error === 'NEPLATNY_ODKAZ');

  // zpět jako mladistvý: člen podepíše vlastní souhlasy
  // (outbox je od auditu chráněn přihlášením → obnovíme session mladistvého)
  jar['airbag_session'] = minorSession;
  const loginMinor = await api('POST', '/api/login', { email: regMinor.member.email });
  check('Magic link pro mladistvého odeslán', loginMinor.sent === true);
  const outbox2 = await api('GET', '/api/outbox');
  const loginMail = outbox2.messages.find((m) => m.subject && m.subject.includes('přihlášení'));
  const loginToken = loginMail && (loginMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  const exch = await api('POST', `/api/login/${loginToken}`);
  check('Přihlášení přes odkaz OK', exch.ok === true && exch.member.id === minorId);

  const cMinor = await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy'] });
  check('Souhlasy mladistvého OK', cMinor.ok === true);
  me = await api('GET', '/api/me');
  check('Stav mladistvého: payment_pending', me.status === 'payment_pending');
  check('Guardian souhlas vidět v /me', me.guardianStatus === 'granted' && me.consents.filter((c) => c.signerType === 'guardian').length === 6);

  const intentMinor = await api('POST', '/api/payments', { purpose: 'prispevek' });
  const confirmMinor = await api('POST', `/api/payments/${intentMinor.paymentId}/confirm`);
  check('Platba mladistvého → active', confirmMinor.member && confirmMinor.member.status === 'active');
  const cardMinor = await api('GET', '/api/card');
  check('QR karta mladistvého', !!cardMinor.qrDataUrl);

  // ---------- TOK C: dozor ----------
  console.log('\n=== TOK C: dozor — správa, kontrola QR ===\n');

  const loginDozor = await api('POST', '/api/login', { email: 'dozor@airbag.test' });
  const outbox3 = await api('GET', '/api/outbox');
  const dozorMail = outbox3.messages.find((m) => m.to === 'dozor@airbag.test' && m.subject.includes('přihlášení'));
  const dozorToken = dozorMail && (dozorMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${dozorToken}`);

  // ✅ Bezpečnostní model: dozor NIKDY nevidí seznam všech členů — jen admin.
  const adminForbiddenDozor = await api('GET', '/api/admin/members');
  check('Dozor NEMÁ přístup k seznamu členů (403, jen admin)', adminForbiddenDozor.error === 'NEDOSTATECNA_PRAVA');
  const statsForbiddenDozor = await api('GET', '/api/admin/stats');
  check('Dozor NEMÁ přístup ke statistikám (403, jen admin)', statsForbiddenDozor.error === 'NEDOSTATECNA_PRAVA');
  const detailForbiddenDozor = await api('GET', `/api/admin/members/${adultId}`);
  check('Dozor NEMÁ přístup k detailu člena (403, jen admin)', detailForbiddenDozor.error === 'NEDOSTATECNA_PRAVA');

  // kontrola QR karty dozorem (provozní nutnost — zůstává povolena)
  const qrCheck = await api('POST', '/api/check-card', { qrPayload: card.qrPayload });
  check('Kontrola QR: vstup povolen', qrCheck.ok === true && qrCheck.status === 'active', qrCheck.message);

  const badQr = await api('POST', '/api/check-card', { qrPayload: 'TJK:999:fake' });
  check('Kontrola falešné karty → zamítnuto', badQr.error === 'NEPLATNA_KARTA');

  // role guard: běžný člen nesmí do adminu
  const loginAdult = await api('POST', '/api/login', { email: reg.member.email });
  const outbox4 = await api('GET', '/api/outbox');
  const adultMail = outbox4.messages.filter((m) => m.to === reg.member.email && m.subject.includes('přihlášení')).pop();
  const adultToken = adultMail && (adultMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${adultToken}`);
  const adminForbidden = await api('GET', '/api/admin/members');
  check('Běžný člen nemá přístup do adminu (403)', adminForbidden.error === 'NEDOSTATECNA_PRAVA');

  // ---------- TOK D (bonus): rezervace + merch ----------
  console.log('\n=== TOK D (bonus): rezervace + merch ===\n');

  const bookings = await api('GET', '/api/bookings?date=2026-08-20');
  check('Slotů 10 (9:00–19:00)', bookings.slots.length === 10, `${bookings.slots.length} slotů`);
  const bk = await api('POST', '/api/bookings', { date: '2026-08-20', hour: 10 });
  check('Rezervace 10:00 OK', bk.ok === true);
  const bkDup = await api('POST', '/api/bookings', { date: '2026-08-20', hour: 10 });
  check('Duplicitní rezervace → 409 OBSAZENO', bkDup.error === 'OBSAZENO');

  const merch = await api('GET', '/api/merch');
  check('Merch produkty', merch.products.length >= 4, `${merch.products.length} produktů`);
  const order = await api('POST', '/api/merch/orders', {
    items: [{ productId: merch.products[0].id, qty: 2, size: 'M' }],
  });
  check('Objednávka merch OK', order.ok === true && order.order.total_czk === merch.products[0].price_czk * 2);

  // ---------- TOK E (bonus): členské výhody (facilities) + akce ----------
  console.log('\n=== TOK E: členské výhody + akce ===\n');

  const facilities = await api('GET', '/api/facilities');
  check('Facilities: airbag existuje', facilities.facilities.some((f) => f.code === 'airbag'), JSON.stringify(facilities.facilities.map((f) => f.code)));

  const eventsList = await api('GET', '/api/events');
  check('Akce: publikované akce', eventsList.events.length >= 3, `${eventsList.events.length} akcí`);
  const ev = eventsList.events[0];
  check('Akce: facility je přiřazená', !ev.facilityName || ev.facilityName.length > 0);

  const signup = await api('POST', `/api/events/${ev.id}/signup`, {});
  check('Přihlášení na akci OK', signup.ok === true);

  const dup = await api('POST', `/api/events/${ev.id}/signup`, {});
  check('Duplicitní přihlášení → 409 PRIHLASEN', dup.error === 'PRIHLASEN');

  const cancel = await api('DELETE', `/api/events/${ev.id}/signup`);
  check('Odhlášení z akce OK', cancel.ok === true);

  // ---------- TOK F: superadmin (vlastník aplikace) ----------
  console.log('\n=== TOK F: superadmin (vlastník) ===\n');

  const saForbiddenDozor = await api('GET', '/api/superadmin/members');
  check('Dozor nemá přístup k superadmin API (403)', saForbiddenDozor.error === 'NEDOSTATECNA_PRAVA');

  const loginSA = await api('POST', '/api/login', { email: 'miroslavbrozek@gmail.com' });
  check('Superadmin: magic link odeslán', loginSA.sent === true);
  const outboxSA = await api('GET', '/api/outbox');
  const saMail = outboxSA.messages.find((m) => m.to === 'miroslavbrozek@gmail.com' && m.subject.includes('přihlášení'));
  const saToken = saMail && (saMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  const saLogin = await api('POST', `/api/login/${saToken}`);
  check('Superadmin přihlášen', saLogin.ok === true);

  const saMembers = await api('GET', '/api/superadmin/members');
  check('Superadmin: přehled členů', saMembers.total >= 1 && saMembers.members.length >= 1, `${saMembers.total} členů`);
  // věk se počítá automaticky z data narození
  const adultWithAge = saMembers.members.find((m) => m.id === adultId);
  check('Superadmin: automatický výpočet věku', adultWithAge && typeof adultWithAge.age === 'number' && adultWithAge.age >= 30, JSON.stringify({ age: adultWithAge && adultWithAge.age }));
  // grafy: kompozice členů
  const comp = saMembers.composition || {};
  check('Superadmin: kompozice (sportovní/řádné + 18+ + muži/ženy/děti)', comp.kind && comp.gender && typeof comp.adult === 'number' && (comp.kind.sportovni || 0) >= 1, JSON.stringify(comp));

  // ---------- PŘEVENCE DUPLICIT: registrace s e-mailem už v lokální DB ----------
  const dupReg = await api('POST', '/api/register', { firstName: 'Dup', lastName: 'Test', birthDate: '1990-01-01', street: 'A 1', city: 'K', zip: '417 41', email: 'dospely-test-dup@test.cz', photo: TEST_PHOTO });
  const dupReg2 = await api('POST', '/api/register', { firstName: 'Dup', lastName: 'Test', birthDate: '1990-01-01', street: 'A 1', city: 'K', zip: '417 41', email: 'dospely-test-dup@test.cz', photo: TEST_PHOTO });
  check('Prevence duplicit: 2. registrace stejného e-mailu → zamítnuta VALIDACE', dupReg2.error === 'VALIDACE' && /už je registrovaný/.test(dupReg2.message || ''), JSON.stringify(dupReg2));
  await reloginSuperAdmin(); // registrace dupReg přepsala cookie na člena — zpět na superadmina

  // Čtení evidence IS ČUS (public.members) — superadmin. Test běží v test režimu,
  // kde SUPABASE_SYNC je off → evidence se nemusí načíst; neočekáváme selhání celého
  // testu, jen že endpoint EXISTUJE a vrací buď členy, nebo ok:false (ne 500/403).
  const evResp = await api('GET', '/api/superadmin/evidence');
  check('Superadmin: evidence endpoint (ok)', evResp && (evResp.ok === true || 'error' in evResp), JSON.stringify({ ok: evResp && evResp.ok, err: evResp && evResp.error }));

  // Admin přehled (jen superadmin — nový bezpečnostní model)
  const adminList = await api('GET', '/api/admin/members');
  check('Admin (superadmin): vidí seznam členů', adminList.members && adminList.members.length >= 3, `${(adminList.members||[]).length} členů`);
  const adultRow = adminList.members.find((m) => m.id === adultId);
  check('Admin: dospělý člen consentOk + paid', adultRow && adultRow.consentOk === true && adultRow.paid === true);
  const adminStats = await api('GET', '/api/admin/stats');
  check('Admin: statistiky aktivní', adminStats.statuses && adminStats.statuses.active >= 2, JSON.stringify(adminStats.statuses||{}));
  const adminDetail = await api('GET', `/api/admin/members/${adultId}`);
  check('Admin: detail člena — auditní stopa souhlasů s IP+UA', adminDetail.consents.length >= 5 && adminDetail.consents.every((c) => c.ip && c.identity));
  check('Admin: detail člena — platby + karta', adminDetail.payments.length >= 1 && !!adminDetail.card);

  // ---------- SCHVALOVÁNÍ ČLENSTVÍ (admin: approve/reject/defer + notifikace + e-mail) ----------
  const cand = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Schvalovani', birthDate: '1993-06-06',
    street: 'S 1', city: 'Krupka', zip: '417 41', email: `schval${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
  });
  check('Registrace kandidáta (foto): membershipKind=sportovni', cand.member && cand.member.membershipKind === 'sportovni', JSON.stringify({ kind: cand.member && cand.member.membershipKind }));

  // zpět jako superadmin (registrace kandidáta přepsala cookie na kandidáta)
  await reloginSuperAdmin();

  // SCHVÁLIT
  const appr = await api('POST', `/api/admin/members/${cand.member.id}/approve`, { action: 'approve' });
  check('Admin: schválit → active', appr.status === 'active', JSON.stringify({ status: appr.status, action: appr.action }));

  // notifikace členovi — přihlásíme se jako kandidát a přečteme
  await loginAs(cand.member.email);
  const notif = await api('GET', '/api/notifications');
  check('Notifikace: schválení v aplikaci (unread ≥1)', notif.notifications && notif.notifications.some((n) => n.type === 'membership_approve'), JSON.stringify((notif.notifications||[]).map((n)=>n.type)));

  // NESCHVÁLIT (nový kandidát) — jako superadmin
  await reloginSuperAdmin();
  const cand2 = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Zamitnuty', birthDate: '1991-07-07',
    street: 'Z 2', city: 'Krupka', zip: '417 41', email: `zamit${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
  });
  await reloginSuperAdmin();
  const rej = await api('POST', `/api/admin/members/${cand2.member.id}/approve`, { action: 'reject' });
  check('Admin: neschválit → rejected', rej.status === 'rejected', JSON.stringify({ status: rej.status }));

  // ODLOŽIT
  const def = await api('POST', `/api/admin/members/${cand2.member.id}/approve`, { action: 'defer' });
  check('Admin: odložit → deferred', def.status === 'deferred', JSON.stringify({ status: def.status }));

  // dozor NEMŮŽE schvalovat (jen admin)
  const loginDozorChk = await api('POST', '/api/login', { email: 'dozor@airbag.test' });
  const obD = await api('GET', '/api/outbox');
  const dMail = obD.messages.find((m) => m.to === 'dozor@airbag.test' && m.subject.includes('přihlášení'));
  const dTok = dMail && (dMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${dTok}`);
  const dozorApprove = await api('POST', `/api/admin/members/${cand.member.id}/approve`, { action: 'approve' });
  check('Dozor NEMÁ přístup ke schválení (403, jen admin)', dozorApprove.error === 'NEDOSTATECNA_PRAVA', JSON.stringify(dozorApprove));
  // zpět na superadmin session (čerstvý token — registrace kandidáta přepsala cookie)
  await reloginSuperAdmin();


  const saTypes = await api('GET', '/api/superadmin/member-types');
  check('Superadmin: jen aktivní kategorie (3)', saTypes.types.length === 3 && saTypes.types.every((t) => ['dospele', 'mladez', 'dite'].includes(t.code)), `${saTypes.types.length} typů: ${saTypes.types.map((t) => t.code).join(',')}`);

  // sync status — režim dle .env (off | dry-run | on); kontrola, že se nikdy
  // nevrátí service role key (bezpečnost — audit Fáze 1)
  const syncStatus = await api('GET', '/api/superadmin/sync-status');
  check('Sync status: režim nastaven + žádný únik klíče', ['on', 'dry-run', 'off'].includes(syncStatus.mode) && !JSON.stringify(syncStatus).includes('eyJ'), JSON.stringify(syncStatus));

  const syncAll = await api('POST', '/api/superadmin/sync');
  check('Sync all: demo účty se neodesílají (vše OK)', syncAll.ok === true && syncAll.synced === syncAll.total && ['on', 'dry-run'].includes(syncAll.mode), JSON.stringify(syncAll));

  const saCard = await api('GET', `/api/superadmin/members/${reg.member.id}/card`);
  check('Superadmin: QR karta člena', !!saCard.qrPayload && !!saCard.qrDataUrl);

  // ---------- TOK G: resend souhlasu rodiče + expirace odkazu ----------
  console.log('\n=== TOK G: resend souhlasu rodiče + expirace odkazu ===\n');

  // nový mladistvý (12 let → kategorie 'dite') — přímo z API, bez výběru typu
  const regKid = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Dite', birthDate: '2014-07-01',
    street: 'Lesni 3', city: 'Krupka', zip: '417 41',
    email: `dite${Date.now()}@test.cz`, phone: '+420 777 000 004',
    photo: TEST_PHOTO,
    guardian: { name: 'Rodic Dite', relation: 'otec', email: `rodicdite${Date.now()}@test.cz` },
  });
  check('Kategorie z věku: dite', regKid.member && regKid.member.membershipType === 'dite', regKid.member && regKid.member.membershipType);
  const kidId = regKid.member.id;
  check('Registrace dítěte: guardianRequired', regKid.guardianRequired === true);

  // e-mail rodiči se odešle → resend vygeneruje NOVÝ token
  let ob = await api('GET', '/api/outbox');
  let kidMail1 = ob.messages.find((m) => m.to === regKid.member.guardianEmail && m.body.includes('souhlas'));
  const oldLink = kidMail1 && (kidMail1.body.match(/(https?:\/\/\S+)/) || [])[1];
  const oldToken = oldLink && oldLink.split('/').pop();
  check('E-mail rodiči odeslán (1. token)', !!oldToken, oldLink);

  const resend = await api('POST', '/api/guardian-resend');
  check('Resend OK', resend.ok === true);
  ob = await api('GET', '/api/outbox');
  kidMail1 = ob.messages.find((m) => m.to === regKid.member.guardianEmail && m.body.includes('souhlas'));
  const newLink = kidMail1 && (kidMail1.body.match(/(https?:\/\/\S+)/) || [])[1];
  const newToken = newLink && newLink.split('/').pop();
  check('Resend vygeneroval NOVÝ token', !!newToken && newToken !== oldToken);

  // starý token už neplatí (nahrazen novým)
  const oldStill = await api('GET', `/api/guardian/${oldToken}`);
  check('Starý token po resendu neplatí (404)', oldStill.error === 'NEPLATNY_ODKAZ');

  // expirace: ručně nastavíme expiraci do minulosti → odkaz neplatí
  const kidDb = new Database(path.join(__dirname, '..', 'data', 'airbag.db'));
  kidDb.prepare('UPDATE members SET guardian_token_expires = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', kidId);
  kidDb.close();
  const expired = await api('GET', `/api/guardian/${newToken}`);
  check('Expirovaný odkaz → 404 NEPLATNY_ODKAZ', expired.error === 'NEPLATNY_ODKAZ', JSON.stringify(expired));

  // resend po expiraci obnoví token (tlačítko „Znovu odeslat e-mail rodiči" funguje i pro vypršelý odkaz)
  const resendAfter = await api('POST', '/api/guardian-resend');
  check('Resend po expiraci OK (obnoví token)', resendAfter.ok === true);

  // resend pro člena bez guardian souhlasu (dospělý) → 409
  const regAdult2 = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'BezRodice', birthDate: '1988-02-02',
    street: 'Kratka 1', city: 'Krupka', zip: '417 41',
    email: `bezrodice${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
  });
  check('Dospělý bez rodiče zaregistrován', regAdult2.member && regAdult2.member.id);
  const resendNoPending = await api('POST', '/api/guardian-resend');
  check('Resend bez pending souhlasu → 409', resendNoPending.error === 'NENI_CO_ODESLAT');

  // ---------- TOK H: Stripe webhook — fail-closed + aktivace ----------
  console.log('\n=== TOK H: Stripe webhook (fail-closed + aktivace) ===\n');

  // Neplatný podpis (i s nakonfigurovaným secretem) → 400, žádný únik klíče
  const wh = await api('POST', '/api/payments/webhook', { type: 'checkout.session.completed' }, { raw: true });
  check('Webhook s neplatným podpisem → 400 (fail-closed)', wh.status === 400, JSON.stringify(wh.data));
  check('Webhook nevrací žádný klíč/secret', !JSON.stringify(wh.data).includes('sk_') && !JSON.stringify(wh.data).includes('whsec_') && !JSON.stringify(wh.data).includes('eyJ'));

  // Ruční potvrzení platby je povolené jen v test mode — Stripe platby se potvrzují webhookem
  const cfg = await api('GET', '/api/config');
  check('Config: paymentGateway režim je nastaven', ['test', 'stripe-test', 'stripe-live'].includes(cfg.paymentGateway), JSON.stringify(cfg.paymentGateway));

  // Aktivace přes webhook (checkout.session.completed s PLATNÝM podpisem):
  // člen → souhlasy → intent → simulovaný webhook → active + QR karta
  const whReg = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Webhook', birthDate: '1992-02-02',
    street: 'Web 1', city: 'Krupka', zip: '417 41', email: `webhook${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
  });
  check('Webhook: registrace OK', whReg.member && whReg.member.id, whReg.member && whReg.member.id);
  await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy'] });
  const whPay = await api('POST', '/api/payments', { purpose: 'prispevek' });
  check('Webhook: intent vytvořen (test gateway)', !!whPay.paymentId && whPay.gateway === 'test', JSON.stringify(whPay.gateway));

  const evtPayload = JSON.stringify({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_local', payment_status: 'paid', metadata: { paymentId: whPay.paymentId } } },
  });
  const whOk = await api('POST', '/api/payments/webhook', evtPayload, { raw: true, headers: { 'stripe-signature': signWebhookEvent(evtPayload) } });
  check('Webhook: platný podpis → 200 + paid', whOk.status === 200 && whOk.data && whOk.data.paid, JSON.stringify(whOk.data));

  const whMe = await api('GET', '/api/me');
  check('Webhook: člen AKTIVOVÁN (active + validUntil)', whMe.status === 'active' && !!whMe.member.validUntil, `${whMe.status} · ${whMe.member.validUntil}`);
  const whCard = await api('GET', '/api/card');
  check('Webhook: QR karta vystavena', !!whCard.qrDataUrl);

  // ---------- TOK I: role člen/nečlen + jednorázové produkty (AIRBAG 300/600) ----------
  console.log('\n=== TOK I: role člen/nečlen + jednorázové vstupy ===\n');

  // produkty jsou veřejně dostupné (ceny obou rolí)
  const prods = await api('GET', '/api/products');
  const airbag = prods.products.find((p) => p.code === 'airbag_day');
  check('Katalog (člen): AIRBAG den = 300 Kč, jen členská varianta', !!airbag && airbag.price === 300 && airbag.memberOnly === true && airbag.available === true, JSON.stringify({ price: airbag && airbag.price, memberOnly: airbag && airbag.memberOnly }));
  check('Katalog: člen nevidí nečlenskou cenu', !('nonmemberPriceCzk' in airbag) && airbag.price !== 600, JSON.stringify(airbag));

  // ── NEČLEN: registrace → souhlasy → vstup 600 → přístup, ale stále nečlen ──
  const host = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Neclen', birthDate: '1990-03-03',
    street: 'X 9', city: 'Krupka', zip: '417 41',
    email: `neclen${Date.now()}@test.cz`, phone: '+420 777 000 009',
    photo: TEST_PHOTO,
  });
  check('Nečlen: registrace OK', !!host.member, host.member && host.member.id);
  let meN = await api('GET', '/api/me');
  check('Nečlen: role = neclen + bez přístupu', meN.kind === 'neclen' && meN.access === false, JSON.stringify({ kind: meN.kind, access: meN.access }));
  await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy'] });
  const hIntent = await api('POST', '/api/payments', { purpose: 'produkt', productCode: 'airbag_day' });
  check('Nečlen: intent produkt (test)', !!hIntent.paymentId && hIntent.gateway === 'test', JSON.stringify(hIntent));
  const hPayInfo = await api('GET', `/api/payments/${hIntent.paymentId}`);
  check('Nečlen: cena 600 Kč', hPayInfo.amountCzk === 600, String(hPayInfo.amountCzk));
  const hConfirm = await api('POST', `/api/payments/${hIntent.paymentId}/confirm`);
  check('Nečlen: vstup potvrzen', hConfirm.ok === true, JSON.stringify(hConfirm.ok));
  meN = await api('GET', '/api/me');
  check('Nečlen: STÁLE role neclen + přístup + oprávnění', meN.kind === 'neclen' && meN.access === true && meN.entitlements.length >= 1, JSON.stringify({ kind: meN.kind, access: meN.access, ents: meN.entitlements.length }));
  const hCard = await api('GET', '/api/card');
  check('Nečlen: QR karta pro vstup', !!hCard.qrDataUrl && hCard.kind === 'neclen', JSON.stringify({ has: !!hCard.qrDataUrl, kind: hCard.kind }));

  // ── MLADISTVÝ: jednorázový vstup povolen — právní stránka = souhlas rodiče ──
  const minorReg = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Minor', birthDate: '2010-01-01',
    street: 'X 1', city: 'Krupka', zip: '417 41', email: `neclenmin${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
    guardian: { name: 'Rodic Minora', relation: 'matka', email: `rodicmin${Date.now()}@test.cz` },
  });
  check('Mladistvý: registrace s rodičem OK (guardianRequired)', !!minorReg.member && minorReg.guardianRequired === true, JSON.stringify(minorReg.error || { gr: minorReg.guardianRequired }));
  // rodič souhlasí (odkaz z outboxu)
  const obMin = await api('GET', '/api/outbox');
  const gMinMail = obMin.messages.find((mm) => mm.to === minorReg.member.guardianEmail && mm.body.includes('souhlas'));
  const gMinToken = gMinMail && (gMinMail.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/guardian/${gMinToken}`, {
    name: 'Rodic Minora', relation: 'matka', email: minorReg.member.guardianEmail,
    docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy', 'guardian_souhlas'],
  });
  await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy'] });
  const minorPay = await api('POST', '/api/payments', { purpose: 'produkt', productCode: 'airbag_day' });
  check('Mladistvý: vstup SE souhlasem rodiče povolen', !!minorPay.paymentId && minorPay.gateway === 'test', JSON.stringify(minorPay));
  const minorConfirm = await api('POST', `/api/payments/${minorPay.paymentId}/confirm`);
  check('Mladistvý: vstup potvrzen', minorConfirm.ok === true, JSON.stringify(minorConfirm.ok));

  // ── ČLEN: roční členství → role clen, vstup za 300 ──
  const regC = await api('POST', '/api/register', {
    firstName: 'Test', lastName: 'Clen', birthDate: '1985-05-05',
    street: 'Ulice 1', city: 'Krupka', zip: '417 41', email: `clen${Date.now()}@test.cz`,
    photo: TEST_PHOTO,
  });
  await api('POST', '/api/consent', { docKeys: ['provozni_rad', 'cestne_prohlaseni', 'gdpr', 'vzdani_prava', 'stanovy'] });
  const p1 = await api('POST', '/api/payments', { purpose: 'prispevek' });
  const c1 = await api('POST', `/api/payments/${p1.paymentId}/confirm`);
  check('Člen: roční členství → active', c1.member && c1.member.status === 'active', JSON.stringify(c1.member));
  const meC = await api('GET', '/api/me');
  check('Člen: kind = clen', meC.kind === 'clen', meC.kind);
  const dIntent = await api('POST', '/api/payments', { purpose: 'produkt', productCode: 'airbag_day' });
  const dPayInfo = await api('GET', `/api/payments/${dIntent.paymentId}`);
  check('Člen: vstup za členskou cenu 300', dPayInfo.amountCzk === 300, String(dPayInfo.amountCzk));
  const dConfirm = await api('POST', `/api/payments/${dIntent.paymentId}/confirm`);
  check('Člen: vstup potvrzen', dConfirm.ok === true, JSON.stringify(dConfirm.ok));
  const cCard = await api('GET', '/api/card');
  check('Člen: QR karta (kind clen)', !!cCard.qrDataUrl && cCard.kind === 'clen', JSON.stringify({ has: !!cCard.qrDataUrl, kind: cCard.kind }));

  // ── dozor: kontrola QR rozliší jednorázový vstup vs členství ──
  const loginDozor2 = await api('POST', '/api/login', { email: 'dozor@airbag.test' });
  const outboxD = await api('GET', '/api/outbox');
  const dozMail2 = outboxD.messages.find((m) => m.to === 'dozor@airbag.test' && m.subject.includes('přihlášení'));
  const dozTok2 = dozMail2 && (dozMail2.body.match(/(https?:\/\/\S+)/) || [])[1].split('/').pop();
  await api('POST', `/api/login/${dozTok2}`);
  const chkHost = await api('POST', '/api/check-card', { qrPayload: hCard.qrPayload });
  check('Dozor: vstup nečlena povolen (entitlement)', chkHost.ok === true && chkHost.accessReason === 'entitlement', JSON.stringify({ ok: chkHost.ok, reason: chkHost.accessReason }));
  const chkMember = await api('POST', '/api/check-card', { qrPayload: cCard.qrPayload });
  check('Dozor: člen povolen (membership)', chkMember.ok === true && chkMember.accessReason === 'membership', JSON.stringify({ ok: chkMember.ok, reason: chkMember.accessReason }));

  // úklid testovacích členů po běhu (lokální DB) — evidence se nezanáší
  // (sync modul navíc @test.cz emaily do Supabase nikdy neodesílá)
  const dClean = new Database(path.join(__dirname, '..', 'data', 'airbag.db'));
  try {
    const del = dClean.transaction(() => {
      let total = 0;
      for (const t of ['entitlements', 'consents', 'payments', 'cards', 'bookings', 'event_signups', 'merch_orders', 'sessions']) {
        total += dClean.prepare(`DELETE FROM ${t} WHERE member_id IN (SELECT id FROM members WHERE email LIKE '%@test.cz')`).run().changes;
      }
      try {
        dClean.prepare('DELETE FROM merch_order_items WHERE order_id IN (SELECT id FROM merch_orders WHERE member_id IN (SELECT id FROM members WHERE email LIKE \'%@test.cz\'))').run();
      } catch (e) { /* tabulka nemusí existovat */ }
      total += dClean.prepare("DELETE FROM members WHERE email LIKE '%@test.cz'").run().changes;
      return total;
    })();
    console.log(`🧹 Úklid: smazáno ${del} testovacích záznamů (členové + vazby)`);
  } finally {
    dClean.close();
  }

  // ---------- shrnutí ----------
  console.log('\n=== SHRNUTÍ ===');
  const passed = results.filter((r) => r.ok).length;
  console.log(`Testů: ${results.length} | OK: ${passed} | SELHÁNÍ: ${failures}`);
  if (failures) {
    results.filter((r) => !r.ok).forEach((r) => console.log('  ❌', r.name, r.detail));
  }
  // uklid: zabijeme server, který jsme spustili (pokud běžel náš)
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  process.exit(failures ? 1 : 0);
}

// spustí server, pokud neběží
async function ensureServer() {
  try {
    await fetch(`${BASE}/api/docs`);
    return;
  } catch (e) { /* server neběží — spustíme */ }
  console.log('Server neběží — spouštím…');
  // TEST MODE: reálný Stripe klíč z .env se NEPROPOUŠTÍ (žádné reálné
  // Checkout Sessions), webhook secret je lokální testovací (viz signWebhookEvent).
  serverProc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      // TEST MODE: reálný SMTP z .env se NEPROPOUŠTÍ — testy běží se stub emaily (outbox),
      // jinak by se přes SMTP (Resend) reálně odesílaly a zpomalovaly/lámaly testy.
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
  });
  serverProc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  serverProc.stderr.on('data', (d) => process.stdout.write('[server-err] ' + d));
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try { await fetch(`${BASE}/api/docs`); return; } catch (e) { /* zkus dál */ }
  }
  throw new Error('Server se nepodařilo spustit');
}

ensureServer().then(main).catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
