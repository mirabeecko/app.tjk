// seed.js — počáteční data: ceník, verze právních dokumentů, demo účty, merch.
// Dialekt: používá D.raw s `?` parametry a ON CONFLICT — funguje na SQLite
// i Postgres (pg driver překládá ? → $n, booleany true/false akceptují oba).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const X = require('./db-app');

// Kvalifikace názvů tabulek: postgres → `app.<tabulka>`, sqlite → beze schématu.
// (Seed SQL je sdílený pro oba drivery; v Postgresu musí mířit do schématu `app`,
// jinak by spadl do public.)
const T = (n) => (D.driver === 'postgres' ? `app.${n}` : n);

const MEMBER_TYPES = [
  // ROČNÍ ČLENSTVÍ — jednotná cena 200 Kč/rok. Kategorie se určuje POUZE podle
  // věku člena (nezletilí vyžadují souhlas zákonného zástupce).
  { code: 'dospele', label: 'Dospělý (18+)', price_czk: 200, description: 'Roční členství s přístupem k zařízením spolku, 200 Kč/rok.', requires_guardian: 0, access: 1, sort_order: 1 },
  { code: 'mladez', label: 'Mládež (15–18 let)', price_czk: 200, description: 'Roční členství se souhlasem zákonného zástupce, 200 Kč/rok.', requires_guardian: 1, access: 1, sort_order: 2 },
  { code: 'dite', label: 'Dítě (do 15 let)', price_czk: 200, description: 'Roční členství s doprovodem zákonného zástupce (doprovod zdarma), 200 Kč/rok.', requires_guardian: 1, access: 1, sort_order: 3 },
];

// Mapování starých typů na věkové kategorie (migrace existujících členů)
const LEGACY_TYPE_MAP = {
  zakladni: 'dospele', podporovatel: 'dospele', rodinne: 'dospele',
  vikend: 'dospele', tyden: 'dospele',
  mladez: 'mladez', dite: 'dite',
  // starý experiment „denní vstup jako typ členství" → dospělý (migrace)
  denni: 'dospele', denni_clen: 'dospele',
};

// Doba platnosti členství dle typu (dny)
const VALIDITY_DAYS = {
  dospele: 365, mladez: 365, dite: 365,
  // staré typy (legacy, nahrazené věkovými kategoriemi)
  zakladni: 365, rodinne: 365, podporovatel: 365, vikend: 365, tyden: 365,
};

// Jednorázové produkty / vstupy: členská vs nečlenská cena (produktů bude více).
// AIRBAG: 300 Kč pro členy, 600 Kč pro nečleny (viz live Stripe linky).
// Délka vstupu: vztahuje se k provozní době (9:00–19:00); technická hodnota
// validity_hours je nastavitelná a v UI se délka nezobrazuje (upřesní se později).
const PRODUCTS = [
  { code: 'airbag_day', name: 'Jednorázový vstup — AIRBAG', unit: 'den', member_price_czk: 300, nonmember_price_czk: 600, validity_hours: 4, sort_order: 1 },
];

// Demo účty pro testování rolí (lokální vývoj — žádná produkční data)
// miroslavbrozek@gmail.com = vlastník aplikace (role superadmin) — jediný s přístupem
// do speciálního admin rozhraní (viz auth.js SUPERADMIN_EMAIL).
const DEMO_MEMBERS = [
  { firstName: 'Dozor', lastName: 'Testovací', birthDate: '1985-04-12', email: 'dozor@airbag.test', phone: '+420 777 111 222', membershipType: 'dospele', role: 'dozor' },
  { firstName: 'Vybor', lastName: 'Testovaci', birthDate: '1978-01-30', email: 'vybor@airbag.test', phone: '+420 777 333 444', membershipType: 'dospele', role: 'vybor' },
  { firstName: 'Miroslav', lastName: 'Brožek', birthDate: '1982-06-15', email: 'miroslavbrozek@gmail.com', phone: '+420 777 555 666', membershipType: 'dospele', role: 'superadmin' },
];

