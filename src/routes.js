// routes.js — REST API členské aplikace.
// Všechny handlery jsou async (datová vrstva vrací Promise v postgres režimu;
// u sqlite je await no-op). asyncRoute posílá chyby do error middleware.
'use strict';

const express = require('express');
const QRCode = require('qrcode');
const D = require('./db');
const A = require('./auth');
const mailer = require('./mailer');
const payments = require('./payments');
const S = require('./supabase-sync');
const E = require('./eligibility');
const { VALIDITY_DAYS } = require('./seed');

const router = express.Router();

const { rateLimit } = require('./rate-limit');
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, name: 'login' });
const registerLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, name: 'register' });
const guardianLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, name: 'guardian' });

// Express 4 neposílá rejected promise do error middleware → obalíme handlery.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


const AGE_REQUIREMENTS = {
  dospele: { min: 18, msg: 'Členství Dospělý je pro osoby starší 18 let.' },
  mladez: { min: 15, max: 18, msg: 'Členství Mládež je pro věk 15–18 let.' },
  dite: { max: 15, msg: 'Členství Dítě je pro děti do 15 let.' },
};

// Kategorie členství se určuje POUZE z věku člena
function membershipTypeForAge(age) {
  if (age < 15) return 'dite';
  if (age < 18) return 'mladez';
  return 'dospele';
}

// Věk z data narození — časově bezpečný výpočet (bez posunu o časové pásmo)
function ageFrom(birthDate) {
  if (!birthDate) return -1;
  let y, m, d;
  if (birthDate instanceof Date && !isNaN(birthDate)) {
    y = birthDate.getUTCFullYear();
    m = birthDate.getUTCMonth() + 1;
    d = birthDate.getUTCDate();
  } else {
    const s = String(birthDate);
    const ym = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (!ym) {
      const dt = new Date(s);
      if (isNaN(dt)) return -1;
      y = dt.getUTCFullYear();
      m = dt.getUTCMonth() + 1;
      d = dt.getUTCDate();
    } else {
      y = Number(ym[1]);
      m = Number(ym[2]);
      d = Number(ym[3] || 1);
    }
  }
  const today = new Date();
  let age = today.getFullYear() - y;
  const md = today.getMonth() + 1 - m;
  if (md < 0 || (md === 0 && today.getDate() < d)) age--;
  return age;
}

function validators() {
  return {
    isEmail: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || ''),
    // Ověří formát YYYY-MM-DD A reálný kalendářní den (2026-02-31 → false)
    isDate: (v) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
      const d = new Date(v);
      if (isNaN(d.getTime())) return false;
      const [y, m, day] = v.split('-').map(Number);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1 && d.getUTCDate() === day;
    },
  };
}

function publicMember(m) {
  if (!m) return null;
  return {
    id: m.id,
    memberNo: m.member_no,
    firstName: m.first_name,
    lastName: m.last_name,
    birthDate: m.birth_date,
    email: m.email,
    phone: m.phone,
    membershipType: m.membership_type,
    role: m.role,
    status: m.status,
    validFrom: m.valid_from,
    validUntil: m.valid_until,
    guardianRequired: m.guardian_status !== 'not_required',
    guardianStatus: m.guardian_status,
    guardianEmail: m.guardian_email,
  };
}

// Dokumenty požadované od uživatele = dokumenty členství + dokumenty služeb,
// na které má podle svého stavu nárok (viz eligibility.js — verzované souhlasy).
async function memberAllConsents(memberId) {
  const m = await D.Members.getById(memberId);
  if (!m) return [];
  const { user } = await E.missingAllDocs(m);
  return user;
}

async function guardianAllConsents(memberId) {
  const m = await D.Members.getById(memberId);
  if (!m) return [];
  const { guardian } = await E.missingAllDocs(m);
  return guardian;
}

async function canPay(m) {
  if (!m) return false;
  const { user, guardian, guardianNotGranted } = await E.missingAllDocs(m);
  return user.length === 0 && !guardianNotGranted && guardian.length === 0;
}

function effectiveStatus(m) {
  if (!m) return null;
  if (m.status === 'active' && m.valid_until && new Date(m.valid_until) < new Date()) {
    return 'expired';
  }
  return m.status;
}

// ---- ROLE UŽIVATELE: člen (zaplacené roční členství + platná platnost) vs nečlen ----
async function isClubMember(m) {
  if (!m) return false;
  if (effectiveStatus(m) !== 'active' || !m.valid_until) return false;
  return D.Payments.hasPaidMembership(m.id);
}
async function userKind(m) {
  return (await isClubMember(m)) ? 'clen' : 'neclen';
}
// Přístup na zařízení: člen NEBO platné jednorázové oprávnění (entitlement)
async function hasAccess(m) {
  if (!m) return false;
  if (await isClubMember(m)) return true;
  return D.Entitlements.hasActive(m.id);
}

// ---------- veřejné: registrace ----------
router.post('/register', registerLimiter, asyncRoute(async (req, res) => {
  const v = validators();
  const b = req.body || {};
  const { firstName, lastName, birthDate, street, city, zip, email, phone } = b;
  const guardian = b.guardian || {};

  const err = (msg) => res.status(400).json({ error: 'VALIDACE', message: msg });
  if (!firstName || !lastName) return err('Jméno a příjmení je povinné.');
  if (!v.isDate(birthDate)) return err('Datum narození je ve špatném formátu (YYYY-MM-DD).');
  if (!v.isEmail(email)) return err('E-mail je ve špatném formátu.');
  if (!street || !city || !zip) return err('Adresa (ulice, město, PSČ) je povinná.');

  // Kontrola smysluplnosti data narození (Fáze 0 — audit): žádná budoucnost,
  // žádné nesmyslné stáří.
  const age = ageFrom(birthDate);
  if (age < 0) return err('Datum narození nemůže být v budoucnosti.');
  if (age > 120) return err('Datum narození je podezřelé (věk nad 120 let).');

  // Typ členství se určuje POUZE z věku — klient ho nemůže ovlivnit
  const membershipType = membershipTypeForAge(age);
  const type = await D.MemberTypes.get(membershipType);
  if (!type) return err('Neznámý typ členství.');

  if (await D.Members.getByEmail(email)) return err('Člen s tímto e-mailem už je registrovaný — přihlaste se.');

  const guardianRequired = !!type.requires_guardian || age < 18;
  if (guardianRequired) {
    if (!guardian.name || !guardian.relation || !guardian.email) {
      return err('U mladistvých je povinný e-mail a jméno zákonného zástupce (rodiče).');
    }
    if (!v.isEmail(guardian.email)) return err('E-mail zákonného zástupce je ve špatném formátu.');
  }

  const guardianToken = guardianRequired ? D.uuid() : null;
  const guardianTokenExpires = guardianRequired
    ? new Date(Date.now() + 7 * 86400 * 1000).toISOString() // odkaz platí 7 dní
    : null;
  const member = await D.Members.create({
    memberNo: await D.Members.nextMemberNo(),
    firstName, lastName, birthDate,
    street, city, zip, email: email, phone: phone || '',
    membershipType,
    status: 'registered',
    guardianName: guardianRequired ? guardian.name : null,
    guardianRelation: guardianRequired ? guardian.relation : null,
    guardianEmail: guardianRequired ? guardian.email : null,
    guardianPhone: guardianRequired ? (guardian.phone || null) : null,
    guardianToken,
    guardianTokenExpires,
    guardianStatus: guardianRequired ? 'pending' : 'not_required',
  });

  // STUB e-mail/SMS zákonnému zástupci (žádné reálné odesílání)
  if (guardianRequired && guardianToken) {
    const link = `${req.protocol}://${req.get('host')}/#/souhlas-rodice/${guardianToken}`;
    await mailer.sendEmail(member.id, guardian.email,
      `Souhlas zákonného zástupce — Tělovýchovná jednota Krupka (${firstName} ${lastName})`,
      `Dobrý den,\n\n${firstName} ${lastName} (nar. ${birthDate}) se registruje jako člen Tělovýchovná jednota Krupka, z.s. pro používání dopadové matrace.\n\nPro udělení souhlasu zákonného zástupce otevřete odkaz:\n${link}\n\nS pozdravem\nTělovýchovná jednota Krupka, z.s.`);
    if (guardian.phone) {
      await mailer.sendSms(member.id, guardian.phone,
        `Tělovýchovná jednota Krupka: souhlas pro ${firstName} ${lastName} — ${link}`);
    }
  }

  // auto-login (člen pokračuje rovnou na souhlasy)
  const token = await D.Sessions.create(member.id, member.role);
  A.setSessionCookie(res, token);

  // asynchronní sync do Supabase evidence (neblokuje odpověď)
  S.upsertMember(member).catch((e) => console.log('[supabase-sync] CHYBA', e.message));

  res.json({
    member: publicMember(member),
    guardianRequired,
    nextStep: guardianRequired ? 'guardian' : 'consent',
  });
}));

