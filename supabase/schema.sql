-- AIRBAG PWA — Supabase/Postgres schéma (cílová migrace z SQLite).
-- Zdroj pravdy pro lokální vývoj: src/schema.sql (SQLite, stejné sloupce).
-- UUID generuje Postgres (gen_random_uuid()), timestampy TIMESTAMPTZ DEFAULT now().
--
-- Členské kategorie: POUZE věkové (dospele 18+, mladez 15–18, dite do 15), vše 200 Kč/rok.
-- Backend určuje kategorii výhradně z birth_date (membershipTypeForAge v src/routes.js).
-- Nezletilí (<18): povinný souhlas zákonného zástupce — jednorázový odkaz e-mailem,
-- platnost 7 dní (guardian_token_expires), tlačítko „Znovu odeslat e-mail rodiči"
-- rotuje token (POST /api/guardian-resend). Audit: signer_type='guardian' v consents.

-- ============================================================
-- 1. Tabulky
-- ============================================================

create table if not exists public.member_types (
  code               text primary key,
  label              text not null,
  price_czk          integer not null,
  description        text not null,
  requires_guardian  boolean not null default false,
  access             boolean not null default true,
  sort_order         integer not null default 0
);

create table if not exists public.members (
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
  membership_type    text not null references public.member_types(code),
  role               text not null default 'member',   -- member | dozor | vybor | superadmin (vlastník)
  status             text not null default 'registered',
  guardian_name      text,
  guardian_relation  text,
  guardian_email     text,
  guardian_phone     text,
  guardian_token     uuid,
  guardian_token_expires timestamptz,  -- expirace odkazu pro souhlas rodiče (7 dní)
  guardian_status    text not null default 'not_required',
  guardian_granted_at timestamptz,
  guardian_ip        text,
  valid_from         timestamptz,
  valid_until        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.doc_versions (
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

-- AUDITNÍ STOPA: neměnitelný záznam (kdo, s čím, kdy, odkud)
create table if not exists public.consents (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id),
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

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id),
  amount_czk  integer not null,
  purpose     text not null,
  status      text not null default 'pending',
  gateway     text not null default 'test',   -- test|gopay|comgate|stripe
  gateway_ref text,
  receipt_no  text,
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid references public.members(id),
  channel    text not null,             -- email | sms
  to_address text not null,
  subject    text,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id         text primary key,
  member_id  uuid not null references public.members(id),
  role       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.cards (
  member_id   uuid primary key references public.members(id),
  qr_payload  text not null,
  issued_at   timestamptz not null default now()
);

create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id),
  slot_start timestamptz not null,
  slot_end   timestamptz not null,
  status     text not null default 'confirmed',
  created_at timestamptz not null default now(),
  unique (slot_start)
);

create table if not exists public.merch_products (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  price_czk     integer not null,
  size_required boolean not null default false
);

create table if not exists public.merch_orders (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id),
  items      jsonb not null,
  total_czk  integer not null,
  status     text not null default 'new',
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. RLS — row level security (role: member / dozor / vybor)
-- ============================================================
-- Identita: auth.uid() → members.id (Supabase Auth).
-- Dozor/výbor se pozná přes public.members.role.

alter table public.members enable row level security;
alter table public.consents enable row level security;
alter table public.payments enable row level security;
alter table public.cards enable row level security;

-- člen vidí jen sebe
create policy members_own on public.members
  for select using (auth.uid() = id);
-- dozor/výbor vidí všechny
create policy members_staff on public.members
  for select using (exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.role in ('dozor', 'vybor')));

-- konsenty: čtení vlastní + staff
create policy consents_own on public.consents
  for select using (member_id = auth.uid());
create policy consents_staff on public.consents
  for select using (exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.role in ('dozor', 'vybor')));
create policy consents_insert on public.consents
  for insert with check (member_id = auth.uid());

-- platby: vlastní + staff
create policy payments_own on public.payments
  for select using (member_id = auth.uid());
create policy payments_staff on public.payments
  for select using (exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.role in ('dozor', 'vybor')));

-- karty: vlastní + staff
create policy cards_own on public.cards
  for select using (member_id = auth.uid());
create policy cards_staff on public.cards
  for select using (exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.role in ('dozor', 'vybor')));

-- ============================================================
-- 3. Pomocné funkce
-- ============================================================

-- přiřazení členského čísla (sekvence)
create sequence if not exists public.member_no_seq;
alter table public.members alter column member_no set default nextval('public.member_no_seq');

-- aktualizace updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();
