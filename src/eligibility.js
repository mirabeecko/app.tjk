// src/eligibility.js — UNIVERZÁLNÍ PIPELINE OPRÁVNĚNÍ (služby, ne jen AirBAG):
//   USER → AGE STATUS → MEMBERSHIP STATUS → GUARDIAN STATUS
//        → ELIGIBLE PRODUCT VARIANT → REQUIRED DOCUMENTS → PRICE → CHECKOUT
// Cena se nikdy nebere z klienta — vždy z varianty dle stavu uživatele.
// Dokumenty jsou konfigurovatelné (doc_keys na doc_versions; nová verze textu
// = nutný nový souhlas — auditní stopa se verzemi).
'use strict';

const D = require('./db');

// Dokumenty k ČLENSTVÍ (config: klíče → doc_versions; texty viz docs/*)
// Součástí členství je i PROVOZNÍ ŘÁD zařízení — člen bez něj nesmí na zařízení
// vstoupit, proto se vyžaduje už při registraci člena (ne až u služby).
const MEMBERSHIP_DOCS = ['stanovy', 'provozni_rad', 'gdpr'];
// Dokumenty, které musí podepsat zákonný zástupce nezletilého.
// ZÁMĚRNĚ ODDĚLENÉ od potvrzení účastníka: zástupce uděluje SAMOSTATNÝ souhlas
// s účastí nezletilého (a nesmí v něm vzdát práva dítěte na náhradu újmy).
// Provozní řád, poučení o rizicích i zdravotní prohlášení potvrzuje sám účastník.
const GUARDIAN_MEMBERSHIP_DOCS = ['guardian_souhlas'];

// ÚČEL REGISTRACE (members.intent):
//   'clenstvi' — uživatel chce členství → dokumenty členství + dokumenty služeb
//   'vstup'    — uživatel chce jen jednorázový vstup → POUZE dokumenty služeb
// POZOR: členství NESMÍ být v aplikaci podmínkou vstupu tam, kde provoz počítá
// i s nečleny (viz docs/provozni_rad.md čl. 1.3). Proto se `stanovy` nevyžadují
// po tom, kdo si jde koupit jednorázový vstup.
function intentOf(m) {
  const i = (m && m.intent) || 'clenstvi';
  return i === 'vstup' ? 'vstup' : 'clenstvi';
}

/** Vyřazené (historické) dokumenty se NIKDY nevyžadují k potvrzení. */
async function withoutRetired(keys) {
  const out = [];
  for (const k of keys) {
    const latest = await D.DocVersions.latest(k);
    if (!latest || latest.status === 'retired') continue;
    out.push(k);
  }
  return out;
}