// ---------- veřejné: dokumenty (aktuální verze) ----------
router.get('/docs', asyncRoute(async (req, res) => {
  const all = await D.DocVersions.latestAll();
  const docs = all.map((d) => ({
    id: d.id,
    docKey: d.doc_key,
    version: d.version,
    title: d.title,
    content: d.content,
    contentHash: d.content_hash,
    effectiveFrom: d.effective_from,
  }));
  res.json({ docs });
}));

// ---------- veřejná konfigurace (režim e-mailů + plateb + ceny pro UI) ----------
router.get('/config', asyncRoute(async (req, res) => {
  const dHost = await D.MemberTypes.get('denni');
  const dMember = await D.MemberTypes.get('denni_clen');
  res.json({
    emailMode: mailer.smtpEnabled ? 'smtp' : 'stub',
    devInbox: true,
    // 'test' | 'stripe-test' | 'stripe-live' — UI podle toho zobrazí správnou bránu
    paymentGateway: payments.gatewayMode(),
    // ceny denního vstupu (pro UI; zdroj pravdy = tabulka member_types)
    dailyPriceHost: dHost ? dHost.price_czk : null,
    dailyPriceMember: dMember ? dMember.price_czk : null,
  });
}));

// Mapování řádku členské evidence (Supabase) → lokální člen PWA.
// Člen z evidence se při prvním přihlášení doimportuje a pokračuje standardním
// flow (souhlasy → platba). Údaje zákonného zástupce z evidence se převezmou.
async function importFromRegistry(row) {
  const age = ageFrom(row.born);
  const guardianOk = !!(row.name_parents && row.mail_parents);
  return {
    memberNo: await D.Members.nextMemberNo(),
    firstName: row.name, lastName: row.surname, birthDate: row.born,
    street: row.street || '', city: row.city || '', zip: row.zip || row.ZIP_CODE || '',
    email: row.mail, phone: row.phone || '',
    membershipType: membershipTypeForAge(age),
    status: 'registered',
    guardianName: guardianOk ? row.name_parents : null,
    guardianRelation: guardianOk ? (row.vztah || null) : null,
    guardianEmail: guardianOk ? row.mail_parents : null,
    guardianPhone: row.phone_parents || null,
    guardianToken: guardianOk ? D.uuid() : null,
    guardianTokenExpires: guardianOk ? new Date(Date.now() + 7 * 86400 * 1000).toISOString() : null,
    guardianStatus: guardianOk ? 'pending' : 'not_required',
    validFrom: row.member_from || null,
    validUntil: row.member_to || null,
  };
}

// ---------- přihlášení (magic link přes e-mail) ----------
router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const { email } = req.body || {};
  let member = await D.Members.getByEmail(email || '');
  let fromRegistry = false;
  // člen není v lokální DB → zkusit členskou evidenci v Supabase (obousměrné propojení)
  if (!member) {
    const ev = await S.findByEmail(email || '');
    if (ev) {
      // import z evidence: lokální záznam se založí, člen pak projde souhlasy + platbou
      const row = await S.fetchFull(ev.id_cus).catch(() => null);
      if (row) {
        const imported = await importFromRegistry(row);
        member = await D.Members.create(imported);
        fromRegistry = true;
        console.log(`[supabase-sync] IMPORT z evidence: ${member.email} (${member.first_name} ${member.last_name})`);
        // nezletilý z evidence s údaji rodiče → rovnou e-mail se souhlasem
        if (member.guardian_status === 'pending' && member.guardian_token) {
          const link = `${req.protocol}://${req.get('host')}/#/souhlas-rodice/${member.guardian_token}`;
          await mailer.sendEmail(member.id, member.guardian_email,
            `Souhlas zákonného zástupce — Tělovýchovná jednota Krupka (${member.first_name} ${member.last_name})`,
            `Dobrý den,\n\n${member.first_name} ${member.last_name} (nar. ${member.birth_date}) se registruje jako člen Tělovýchovná jednota Krupka, z.s.\n\nPro udělení souhlasu zákonného zástupce otevřete odkaz (platí 7 dní):\n${link}\n\nS pozdravem\nTělovýchovná jednota Krupka, z.s.`);
        }
      }
    }
  }
  if (!member) return res.status(404).json({ error: 'NENALEZEN', message: 'Člen s tímto e-mailem není registrovaný.' });
  const token = await D.Sessions.create(member.id, 'login', 15 / 60); // 15 minut
  const link = `${req.protocol}://${req.get('host')}/#/prihlaseni/${token}`;
  const msg = await mailer.sendEmail(member.id, member.email,
    'Odkaz pro přihlášení — Tělovýchovná jednota Krupka členská aplikace',
    `Dobrý den,\n\npro přihlášení do členské aplikace Tělovýchovná jednota Krupka použijte tento odkaz (platí 15 minut):\n${link}\n\nS pozdravem\nTělovýchovná jednota Krupka, z.s.`);
  res.json({ sent: true, devMessageId: msg.id, fromRegistry });
}));

router.post('/login/:token', asyncRoute(async (req, res) => {
  const s = await D.Sessions.get(req.params.token);
  if (!s || s.role !== 'login') return res.status(401).json({ error: 'NEPLATNY_ODKAZ', message: 'Odkaz pro přihlášení je neplatný nebo vypršel.' });
  const member = await D.Members.getById(s.member_id);
  await D.Sessions.delete(s.id);
  const token = await D.Sessions.create(member.id, member.role);
  A.setSessionCookie(res, token);
  res.json({ ok: true, member: publicMember(member) });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = A.parseCookies(req)[A.COOKIE];
  if (token) await D.Sessions.delete(token);
  A.clearSessionCookie(res);
  res.json({ ok: true });
}));

