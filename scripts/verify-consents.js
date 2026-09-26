#!/usr/bin/env node
// scripts/verify-consents.js — KONTROLA DŮKAZNÍ VRSTVY SOUHLASŮ.
//
// Co dělá:
//   1) U KAŽDÉHO souhlasu přepočítá SHA-256 z uloženého znění dokumentu a porovná
//      ho s otiskem, který je uložený u souhlasu (v okamžiku podpisu).
//      → odhalí, že se text v databázi dodatečně změnil (a tedy se „nedá prokázat“).
//   2) Umí vyexportovat DŮKAZNÍ BALÍČEK: tisknutelný protokol pro každého člena
//      + strojová data (JSON). Ten přežije i ztrátu aplikace/DB — dá se založit do spisu.
//
// Použití:
//   node scripts/verify-consents.js                     # kontrola všech souhlasů
//   node scripts/verify-consents.js --verbose           # + řádek po řádku
//   node scripts/verify-consents.js --member <email|id> # kontrola + protokol jednoho člena
//   node scripts/verify-consents.js --export <slozka>   # důkazní balíček (protokoly + JSON)
//
// Návratový kód: 0 = vše v pořádku, 1 = nalezen problém (rozbitý/chybějící otisk).
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const D = require('../src/db');
const EVD = require('../src/evidence');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const VERBOSE = has('--verbose') || has('-v');
const EXPORT_DIR = valueOf('--export', null);
const MEMBER = valueOf('--member', null);

const ICON = { OK: 'OK   ', NESOUHLASI: 'ROZBITO', CHYBI_TEXT: 'CHYBI ' };

function line(ev) {
  const mark = ICON[ev.integrity] || '?     ';
  return `  ${mark} ${ev.title} v${ev.version} · ${ev.signerLabel} ${ev.identity} · ${ev.grantedAt} · IP ${ev.ip} · otisk ${String(ev.contentHash).slice(0, 16)}…`;
}

async function findMember(query) {
  // POZOR: sqlite driver je synchronní a při nenalezení vrací undefined (ne Promise)
  // → await + try/catch, aby fungoval i postgres (kde ne-UUID řetězec vyhodí chybu).
  let byId = null;
  try { byId = await D.Members.getById(query); } catch (e) { byId = null; }
  if (byId) return byId;
  return D.Members.getByEmail(query);
}