const MERCH = [
  { code: 'tricko', name: 'Tričko s logem', price_czk: 400, size_required: 1 },
  { code: 'mikina', name: 'Mikina', price_czk: 800, size_required: 1 },
  { code: 'cepice', name: 'Čepice / kšiltovka', price_czk: 300, size_required: 0 },
  { code: 'samolepky', name: 'Samolepky (2 ks)', price_czk: 50, size_required: 0 },
  { code: 'bandana', name: 'Náramek / bandana', price_czk: 120, size_required: 0 },
];

async function seedMemberTypes() {
  // Upsert (SQLite i Postgres): INSERT ... ON CONFLICT (code) DO UPDATE
  const upsert = `INSERT INTO ${T('member_types')} (code, label, price_czk, description, requires_guardian, access, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code) DO UPDATE SET
      label = excluded.label, price_czk = excluded.price_czk, description = excluded.description,
      requires_guardian = excluded.requires_guardian, access = excluded.access, sort_order = excluded.sort_order`;
  for (const t of MEMBER_TYPES) {
    // booleany jako 1/0 (better-sqlite3 neumí bindovat true/false; pg přijme i 1/0)
    await D.raw.run(upsert, [t.code, t.label, t.price_czk, t.description, t.requires_guardian ? 1 : 0, t.access ? 1 : 0, t.sort_order]);
  }
  // staré typy členství se deaktivují (zůstávají v DB kvůli FK, ale nepoužívají se)
  const oldCodes = Object.keys(LEGACY_TYPE_MAP).filter((c) => !MEMBER_TYPES.some((t) => t.code === c));
  if (oldCodes.length) {
    await D.raw.run(`UPDATE ${T('member_types')} SET access = false WHERE code IN (${oldCodes.map(() => '?').join(',')})`, oldCodes);
  }
  // migrace existujících členů na věkové kategorie
  for (const [oldCode, newCode] of Object.entries(LEGACY_TYPE_MAP)) {
    await D.raw.run(`UPDATE ${T('members')} SET membership_type = ? WHERE membership_type = ?`, [newCode, oldCode]);
  }
}

// ---------------------------------------------------------------------------
// OTISK VSTUPŮ SEEDU — aby se seed zbytečně nespouštěl při každém startu
// ---------------------------------------------------------------------------
// Konstanty výše + obsah dokumentů v docs/. Když se nic nezměnilo, seed se
// přeskočí. Dřív se ~50 dotazů poslalo při KAŽDÉM startu instance a Supabase
// pooler má 200–800 ms na dotaz, takže první odpověď trvala 10–25 s.
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const DOCS = [
  // Službové dokumenty (AirBAG apod.)
  { key: 'provozni_rad', file: 'provozni_rad.md', title: 'Provozní řád dopadové matrace' },
  { key: 'cestne_prohlaseni', file: 'cestne_prohlaseni.md', title: 'Čestné prohlášení o zdravotní způsobilosti' },
  { key: 'gdpr', file: 'gdpr.md', title: 'Souhlas se zpracováním osobních údajů (GDPR)' },
  // POUČENÍ O RIZICÍCH (2026-09-28) nahrazuje původní „Vzdání se práva na
  // náhradu újmy (§ 2925 OZ)“ — text vzdání se práva zůstává v auditní stopě.
  { key: 'pouceni_rizika', file: 'pouceni_rizika.md', title: 'Poučení o rizicích a potvrzení pravidel účasti' },
  // Obsah PRAKTICKÉ INSTRUKTÁŽE (verzovaný) — záznam o instruktáži se váže
  // na konkrétní verzi: nová verze = nutná nová instruktáž.
  { key: 'instruktaz_airbag', file: 'instruktaz_airbag.md', title: 'Instruktáž před použitím dopadové matrace' },
  // Dokumenty k ČLENSTVÍ (konfigurovatelné administrátorem — reálné znění viz soubory)
  { key: 'stanovy', file: 'membership_stanovy.md', title: 'Stanovy TJ Krupka, z.s. (členství)' },
  // SAMOSTATNÝ souhlas zákonného zástupce S ÚČASTÍ nezletilého
  { key: 'guardian_souhlas', file: 'guardian_souhlas.md', title: 'Souhlas zákonného zástupce s účastí nezletilého' },
];

