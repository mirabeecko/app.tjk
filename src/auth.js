// auth.js — session management + role guards (cookie-based, httpOnly).
'use strict';

const D = require('./db');

const COOKIE = 'airbag_session';

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Middleware: načte session + člena do req.
// ASYNC — datová vrstva vrací Promise v postgres režimu (sqlite je sync,
// await je no-op). Chyby se předávají do error middleware.
async function loadSession(req, res, next) {
  req.session = null;
  req.member = null;
  try {
    const token = parseCookies(req)[COOKIE];
    if (token) {
      const s = await D.Sessions.get(token);
      if (s) {
        req.session = s;
        req.member = await D.Members.getById(s.member_id);
      }
    }
  } catch (err) {
    return next(err);
  }
  next();
}

function setSessionCookie(res, token) {
  // Secure se přidá jen v produkci (NODE_ENV=production) nebo při explicitním
  // zapnutí (COOKIE_SECURE=true) — lokální HTTP vývoj by jinak cookie neuložil.
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
    ? '; Secure'
    : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// Guard: vyžaduje přihlášeného člena
function requireMember(req, res, next) {
  if (!req.member) return res.status(401).json({ error: 'NEJSTE_PRIHLASENI', message: 'Pro tuto akci je nutné přihlášení.' });
  next();
}

// Guard: role member | dozor | vybor | superadmin (dozor a výbor mají i členská práva)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.member) return res.status(401).json({ error: 'NEJSTE_PRIHLASENI', message: 'Pro tuto akci je nutné přihlášení.' });
    if (!roles.includes(req.member.role)) return res.status(403).json({ error: 'NEDOSTATECNA_PRAVA', message: 'Nemáte oprávnění k této akci.' });
    next();
  };
}

// Jediný vlastník/administrátor aplikace: role superadmin + povolený e-mail.
// E-mail je pojistka navíc — i kdyby někdo roli zfalšoval, guard ho pustí jen s tímto emailem.
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'miroslavbrozek@gmail.com';

function isSuperAdmin(member) {
  return !!member && member.role === 'superadmin' && member.email === SUPERADMIN_EMAIL;
}

// Guard: vyžaduje superadmina (vlastníka) — výhradně pro e-mail SUPERADMIN_EMAIL
function requireSuperAdmin(req, res, next) {
  if (!req.member) return res.status(401).json({ error: 'NEJSTE_PRIHLASENI', message: 'Pro tuto akci je nutné přihlášení.' });
  if (!isSuperAdmin(req.member)) return res.status(403).json({ error: 'NEDOSTATECNA_PRAVA', message: 'Tato sekce je dostupná pouze vlastníkovi aplikace.' });
  next();
}

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

module.exports = { COOKIE, loadSession, setSessionCookie, clearSessionCookie, requireMember, requireRole, requireSuperAdmin, isSuperAdmin, SUPERADMIN_EMAIL, clientIp, parseCookies };
