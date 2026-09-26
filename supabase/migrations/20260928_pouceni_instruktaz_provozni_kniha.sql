-- ============================================================================
-- AIRBAG PWA — rozšíření 2026-09-28
--   1) poučení o rizicích místo vzdání se práva na náhradu újmy (status retired)
--   2) PRAKTICKÁ INSTRUKTÁŽ — záznam vytváří pověřený dozor (odděleně od souhlasů)
--   3) PROVOZNÍ KNIHA — provozní den + denní kontrola + přerušení/obnovení + události
--   4) ověření vazby zákonného zástupce k nezletilému
--   5) ověření totožnosti u vstupu (vstupní PIN) a účel registrace (intent)
--   6) evidence parametrů čekajících na potvrzení (tlak, hmotnost, vítr, kotvení…)
--
-- DŮLEŽITÉ: tato migrace NEMAŽE ani NEPŘEPISUJE historii. Původní znění
-- dokumentu „Vzdání se práva na náhradu újmy (§ 2925 OZ)“ i všechny souhlasy
-- s ním zůstávají v app.doc_versions a app.consents beze změny — jen se
-- dokument označí jako vyřazený (status='retired'), aby se z něj nestala
-- povinnost a aby bylo dohledatelné, čím byl nahrazen.
--
-- Idempotentní: lze spustit opakovaně (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- 1) HISTORICKÉ VERZE DOKUMENTŮ + JAK BYLO POTVRZENÍ OVĚŘENO
-- ---------------------------------------------------------------------------
ALTER TABLE app.doc_versions ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active';
ALTER TABLE app.doc_versions ADD COLUMN IF NOT EXISTS superseded_by text;
ALTER TABLE app.doc_versions ADD COLUMN IF NOT EXISTS status_note   text NOT NULL DEFAULT '';

ALTER TABLE app.consents ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'session';
ALTER TABLE app.consents ADD COLUMN IF NOT EXISTS auth_note   text NOT NULL DEFAULT '';

-- Účel registrace + ověření totožnosti + ověření vazby zákonného zástupce
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS intent                   text NOT NULL DEFAULT 'clenstvi';
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS entry_pin_hash           text;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS entry_pin_set_at         timestamptz;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS guardian_verified_method text;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS guardian_verified_by     uuid;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS guardian_verified_at     timestamptz;
ALTER TABLE app.members ADD COLUMN IF NOT EXISTS guardian_verified_note   text;

-- ---------------------------------------------------------------------------
-- 2) PRAKTICKÁ INSTRUKTÁŽ (záznam vytváří dozor AŽ PO instruktáži)
--    Účastník nesmí získat stav „připraven ke skoku“ jen potvrzením dokumentů.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.instructions (
  id                 text PRIMARY KEY,
  facility_code      text NOT NULL DEFAULT 'airbag',
  member_id          text,
  participant_name   text NOT NULL DEFAULT '',
  participant_no     integer,
  participant_birth  text,
  is_minor           integer NOT NULL DEFAULT 0,
  dozor_id           text,
  dozor_name         text NOT NULL DEFAULT '',
  dozor_role         text NOT NULL DEFAULT '',
  instructed_at      timestamptz NOT NULL DEFAULT now(),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  doc_key            text NOT NULL DEFAULT 'instruktaz_airbag',
  doc_version        integer NOT NULL,
  content_hash       text NOT NULL DEFAULT '',
  result             text NOT NULL,                 -- absolvoval | neabsolvoval
  reason             text NOT NULL DEFAULT '',
  note               text NOT NULL DEFAULT '',
  source             text NOT NULL DEFAULT 'app',   -- app | offline | manual
  offline_ref        text,
  synced_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instr_member ON app.instructions (member_id, instructed_at DESC);
CREATE INDEX IF NOT EXISTS idx_instr_at     ON app.instructions (instructed_at DESC);
CREATE INDEX IF NOT EXISTS idx_instr_result ON app.instructions (result, doc_version);

-- ---------------------------------------------------------------------------
-- 3) PROVOZNÍ KNIHA — provozní den (hlavička + denní kontrola)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.provozni_dny (
  id                 text PRIMARY KEY,
  facility_code      text NOT NULL DEFAULT 'airbag',
  day                text NOT NULL,                 -- YYYY-MM-DD
  dozor_id           text,
  dozor_name         text NOT NULL DEFAULT '',
  dozor_present      integer NOT NULL DEFAULT 1,
  check_mattress     text NOT NULL DEFAULT 'neprovedeno',  -- ok | zavada | neprovedeno
  check_pressure     text NOT NULL DEFAULT 'neprovedeno',
  check_anchoring    text NOT NULL DEFAULT 'neprovedeno',
  check_ramp         text NOT NULL DEFAULT 'neprovedeno',
  check_surroundings text NOT NULL DEFAULT 'neprovedeno',
  check_note         text NOT NULL DEFAULT '',
  defects            text NOT NULL DEFAULT '',
  verdict            text NOT NULL DEFAULT 'ceka',  -- vyhovuje | nevyhovuje | ceka
  verdict_note       text NOT NULL DEFAULT '',
  opened_at          timestamptz,
  opened_confirmed   integer NOT NULL DEFAULT 0,
  interrupted_at     timestamptz,
  interrupt_reason   text NOT NULL DEFAULT '',
  resumed_at         timestamptz,
  resumed_note       text NOT NULL DEFAULT '',
  closed_at          timestamptz,
  source             text NOT NULL DEFAULT 'app',   -- app | offline
  offline_ref        text,
  synced_at          timestamptz,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_code, day)
);
CREATE INDEX IF NOT EXISTS idx_provozni_day ON app.provozni_dny (facility_code, day DESC);