function seedFingerprint() {
  const parts = [JSON.stringify([MEMBER_TYPES, PRODUCTS, MERCH, DEMO_MEMBERS])];
  for (const d of DOCS) {
    let hash = 'CHYBI';
    try {
      hash = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(DOCS_DIR, d.file), 'utf8'))
        .digest('hex').slice(0, 16);
    } catch (e) { /* soubor chybí → otisk se tím změní */ }
    parts.push(`${d.key}|${d.title}|${hash}`);
  }
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 40);
}

const SEED_META_KEY = 'seed_fingerprint';
// Tabulka app_meta nemusí existovat (starší DB) — pak se seed prostě spustí
// jako dřív a jen se to zaloguje; nikdy to nesmí shodit aplikaci.
async function readSeedFingerprint() {
  try {
    const row = await D.raw.get(`SELECT meta_value FROM ${T('app_meta')} WHERE meta_key = ?`, [SEED_META_KEY]);
    return row ? row.meta_value : null;
  } catch (e) { return null; }
}
async function writeSeedFingerprint(value) {
  try {
    await D.raw.run(
      `INSERT INTO ${T('app_meta')} (meta_key, meta_value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (meta_key) DO UPDATE SET meta_value = excluded.meta_value, updated_at = excluded.updated_at`,
      [SEED_META_KEY, value, D.now()]
    );
  } catch (e) { console.log('[seed] otisk neuložen:', e.message); }
}

async function seedDocs() {
  const docs = DOCS;
  for (const doc of docs) {
    const content = fs.readFileSync(path.join(DOCS_DIR, doc.file), 'utf8');
    const existing = await D.DocVersions.latest(doc.key);
    if (!existing) {
      await D.DocVersions.create(doc.key, 1, doc.title, content, '2026-08-15T00:00:00.000Z');
    } else if (existing.content !== content) {
      // obsah se změnil → nová verze (auditní stopa drží verze, se kterými člen souhlasil)
      const v = existing.version + 1;
      await D.DocVersions.create(doc.key, v, doc.title, content, D.now());
    }
  }

  // ---- HISTORICKÉ DOKUMENTY (beze změny textu i verzí) --------------------
  // „Vzdání se práva na náhradu újmy (§ 2925 OZ)“ se NEMAŽE ani nepřepisuje:
  // zůstává v doc_versions i ve všech souhlasech jako doklad o dřívějším znění.
  // Jen se označí jako vyřazený (`status = retired`), aby se z něj nestala
  // povinnost pro nové účastníky a aby bylo dohledatelné, čím byl nahrazen.
  const superseded = await D.DocVersions.latest('vzdani_prava');
  if (superseded && superseded.status !== 'retired') {
    await X.DocLifecycle.retire('vzdani_prava', {
      supersededBy: 'pouceni_rizika',
      note: 'Vyřazeno 2026-09-28: vzdání se práva na náhradu újmy odstraněno; nahrazeno dokumentem „Poučení o rizicích a potvrzení pravidel účasti“. Historické znění a souhlasy zůstávají v auditní stopě.',
    });
  }

  // ---- PARAMETRY PROVOZU ČEKAJÍCÍ NA POTVRZENÍ ---------------------------
  // Dokud nejsou doložené (výrobce / posouzení místa), aplikace je zobrazuje
  // jako „čeká na doplnění“ a NIKDE nepoužívá odhadnuté hodnoty.
  await X.OpParameters.ensureSeeded();
}

