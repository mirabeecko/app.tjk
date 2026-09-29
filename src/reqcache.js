// reqcache.js — CACHE ČTENÍ V RÁMCI JEDNOHO REQUESTU
//
// PROČ: databáze je v eu-central-1 a aplikační funkce běžely v iad1 (USA) —
// každý dotaz tak stál ~200 ms (transatlantický oblet). Aplikace navíc volala
// stejné čtení mnohokrát (např. `userState` 3× nebo `DocVersions.latest` pro
// každý podepsaný souhlas = N+1). Na obrazovce „Profil“ to bylo 50–70 dotazů
// v sérii → sekundy.
//
// JAK: AsyncLocalStorage — každý HTTP request dostane vlastní úložiště, takže
// se výsledky NEMÍCHAJÍ mezi requesty ani mezi souběžnými uživateli a nikdy
// nezastarají (úložiště zaniká s requestem). Uvnitř jednoho requestu se stejné
// čtení se stejnými argumenty vykoná JEDNOU.
//
// BEZPEČNOST: metoda, která není v READ_METHODS, se považuje za ZÁPIS a celou
// cache requestu zahodí. Když je tedy nějaká metoda omylem nezařazená, jen se
// necachuje (pomalejší, ale správné). Opak (zápis v READ_METHODS) by byl
// nebezpečný, proto je seznam jen o prokazatelně čistých čteních.
//
// MĚŘENÍ: `REQCACHE=off` cache vypne (pro srovnání „před/po“ na stejném kódu),
// `QUERY_LOG=1` vypíše na konci requestu počty dotazů do databáze.
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const MAX_ENTRIES = 600;
const ENABLED = process.env.REQCACHE !== 'off';

// Prokazatelně čistě čtecí metody datové vrstvy (podle názvu).
// Vše ostatní = zápis → invalidace.
const READ_METHODS = new Set([
  'get', 'all', 'one',
  'getById', 'getByCode', 'getByName', 'getByEmail', 'getByToken', 'getByDay',
  'getByKey', 'getByFacility',
  'list', 'listAll', 'listActive', 'listFor', 'listForMember', 'listForDay',
  'listForName', 'listProducts', 'listUsers', 'listRecent',
  'latest', 'latestAll', 'latestMap', 'byKeyVersion',
  'listForProduct', 'listAllByProduct', 'pickVariant',
  'hasActive', 'hasPaidMembership', 'hasAny', 'unreadCount',
  'lastFor', 'lastPassedFor', 'activeByEmail',
  'recent', 'summary', 'byDay', 'topMember',
  'count', 'exists', 'find',
  'checkVerdict', 'parseDocs', 'ageFrom', 'ageTypeOf', 'intentOf',
  'withoutRetired', 'effectiveStatus', 'publicMember', 'isClubMember',
  'userKind', 'canPay', 'resolveVariant', 'productEligibility',
  'membershipEligibility', 'membershipStatusOf', 'userState', 'requiredDocUnion',
  'signedDocKeysPublic', 'missingAllDocs', 'readiness', 'documentState',
  'instructionState', 'guardianState', 'operationalDayState', 'identityState',
  'memberOverview',
]);

// Objekty, které se NEobalují (obsahují surový SQL/klienta — cachovat nelze).
// Surové dotazy se měří na nejnižší úrovni (instrumentPool / instrumentSqlite).
const SKIP_OBJECTS = new Set(['pool', 'db', 'raw']);

function newStore() {
  return { cache: new Map(), dbCalls: 0, hits: 0, writes: 0, byMethod: Object.create(null) };
}

/** Obalí modul v místě (in-place), aby zůstalo funkční `this` i vnitřní volání.
 *  `label` identifikuje modul — MUSÍ být součástí klíče cache, jinak by si
 *  kolidovaly stejnojmenné metody různých repozitářů (Consents.listForMember
 *  vs. Entitlements.listForMember se stejným argumentem = jiná data). */
let moduleSeq = 0;
const moduleIds = new WeakMap();

