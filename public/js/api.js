// api.js — tenký wrapper nad REST API + session state.
'use strict';

const API = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const base = (typeof window !== 'undefined' && window.__API_BASE__) || '';
    const resp = await fetch(`${base}/api${path}`, opts);
    let data = null;
    try { data = await resp.json(); } catch (e) { /* prázdná odpověď */ }
    if (!resp.ok) {
      const err = new Error((data && data.message) || `Chyba ${resp.status}`);
      err.code = data && data.error;
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    // ZMĚNA STAVU → zneplatnit cache /me. Bez tohoto se po zápisu (např. uložení
    // souhlasů) ještě 15 s vracel STARÝ stav, takže stránka platby tvrdila
    // „nejdřív potvrďte souhlasy“ i u dokumentů, které uživatel právě podepsal.
    if (method !== 'GET') meLoadedAt = 0;
    return data;
  },
  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body || {}),
  patch: (path, body) => API.request('PATCH', path, body || {}),
  delete: (path) => API.request('DELETE', path),
};

// Session cache (načteno při startu)
let me = null;
// VÝKON: při startu aplikace se /me volalo dvakrát (bootstrap + router) a každé
// volání znamenalo další dotaz do DB a nový request. Držíme proto jednu sdílenou
// probíhající Promise (souběžná volání se slijí do jednoho requestu) a výsledek
// krátce cachujeme, aby navigace mezi pohledy netahala data znovu.
let meInFlight = null;
let meLoadedAt = 0;
const ME_TTL_MS = 15000;

async function refreshMe({ force = false } = {}) {
  const fresh = force || (Date.now() - meLoadedAt) > ME_TTL_MS;
  if (fresh) {
    if (!meInFlight) {
      meInFlight = API.get('/me')
        .then((res) => { me = res; meLoadedAt = Date.now(); return me; })
        .catch(() => { me = null; return null; })
        .finally(() => { meInFlight = null; });
    }
    return meInFlight;
  }
  return me;
}

function isLoggedIn() { return !!me; }
function currentRole() { return me && me.member ? me.member.role : null; }
function isStaff() { const r = currentRole(); return r === 'dozor' || r === 'vybor' || r === 'superadmin'; }
// Práva dozoru (načítá server v /me jako canDozor) — pozor: účet dozoru
// NEMUSÍ být členem, takže se nesmí odvozovat z členství.
function isDozor() {
  if (me && typeof me.canDozor === 'boolean') return me.canDozor;
  return isStaff();
}
function currentMe() { return me; }
// Vlastník aplikace (jediný s přístupem do superadmin sekce) — e-mail je pojistka
function isSuperAdmin() {
  return !!(me && me.member && me.member.role === 'superadmin' && me.member.email === 'miroslavbrozek@gmail.com');
}

// Registrace service workeru (PWA offline). Přesunuto z inline <script>
// kvůli striktnímu CSP (script-src 'self').
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registrace selhala:', e));
  });
}
