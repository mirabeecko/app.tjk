-- ============================================================================
-- consent_codes — jednorázové ověřovací kódy pro potvrzení dokumentů.
--
-- PROČ SAMOSTATNÁ MIGRACE (2026-10-15): tabulka existuje ve `src/schema.sql`
-- od zavedení e-souhlasů, ale NIKDY nebyla vytvořena na produkci (chybí
-- migrace) — a `src/db-postgres.js` schéma sám nedoplňuje. Důsledek na živém
-- webu: „Poslat ověřovací kód na e-mail“ i potvrzení dokumentů kódem vracely
-- 500 „Došlo k neočekávané chybě serveru“. Protože nově registrovaný člen
-- NEMÁ heslo (hasPassword: false), byl kód JEDINÁ cesta, jak potvrdit
-- dokumenty → celý tok registrace se zastavil před platbou.
--
-- Idempotentní: lze spustit opakovaně.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.consent_codes (
  id          text PRIMARY KEY,
  member_id   text NOT NULL,
  code_hash   text NOT NULL,                    -- SHA-256 kódu (kód sám se neukládá)
  purpose     text NOT NULL DEFAULT 'consent',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0
);

-- Používá se dotazem: WHERE member_id = ? AND purpose = ? AND used_at IS NULL
-- ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_ccodes_member
  ON app.consent_codes (member_id, created_at DESC);
