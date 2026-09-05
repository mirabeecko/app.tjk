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
    return data;
  },
  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body || {}),
  patch: (path, body) => API.request('PATCH', path, body || {}),
  delete: (path) => API.request('DELETE', path),
};

// Session cache (načteno při startu)
let me = null;

async function refreshMe() {
  try {
    me = await API.get('/me');
  } catch (e) {
    me = null;
  }
  return me;
}

function isLoggedIn() { return !!me; }
function currentRole() { return me && me.member ? me.member.role : null; }
function isStaff() { const r = currentRole(); return r === 'dozor' || r === 'vybor' || r === 'superadmin'; }
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