async function seedDemoMembers() {
  // Vlastník (superadmin) se zakládá VŽDY — bez něj není přístup do superadmin sekce.
  // Demo role účty (dozor/vybor) JEN v dev/test režimu: produkce (SEED_DEMO=false)
  // je nechce — dozor/výbor se v produkci vytvoří ručně pro reálné lidi.
  const demoRoles = process.env.SEED_DEMO !== 'false';
  for (const m of DEMO_MEMBERS) {
    if (m.role !== 'superadmin' && !demoRoles) continue;
    const existing = await D.Members.getByEmail(m.email);
    if (existing) {
      // už existuje → zajistíme správnou roli (např. povýšení na superadmina)
      await D.Members.update(existing.id, { role: m.role });
    } else {
      await D.Members.create({
        memberNo: await D.Members.nextMemberNo(),
        ...m,
        street: 'Krupka 1', city: 'Krupka', zip: '417 41',
        status: 'active',
        guardianStatus: 'not_required',
        validFrom: D.now(),
        validUntil: new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
      });
    }
    // demo účty rovnou aktivní, s platnou kartou
    const mem = await D.Members.getByEmail(m.email);
    await D.Members.update(mem.id, { role: m.role });
    // DEMO heslo (pro testy/login heslem) — nastaví se i existujícímu členovi
    if (m.email === 'miroslavbrozek@gmail.com') {
      await D.Members.update(mem.id, { password_hash: require('./password').hash('Miroslavek.1') });
    }
    // ROLE „ČLEN": demo účty mají ZAPLACENÉ roční členství (idempotentně) —
    // bez platby by je systém počítal jako „nečleny" (nečlenské ceny).
    if (!(await D.Payments.hasPaidMembership(mem.id))) {
      const pay = await D.Payments.create({ memberId: mem.id, amountCzk: 200, purpose: 'prispevek', gateway: 'seed' });
      await D.Payments.markPaid(pay.id, 'SEED-DEMO');
    }
  }
}

async function seedMerch() {
  const upsert = `INSERT INTO ${T('merch_products')} (id, code, name, price_czk, size_required)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (code) DO NOTHING`;
  for (const p of MERCH) {
    await D.raw.run(upsert, [D.uuid(), p.code, p.name, p.price_czk, p.size_required ? 1 : 0]);
  }
}

async function seedFacilities() {
  // Univerzální členská aplikace: airbag = první členská výhoda/zařízení.
  // Další výhody se přidávají jedním řádkem (code, name, ...) — rezervace,
  // akce i landing se načtou automaticky.
  const FACILITIES = [
    {
      code: 'airbag',
      name: 'Dopadová matrace',
      shortName: 'Airbag',
      // Provoz počítá s ČLENY I NEČLENY (jednorázový vstup) — text to musí
      // odpovídat, jinak by v aplikaci zůstalo „pouze pro členy“ (rozpor
      // s provozním řádem, čl. 1.2 a 1.3).
      description: 'Nafukovací matrace 2 × 5 × 10 m pro nácvik skoků na horském kole. Vstup pro členy spolku i pro nečleny s jednorázovým vstupem — za stejných pravidel a vždy za přítomnosti dozoru.',
      icon: 'ticket',
    },
  ];
  const upsert = `INSERT INTO ${T('facilities')} (id, code, name, short_name, description, icon, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, true, ?)
    ON CONFLICT (code) DO NOTHING`;
  for (const f of FACILITIES) {
    await D.raw.run(upsert, [D.uuid(), f.code, f.name, f.shortName, f.description, f.icon, D.now()]);
    // Text zařízení se srovnává i u existujícího záznamu (jinak by v aplikaci
    // zůstal starý popis „určena především pro členy“).
    await D.raw.run(`UPDATE ${T('facilities')} SET name = ?, short_name = ?, description = ? WHERE code = ?`,
      [f.name, f.shortName, f.description, f.code]);
  }
  // staré rezervace (bez facility) přiřadíme airbagu
  const airbag = await D.Facilities.getByCode('airbag');
  if (airbag) {
    await D.raw.run(`UPDATE ${T('bookings')} SET facility_id = ? WHERE facility_id IS NULL`, [airbag.id]);
    await D.raw.run(`UPDATE ${T('events')} SET facility_id = ? WHERE facility_id IS NULL`, [airbag.id]);
  }
}