// ---------- přihlášený: stav člena ----------
router.get('/me', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const consents = await D.Consents.listForMember(m.id);
  const paymentsList = await D.Payments.listForMember(m.id);
  const entitlementsList = await D.Entitlements.listForMember(m.id);
  const est = await E.userState(m);
  const kind = est.isMember ? 'clen' : 'neclen';
  const entitlements = [];
  for (const e of entitlementsList) {
    const prod = await D.Products.getById(e.product_id);
    entitlements.push({
      id: e.id, productCode: prod ? prod.code : null, productName: prod ? prod.name : null,
      validFrom: e.valid_from, validUntil: e.valid_until,
    });
  }
  res.json({
    member: publicMember(m),
    // segmentace uživatele (spec): věk + členství + zástupce
    ageType: est.ageType,                     // ADULT | MINOR
    membershipStatus: est.membershipStatus,   // MEMBER | MEMBERSHIP_EXPIRED | MEMBERSHIP_PENDING | NON_MEMBER
    kind,
    access: await hasAccess(m),
    status: effectiveStatus(m),
    missingConsents: await memberAllConsents(m.id),
    missingGuardianConsents: m.guardian_status === 'pending' ? await guardianAllConsents(m.id) : [],
    guardianStatus: m.guardian_status,
    consents: consents.map((c) => ({
      docKey: c.doc_key, version: c.doc_version, signerType: c.signer_type,
      grantedAt: c.granted_at, identity: c.identity, ip: c.ip, contentHash: c.content_hash,
    })),
    payments: paymentsList.map((p) => ({
      id: p.id, amountCzk: p.amount_czk, purpose: p.purpose, productCode: p.product_code,
      status: p.status, gateway: p.gateway, receiptNo: p.receipt_no, paidAt: p.paid_at, createdAt: p.created_at,
    })),
    entitlements,
  });
}));

// ---------- SKUPINY SOUHLASŮ (rozdělený flow: členství → služba → zástupce) ----------
router.get('/consent-groups', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const st = await E.userState(m);
  const memberSigned = await E.signedDocKeysPublic(m.id, 'member');
  const guardianSigned = st.isMinor ? await E.signedDocKeysPublic(m.id, 'guardian') : null;
  const docInfo = async (k) => { const d = await D.DocVersions.latest(k); return d ? { docKey: k, title: d.title, version: d.version } : null; };

  const groups = [];
  // 1) členství
  const mreq = await E.membershipEligibility(m);
  const membershipDocs = [];
  for (const k of mreq.required.user) {
    const info = await docInfo(k);
    if (info) membershipDocs.push({ ...info, signed: !!memberSigned[k] });
  }
  groups.push({ key: 'membership', title: 'Dokumenty k členství TJK', signer: 'user', docs: membershipDocs });

  // 2) služby (pro každý dostupný produkt)
  const prods = await D.Products.listActive();
  for (const p of prods) {
    const variant = await E.resolveVariant(p.id, st);
    if (!variant) continue;
    const docs = D.ProductVariants.parseDocs(variant);
    const list = [];
    for (const k of docs.userDocs) {
      const info = await docInfo(k);
      if (info) list.push({ ...info, signed: !!memberSigned[k] });
    }
    groups.push({ key: 'service:' + p.code, title: `Dokumenty služby — ${p.name}`, signer: 'user', docs: list });
  }

  // 3) zákonný zástupce (jen nezletilý)
  let guardianGroup = null;
  if (st.isMinor) {
    const guardDocs = [];
    const seen = new Set();
    const addGuard = async (k) => {
      if (seen.has(k)) return;
      seen.add(k);
      const info = await docInfo(k);
      if (info) guardDocs.push({ ...info, signed: !!guardianSigned[k] });
    };
    for (const k of E.GUARDIAN_MEMBERSHIP_DOCS) await addGuard(k);
    for (const p of prods) {
      const variant = await E.resolveVariant(p.id, st);
      if (!variant) continue;
      const docs = D.ProductVariants.parseDocs(variant);
      const g = docs.guardianDocs || docs.userDocs;
      for (const k of g) await addGuard(k);
    }
    guardianGroup = {
      key: 'guardian', title: 'Souhlas zákonného zástupce (nezletilý)',
      signer: 'guardian', guardianGranted: st.guardianGranted, guardianEmail: st.guardianEmail, docs: guardDocs,
    };
    groups.push(guardianGroup);
  }

  res.json({ ageType: st.ageType, membershipStatus: st.membershipStatus, groups, guardian: guardianGroup });
}));

// ---------- E-SOUHLAS (člen) — audit trail ----------
router.post('/consent', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const { docKeys } = req.body || {};
  if (!Array.isArray(docKeys) || docKeys.length === 0) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Musíte potvrdit alespoň jeden dokument.' });
  }
  const unknown = [];
  for (const k of docKeys) if (!(await D.DocVersions.latest(k))) unknown.push(k);
  if (unknown.length) return res.status(400).json({ error: 'VALIDACE', message: `Neznámý dokument: ${unknown.join(', ')}` });

  const ip = A.clientIp(req);
  const ua = req.headers['user-agent'] || null;
  const created = [];
  for (const key of docKeys) {
    const doc = await D.DocVersions.latest(key);
    if (!doc) return res.status(500).json({ error: 'CHYBA', message: `Dokument ${key} není v systému.` });
    // nová verze dokumentu = platný je jen souhlas s aktuální verzí (upsert)
    created.push(await D.Consents.create({
      memberId: m.id, docKey: key, docVersion: doc.version, contentHash: doc.content_hash,
      signerType: 'member', identity: m.email, ip, userAgent: ua,
    }));
  }

  // přechod stavu
  let status = m.status;
  const missingMember = await memberAllConsents(m.id);
  if (missingMember.length === 0) {
    if (m.guardian_status === 'pending') status = 'guardian_pending';
    else status = 'payment_pending';
    if (m.status === 'registered') await D.Members.update(m.id, { status });
  }
  res.json({
    ok: true,
    recorded: created.map((c) => ({ id: c.id, docKey: c.doc_key, version: c.doc_version, grantedAt: c.granted_at })),
    status,
    missingConsents: missingMember,
    guardianStatus: m.guardian_status,
  });
}));

// Ověření platnosti guardian odkazu (status pending + neexpirovaný token)
function guardianTokenValid(m) {
  if (!m || m.guardian_status !== 'pending' || !m.guardian_token) return false;
  if (m.guardian_token_expires && new Date(m.guardian_token_expires) < new Date()) return false;
  return true;
}

