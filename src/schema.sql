-- AIRBAG PWA — SQLite schéma (lokální vývoj)
-- Navrženo 1:1 pro migraci na Supabase/Postgres (viz supabase/schema.sql).
-- UUID = TEXT, časová razítka = ISO 8601 stringy, aby přechod na Postgres
-- nevyžadoval datové migrace.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Členské kategorie (ceník)
CREATE TABLE IF NOT EXISTS member_types (
  code        TEXT PRIMARY KEY,          -- dospele|mladez|dite (věkové kategorie)
  label       TEXT NOT NULL,
  price_czk   INTEGER NOT NULL,
  description TEXT NOT NULL,
  requires_guardian INTEGER NOT NULL DEFAULT 0,  -- 1 = nutný souhlas zákonného zástupce
  access      INTEGER NOT NULL DEFAULT 1,        -- 1 = přístup k matraci
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Členové
CREATE TABLE IF NOT EXISTS members (
  id              TEXT PRIMARY KEY,      -- uuid
  member_no       INTEGER UNIQUE,        -- členské číslo (1,2,3,...)
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  birth_date      TEXT NOT NULL,         -- YYYY-MM-DD
  street          TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  zip             TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL,
  password_hash   TEXT,                    -- scrypt hash (email+heslo přihlášení; NULL = jen magic link)
  phone           TEXT NOT NULL DEFAULT '',
  membership_type TEXT NOT NULL REFERENCES member_types(code),
  membership_kind TEXT NOT NULL DEFAULT 'sportovni',  -- sportovni | radne (nový člen = sportovní)
  gender          TEXT,                    -- muz | zena | null (pro statistiky složení)
  photo           TEXT,                    -- base64 data-URL (povinné při registraci)
  role            TEXT NOT NULL DEFAULT 'member',   -- member|dozor|vybor|superadmin (vlastník)
  status          TEXT NOT NULL DEFAULT 'registered',
                  -- registered -> consent_pending -> payment_pending -> review -> active
                  -- review (čeká na schválení admina) -> active | rejected | deferred
  guardian_name     TEXT,                -- jméno zákonného zástupce
  guardian_relation TEXT,                -- vztah (matka/otec/...)
  guardian_email    TEXT,
  guardian_phone    TEXT,
  guardian_token    TEXT,                -- jednorázový token pro e-souhlas rodiče
  guardian_token_expires TEXT,           -- expirace odkazu pro souhlas (7 dní)
  guardian_status   TEXT NOT NULL DEFAULT 'not_required',  -- not_required|pending|granted|rejected
  guardian_granted_at TEXT,
  guardian_ip        TEXT,
  valid_from      TEXT,                  -- začátek členského období
  valid_until     TEXT,                  -- konec členského období
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members (lower(email));

-- Verzované právní dokumenty (provozní řád, GDPR, ...)
CREATE TABLE IF NOT EXISTS doc_versions (
  id            TEXT PRIMARY KEY,        -- uuid
  doc_key       TEXT NOT NULL,           -- provozni_rad|cestne_prohlaseni|gdpr|vzdani_prava
  version       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,           -- plné znění dokumentu (markdown/html)
  content_hash  TEXT NOT NULL,           -- SHA-256 obsahu
  effective_from TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(doc_key, version)
);

-- Notifikace v aplikaci (např. schválení/neschválení členství)
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,        -- uuid
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,           -- membership_approved | membership_rejected | ...
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0,  -- 0 = nepřečtená, 1 = přečtená
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications (member_id, read);

-- AUDITNÍ STOPA souhlasů — neměnitelný záznam: kdo, s čím, kdy, odkud
CREATE TABLE IF NOT EXISTS consents (
  id            TEXT PRIMARY KEY,        -- uuid
  member_id     TEXT NOT NULL REFERENCES members(id),
  doc_key       TEXT NOT NULL,
  doc_version   INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,           -- hash verze dokumentu, se kterou souhlasil
  signer_type   TEXT NOT NULL,           -- member | guardian
  identity      TEXT NOT NULL,           -- e-mail souhlasící osoby
  granted_at    TEXT NOT NULL,           -- ISO timestamp
  ip            TEXT NOT NULL,
  user_agent    TEXT,
  UNIQUE(member_id, doc_key, signer_type)
);

-- Platby
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,          -- uuid
  member_id   TEXT NOT NULL REFERENCES members(id),
  amount_czk  INTEGER NOT NULL,
  purpose     TEXT NOT NULL,             -- prispevek|merch|sluzba
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|paid|failed|cancelled
  gateway     TEXT NOT NULL DEFAULT 'test',     -- test|gopay|comgate|stripe
  gateway_ref TEXT,                      -- reference u brány
  product_code TEXT,                     -- jednorázový produkt (purpose='produkt')
  receipt_no  TEXT,                      -- číslo účtenky
  paid_at     TEXT,
  created_at  TEXT NOT NULL
);

-- Stub e-mail/SMS outbox (žádné reálné odesílání — konzole/dev inbox)
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  member_id  TEXT,
  channel    TEXT NOT NULL,              -- email|sms
  to_address TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions (token auth)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- token
  member_id  TEXT NOT NULL REFERENCES members(id),
  role       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- QR členská karta — snapshot dat v době vydání
CREATE TABLE IF NOT EXISTS cards (
  member_id   TEXT PRIMARY KEY REFERENCES members(id),
  qr_payload  TEXT NOT NULL,             -- data zakódovaná do QR
  issued_at   TEXT NOT NULL
);

-- Členské výhody / zařízení spolku (airbag je jedno z nich — univerzální členská aplikace)
CREATE TABLE IF NOT EXISTS facilities (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,     -- 'airbag', 'hala', ...
  name        TEXT NOT NULL,
  short_name  TEXT,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT 'ticket',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- Rezervace (univerzální — vztahují se k zařízení/výhodě)
CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  facility_id TEXT REFERENCES facilities(id),
  slot_start  TEXT NOT NULL,
  slot_end    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed',
  created_at  TEXT NOT NULL
);

-- Merch produkty a objednávky (MVP bonus)
CREATE TABLE IF NOT EXISTS merch_products (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  price_czk  INTEGER NOT NULL,
  size_required INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS merch_orders (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  items      TEXT NOT NULL,              -- JSON [{product, size, qty}]
  total_czk  INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new',
  payment_id TEXT,
  created_at TEXT NOT NULL
);

-- Akce spolku a přihlášení na ně (volitelně vázané na zařízení/výhodu)
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  facility_id  TEXT REFERENCES facilities(id),
  starts_at    TEXT NOT NULL,            -- ISO datetime
  ends_at      TEXT,
  location     TEXT NOT NULL DEFAULT '',
  capacity     INTEGER,                  -- NULL = neomezeno
  signup_deadline TEXT,                  -- ISO datetime; NULL = do začátku akce
  status       TEXT NOT NULL DEFAULT 'published',  -- draft | published | cancelled
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_signups (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  UNIQUE (event_id, member_id)
);

-- Jednorázové produkty / vstupy (produktů může být více):
-- členská cena (member_price) vs nečlenská (nonmember_price), délka platnosti v hodinách.
CREATE TABLE IF NOT EXISTS products (
  id                  TEXT PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,       -- 'airbag_day', ...
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL DEFAULT 'den',-- jednotka (den, hodina, ...)
  member_price_czk    INTEGER NOT NULL,
  nonmember_price_czk INTEGER NOT NULL,
  validity_hours      INTEGER NOT NULL DEFAULT 24,
  active              INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

-- Zakoupená oprávnění k jednorázovým produktům (host / nečlen / člen)
CREATE TABLE IF NOT EXISTS entitlements (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  payment_id  TEXT REFERENCES payments(id),
  valid_from  TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- PRODUKTOVÉ VARIANTY (univerzální eligibilita: produkt → varianta dle uživatele)
-- audience: MEMBER (jen aktivní členové) | PUBLIC (kdo nemá aktivní členství)
-- age_type: ANY | ADULT | MINOR  (omezuje věkovou kategorii varianty)
-- doc_keys / guardian_doc_keys: povinné dokumenty pro uživatele / zákonného zástupce
-- (JSON pole doc_key z doc_versions; prázdné guardian_doc_keys = zástupce podepisuje doc_keys)
CREATE TABLE IF NOT EXISTS product_variants (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  audience      TEXT NOT NULL DEFAULT 'PUBLIC',   -- MEMBER | PUBLIC
  age_type      TEXT NOT NULL DEFAULT 'ANY',      -- ANY | ADULT | MINOR
  price_czk     INTEGER NOT NULL,
  doc_keys      TEXT NOT NULL DEFAULT '[]',       -- JSON [doc_key,...]
  guardian_doc_keys TEXT,                          -- JSON | NULL => same jako doc_keys
  active_from   TEXT,
  active_until  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id, active);

-- ===========================================================================
-- ROZŠÍŘENÍ 2026-09-27 — vstupy, audit členství, pozvánky dozoru, fotky
-- (1:1 se Supabase migrací 20260927_airbag_entries_dozor_audit.sql)
-- ===========================================================================

-- 1) VSTUPY NA AIRBAG (členové i nečlenové) — surová data pro analýzy
CREATE TABLE IF NOT EXISTS entries (
  id               TEXT PRIMARY KEY,
  facility_code    TEXT NOT NULL DEFAULT 'airbag',
  member_id        TEXT,                            -- NULL = nečlen / host
  person_name      TEXT NOT NULL DEFAULT '',
  person_no        INTEGER,
  kind             TEXT NOT NULL DEFAULT 'neclen',   -- clen | neclen
  entitlement_kind TEXT,                            -- membership | entitlement | none
  access_ok        INTEGER NOT NULL DEFAULT 1,
  reason           TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'qr',      -- qr | manual | import
  recorded_by      TEXT,
  recorded_by_name TEXT NOT NULL DEFAULT '',
  valid_until      TEXT,
  member_kind      TEXT,                            -- sportovni | radne (snapshot)
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_created  ON entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_member   ON entries (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_facility ON entries (facility_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_kind     ON entries (kind, created_at DESC);

-- 2) AUDIT ZÁPISU ČLENSTVÍ — kdo, kde, kdy zapsal člena a jaký typ mu dal
CREATE TABLE IF NOT EXISTS membership_audit (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  action      TEXT NOT NULL,      -- created | kind_changed | activated | blocked | unblocked
  kind_from   TEXT,
  kind_to     TEXT,
  status_from TEXT,
  status_to   TEXT,
  source      TEXT NOT NULL DEFAULT 'app.tjkrupka.cz',
  actor_email TEXT NOT NULL DEFAULT '',
  actor_id    TEXT,
  actor_name  TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maudit_member  ON membership_audit (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maudit_created ON membership_audit (created_at DESC);

-- 3) POZVÁNKY PRO ÚČTY DOZORU (vytváří jen superadmin, doručuje e-mailem)
CREATE TABLE IF NOT EXISTS dozor_invites (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name  TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  revoked_at TEXT,
  invited_by TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dozvinv_email ON dozor_invites (lower(email));
CREATE INDEX IF NOT EXISTS idx_dozvinv_token ON dozor_invites (token);

-- 6) VÝKONOVÉ INDEXY (QR kontrola, platby, přehled členské základny)
CREATE INDEX IF NOT EXISTS idx_cards_payload         ON cards (qr_payload);
CREATE INDEX IF NOT EXISTS idx_payments_member_ok    ON payments (member_id, status, purpose);
CREATE INDEX IF NOT EXISTS idx_entitlements_m_valid  ON entitlements (member_id, valid_until DESC);
CREATE INDEX IF NOT EXISTS idx_members_role          ON members (role);
CREATE INDEX IF NOT EXISTS idx_members_status        ON members (status);
CREATE INDEX IF NOT EXISTS idx_members_kind          ON members (membership_kind);
CREATE INDEX IF NOT EXISTS idx_consents_member       ON consents (member_id);