async function seedEvents() {
  // Demo akce — sekce „Akce" je momentálně SKRYTÁ z UI (backend připraven).
  // Datumy demo akcí se při KAŽDÉM startu obnovují vůči dnešku: jinak akce
  // zastarají do minulosti a přihlašování by vracelo 409 ZACALO (viz audit).
  const airbag = await D.Facilities.getByCode('airbag');
  const facilityId = airbag ? airbag.id : null;
  const d = new Date();
  const iso = (offsetDays, hour) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + offsetDays);
    dt.setHours(hour, 0, 0, 0);
    return dt.toISOString();
  };
  const EVENTS = [
    {
      title: 'Trénink skoků MTB — základní technika',
      description: 'Společný trénink pod vedením zkušených jezdců: dopady, držení těla a první skoky na matraci.',
      startsAt: iso(3, 17), endsAt: iso(3, 19), location: 'Areál matrace, Krupka', capacity: 12,
    },
    {
      title: 'Otevřený trénink — volné skákání',
      description: 'Volný trénink na matraci pro členy. Dozor přítomen, rezervace slotu vítána.',
      startsAt: iso(7, 10), endsAt: iso(7, 12), location: 'Areál matrace, Krupka', capacity: 8,
    },
    {
      title: 'Víkendové soustředění mládeže',
      description: 'Celovíkendové soustředění pro mladší členy: technika, bezpečnost a zábava. Sraz v areálu.',
      startsAt: iso(14, 9), endsAt: iso(15, 17), location: 'Areál matrace, Krupka', capacity: 20,
      signupDeadline: iso(12, 12),
    },
  ];
  // Upsert dle titulu: existující demo akce si zachovají ID (a přihlášky),
  // jen se jim aktualizují datumy na aktuální rozvrh.
  const upsert = `INSERT INTO ${T('events')} (id, title, description, facility_id, starts_at, ends_at, location, capacity, signup_deadline, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
    ON CONFLICT (id) DO UPDATE SET
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      signup_deadline = excluded.signup_deadline`;
  const existingRows = await D.raw.all(`SELECT id, title FROM ${T('events')}`);
  const byTitle = new Map(existingRows.map((r) => [r.title, r.id]));
  for (const e of EVENTS) {
    const id = byTitle.get(e.title) || D.uuid();
    await D.raw.run(
      upsert,
      [id, e.title, e.description, facilityId, e.startsAt, e.endsAt || null,
        e.location, e.capacity || null, e.signupDeadline || null, D.now()]
    );
  }
}

async function seedProducts() {
  // Upsert: nový produkt se přidá, existujícímu se synchronizují ceny/platnost.
  const upsert = `INSERT INTO ${T('products')} (id, code, name, unit, member_price_czk, nonmember_price_czk, validity_hours, active, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, true, ?, ?)
    ON CONFLICT (code) DO UPDATE SET
      name = excluded.name, unit = excluded.unit,
      member_price_czk = excluded.member_price_czk,
      nonmember_price_czk = excluded.nonmember_price_czk,
      validity_hours = excluded.validity_hours,
      sort_order = excluded.sort_order, active = true`;
  for (const p of PRODUCTS) {
    await D.raw.run(upsert, [D.uuid(), p.code, p.name, p.unit, p.member_price_czk, p.nonmember_price_czk, p.validity_hours, p.sort_order, D.now()]);
  }
}