// ---------- E-SOUHLAS zákonného zástupce (veřejný odkaz) ----------
router.get('/guardian/:token', guardianLimiter, asyncRoute(async (req, res) => {
  const m = await D.Members.getByGuardianToken(req.params.token);
  if (!guardianTokenValid(m)) {
    return res.status(404).json({ error: 'NEPLATNY_ODKAZ', message: 'Odkaz je neplatný, vypršel nebo už byl použit.' });
  }
  const all = await D.DocVersions.latestAll();
  const docs = all.map((d) => ({
    docKey: d.doc_key, version: d.version, title: d.title, content: d.content, contentHash: d.content_hash,
  }));
  res.json({
    member: { firstName: m.first_name, lastName: m.last_name, birthDate: m.birth_date, membershipType: m.membership_type },
    guardian: { name: m.guardian_name, relation: m.guardian_relation, email: m.guardian_email },
    docs,
  });
}));

router.post('/guardian/:token', guardianLimiter, asyncRoute(async (req, res) => {
  const m = await D.Members.getByGuardianToken(req.params.token);
  if (!guardianTokenValid(m)) {
    return res.status(404).json({ error: 'NEPLATNY_ODKAZ', message: 'Odkaz je neplatný, vypršel nebo už byl použit.' });
  }
  const b = req.body || {};
  const { name, relation, email } = b;
  const docKeys = b.docKeys || [];
  if (!name || !relation || !validators().isEmail(email)) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Jméno, vztah a e-mail zákonného zástupce jsou povinné.' });
  }
  const unknown = [];
  for (const k of docKeys) if (!(await D.DocVersions.latest(k))) unknown.push(k);
  if (unknown.length) return res.status(400).json({ error: 'VALIDACE', message: `Neznámý dokument: ${unknown.join(', ')}` });

  const ip = A.clientIp(req);
  const ua = req.headers['user-agent'] || null;
  const created = [];
  for (const key of docKeys) {
    const doc = await D.DocVersions.latest(key);
    created.push(await D.Consents.create({
      memberId: m.id, docKey: key, docVersion: doc.version, contentHash: doc.content_hash,
      signerType: 'guardian', identity: email, ip, userAgent: ua,
    }));
  }

  await D.Members.update(m.id, {
    guardian_name: name,
    guardian_relation: relation,
    guardian_email: email,
    guardian_phone: b.phone || m.guardian_phone,
    guardian_status: 'granted',
    guardian_granted_at: D.now(),
    guardian_ip: ip,
  });

  const updated = await D.Members.getById(m.id);
  let status = updated.status;
  if ((await memberAllConsents(updated.id)).length === 0) {
    status = 'payment_pending';
    if (updated.status !== 'active') await D.Members.update(updated.id, { status });
  }
  res.json({
    ok: true,
    recorded: created.map((c) => ({ id: c.id, docKey: c.doc_key, version: c.doc_version, grantedAt: c.granted_at })),
    status,
  });
}));

// ---------- platby ----------
// Aktivace po úspěšné platbě (sdílené test mode + Stripe webhook):
//   - 'prispevek' → ROČNÍ ČLENSTVÍ (365 dní dle typu, role uživatele = člen)
//   - 'produkt'   → JEDNORÁZOVÝ VSTUP (zakoupí člen i nečlen; členství NEzakládá;
//                   vytvoří oprávnění `entitlement` dle validity_hours produktu)
async function activateMembership(paid) {
  if (!paid) return null;
  const m = await D.Members.getById(paid.member_id);
  if (!m) return null;
  const now = new Date();

  if (paid.purpose === 'produkt') {
    // Jednorázový vstup → oprávnění (entitlement); nemění členskou platnost!
    const product = paid.product_code ? await D.Products.getByCode(paid.product_code) : null;
    if (!product) return null;
    // navazování: další nákup stejného produktu prodlužuje od konce aktuálního oprávnění
    const list = await D.Entitlements.listForMember(m.id);
    const activeEnds = list
      .filter((e) => e.product_id === product.id && new Date(e.valid_until) > now)
      .map((e) => new Date(e.valid_until).getTime());
    const base = activeEnds.length ? Math.max(now.getTime(), ...activeEnds) : now.getTime();
    const from = new Date(now.getTime());
    const until = new Date(base + product.validity_hours * 3600 * 1000);
    const entitlement = await D.Entitlements.create({
      memberId: m.id, productId: product.id, paymentId: paid.id,
      validFrom: from.toISOString(), validUntil: until.toISOString(),
    });
    // QR karta pro kontrolu dozorem
    const cardToken = D.uuid().replace(/-/g, '').slice(0, 20);
    await D.Cards.upsert(m.id, `TJK:${m.member_no}:${cardToken}`);
    // nečlen se do členské evidence (public.members) NEsynchronizuje
    return entitlement;
  }

  // ROČNÍ ČLENSTVÍ (prispevek)
  if (paid.purpose !== 'prispevek') return null;
  const days = VALIDITY_DAYS[m.membership_type] || 365;
  const from = now;
  const until = new Date(from.getTime() + days * 86400 * 1000);
  const member = await D.Members.update(m.id, {
    status: 'active',
    valid_from: from.toISOString(),
    valid_until: until.toISOString(),
  });
  const cardToken = D.uuid().replace(/-/g, '').slice(0, 20);
  await D.Cards.upsert(m.id, `TJK:${m.member_no}:${cardToken}`);
  // aktivní člen → sync platnosti do Supabase evidence (fire-and-forget)
  S.upsertMember(member).catch((e) => console.log('[supabase-sync] CHYBA', e.message));
  return member;
}

router.post('/payments', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const purpose = (req.body || {}).purpose || 'prispevek';
  const orderId = (req.body || {}).orderId;
  const origin = `${req.protocol}://${req.get('host')}`;

  // Stripe, pokud je nakonfigurováno, jinak test mode
  const gateway = payments.stripeEnabled ? 'stripe' : 'test';

  if (purpose === 'prispevek') {
    // Server-side autorizace členství (spec §5,7,18)
    const el = await E.membershipEligibility(m);
    if (el.state.isMember) {
      return res.status(409).json({ error: 'UZ_AKTIVNI', message: 'Členství je už aktivní — příspěvek je uhrazen.' });
    }
    if (!el.ok) {
      if (el.missing.guardianNotGranted) {
        return res.status(403).json({ error: 'POTREBA_OPATROVNIKA', message: 'Členství nezletilého musí potvrdit zákonný zástupce.' });
      }
      return res.status(409).json({
        error: 'CHYBI_DOKUMENTY',
        message: 'Nejprve potvrďte dokumenty k členství.',
        missingConsents: el.missing.user,
        guardianMissing: el.missing.guardian,
      });
    }
    const type = await D.MemberTypes.get(m.membership_type);
    try {
      const intent = await payments.createPaymentIntent({
        memberId: m.id, amountCzk: type.price_czk, purpose, gateway, origin,
      });
      return res.json(intent);
    } catch (err) {
      return res.status(502).json({ error: err.code || 'PLATEBNI_CHYBA', message: err.message });
    }
  }

  if (purpose === 'merch' && orderId) {
    await D.Merch.linkPayment(orderId, null);
    const order = await D.Merch.getOrder(orderId);
    try {
      const intent = await payments.createPaymentIntent({
        memberId: m.id, amountCzk: order.total_czk, purpose, gateway, origin,
      });
      await D.Merch.linkPayment(orderId, intent.paymentId);
      return res.json(intent);
    } catch (err) {
      return res.status(502).json({ error: err.code || 'PLATEBNI_CHYBA', message: err.message });
    }
  }

  // JEDNORÁZOVÝ VSTUP / SLUŽBA (produkt s variantami — spec §14, §18):
  // varianta i CENA se určují výhradně na serveru dle stavu uživatele.
  // Klient nikdy neposílá cenu; člen nemůže koupit PUBLIC (600) a nečlen MEMBER (300).
  if (purpose === 'produkt') {
    const productCode = ((req.body || {}).productCode || '').trim();
    const el = await E.productEligibility(m, productCode);
    if (!el.product) {
      return res.status(400).json({ error: 'VALIDACE', message: 'Neznámá služba.' });
    }
    if (!el.ok) {
      if (el.missing.guardianNotGranted) {
        return res.status(403).json({
          error: 'POTREBA_OPATROVNIKA',
          message: 'Tuto službu musí potvrdit zákonný zástupce.',
        });
      }
      if (!el.variant) {
        return res.status(403).json({ error: 'NEDOSTUPNY_PRODUKT', message: el.message });
      }
      return res.status(409).json({
        error: 'CHYBI_DOKUMENTY',
        message: el.message || 'Nejprve potvrďte povinné dokumenty služby.',
        missingConsents: el.missing.user,
        guardianMissing: el.missing.guardian,
      });
    }
    try {
      const intent = await payments.createPaymentIntent({
        memberId: m.id, amountCzk: el.price, purpose, productCode, gateway, origin,
      });
      return res.json(intent);
    } catch (err) {
      return res.status(502).json({ error: err.code || 'PLATEBNI_CHYBA', message: err.message });
    }
  }

  return res.status(400).json({ error: 'VALIDACE', message: 'Neznámý účel platby.' });
}));