-- ---------------------------------------------------------------------------
-- 4) ZÁZNAMY PROVOZNÍ KNIHY (závady, přerušení, obnovení, mimořádné události…)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.provozni_zaznamy (
  id              text PRIMARY KEY,
  provozni_den_id text REFERENCES app.provozni_dny(id),
  facility_code   text NOT NULL DEFAULT 'airbag',
  day             text NOT NULL,
  type            text NOT NULL,
  text            text NOT NULL DEFAULT '',
  severity        text NOT NULL DEFAULT 'info',   -- info | warning | critical
  dozor_id        text,
  dozor_name      text NOT NULL DEFAULT '',
  at              timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'app',
  offline_ref     text,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provzaz_den  ON app.provozni_zaznamy (facility_code, day, at);
CREATE INDEX IF NOT EXISTS idx_provzaz_type ON app.provozni_zaznamy (type, at DESC);

-- ---------------------------------------------------------------------------
-- 5) OVĚŘENÍ VAZBY ZÁKONNÉHO ZÁSTUPCE K NEZLETILÉMU
--    Elektronický odkaz ověřuje jen kontrolu e-mailové schránky; vztah k dítěti
--    ověřuje dozor na místě podle dokladu a zapisuje to sem.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.guardian_verifications (
  id                text PRIMARY KEY,
  member_id         text NOT NULL,
  child_name        text NOT NULL DEFAULT '',
  guardian_name     text NOT NULL DEFAULT '',
  guardian_relation text NOT NULL DEFAULT '',
  method            text NOT NULL,     -- rodny_list | doklad_totoznosti | pribuzensky_doklad | jine
  method_note       text NOT NULL DEFAULT '',
  verified_by       text,
  verified_by_name  text NOT NULL DEFAULT '',
  verified_at       timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL DEFAULT 'app',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gver_member ON app.guardian_verifications (member_id, verified_at DESC);

-- ---------------------------------------------------------------------------
-- 6) PARAMETRY PROVOZU ČEKAJÍCÍ NA POTVRZENÍ
--    Dokud je status='ceka_na_doplneni', value je NULL — aplikace nikde
--    nezobrazuje odhadnuté hodnoty (tlak, hmotnost, vítr, kotvení, sporty…).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.op_parameters (
  key               text PRIMARY KEY,
  label             text NOT NULL,
  unit              text NOT NULL DEFAULT '',
  value             text,
  source_required   text NOT NULL DEFAULT 'dokumentace_vyrobce',
  status            text NOT NULL DEFAULT 'ceka_na_doplneni',
  source_note       text NOT NULL DEFAULT '',
  confirmed_by      text,
  confirmed_by_name text NOT NULL DEFAULT '',
  confirmed_at      timestamptz,
  note              text NOT NULL DEFAULT '',
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7) VYŘAZENÍ DOKUMENTU „Vzdání se práva na náhradu újmy“ (text beze změny!)
--    Nové znění se seeduje z docs/pouceni_rizika.md jako samostatný dokument
--    (doc_key = pouceni_rizika). Historii nemažeme.
-- ---------------------------------------------------------------------------
UPDATE app.doc_versions
   SET status = 'retired',
       superseded_by = 'pouceni_rizika',
       status_note = 'Vyřazeno 2026-09-28: vzdání se práva na náhradu újmy odstraněno; nahrazeno dokumentem „Poučení o rizicích a potvrzení pravidel účasti“. Historické znění a souhlasy zůstávají v auditní stopě.'
 WHERE doc_key = 'vzdani_prava';

-- ---------------------------------------------------------------------------
-- 8) SNAPSHOT PODMÍNEK VSTUPU u záznamu o vstupu (app.entries)
--    U každého vstupu je dohledatelné, ZA JAKÝCH podmínek byl povolen:
--    provozní den a jeho kontrola, použitá instruktáž, potvrzené dokumenty
--    a způsob ověření totožnosti.
-- ---------------------------------------------------------------------------
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS day             text;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS provozni_den_id text;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS day_verdict     text;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS instruction_id  text;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS instruction_ok  integer NOT NULL DEFAULT 0;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS documents_ok    integer NOT NULL DEFAULT 0;
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS identity_check  text NOT NULL DEFAULT '';
ALTER TABLE app.entries ADD COLUMN IF NOT EXISTS blocking        text NOT NULL DEFAULT '';