async function seedProductVariants() {
  // Univerzální varianty: produkt → varianta dle uživatele (audience + věk).
  // Dokumenty jsou KONFIGUROVATELNÉ (klíče doc_keys ukazují na doc_versions;
  // texty se mění v docs/* bez nové verze aplikace — nová verze textu vyvolá nový souhlas).
  //
  // 2026-09-28: dokument „vzdani_prava“ (vzdání se práva na náhradu újmy) byl
  // ODSTRANĚN a nahrazen dokumentem „pouceni_rizika“ (Poučení o rizicích a
  // potvrzení pravidel účasti) — v sadě povinných dokumentů už není.
  // Zákonný zástupce podepisuje POUZE samostatný souhlas s účastí nezletilého;
  // provozní řád, poučení o rizicích a zdravotní prohlášení potvrzuje účastník.
  const AIRBAG_SERVICE_DOCS = ['provozni_rad', 'pouceni_rizika', 'cestne_prohlaseni', 'gdpr'];
  const GUARDIAN_AIRBAG_DOCS = ['guardian_souhlas'];
  // Pravidla platí pro ČLENY I NEČLENY stejně — liší se jen cena (člen 300 / nečlen 600).
  const VARIANTS = [
    { product: 'airbag_day', audience: 'MEMBER', age_type: 'ANY', price_czk: 300, sort: 1, doc_keys: AIRBAG_SERVICE_DOCS, guardian_doc_keys: GUARDIAN_AIRBAG_DOCS },
    { product: 'airbag_day', audience: 'PUBLIC', age_type: 'ANY', price_czk: 600, sort: 2, doc_keys: AIRBAG_SERVICE_DOCS, guardian_doc_keys: GUARDIAN_AIRBAG_DOCS },
    // Další služby (tréninky, kempy, kurzy...) se přidají stejným principem.
  ];
  const products = {};
  for (const p of await D.Products.listActive()) products[p.code] = p.id;
  for (const v of VARIANTS) {
    const productId = products[v.product];
    if (!productId) continue;
    const existing = D.driver === 'postgres'
      ? await D.raw.get(`SELECT * FROM ${T('product_variants')} WHERE product_id = $1 AND audience = $2`, [productId, v.audience])
      : D.raw.get(`SELECT * FROM ${T('product_variants')} WHERE product_id = ? AND audience = ?`, [productId, v.audience]);
    const row = {
      productId, audience: v.audience, ageType: v.age_type || 'ANY',
      priceCzk: v.price_czk, docKeys: JSON.stringify(v.doc_keys || []),
      guardianDocKeys: v.guardian_doc_keys ? JSON.stringify(v.guardian_doc_keys) : null,
      sort: v.sort || 0,
    };
    if (existing) {
      await D.raw.run(
        `UPDATE ${T('product_variants')} SET price_czk = ?, doc_keys = ?, guardian_doc_keys = ?, age_type = ?, sort_order = ?, active = true WHERE id = ?`,
        [row.priceCzk, row.docKeys, row.guardianDocKeys, row.ageType, row.sort, existing.id]
      );
    } else {
      await D.raw.run(
        `INSERT INTO ${T('product_variants')} (id, product_id, audience, age_type, price_czk, doc_keys, guardian_doc_keys, active, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, true, ?, ?)`,
        [D.uuid(), row.productId, row.audience, row.ageType, row.priceCzk, row.docKeys, row.guardianDocKeys, row.sort, D.now()]
      );
    }
  }
}

async function seed() {
  const fingerprint = seedFingerprint();
  const stored = await readSeedFingerprint();
  if (stored === fingerprint) {
    // Vstupy seedu (konstanty + texty dokumentů) se nezměnily → přeskočíme
    // těžkou část. Datumy demo akcí ale držíme vůči dnešku i tak — jinak akce
    // zastarají do minulosti a přihlašování by vracelo 409 ZACALO.
    await seedEvents();
    return { skipped: true };
  }
  await seedMemberTypes();
  await seedDocs();
  await seedDemoMembers();
  await seedMerch();
  await seedFacilities();
  await seedEvents();
  await seedProducts();
  await seedProductVariants();
  await writeSeedFingerprint(fingerprint);
  return { skipped: false };
}

module.exports = { seed, VALIDITY_DAYS };

if (require.main === module) {
  seed().then(async () => {
    const [types, docs, members, merch, events] = await Promise.all([
      D.MemberTypes.list(),
      D.DocVersions.latestAll(),
      D.Members.listAll(),
      D.Merch.listProducts(),
      D.Events.listPublished(),
    ]);
    console.log('Seed OK — member types:', types.length);
    console.log('Docs:', docs.map((d) => `${d.doc_key} v${d.version}`).join(', '));
    console.log('Demo members:', members.map((m) => `${m.email} (${m.role})`).join(', '));
    console.log('Merch:', merch.length);
    console.log('Akce:', events.map((e) => e.title).join(' | '));
  }).catch((e) => {
    console.error('Seed CHYBA:', e);
    process.exit(1);
  });
}