async function main() {
  console.log('=== KONTROLA INTEGRITY SOUHLASŮ (SHA-256) ===');
  console.log(`databáze: ${D.driver}`);

  // ---- režim pro jednoho člena -------------------------------------------
  if (MEMBER) {
    const m = await findMember(MEMBER);
    if (!m) {
      console.error(`\nCHYBA: člen „${MEMBER}“ nebyl nalezen (zadejte e-mail nebo ID).`);
      process.exit(1);
    }
    const bundle = await EVD.evidenceBundle(m);
    console.log(`\nčlen: ${bundle.member.name} (${bundle.member.email}) · ID ${bundle.member.id}`);
    console.log(`protokol č.: ${bundle.protocolNo}`);
    console.log(`podepsaných dokumentů: ${bundle.summary.signed} (z toho zákonný zástupce: ${bundle.summary.byGuardian})`);
    for (const c of bundle.consents) console.log(line(c));
    console.log(`\notisk důkazního balíku: ${bundle.fingerprint}`);
    console.log(`VÝSLEDEK: ${bundle.summary.verdict} (${bundle.summary.ok} v pořádku, ${bundle.summary.broken} rozbitých, ${bundle.summary.missingText} bez znění)`);

    if (EXPORT_DIR || has('--protocol')) {
      const dir = EXPORT_DIR ? path.resolve(EXPORT_DIR) : process.cwd();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, EVD.protocolFileName(bundle));
      fs.writeFileSync(file, EVD.protocolHtml(bundle, { issuedBy: 'dávkový export — node scripts/verify-consents.js' }), 'utf8');
      console.log(`\nprotokol (HTML k tisku / PDF) → ${file}`);
    }
    process.exit(bundle.summary.verdict === 'OK' ? 0 : 1);
  }

  // ---- kontrola všech ----------------------------------------------------
  const res = await EVD.verifyAll();
  console.log(`\nzkontrolováno souhlasů: ${res.total} · v pořádku: ${res.ok} · problémy: ${res.problems}`);
  if (VERBOSE) {
    for (const r of res.rows) {
      console.log(`  ${ICON[r.integrity] || '?     '} ${r.title} v${r.version} · ${r.signerType} ${r.identity} · ${r.grantedAt}`);
    }
  }
  if (res.problems) {
    console.log('\nNALEZENÉ PROBLÉMY:');
    for (const p of res.problemsDetail) {
      console.log(`  ${ICON[p.integrity] || '?'} ${p.title} v${p.version} · člen ${p.memberId} · ${p.identity} · ${p.grantedAt}`);
    }
    console.log('\nCo to znamená: u vypsaných souhlasů se znění v systému neshoduje s tím, co člen podepsal,');
    console.log('nebo se znění podepsané verze ztratilo. Zkontrolujte, kdo a kdy dokument upravoval');
    console.log('(tabulka doc_versions) — souhlas se váže na verzi, nová verze vyžaduje nový souhlas.');
  } else {
    console.log('VÝSLEDEK: OK — znění u všech souhlasů odpovídá tomu, co členové podepsali.');
  }

  // ---- důkazní balíček ---------------------------------------------------
  if (EXPORT_DIR) {
    const dir = path.resolve(EXPORT_DIR);
    const protokoly = path.join(dir, 'protokoly');
    fs.mkdirSync(protokoly, { recursive: true });

    const ids = await D.raw.all(`SELECT DISTINCT member_id FROM ${D.driver === 'postgres' ? 'app.' : ''}consents`);
    const pack = { generatedAt: new Date().toISOString(), driver: D.driver, members: [], verify: res };
    let written = 0;
    for (const row of ids) {
      const m = await D.Members.getById(row.member_id);
      if (!m) continue;
      const bundle = await EVD.evidenceBundle(m);
      pack.members.push(bundle);
      const file = path.join(protokoly, EVD.protocolFileName(bundle));
      fs.writeFileSync(file, EVD.protocolHtml(bundle, { issuedBy: 'dávkový export — node scripts/verify-consents.js' }), 'utf8');
      written += 1;
    }
    fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(pack, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'README.txt'), [
      'DŮKAZNÍ BALÍČEK E-SOUHLASŮ — Tělovýchovná jednota Krupka, z.s.',
      `vyhotoveno: ${pack.generatedAt}`,
      '',
      'Obsah:',
      '  protokoly/*.html  — protokol o elektronickém souhlasu pro každého člena',
      '                      (otevřete v prohlížeči → Vytisknout / Uložit jako PDF)',
      '  evidence.json     — stejná data ve strojové podobě (otisky SHA-256, časy, IP, identity)',
      '',
      'Kontrola: každý souhlas obsahuje otisk SHA-256 znění, které člen podepsal.',
      'Přepočet: node scripts/verify-consents.js  (0 problémů = znění nebylo změněno).',
      '',
      'UPOZORNĚNÍ: balíček obsahuje osobní údaje (jméno, datum narození, e-mail, IP).',
      'Ukládejte ho zabezpečeně a přístup omezte — jde o dokumentaci podle GDPR.',
    ].join('\n'), 'utf8');

    console.log(`\nDŮKAZNÍ BALÍČEK → ${dir}`);
    console.log(`  protokoly: ${written} (složka protokoly/)`);
    console.log('  data:      evidence.json');
    console.log('  návod:     README.txt');
  }

  process.exit(res.problems ? 1 : 0);
}

main().catch((err) => {
  console.error('CHYBA:', err.message);
  process.exit(1);
});
