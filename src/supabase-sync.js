// src/supabase-sync.js — synchronizace členů PWA → Supabase členská evidence.
//
// Supabase projekt: https://mljqltwcdqknezuqpisb.supabase.co (stejný jako WebDo24),
// tabulka `public.members` = existující členská evidence TJ Krupka (import z IS ČUS):
//   name, surname, born, mail, phone, street, city, zip, role (2=člen, 3=vedoucí/výbor),
//   oddil, name_parents, vztah, zakonny_zastupce, mail_parents, phone_parents,
//   member_from, member_to, …
//
// Režimy (env SUPABASE_SYNC):
//   off      (default, bez konfigurace) — žádná komunikace, čistý no-op
//   dry-run  — počítá a LOGUJE, co by poslal, ale nic nezapíše (bezpečný test)
//   on       — reálný upsert (INSERT/PATCH přes PostgREST)
//
// Pozor: tabulka NEMÁ unikátní index na mail — upsert se proto řeší ručně:
//   SELECT dle mailu (ilike, case-insensitive) → existuje-li: PATCH, jinak POST.
// Service role key se nikdy neloguje ani nevrací v odpovědích.
'use strict';

const env = process.env;

const cfg = {
  url: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  mode: (env.SUPABASE_SYNC || 'off').toLowerCase(), // off | dry-run | on
};

function enabled() {
  return !!(cfg.mode === 'on' && cfg.url && cfg.serviceKey);
}
function mode() {
  return cfg.mode;
}

// Lokální demo účty (seed) a testovací členové se do produkční evidence NIKDY neodesílají.
// airbag.test = seed role účty; test.cz = členové vytvoření npm test.
const DEV_EMAIL_DOMAINS = ['airbag.test', 'test.cz'];
function isDevDemo(member) {
  const email = (member && (member.email || member.mail) || '').toLowerCase();
  return DEV_EMAIL_DOMAINS.some((d) => email.endsWith('@' + d));
}

function apiHeaders() {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json',
  };
}

// Mapování lokálního člena PWA → řádek členské evidence
function toRow(m) {
  // evidence: 2 = běžný člen, 3 = vedoucí/výbor; vlastník (superadmin) → 3
  const role = m.role && m.role !== 'member' ? 3 : 2;
  const r = {
    name: m.first_name || null,
    surname: m.last_name || null,
    born: m.birth_date || null,
    mail: m.email || null,
    phone: m.phone || null,
    street: m.street || null,
    city: m.city || null,
    zip: m.zip || null,
    role,
    member_from: m.valid_from || null,
    member_to: m.valid_until || null,
    name_parents: m.guardian_name || null,
    vztah: m.guardian_relation || null,
    zakonny_zastupce: m.guardian_name || null,
    mail_parents: m.guardian_email || null,
    phone_parents: m.guardian_phone || null,
  };
  // prázdné řetězce → NULL (evidence to nemá ráda)
  for (const k of Object.keys(r)) {
    if (r[k] === '') r[k] = null;
  }
  return r;
}

function log(action, detail) {
  console.log(`[supabase-sync:${cfg.mode}] ${action}${detail ? ' — ' + detail : ''}`);
}