function wrapModule(mod, label) {
  if (!mod || typeof mod !== 'object') return mod;
  if (!moduleIds.has(mod)) moduleIds.set(mod, label || ('m' + (++moduleSeq)));
  const myLabel = moduleIds.get(mod);

  for (const name of Object.keys(mod)) {
    const fn = mod[name];
    if (SKIP_OBJECTS.has(name)) continue;

    // Repozitáře (Members, DocVersions, Entitlements…) jsou vnořené objekty.
    if (fn && typeof fn === 'object' && fn.constructor === Object) {
      wrapModule(fn, myLabel + '.' + name);
      continue;
    }
    if (typeof fn !== 'function') continue;      // konstanty (TBL, CHECKS…) přeskoč
    if (fn.__reqCached) continue;
    const isRead = READ_METHODS.has(name);
    const fullName = myLabel + '.' + name;

    const wrapped = function (...args) {
      const store = als.getStore();
      if (!store) return fn.apply(this, args);   // mimo request (seed, skripty) → bez cache

      if (!isRead) {
        store.writes += 1;
        store.byMethod['ZÁPIS:' + fullName] = (store.byMethod['ZÁPIS:' + fullName] || 0) + 1;
        store.cache.clear();                      // zápis → zneplatnit vše v requestu
        return fn.apply(this, args);
      }

      if (!ENABLED) { count(store, fullName); return fn.apply(this, args); }

      let key;
      try {
        key = fullName + '\u0000' + JSON.stringify(args);
      } catch {
        count(store, fullName);
        return fn.apply(this, args);              // nejsou-li argumenty serializovatelné
      }
      if (store.cache.has(key)) { store.hits += 1; return store.cache.get(key); }

      count(store, fullName);
      const result = fn.apply(this, args);
      if (store.cache.size < MAX_ENTRIES) store.cache.set(key, result);
      return result;
    };
    wrapped.__reqCached = true;
    wrapped.__reqOrig = fn;

    try {
      Object.defineProperty(mod, name, {
        value: wrapped, writable: true, configurable: true, enumerable: true,
      });
    } catch { /* zamčené vlastnosti necháváme být */ }
  }
  return mod;
}

function count(store, fullName) {
  store.dbCalls += 1;
  store.byMethod[fullName] = (store.byMethod[fullName] || 0) + 1;
}

/** Spustí obsluhu requestu s vlastním úložištěm. */
function run(fn) {
  return als.run(newStore(), fn);
}

/** Statistiky aktuálního requestu (nebo null mimo request). */
function stats() {
  return als.getStore() || null;
}

/** Zneplatní cache aktuálního requestu (např. po zápisu mimo datovou vrstvu). */
function invalidate() {
  const store = als.getStore();
  if (store) { store.writes += 1; store.cache.clear(); }
}

// ── MĚŘENÍ SKUTEČNÝCH DOTAZŮ ────────────────────────────────────────────────
// Počítá se na NEJNIŽŠÍ úrovni (skutečné provedení SQL), aby číslo odpovídalo
// realitě: postgres → pool.query, sqlite → provedení připraveného dotazu.
// Zapíná se jen s QUERY_LOG=1, jinak se nic neobaluje (nulová režie).

function countRaw(label) {
  const store = als.getStore();
  if (store) count(store, 'raw.' + label);
}

function instrumentPool(pool) {
  if (pool.__counted) return;
  const orig = pool.query.bind(pool);
  pool.query = (...args) => { countRaw('query'); return orig(...args); };
  pool.__counted = true;
}

function instrumentSqlite(db) {
  if (db.__counted) return;
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => {
    const st = orig(sql);
    return {
      all: (...a) => { countRaw('all'); return st.all(...a); },
      get: (...a) => { countRaw('get'); return st.get(...a); },
      run: (...a) => { countRaw('run'); return st.run(...a); },
    };
  };
  db.__counted = true;
}

module.exports = {
  wrapModule, run, stats, invalidate, READ_METHODS,
  instrumentPool, instrumentSqlite, countRaw,
};