// Věk z data narození — časově bezpečný výpočet (bez posunu o časové pásmo).
// Zvládá Date (Postgres), ISO string i 'YYYY-MM-DD' (SQLite).
function ageFrom(birthDate) {
  if (!birthDate) return -1;
  let y, m, d;
  if (birthDate instanceof Date && !isNaN(birthDate)) {
    y = birthDate.getUTCFullYear();
    m = birthDate.getUTCMonth() + 1;
    d = birthDate.getUTCDate();
  } else {
    const s = String(birthDate);
    // ISO datetime 'YYYY-MM-DDTHH:mm:ss...' nebo datum 'YYYY-MM-DD'
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

// ADULT (>=18) | MINOR (<18)
function ageTypeOf(m) {
  return ageFrom(m.birth_date) >= 18 ? 'ADULT' : 'MINOR';
}

function effectiveActive(m) {
  return m.status === 'active' && m.valid_until && new Date(m.valid_until) > new Date();
}

// MEMBER | MEMBERSHIP_EXPIRED | MEMBERSHIP_PENDING | NON_MEMBER
async function membershipStatusOf(m) {
  const paid = await D.Payments.hasPaidMembership(m.id);
  if (paid && effectiveActive(m)) return 'MEMBER';
  if (paid && !effectiveActive(m)) return 'MEMBERSHIP_EXPIRED';
  if (['registered', 'consent_pending', 'guardian_pending', 'payment_pending'].includes(m.status)) {
    return 'MEMBERSHIP_PENDING';
  }
  return 'NON_MEMBER';
}

// Kompletní stav uživatele pro pipeline
async function userState(m) {
  const ageType = ageTypeOf(m);
  const membershipStatus = await membershipStatusOf(m);
  const age = ageFrom(m.birth_date);
  return {
    id: m.id,
    age,
    ageType,                                   // ADULT | MINOR
    membershipStatus,                          // MEMBER | MEMBERSHIP_EXPIRED | MEMBERSHIP_PENDING | NON_MEMBER
    isMember: membershipStatus === 'MEMBER',
    isMinor: ageType === 'MINOR',
    guardianGranted: m.guardian_status === 'granted',
    guardianPending: m.guardian_status === 'pending',
    guardianEmail: m.guardian_email || null,
  };
}

// Platnost souhlasu = souhlas s AKTUÁLNÍ verzí dokumentu (spec §11)
async function isConsentValid(list, docKey, signerType) {
  const latest = await D.DocVersions.latest(docKey);
  if (!latest) return false;
  return !!list.find(
    (c) => c.doc_key === docKey && c.signer_type === signerType && c.doc_version === latest.version
  );
}

async function signedDocKeys(memberId, signerType) {
  const list = await D.Consents.listForMember(memberId);
  const out = {};
  for (const c of list) {
    const latest = await D.DocVersions.latest(c.doc_key);
    // vyřazený dokument se nepočítá jako splněný požadavek (už se nevyžaduje)
    if (latest && latest.status !== 'retired' && c.doc_version === latest.version) out[c.doc_key] = true;
  }
  return out;
}

// Co musí podepsat uživatel a (u nezletilého) zákonný zástupce pro danou
// sadu dokumentů. Vrací i chybějící.
async function checkDocs(memberId, userDocs, guardianDocs) {
  const signed = await signedDocKeys(memberId, 'member');
  const missingUser = userDocs.filter((k) => !signed[k]);
  const missingGuardian = [];
  let guardianGranted = true;
  if (guardianDocs && guardianDocs.length) {
    const gSigned = await signedDocKeys(memberId, 'guardian');
    missingGuardian.push(...guardianDocs.filter((k) => !gSigned[k]));
  }
  return { missingUser, missingGuardian, guardianGranted };
}

// ── ČLENSTVÍ ──────────────────────────────────────────────────────
async function membershipEligibility(m) {
  const st = await userState(m);
  const intent = intentOf(m);
  // Kdo si jde koupit JEN jednorázový vstup, nepotřebuje dokumenty členství
  // (stanovy) — členství není podmínkou vstupu (viz docs/provozni_rad.md čl. 1.3).
  const membershipDocs = intent === 'clenstvi' ? await withoutRetired(MEMBERSHIP_DOCS) : [];
  const guardianDocs = st.isMinor ? await withoutRetired(GUARDIAN_MEMBERSHIP_DOCS) : [];
  // POZOR: i aktivní člen dostává `required`/`missing` — UI souhrnů (stránka
  // Souhlasy, /consent-groups) je čte pro všechny stavy; dřív chyběly a shodily
  // /api/consent-groups na 500 (Cannot read properties of undefined).
  const d = await checkDocs(m.id, membershipDocs, guardianDocs);
  if (st.isMember) {
    return {
      ok: true,
      state: st,
      intent,
      required: { user: membershipDocs, guardian: guardianDocs },
      missing: { user: [], guardian: [], guardianNotGranted: false },
      message: 'Členství je aktivní.',
    };
  }
  const ok = d.missingUser.length === 0
    && (!st.isMinor || (st.guardianGranted && d.missingGuardian.length === 0));
  return {
    ok,
    state: st,
    intent,
    required: { user: membershipDocs, guardian: guardianDocs },
    missing: {
      user: d.missingUser,
      guardian: st.isMinor && !st.guardianGranted ? guardianDocs : d.missingGuardian,
      guardianNotGranted: st.isMinor && !st.guardianGranted,
    },
  };
}

// ── PRODUKT / SLUŽBA ──────────────────────────────────────────────
// Vybere správnou variantu (nikdy neobě ceny) a vrátí autorizovanou cenu.
async function resolveVariant(productId, st) {
  const variants = await D.ProductVariants.listForProduct(productId);
  return pickVariant(variants, st);
}

/** Čistý výběr varianty z už načteného seznamu (bez dotazu do DB). */
function pickVariant(variants, st) {
  const now = new Date().toISOString();
  const audience = st.isMember ? 'MEMBER' : 'PUBLIC';
  const match = (variants || []).find((v) => {
    if (!v.active) return false;
    if (v.audience !== audience) return false;
    if (v.age_type && v.age_type !== 'ANY' && v.age_type !== st.ageType) return false;
    if (v.active_from && v.active_from > now) return false;
    if (v.active_until && v.active_until < now) return false;
    return true;
  });
  return match || null;
}

async function productEligibility(m, productCode) {
  const product = productCode ? await D.Products.getByCode(productCode) : null;
  if (!product) return { ok: false, code: 'NEZNAMY_PRODUKT', message: 'Neznámá služba.' };
  const st = await userState(m);
  const variant = await resolveVariant(product.id, st);
  if (!variant) {
    return {
      ok: false, code: 'NEDOSTUPNY_PRODUKT', state: st, product,
      message: st.isMember
        ? 'Pro členy není tato služba aktuálně dostupná.'
        : 'Tato služba je pro nečleny dostupná po dokončení registrace a souhlasů.',
      price: null,
    };
  }
  const docs = D.ProductVariants.parseDocs(variant);
  const userDocs = await withoutRetired(docs.userDocs);
  // nezletilý: zástupce podepisuje guardian_doc_keys (nebo userDocs), jinak žádné
  const guardianDocs = st.isMinor ? await withoutRetired(docs.guardianDocs || docs.userDocs) : [];
  const d = await checkDocs(m.id, userDocs, guardianDocs);
  const guardianOk = !st.isMinor || (st.guardianGranted && d.missingGuardian.length === 0);
  const ok = d.missingUser.length === 0 && guardianOk;
  return {
    ok,
    state: st,
    product,
    variant,
    price: variant.price_czk,             // autorizovaná cena — zdroj pravdy
    audience: variant.audience,
    required: { user: userDocs, guardian: guardianDocs },
    missing: {
      user: d.missingUser,
      guardian: st.isMinor && !st.guardianGranted ? guardianDocs : d.missingGuardian,
      guardianNotGranted: st.isMinor && !st.guardianGranted,
    },
    message: ok
      ? undefined
      : st.isMinor && !st.guardianGranted
        ? 'Tuto službu musí potvrdit zákonný zástupce.'
        : 'Nejprve je nutné potvrdit povinné dokumenty.',
  };
}

// ── Sjednocené požadavky (UI/status): dokumenty členství + služeb uživatele ──
async function requiredDocUnion(m, stIn) {
  const st = stIn || await userState(m);
  const intent = intentOf(m);
  // Dokumenty členství jen tehdy, když uživatel o členství skutečně usiluje
  // (intent='clenstvi') nebo už členem je. „Vstup“ = jen dokumenty služeb.
  const user = new Set(intent === 'clenstvi' || st.isMember ? await withoutRetired(MEMBERSHIP_DOCS) : []);
  const guardian = new Set();
  const prods = await D.Products.listActive();
  // Všechny varianty jedním dotazem (dřív dotaz pro každý produkt = N+1).
  const variantsByProduct = await D.ProductVariants.listAllByProduct();
  for (const p of prods) {
    const v = pickVariant(variantsByProduct.get(p.id), st);
    if (!v) continue;
    const docs = D.ProductVariants.parseDocs(v);
    for (const k of await withoutRetired(docs.userDocs)) user.add(k);
    if (st.isMinor) {
      const g = docs.guardianDocs || docs.userDocs;
      for (const k of await withoutRetired(g)) guardian.add(k);
    }
  }
  if (st.isMinor) {
    for (const k of await withoutRetired(GUARDIAN_MEMBERSHIP_DOCS)) guardian.add(k);
  }
  return {
    userKeys: [...user],
    guardianKeys: st.isMinor ? [...guardian] : [],
    isMinor: st.isMinor,
    guardianGranted: st.guardianGranted,
    intent,
    state: st,
  };
}

async function missingAllDocs(m) {
  const req = await requiredDocUnion(m);
  const su = await signedDocKeys(m.id, 'member');
  const gu = await signedDocKeys(m.id, 'guardian');
  const user = req.userKeys.filter((k) => !su[k]);
  let guardian = [];
  if (req.isMinor) {
    guardian = req.guardianKeys.filter((k) => !gu[k]);
  }
  return { user, guardian, required: req, guardianNotGranted: req.isMinor && !req.guardianGranted };
}

module.exports = {
  ageFrom,
  ageTypeOf,
  membershipStatusOf,
  userState,
  membershipEligibility,
  productEligibility,
  resolveVariant,
  pickVariant,
  signedDocKeysPublic: signedDocKeys,
  requiredDocUnion,
  missingAllDocs,
  intentOf,
  withoutRetired,
  MEMBERSHIP_DOCS,
  GUARDIAN_MEMBERSHIP_DOCS,
};
