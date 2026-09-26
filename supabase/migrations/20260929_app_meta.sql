-- ============================================================================
-- app_meta — jednoduchá tabulka klíč/hodnota pro metadata aplikace.
--
-- Používá ji seed (src/seed.js) k uložení otisku svých vstupů: když se konstanty
-- a texty dokumentů nezměnily, seed se přeskočí. Bez toho posílal ~50 dotazů při
-- KAŽDÉM startu serverless instance (Supabase pooler 200–800 ms/dotaz → první
-- odpověď trvala 10–25 s).
--
-- Idempotentní: lze spustit opakovaně.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.app_meta (
  meta_key   text PRIMARY KEY,
  meta_value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
