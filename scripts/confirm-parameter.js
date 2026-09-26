#!/usr/bin/env node
// scripts/confirm-parameter.js — POTVRZENÍ PARAMETRŮ PROVOZU Z DOKUMENTACE.
//
// Proč to existuje: provozní řád nesmí obsahovat odhadnuté technické limity.
// Dokud parametr (tlak, hmotnost, věk, vítr, kotvení, sporty, nájezd…) není
// potvrzený, aplikace jej zobrazuje jako „čeká na doplnění“ a hodnotu nepoužije.
//
// Použití:
//   node scripts/confirm-parameter.js --list
//   node scripts/confirm-parameter.js --key tlak --value "12 kPa (tolerance ±1 kPa)" \
//        --source "Dokumentace výrobce XY, návod k použití, str. 7" --by "Předseda spolku"
//   node scripts/confirm-parameter.js --key hmotnost --value "120 kg" \
//        --source "Potvrzení výrobce ze dne 2026-10-01 (e-mail)" --by "Jana Nováková, výbor"
//
// Zapíše se hodnota, zdroj, kdo a kdy ji potvrdil → auditní stopa. Potvrzení
// parametru je vědomý úkon odpovědné osoby, ne odhad programu.
'use strict';

require('dotenv').config();

const D = require('../src/db');
const X = require('../src/db-app');

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (flag) => args.includes(flag);

async function main() {
  await X.OpParameters.ensureSeeded();
  const rows = await X.OpParameters.list();

  if (has('--list') || !valueOf('--key', null)) {
    console.log('=== PARAMETRY PROVOZU ===');
    console.log('(dokud je stav „čeká na doplnění“, aplikace hodnotu NIKDE nepoužívá)\n');
    for (const p of rows) {
      const state = p.status === 'potvrzeno' ? `potvrzeno: ${p.value}` : 'ČEKÁ NA DOPLNĚNÍ';
      console.log(`  ${p.key.padEnd(12)} ${p.label}`);
      console.log(`  ${' '.repeat(12)} ${state}`);
      console.log(`  ${' '.repeat(12)} vyžaduje zdroj: ${p.source_required}${p.source_note ? ` · zdroj: ${p.source_note}` : ''}`);
      if (p.confirmed_by_name) console.log(`  ${' '.repeat(12)} potvrdil: ${p.confirmed_by_name} (${p.confirmed_at})`);
    }
    const pending = rows.filter((p) => p.status !== 'potvrzeno');
    console.log(`\nčeká na doplnění: ${pending.length} z ${rows.length}`);
    process.exit(0);
  }

  const key = valueOf('--key', null);
  const value = valueOf('--value', null);
  const source = valueOf('--source', null);
  const by = valueOf('--by', '');
  if (!value || !source) {
    console.error('Chyba: potvrzení vyžaduje --value i --source (čím je hodnota doložena).');
    process.exit(2);
  }
  const existing = await X.OpParameters.get(key);
  if (!existing) {
    console.error(`Chyba: neznámý parametr „${key}“. Použijte --list.`);
    process.exit(2);
  }
  const updated = await X.OpParameters.confirm(key, { value, sourceNote: source, byName: by });
  console.log(`Potvrzeno: ${updated.key} = ${updated.value}`);
  console.log(`Zdroj: ${updated.source_note}`);
  console.log(`Potvrdil: ${updated.confirmed_by_name || '(neuvedeno)'} · ${updated.confirmed_at}`);
  console.log('\nPozor: dokud nejsou potvrzené VŠECHNY parametry, je provozní řád Prozatímní.');
  const pending = (await X.OpParameters.list()).filter((p) => p.status !== 'potvrzeno');
  console.log(`Zbývá potvrdit: ${pending.length} (${pending.map((p) => p.key).join(', ') || '—'})`);
}

main().catch((err) => {
  console.error('CHYBA:', err.message);
  process.exit(1);
});
