// rate-limit.js — jednoduchý in-memory rate limiter (per IP + endpoint).
// Chrání citlivé endpointy (přihlášení, registrace, rodičovský souhlas) před
// e-mail bombingem a enumerací. Bez externí závislosti (MVP).
//
// Poznámka: stav limiteru žije v paměti procesu — při restartu serveru se
// vynuluje, což je pro tuto aplikaci dostačující. Pro produkci s více
// instancemi by se použilo sdílené úložiště (Redis apod.).
'use strict';

const buckets = new Map(); // key -> { count, resetAt }

// Pravidelné čištění vypršených bucketů (aby mapa neprorůstala).
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// rateLimit({ windowMs, max, name }) → Express middleware
// Vrací 429, pokud IP překročí `max` požadavků v časovém okně `windowMs`.
function rateLimit({ windowMs = 60 * 1000, max = 30, name = 'default' } = {}) {
  return (req, res, next) => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({
        error: 'PRILIS_MNOHO_POZADAVKU',
        message: `Příliš mnoho požadavků — zkuste to znovu za ${retry} s.`,
      });
    }
    next();
  };
}

module.exports = { rateLimit };