router.get('/payments/:id', A.requireMember, asyncRoute(async (req, res) => {
  const p = await D.Payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'NENALEZENO', message: 'Platba nenalezena.' });
  if (p.member_id !== req.member.id && req.member.role === 'member') {
    return res.status(403).json({ error: 'NEDOSTATECNA_PRAVA' });
  }
  res.json({
    id: p.id, amountCzk: p.amount_czk, purpose: p.purpose, status: p.status,
    gateway: p.gateway, receiptNo: p.receipt_no, paidAt: p.paid_at, createdAt: p.created_at,
    gatewayUrl: `/platba/${p.id}`,
  });
}));

// Simulace callbacku od platební brány — JEN test mode
// (platby přes Stripe se potvrzují výhradně webhookem checkout.session.completed)
router.post('/payments/:id/confirm', A.requireMember, asyncRoute(async (req, res) => {
  const p = await D.Payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'NENALEZENO', message: 'Platba nenalezena.' });
  if (p.member_id !== req.member.id && req.member.role === 'member') {
    return res.status(403).json({ error: 'NEDOSTATECNA_PRAVA' });
  }
  if (p.gateway !== 'test') {
    return res.status(400).json({
      error: 'NEJDE_POTVRDIT',
      message: 'Tato platba se potvrzuje přes platební bránu (Stripe), ne ručně.',
    });
  }
  const paid = await payments.confirmPayment(p.id);
  const activated = await activateMembership(paid);
  // member se vrací jen při aktivaci ročního členství (řádek má .status);
  // jednorázový vstup vrací oprávnění (entitlement) — to není člen.
  const member = activated && activated.status ? activated : null;
  res.json({ ok: true, payment: paid, member: member ? publicMember(member) : null });
}));

router.post('/payments/:id/fail', A.requireMember, asyncRoute(async (req, res) => {
  const p = await D.Payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'NENALEZENO' });
  if (p.gateway !== 'test') {
    return res.status(400).json({ error: 'NEJDE_ZRUSIT', message: 'Tuto platbu zrušte v platební bráně (Stripe).' });
  }
  await payments.failPayment(p.id);
  res.json({ ok: true });
}));

router.get('/payments/:id/receipt', A.requireMember, asyncRoute(async (req, res) => {
  const p = await D.Payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'NENALEZENO' });
  if (p.member_id !== req.member.id && req.member.role === 'member') {
    return res.status(403).json({ error: 'NEDOSTATECNA_PRAVA' });
  }
  if (p.status !== 'paid') return res.status(409).json({ error: 'NEZAPLACENO', message: 'Platba nebyla uhrazena.' });
  const m = await D.Members.getById(p.member_id);
  res.json({
    receiptNo: p.receipt_no, paidAt: p.paid_at, amountCzk: p.amount_czk, purpose: p.purpose,
    memberName: `${m.first_name} ${m.last_name}`, memberId: m.id, memberNo: m.member_no,
    issuedBy: 'Tělovýchovná jednota Krupka, z.s., IČO 46070516',
    note: 'Potvrzení o úhradě — Tělovýchovná jednota Krupka, z.s. (v testovacím režimu bez právní účinnosti).',
  });
}));

// ---------- Stripe webhook (raw body — musí být montován PŘED express.json) ----------
// Zpracovává checkout.session.completed: ověří podpis (fail-closed), označí
// platbu jako zaplacenou a AKTIVUJE členství (stejná logika jako test mode).
const webhookRouter = express.Router();
webhookRouter.post('/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (req, res) => {
  const result = await payments.handleWebhook(req, req.body);
  if (result && result.paid) {
    // aktivace členství / denního vstupu (vrací member nebo null pro merch)
    await activateMembership(result.paid);
  }
  res.status(result.status || 200).json(result);
}));

// Znovu odeslat e-mail se souhlasem zákonnému zástupci (přihlášený člen, status pending)
router.post('/guardian-resend', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  if (m.guardian_status !== 'pending' || !m.guardian_email) {
    return res.status(409).json({ error: 'NENI_CO_ODESLAT', message: 'Žádný čekající souhlas zákonného zástupce.' });
  }
  const guardianToken = D.uuid();
  await D.Members.update(m.id, {
    guardian_token: guardianToken,
    guardian_token_expires: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  });
  const link = `${req.protocol}://${req.get('host')}/#/souhlas-rodice/${guardianToken}`;
  await mailer.sendEmail(m.id, m.guardian_email,
    `Souhlas zákonného zástupce — Tělovýchovná jednota Krupka (${m.first_name} ${m.last_name})`,
    `Dobrý den,\n\n${m.first_name} ${m.last_name} (nar. ${m.birth_date}) se registruje jako člen Tělovýchovná jednota Krupka, z.s. pro používání dopadové matrace.\n\nPro udělení souhlasu zákonného zástupce otevřete odkaz (platí 7 dní):\n${link}\n\nS pozdravem\nTělovýchovná jednota Krupka, z.s.`);
  res.json({ ok: true, message: 'E-mail se souhlasem byl znovu odeslán.' });
}));

