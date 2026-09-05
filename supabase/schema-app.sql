-- AIRBAG PWA — PRODUKČNÍ SCHÉMA (Supabase/Postgres)
-- ============================================================
-- Všechny tabulky aplikace žijí ve schématu `app` (NE public!).
-- DŮVOD: public.members je členská evidence TJ Krupka (import z IS ČUS,
-- sloupce name/surname/born/mail..., PK id_cus) — s tou aplikace nesmí kolidovat.
-- Evidence zůstává v public a řeší se přes PostgREST (src/supabase-sync.js).
--
-- APLIKACE: spusťte tento soubor v Supabase SQL editoru (Dashboard → SQL).
-- Připojení aplikace: DB_DRIVER=postgres + DATABASE_URL (pooler connection string)
--   postgresql://postgres.<ref>:<heslo>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
--
-- POZNÁMKA k RLS: aplikace přistupuje přes service_role (BYPASSRLS), takže RLS
-- zde zatím nenastavujeme. Pokud se v budoucnu přejde na Supabase Auth, doplní se
-- politiky (auth.uid() → app.members.id) — viz README sekce „Migrace na Supabase".

create schema if not exists app;

-- ============================================================
-- 1. Tabulky
-- ============================================================

-- Členské kategorie (ceník) — věkové, vše 200 Kč/rok
create table if not exists app.member_types (
  code               text primary key,
  label              text not null,
  price_czk          integer not null,
  description        text not null,
  requires_guardian  boolean not null default false,
  access             boolean not null default true,
  sort_order         integer not null default 0
);