// Najde řádek evidence podle e-mailu (case-insensitive). Vrací {id_cus, mail} nebo null.
// Pozor: evidenční tabulka nemá sloupec id — PK je číselné id_cus (import z IS ČUS).
async function findByEmail(email) {
  if (!enabled() && cfg.mode !== 'dry-run') return null;
  if (!email) return null;
  const url = `${cfg.url}/rest/v1/members?select=id_cus,mail&mail=ilike.${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: apiHeaders() });
  if (!resp.ok) {
    log('findByEmail CHYBA', `${resp.status} ${(await resp.text()).slice(0, 120)}`);
    return null;
  }
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Načte plný řádek evidence podle id_cus (pro import člena do lokální DB při přihlášení).
async function fetchFull(idCus) {
  if (!enabled() && cfg.mode !== 'dry-run') return null;
  if (!idCus) return null;
  const url = `${cfg.url}/rest/v1/members?id_cus=eq.${encodeURIComponent(idCus)}&select=*`;
  const resp = await fetch(url, { headers: apiHeaders() });
  if (!resp.ok) {
    log('fetchFull CHYBA', `${resp.status} ${(await resp.text()).slice(0, 120)}`);
    return null;
  }
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Nové id_cus pro INSERT (PK evidenční tabulky nemá auto-generování — NOT NULL bez defaultu).
async function nextIdCus() {
  const url = `${cfg.url}/rest/v1/members?select=id_cus&order=id_cus.desc&limit=1`;
  const resp = await fetch(url, { headers: apiHeaders() });
  if (!resp.ok) {
    log('nextIdCus CHYBA', `${resp.status} ${(await resp.text()).slice(0, 120)}`);
    return null;
  }
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length ? rows[0].id_cus + 1 : 1;
}

// Upsert člena PWA do evidence. Vrací {ok, action: 'insert'|'update'|'skipped'|'dry-run'}.
async function upsertMember(member) {
  if (cfg.mode === 'off' || !cfg.url) return { ok: true, action: 'skipped', reason: 'off' };
  if (isDevDemo(member)) {
    log('SKIP demo účet', member.email);
    return { ok: true, action: 'skipped', reason: 'demo' };
  }
  const row = toRow(member);
  const existing = await findByEmail(member.email);
  if (cfg.mode === 'dry-run') {
    log('dry-run', `${existing ? 'UPDATE' : 'INSERT'} ${member.email} → ${JSON.stringify(row).slice(0, 160)}`);
    return { ok: true, action: 'dry-run', member: member.email };
  }
  const headers = apiHeaders();
  if (existing) {
    // PATCH posílá JEN vyplněná pole (audit Fáze 1): prázdné/null hodnoty by
    // přepsaly reálná data evidence (adresa, telefon, platnost členství…).
    // Roli evidence NEPŘEPISUJEME — vedoucí z evidence nesmí být degradován
    // na běžného člena jen proto, že se přihlásil přes PWA.
    const patch = {};
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && v !== '') patch[k] = v;
    }
    delete patch.role;
    const resp = await fetch(`${cfg.url}/rest/v1/members?id_cus=eq.${existing.id_cus}`, {
      method: 'PATCH', headers, body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      log('UPDATE CHYBA', `${member.email} ${resp.status} ${(await resp.text()).slice(0, 120)}`);
      return { ok: false, action: 'update', member: member.email, error: resp.status };
    }
    log('UPDATE', member.email);
    return { ok: true, action: 'update', member: member.email };
  }
  const resp = await fetch(`${cfg.url}/rest/v1/members`, {
    method: 'POST', headers, body: JSON.stringify(row),
  });
  if (!resp.ok) {
    // id_cus je NOT NULL bez auto-generování — při selhání zkusíme INSERT s max+1
    const idCus = await nextIdCus();
    if (idCus === null) return { ok: false, action: 'insert', member: member.email, error: resp.status };
    const resp2 = await fetch(`${cfg.url}/rest/v1/members`, {
      method: 'POST', headers, body: JSON.stringify({ ...row, id_cus: idCus }),
    });
    if (!resp2.ok) {
      log('INSERT CHYBA', `${member.email} ${resp2.status} ${(await resp2.text()).slice(0, 160)}`);
      return { ok: false, action: 'insert', member: member.email, error: resp2.status };
    }
    log('INSERT', `${member.email} (id_cus ${idCus})`);
    return { ok: true, action: 'insert', member: member.email, idCus };
  }
  log('INSERT', member.email);
  return { ok: true, action: 'insert', member: member.email };
}

// Hromadný upsert všech členů (superadmin tlačítko).
async function syncAll(members) {
  if (cfg.mode === 'off' || !cfg.url) return { ok: true, synced: 0, mode: cfg.mode, reason: 'off' };
  const results = [];
  for (const m of members) results.push(await upsertMember(m));
  const ok = results.filter((r) => r.ok).length;
  return { ok: ok === results.length, synced: ok, total: results.length, mode: cfg.mode };
}

module.exports = { enabled, mode, upsertMember, syncAll, findByEmail, fetchFull, toRow, _cfg: cfg };