// ---------- členská karta (QR) ----------
router.get('/card', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const st = effectiveStatus(m);
  const member = await isClubMember(m);
  const entitlement = !member && await D.Entitlements.hasActive(m.id);
  const allowed = member || entitlement;
  let card = await D.Cards.getByMember(m.id);
  if (!card && allowed) {
    const cardToken = D.uuid().replace(/-/g, '').slice(0, 20);
    // ID člena v payloadu = UUID (nesouvisí s datem vzniku členství)
    await D.Cards.upsert(m.id, `TJK:${m.id}:${cardToken}`);
    card = await D.Cards.getByMember(m.id);
  }
  if (!card) {
    return res.status(409).json({
      error: 'KARTA_NENI',
      message: 'Karta bude vystavena po zaplacení ročního členství nebo jednorázového vstupu.',
    });
  }
  const qrDataUrl = await QRCode.toDataURL(card.qr_payload, { width: 320, margin: 1, color: { dark: '#0E3B2C', light: '#ffffff' } });
  const type = await D.MemberTypes.get(m.membership_type);
  const entitlements = await D.Entitlements.listForMember(m.id);
  const accessUntil = entitlement || member
    ? (member ? m.valid_until : null)
    : null;
  res.json({
    memberId: m.id,
    memberNo: m.member_no,
    name: `${m.first_name} ${m.last_name}`,
    membershipType: type ? type.label : m.membership_type,
    kind: member ? 'clen' : 'neclen',
    status: st,
    validUntil: m.valid_until,
    accessUntil: accessUntil || (entitlements.length ? entitlements[0].valid_until : null),
    qrPayload: card.qr_payload,
    qrDataUrl,
  });
}));

// Kontrola přístupu dozorem (načtení QR karty)
router.post('/check-card', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const payload = ((req.body || {}).qrPayload || '').trim();
  const card = await D.Cards.getByPayload(payload);
  if (!card) return res.status(404).json({ error: 'NEPLATNA_KARTA', message: 'Karta nebyla nalezena.' });
  const m = await D.Members.getById(card.member_id);
  if (!m) return res.status(404).json({ error: 'NEPLATNA_KARTA' });
  const st = effectiveStatus(m);
  const member = await isClubMember(m);
  const entitlement = await D.Entitlements.hasActive(m.id);
  const ok = member || entitlement;
  const msg = member
    ? 'Členství aktivní — vstup povolen.'
    : entitlement
      ? 'Aktivní jednorázový vstup — vstup povolen.'
      : st === 'expired' ? 'Členství vypršelo — vstup zamítnut.' : 'Žádné platné členství ani vstup — zamítnuto.';
  res.json({
    ok,
    memberName: `${m.first_name} ${m.last_name}`,
    memberId: m.id,
    memberNo: m.member_no,
    kind: member ? 'clen' : 'neclen',
    status: st,
    validUntil: m.valid_until,
    accessReason: member ? 'membership' : entitlement ? 'entitlement' : 'none',
    message: msg,
  });
}));

// ---------- admin (dozor / výbor / superadmin) ----------
router.get('/admin/members', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const all = await D.Members.listAll();
  const rows = [];
  for (const m of all) {
    const consents = await D.Consents.listForMember(m.id);
    const pays = await D.Payments.listForMember(m.id);
    rows.push({
      id: m.id, memberNo: m.member_no, name: `${m.first_name} ${m.last_name}`,
      birthDate: m.birth_date, email: m.email, membershipType: m.membership_type,
      role: m.role, status: effectiveStatus(m),
      guardianStatus: m.guardian_status,
      consentCount: consents.length, consentOk: (await memberAllConsents(m.id)).length === 0,
      guardianOk: m.guardian_status !== 'pending' || (await guardianAllConsents(m.id)).length === 0,
      paid: pays.some((p) => p.status === 'paid'),
      validUntil: m.valid_until,
      createdAt: m.created_at,
    });
  }
  res.json({ members: rows });
}));

router.get('/admin/members/:id', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  const consents = await D.Consents.listForMember(m.id);
  res.json({
    member: publicMember(m),
    status: effectiveStatus(m),
    consents: consents.map((c) => ({
      docKey: c.doc_key, version: c.doc_version, contentHash: c.content_hash,
      signerType: c.signer_type, identity: c.identity, grantedAt: c.granted_at, ip: c.ip, userAgent: c.user_agent,
    })),
    payments: await D.Payments.listForMember(m.id),
    card: await D.Cards.getByMember(m.id),
    bookings: await D.Bookings.listForMember(m.id),
  });
}));

router.post('/admin/members/:id/status', A.requireRole('dozor', 'vybor', 'superadmin'), asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZENO' });
  const { status } = req.body || {};
  if (!['active', 'rejected', 'expired', 'registered'].includes(status)) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Neplatný stav.' });
  }
  const updated = await D.Members.update(m.id, { status });
  res.json({ ok: true, member: publicMember(updated), status: effectiveStatus(updated) });
}));

router.get('/admin/stats', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const rows = await D.Members.listAll();
  const statuses = {};
  for (const m of rows) {
    const st = effectiveStatus(m);
    statuses[st] = (statuses[st] || 0) + 1;
  }
  const payStats = await D.Payments.sumPaid();
  res.json({
    total: rows.length,
    statuses,
    paidCzk: payStats.s || 0,
    paidCount: payStats.c || 0,
    pendingGuardian: rows.filter((m) => m.guardian_status === 'pending').length,
  });
}));

// ---------- dev inbox (STUB e-maily/SMS) ----------
// Zabezpečeno (audit): outbox obsahuje magic linky (přihlášení, souhlas rodiče),
// proto je dostupný JEN přihlášeným členům a JEN v dev režimu. Jakmile se zapne
// reálný SMTP, outbox se zavře — v produkci by unikal citlivé odkazy.
router.get('/outbox', A.requireMember, asyncRoute(async (req, res) => {
  if (mailer.smtpEnabled) {
    return res.status(403).json({
      error: 'OUTBOX_VYPNOUT',
      message: 'Dev inbox je dostupný pouze v testovacím režimu (bez SMTP).',
    });
  }
  const all = await D.Messages.list();
  const messages = all.map((m) => ({
    id: m.id, channel: m.channel, to: m.to_address, subject: m.subject, body: m.body, createdAt: m.created_at,
  }));
  res.json({ messages });
}));

// ---------- KATALOG SLUŽEB (produkt = jedna varianta + jedna cena dle uživatele) ----------
// Backend odvodí variantu ze stavu uživatele; uživatel nikdy nevidí obě ceny
// a nikdy si nevybírá, jestli je člen/nečlen/dospělý/nezletilý (spec §14–16, §21–22).
router.get('/products', asyncRoute(async (req, res) => {
  const list = await D.Products.listActive();
  let st = null;
  let membership = null;
  if (req.member) {
    st = await E.userState(req.member);
    membership = await E.membershipEligibility(req.member);
  }
  const products = [];
  for (const p of list) {
    let variant = null;
    if (st) {
      variant = await E.resolveVariant(p.id, st);
    } else {
      // anonym: veřejná varianta (jedna cena)
      const vs = await D.ProductVariants.listForProduct(p.id);
      variant = vs.find((v) => v.active && v.audience === 'PUBLIC' && (!v.age_type || v.age_type === 'ANY')) || null;
    }
    const allVariants = await D.ProductVariants.listForProduct(p.id);
    const hasMemberVariant = allVariants.some((v) => v.active && v.audience === 'MEMBER');
    const hasPublicVariant = allVariants.some((v) => v.active && v.audience === 'PUBLIC');
    products.push({
      code: p.code,
      name: p.name,
      unit: p.unit,
      validityHours: p.validity_hours,
      description: p.description || null,
      // JEDNA cena dle aktuálního stavu (nebo null, pokud uživatel nemá nárok)
      price: variant ? variant.price_czk : null,
      audience: variant ? variant.audience : null,
      available: !!variant,
      memberOnly: !!variant && variant.audience === 'MEMBER',
      requiresGuardian: !!(st && st.isMinor),
      // marketingové rozlišení (bez ceny): existuje členská varianta?
      hasMemberVariant,
      hasPublicVariant,
    });
  }
  res.json({
    membershipStatus: st ? st.membershipStatus : 'NON_MEMBER',
    ageType: st ? st.ageType : null,
    isMember: st ? st.isMember : false,
    membershipPriceCzk: 200,
    membership: membership,
    products,
  });
}));

