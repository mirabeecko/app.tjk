// src/google-auth.js — přihlášení / registrace přes Google (OAuth 2.0 + ID token).
// Cesta A (doporučená): Google ID token (POST /api/auth/google) — klient pošle
//   id_token z Google, server ho ověří (sub + audience), najde/vytvoří člena
//   dle e-mailu a nastaví session.
// Cesta B (razítko): auth code flow (GET /api/auth/google → redirect na Google,
//   GET /api/auth/google/callback → výměna kódu za token). Tady server ověří
//   a uloží session, klient dostane redirect se session cookie.
//
// V obou případech platí: e-mail z Google je OVĚŘENÝ → je to identita člena.
// Neznámý e-mail → člen se založí (registrace Googlem); známý → přihlásí se.
// Prevence duplicit: dělá se přes D.Members.getByEmail (a unikátní index email).
'use strict';

const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

const enabled = Boolean(CLIENT_ID && CLIENT_SECRET);
const client = enabled ? new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) : null;

// URL pro přihlašovací stránku Google (auth code flow) — klient na ni přesměruje.
function getAuthUrl() {
  if (!enabled) return '';
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
}

// Ověří ID token (Google): vrátí { sub, email, email_verified, name, given_name, family_name }.
// Fail-closed: neplatný/neznámý klient → null.
async function verifyIdToken(idToken) {
  if (!enabled || !idToken) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || payload.email_verified !== true) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      givenName: payload.given_name,
      familyName: payload.family_name,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[google-auth] ID token CHYBA:', e.message);
    return null;
  }
}

// Vymění auth code za ID token (razítko flow) → stejný result jako verifyIdToken.
async function verifyAuthCode(code) {
  if (!enabled || !code || !client) return null;
  try {
    const { tokens } = await client.getToken(code);
    return await verifyIdToken(tokens && tokens.id_token);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[google-auth] auth code CHYBA:', e.message);
    return null;
  }
}

module.exports = { enabled, getAuthUrl, verifyIdToken, verifyAuthCode };