-- Členové aplikace (není to stejné jako public.members!)
create table if not exists app.members (
  id                 uuid primary key default gen_random_uuid(),
  member_no          integer unique,
  first_name         text not null,
  last_name          text not null,
  birth_date         date not null,
  street             text not null default '',
  city               text not null default '',
  zip                text not null default '',
  email              text not null unique,
  phone              text not null default '',
  membership_type    text not null references app.member_types(code),
  membership_kind    text not null default 'sportovni',  -- sportovni | radne (nový člen = sportovní)
  photo              text,               -- base64 data-URL (povinné při registraci)
  role               text not null default 'member',   -- member | dozor | vybor | superadmin
  status             text not null default 'registered',
  guardian_name      text,
  guardian_relation  text,
  guardian_email     text,
  guardian_phone     text,
  guardian_token     uuid,
  guardian_token_expires timestamptz,  -- odkaz pro souhlas rodiče (7 dní)
  guardian_status    text not null default 'not_required',  -- not_required|pending|granted|rejected
  guardian_granted_at timestamptz,
  guardian_ip        text,
  valid_from         timestamptz,
  valid_until        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Notifikace v aplikaci (např. schválení/neschválení členství)
create table if not exists app.notifications (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references app.members(id) on delete cascade,
  type          text not null,          -- membership_approved | membership_rejected | ...
  title         text not null,
  body          text not null,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notifications_member on app.notifications (member_id, read);

-- Verzované právní dokumenty (provozní řád, GDPR, …)
create table if not exists app.doc_versions (
  id            uuid primary key default gen_random_uuid(),
  doc_key       text not null,          -- provozni_rad|cestne_prohlaseni|gdpr|vzdani_prava
  version       integer not null,
  title         text not null,
  content       text not null,
  content_hash  text not null,          -- sha256
  effective_from timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (doc_key, version)
);

-- AUDITNÍ STOPA souhlasů (kdo, s čím, kdy, odkud)
create table if not exists app.consents (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references app.members(id),
  doc_key       text not null,
  doc_version   integer not null,
  content_hash  text not null,
  signer_type   text not null,          -- member | guardian
  identity      text not null,
  granted_at    timestamptz not null default now(),
  ip            text not null,
  user_agent    text,
  unique (member_id, doc_key, signer_type)
);

-- Platby (test | stripe)
create table if not exists app.payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references app.members(id),
  amount_czk  integer not null,
  purpose     text not null,             -- prispevek|merch|sluzba
  status      text not null default 'pending',  -- pending|paid|failed|cancelled
  gateway     text not null default 'test',     -- test|stripe
  gateway_ref text,                      -- Stripe session id / test ref
  product_code text,                     -- jednorázový produkt (purpose='produkt')
  receipt_no  text,
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Stub e-mail/SMS outbox
create table if not exists app.messages (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid references app.members(id),
  channel    text not null,              -- email | sms
  to_address text not null,
  subject    text,
  body       text not null,
  created_at timestamptz not null default now()
);

-- Sessions (token auth — magic link)
create table if not exists app.sessions (
  id         text primary key,           -- token
  member_id  uuid not null references app.members(id),
  role       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- QR členská karta
create table if not exists app.cards (
  member_id   uuid primary key references app.members(id),
  qr_payload  text not null,
  issued_at   timestamptz not null default now()
);

-- Členské výhody / zařízení spolku (airbag = první)
create table if not exists app.facilities (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,      -- 'airbag', ...
  name        text not null,
  short_name  text,
  description text not null default '',
  icon        text not null default 'ticket',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Rezervace slotů (dle zařízení)
create table if not exists app.bookings (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references app.members(id),
  facility_id uuid references app.facilities(id),
  slot_start  timestamptz not null,
  slot_end    timestamptz not null,
  status      text not null default 'confirmed',
  created_at  timestamptz not null default now(),
  unique (slot_start, facility_id)
);

-- Merch
create table if not exists app.merch_products (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  price_czk     integer not null,
  size_required boolean not null default false
);

create table if not exists app.merch_orders (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references app.members(id),
  items      jsonb not null,             -- [{product, size, qty}]
  total_czk  integer not null,
  status     text not null default 'new',
  payment_id uuid references app.payments(id),
  created_at timestamptz not null default now()
);

-- Akce spolku + přihlášení (backend připraven, UI dočasně skryté)
create table if not exists app.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text not null default '',
  facility_id  uuid references app.facilities(id),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  location     text not null default '',
  capacity     integer,                  -- NULL = neomezeno
  signup_deadline timestamptz,
  status       text not null default 'published',  -- draft|published|cancelled
  created_at   timestamptz not null default now()
);

create table if not exists app.event_signups (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references app.events(id),
  member_id  uuid not null references app.members(id),
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);

-- ============================================================
-- 2. Sekvence, triggery, indexy
-- ============================================================

-- Členské číslo (sekvence) — aplikace ho ale posílá explicitně (MAX+1),
-- sekvence slouží jako pojistka a pro ruční zásahy.
create sequence if not exists app.member_no_seq;
alter table app.members alter column member_no set default nextval('app.member_no_seq');

-- updated_at se aktualizuje automaticky (aplikace ho nastavuje i sama)
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists members_touch on app.members;
create trigger members_touch before update on app.members
  for each row execute function app.touch_updated_at();

-- Indexy pro časté dotazy
create unique index if not exists idx_members_email on app.members (lower(email));
create index if not exists idx_members_guardian_token on app.members (guardian_token);
create index if not exists idx_consents_member on app.consents (member_id);
create index if not exists idx_payments_member on app.payments (member_id);
create index if not exists idx_bookings_slot on app.bookings (slot_start);
create index if not exists idx_sessions_expires on app.sessions (expires_at);
create index if not exists idx_events_starts on app.events (starts_at);

-- Jednorázové produkty / vstupy (produktů může být více): členská vs nečlenská cena
create table if not exists app.products (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique not null,
  name                text not null,
  unit                text not null default 'den',
  member_price_czk    integer not null,
  nonmember_price_czk integer not null,
  validity_hours      integer not null default 24,
  active              boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

-- Zakoupená oprávnění k jednorázovým produktům
create table if not exists app.entitlements (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references app.members(id),
  product_id  uuid not null references app.products(id),
  payment_id  uuid references app.payments(id),
  valid_from  timestamptz not null,
  valid_until timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_entitlements_member on app.entitlements (member_id, valid_until);

-- zpětná kompatibilita (idempotentní doplnění sloupce do existujících DB)
alter table app.payments add column if not exists product_code text;

-- Produktové varianty (univerzální eligibilita)
create table if not exists app.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references app.products(id),
  audience      text not null default 'PUBLIC',   -- MEMBER | PUBLIC
  age_type      text not null default 'ANY',      -- ANY | ADULT | MINOR
  price_czk     integer not null,
  doc_keys      jsonb not null default '[]'::jsonb,
  guardian_doc_keys jsonb,
  active_from   timestamptz,
  active_until  timestamptz,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_variants_product on app.product_variants (product_id, active);