// ---------- členské výhody / zařízení spolku ----------
router.get('/facilities', asyncRoute(async (req, res) => {
  const all = await D.Facilities.listActive();
  res.json({
    facilities: all.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      shortName: f.short_name,
      description: f.description,
      icon: f.icon,
    })),
  });
}));

// ---------- SUPERADMIN (vlastník aplikace — výhradně miroslavbrozek@gmail.com) ----------
// Kompletní přehled členů se VŠEMI informacemi (osobní údaje, kontakt, adresa,
// zákonný zástupce, členství, platby, souhlasy).
router.get('/superadmin/members', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const all = await D.Members.listAll();
  const rows = [];
  for (const m of all) {
    const type = await D.MemberTypes.get(m.membership_type);
    rows.push({
      id: m.id,
      memberNo: m.member_no,
      name: `${m.first_name} ${m.last_name}`,
      firstName: m.first_name,
      lastName: m.last_name,
      birthDate: m.birth_date,
      email: m.email,
      phone: m.phone,
      street: m.street,
      city: m.city,
      zip: m.zip,
      membershipType: m.membership_type,
      membershipLabel: (type || {}).label || m.membership_type,
      role: m.role,
      status: m.status,
      validFrom: m.valid_from,
      validUntil: m.valid_until,
      guardianName: m.guardian_name,
      guardianRelation: m.guardian_relation,
      guardianEmail: m.guardian_email,
      guardianPhone: m.guardian_phone,
      guardianStatus: m.guardian_status,
      guardianGrantedAt: m.guardian_granted_at,
      consentsCount: await D.Consents.countForMember(m.id),
      paid: (await D.Payments.countPaidContributionsForMember(m.id)) > 0,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    });
  }
  res.json({
    total: rows.length,
    members: rows,
  });
}));

// Typy členství + počty členů v každém typu
router.get('/superadmin/member-types', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const all = await D.MemberTypes.list();
  const types = [];
  for (const t of all) {
    if (!t.access) continue; // jen aktivní věkové kategorie (legacy typy se nezobrazují)
    types.push({
      code: t.code, label: t.label, priceCzk: t.price_czk, description: t.description,
      memberCount: await D.Members.countByType(t.code),
    });
  }
  res.json({ types });
}));

// Stav synchronizace se Supabase členskou evidencí (pro UI vlastníka)
router.get('/superadmin/sync-status', A.requireSuperAdmin, (req, res) => {
  res.json({
    mode: S.mode(),
    enabled: S.enabled(),
    config: {
      url: S._cfg.url ? `${new URL(S._cfg.url).host}` : null,
      sync: S._cfg.mode,
    },
  });
});

// Ruční hromadný sync všech členů PWA → Supabase evidence (vlastník)
router.post('/superadmin/sync', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const members = await D.Members.listAll();
  const result = await S.syncAll(members);
  res.json(result);
}));

// QR karta libovolného člena (payload + QR obrázek pro načtení dozorem)
router.get('/superadmin/members/:id/card', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const m = await D.Members.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'NENALEZEN', message: 'Člen nebyl nalezen.' });
  const card = await D.Cards.getByMember(m.id);
  if (!card) return res.status(409).json({ error: 'KARTA_NENI', message: 'Člen zatím nemá vystavenou kartu.' });
  const qrDataUrl = await QRCode.toDataURL(card.qr_payload, { width: 320, margin: 1, color: { dark: '#0E3B2C', light: '#ffffff' } });
  const type = await D.MemberTypes.get(m.membership_type);
  res.json({
    memberId: m.id,
    memberNo: m.member_no,
    name: `${m.first_name} ${m.last_name}`,
    membershipLabel: (type || {}).label || m.membership_type,
    status: effectiveStatus(m),
    validUntil: m.valid_until,
    qrPayload: card.qr_payload,
    qrDataUrl,
  });
}));

// ---------- ADMIN KATALOGU: produkty, varianty, dokumenty (superadmin) ----------
// Konfigurace bez nové verze aplikace: varianty/ceny/dokumenty žijí v DB,
// texty dokumentů lze zveřejnit v nové verzi (souhlasy se pak vyžádají znovu).
function serializeVariant(v) {
  const d = D.ProductVariants.parseDocs(v);
  return {
    id: v.id, productId: v.product_id, audience: v.audience, ageType: v.age_type,
    priceCzk: v.price_czk, active: !!v.active, sortOrder: v.sort_order || 0,
    docKeys: d.userDocs, guardianDocKeys: d.guardianDocs, // null = zástupce podepisuje docKeys
  };
}

router.get('/superadmin/catalog', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const products = await D.Products.listAll();
  const variants = [];
  for (const p of products) {
    for (const v of await D.ProductVariants.listForProduct(p.id)) {
      variants.push({ ...serializeVariant(v), productCode: p.code, productName: p.name });
    }
  }
  const docs = (await D.DocVersions.latestAll()).map((d) => ({
    docKey: d.doc_key, version: d.version, title: d.title,
    contentHash: d.content_hash, effectiveFrom: d.effective_from, content: d.content,
  }));
  res.json({ products, variants, docs });
}));

router.post('/superadmin/products', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toLowerCase();
  if (!code || !b.name) return res.status(400).json({ error: 'VALIDACE', message: 'code a name jsou povinné.' });
  if (await D.Products.getByCode(code)) return res.status(409).json({ error: 'EXISTUJE', message: 'Produkt s tímto kódem už existuje.' });
  const product = await D.Products.create({ code, name: b.name, unit: b.unit, validityHours: Number(b.validityHours) || 1 });
  res.json({ ok: true, product });
}));

