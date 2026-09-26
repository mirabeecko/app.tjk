-- ============================================================================
-- AIRBAG PWA — rozšíření 2026-09-27
--   1) evidence vstupů na airbag (členové i nečlenové) — podklad pro analýzy
--   2) audit typu členství (kdo / kde / kdy zapsal členství) — viz požadavek
--      „u člena musí být vždy uveden typ členství a kdo, kde, kdy ho zapsal"
--   3) pozvánky pro účty dozoru (vytváří výhradně superadmin e-mailem)
--   4) pozastavení/obnovení přístupu do účtu (block/unblock) — superadmin
--   5) fotografie členů (ověřená fotka pro kontrolu dozorem)
--   6) výkonové indexy (QR lookup, platby, vstupy, e-maily)
--
-- Idempotentní: lze spustit opakovaně (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Schéma: app.*  (stejné jako zbytek aplikace)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- 1) VSTUPY NA AIRBAG (členové i nečlenové) — surová data pro analýzy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.entries (
  id             TEXT PRIMARY KEY,
  facility_code  TEXT NOT NULL DEFAULT 'airbag',   -- které zařízení (airbag, hala…)
  member_id      TEXT,                             -- NULL = nečlen / host
  person_name    TEXT NOT NULL DEFAULT '',         -- jméno v okamžiku vstupu (snapshot)
  person_no      INTEGER,                          -- členské číslo (snapshot)
  kind           TEXT NOT NULL DEFAULT 'neclen',   -- clen | neclen
  entitlement_kind TEXT,                           -- membership | entitlement | none
  access_ok      INTEGER NOT NULL DEFAULT 1,       -- 1 = vpuštěn, 0 = zamítnut
  reason         TEXT NOT NULL DEFAULT '',         -- text sdělení dozorovi
  source         TEXT NOT NULL DEFAULT 'qr',       -- qr | manual | import
  recorded_by    TEXT,                             -- kdo záznam pořídil (member_id dozora)
  recorded_by_name TEXT NOT NULL DEFAULT '',       -- jméno dozora (snapshot)
  valid_until    TEXT,                             -- platnost členství/vstupu v okamžiku vstupu
  member_kind    TEXT,                             -- sportovni | radne (snapshot typu členství)
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_created    ON app.entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_member     ON app.entries (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_facility   ON app.entries (facility_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_kind       ON app.entries (kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) AUDIT ZÁPISU ČLENSTVÍ — kdo, kde, kdy zapsal člena a jaký typ mu dal
--    (řádné členství NIKDY nevzniká automaticky — jen tímto explicitním zápisem)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.membership_audit (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL,
  action        TEXT NOT NULL,        -- created | kind_changed | activated | expired | blocked | unblocked
  kind_from     TEXT,                 -- předchozí typ členství (sportovni|radne|NULL)
  kind_to       TEXT,                 -- nový typ členství
  status_from   TEXT,
  status_to     TEXT,
  source        TEXT NOT NULL DEFAULT 'app.tjkrupka.cz',  -- kde se stalo (app | admin | import)
  actor_email   TEXT NOT NULL DEFAULT '',                 -- kdo to provedl
  actor_id      TEXT,                                     -- member_id aktéra (NULL = systém)
  actor_name    TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maudit_member  ON app.membership_audit (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maudit_created ON app.membership_audit (created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) POZVÁNKY PRO ÚČTY DOZORU (vytváří jen superadmin, doručuje e-mailem)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.dozor_invites (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL UNIQUE,     -- jednorázový token v odkazu
  expires_at    TEXT NOT NULL,            -- platnost odkazu
  used_at       TEXT,                     -- vyplněno = pozvánka vyčerpána
  revoked_at    TEXT,                     -- vyplněno = superadmin pozvánku zrušil
  invited_by    TEXT NOT NULL DEFAULT '', -- e-mail superadmina
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dozvinv_email  ON app.dozor_invites (lower(email));
CREATE INDEX IF NOT EXISTS idx_dozvinv_token  ON app.dozor_invites (token);

-- ---------------------------------------------------------------------------
-- 4) + 5) DOPLNĚNÍ TABULKY members
--    - audit typu členství (zdroj, kdo a kdy ho nastavil)
--    - pozastavení účtu (block) superadminem
--    - ověřená fotografie pro kontrolu dozorem
-- ---------------------------------------------------------------------------
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS membership_kind_source   TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS membership_kind_set_by   TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS membership_kind_set_at   TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS blocked                  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS blocked_at               TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS blocked_reason           TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS photo_verified           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS photo_verified_at        TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS dozor_granted_at         TEXT;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS dozor_granted_by         TEXT;

-- Zpětná konzistence: stávajícím členům doplň zdroj typu členství
UPDATE app.members
   SET membership_kind_source = COALESCE(membership_kind_source, 'app.tjkrupka.cz')
 WHERE membership_kind_source IS NULL;

-- ---------------------------------------------------------------------------
-- 6) VÝKONOVÉ INDEXY (bez nich je QR kontrola a administrativa pomalá)
-- ---------------------------------------------------------------------------
-- QR kontrola dozorem: hledání karty podle payloadu = full scan bez indexu
CREATE INDEX IF NOT EXISTS idx_cards_payload   ON app.cards (qr_payload);
-- Zjišťování, zda člen zaplatil členství (volá se při každé QR kontrole)
CREATE INDEX IF NOT EXISTS idx_payments_member_ok
  ON app.payments (member_id, status, purpose);
-- Aktivní jednorázové vstupy (každá QR kontrola)
CREATE INDEX IF NOT EXISTS idx_entitlements_member_valid
  ON app.entitlements (member_id, valid_until DESC);
-- Přehled členské základny superadminem
CREATE INDEX IF NOT EXISTS idx_members_role    ON app.members (role);
CREATE INDEX IF NOT EXISTS idx_members_status  ON app.members (status);
CREATE INDEX IF NOT EXISTS idx_members_kind    ON app.members (membership_kind);
-- Souhlasy pro QR detail (dokumenty člena)
CREATE INDEX IF NOT EXISTS idx_consents_member ON app.consents (member_id);

-- ---------------------------------------------------------------------------
-- 7) RLS poznamenání: aplikace přistupuje přes server (service role / pooler),
--    proto RLS na těchto tabulkách zapínat NETŘEBA — nikdy se nečtou z klienta.
-- ---------------------------------------------------------------------------
