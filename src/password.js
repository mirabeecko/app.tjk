// src/password.js — hashování a ověřování hesel (scrypt, Node built-in crypto).
// Formát uložené hodnoty: scrypt$<salt-hex>$<hash-hex>  (bez externí knihovny).
'use strict';

const crypto = require('crypto');

// Vytvoří hash hesla. Vrací "scrypt$salt$hash".
function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// Konstantní-časové ověření hesla proti uloženému hashu. Vrací boolean.
function verify(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes('$')) return false;
  const [scheme, salt, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const candidate = crypto.scryptSync(String(password), salt, 32).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hash, verify };