router.post('/superadmin/variants', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const product = b.productCode ? await D.Products.getByCode(b.productCode) : null;
  if (!product) return res.status(400).json({ error: 'VALIDACE', message: 'Neznámý produkt.' });
  const docKeys = Array.isArray(b.docKeys) ? b.docKeys.filter(Boolean) : [];
  const guardianDocKeys = Array.isArray(b.guardianDocKeys)
    ? b.guardianDocKeys.filter(Boolean)
    : b.guardianDocKeys === null ? null : docKeys;
  const payload = {
    audience: (b.audience || 'PUBLIC').toUpperCase(),
    ageType: (b.ageType || 'ANY').toUpperCase(),
    priceCzk: Number(b.priceCzk),
    docKeys,
    guardianDocKeys,
    active: b.active !== false,
    sortOrder: Number(b.sortOrder) || 0,
  };
  let variant;
  if (b.id) {
    // update (drivery mají odlišné rozhraní → upravíme přes raw, aby byla JSON pole správně)
    const existing = await D.ProductVariants.getById(b.id);
    if (!existing || existing.product_id !== product.id) {
      return res.status(404).json({ error: 'NENALEZENO', message: 'Varianta nebyla nalezena.' });
    }
    const fields = {
      audience: payload.audience, age_type: payload.ageType, price_czk: payload.priceCzk,
      doc_keys: JSON.stringify(payload.docKeys),
      guardian_doc_keys: payload.guardianDocKeys ? JSON.stringify(payload.guardianDocKeys) : null,
      active: payload.active ? 1 : 0, sort_order: payload.sortOrder,
    };
    variant = await D.ProductVariants.update(b.id, fields);
  } else {
    variant = await D.ProductVariants.create({ productId: product.id, ...payload });
  }
  res.json({ ok: true, variant: serializeVariant(variant) });
}));

router.post('/superadmin/docs', A.requireSuperAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const docKey = String(b.docKey || '').trim();
  const content = String(b.content || '');
  if (!docKey || !content.trim()) return res.status(400).json({ error: 'VALIDACE', message: 'docKey a content jsou povinné.' });
  const doc = await D.DocVersions.createNext({ docKey, title: b.title, content });
  res.json({ ok: true, doc: { docKey: doc.doc_key, version: doc.version, title: doc.title, contentHash: doc.content_hash } });
}));

// ---------- rezervace (univerzální — dle zařízení) ----------
router.get('/bookings', A.requireMember, asyncRoute(async (req, res) => {
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const code = (req.query.facility || 'airbag').slice(0, 40);
  const facility = await D.Facilities.getByCode(code);
  if (!facility) return res.status(404).json({ error: 'NENALEZENO', message: 'Zařízení nebylo nalezeno.' });
  res.json({ date, facility: { code: facility.code, name: facility.name, shortName: facility.short_name }, slots: await D.Bookings.slotsFor(date, facility.id) });
}));

router.post('/bookings', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  if (effectiveStatus(m) !== 'active') {
    return res.status(403).json({ error: 'NEJSTE_CLENEM', message: 'Rezervovat mohou pouze aktivní členové.' });
  }
  const { date, hour, facility: code } = req.body || {};
  const facility = await D.Facilities.getByCode(code || 'airbag');
  if (!facility) return res.status(404).json({ error: 'NENALEZENO', message: 'Zařízení nebylo nalezeno.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || hour < 9 || hour > 18) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Zadejte platné datum a hodinu (9–18).' });
  }
  const start = `${date}T${String(hour).padStart(2, '0')}:00:00`;
  const end = `${date}T${String(hour + 1).padStart(2, '0')}:00:00`;
  const slots = await D.Bookings.slotsFor(date, facility.id);
  const slot = slots.find((s) => s.start === start);
  if (!slot || slot.taken) return res.status(409).json({ error: 'OBSAZENO', message: 'Tento slot je už obsazený.' });
  const booking = await D.Bookings.create({ memberId: m.id, facilityId: facility.id, slotStart: start, slotEnd: end });
  res.json({ ok: true, booking });
}));

// ---------- akce spolku + přihlášení na akci ----------
router.get('/events', asyncRoute(async (req, res) => {
  const all = await D.Events.listPublished();
  const memberId = req.member ? req.member.id : null;
  const events = [];
  for (const e of all) {
    events.push({
      id: e.id,
      title: e.title,
      description: e.description,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      location: e.location,
      capacity: e.capacity,
      signupDeadline: e.signup_deadline,
      signupCount: e.signup_count,
      spotsLeft: e.capacity ? Math.max(0, e.capacity - e.signup_count) : null,
      signedUp: memberId ? await D.Events.hasSignedUp(e.id, memberId) : false,
      facilityName: e.facility_name || null,
      facilityIcon: e.facility_icon || null,
    });
  }
  res.json({ events });
}));

// přihlášení na akci (po přihlášení do aplikace)
router.post('/events/:id/signup', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  if (effectiveStatus(m) !== 'active') {
    return res.status(403).json({ error: 'NEJSTE_CLENEM', message: 'Na akce se mohou přihlašovat pouze aktivní členové.' });
  }
  const event = await D.Events.getById(req.params.id);
  if (!event || event.status !== 'published') {
    return res.status(404).json({ error: 'NENALEZENA', message: 'Akce nebyla nalezena.' });
  }
  const now = new Date();
  if (event.signup_deadline && new Date(event.signup_deadline) < now) {
    return res.status(409).json({ error: 'UZAVRENO', message: 'Přihlašování na tuto akci bylo ukončeno.' });
  }
  if (new Date(event.starts_at) < now) {
    return res.status(409).json({ error: 'ZACALO', message: 'Akce už začala.' });
  }
  const count = await D.Events.signupCount(event.id);
  if (event.capacity && count >= event.capacity) {
    return res.status(409).json({ error: 'PLNO', message: 'Akce je plná.' });
  }
  if (await D.Events.hasSignedUp(event.id, m.id)) {
    return res.status(409).json({ error: 'PRIHLASEN', message: 'Na tuto akci už jste přihlášeni.' });
  }
  await D.Events.signup(event.id, m.id);
  res.json({ ok: true, signupCount: count + 1 });
}));

// odhlášení z akce
router.delete('/events/:id/signup', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const event = await D.Events.getById(req.params.id);
  if (!event) return res.status(404).json({ error: 'NENALEZENA', message: 'Akce nebyla nalezena.' });
  await D.Events.cancel(event.id, m.id);
  res.json({ ok: true, signupCount: await D.Events.signupCount(event.id) });
}));

// ---------- merch (MVP bonus) ----------
router.get('/merch', asyncRoute(async (req, res) => {
  res.json({ products: await D.Merch.listProducts() });
}));

router.post('/merch/orders', A.requireMember, asyncRoute(async (req, res) => {
  const m = req.member;
  const items = (req.body || {}).items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'VALIDACE', message: 'Košík je prázdný.' });
  }
  let total = 0;
  const normalized = [];
  for (const it of items) {
    const p = await D.Merch.getProduct(it.productId);
    if (!p) return res.status(400).json({ error: 'VALIDACE', message: 'Neznámý produkt v košíku.' });
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    total += p.price_czk * qty;
    normalized.push({ product: p.code, name: p.name, size: it.size || null, qty, priceCzk: p.price_czk });
  }
  const order = await D.Merch.createOrder({ memberId: m.id, items: normalized, totalCzk: total });
  res.json({ ok: true, order: { ...order, items: normalized } });
}));

module.exports = router;
// Webhook router (raw body) se montuje v server.js PŘED express.json —
// Stripe podepisuje přesně původní payload, takže nesmí projít JSON parserem.
module.exports.webhookRouter = webhookRouter;
