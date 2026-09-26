// mailer.js — e-mail/SMS kanál.
//
// TŘI REŽIMY (v tomto pořadí):
//   1. CENTRÁLNÍ config  — _config/mail/credentials.json (env MAIL_CONFIG).
//      Jediná kopie Resend API klíče pro celý workspace. Používá se lokálně.
//      Odesílání deleguje na _config/mail/mailer.mjs, aby logika nebyla dvakrát.
//   2. ENV               — RESEND_API_KEY / SMTP_HOST+SMTP_USER+SMTP_PASS.
//      Používá se v produkci (Vercel), kde _config/ na disku není.
//   3. STUB              — bez credentials. Zprávy jdou jen do outboxu
//      (tabulka messages), do konzole a jsou vidět na /#/outbox (dev inbox).
//
// Outbox se plní VŽDY — slouží zároveň jako auditní stopa odeslaných zpráv,
// a to i když přenos selže (pak zpráva v outboxu zůstane).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const nodemailer = require('nodemailer');
const D = require('./db');

// ── 1. Centrální config ────────────────────────────────────────────────
const CENTRAL_CONFIG_PATH =
  process.env.MAIL_CONFIG ||
  path.resolve(__dirname, '..', '..', '..', '_config', 'mail', 'credentials.json');
const CENTRAL_ADAPTER_PATH = path.resolve(path.dirname(CENTRAL_CONFIG_PATH), 'mailer.mjs');

// Synchronní čtení jen kvůli `smtpEnabled` (routes.js ho potřebuje bez await).
// Vlastní odesílání jde přes adaptér.
function readCentralConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CENTRAL_CONFIG_PATH, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || !cfg.api_key) return null;
    return cfg;
  } catch {
    return null; // chybí nebo rozbitý → spadneme na env / stub
  }
}

const centralCfg = readCentralConfig();
const centralSender = 'airbag'; // alias z credentials.json → tjkrupka.cz
const centralEnabled = Boolean(
  centralCfg && (centralCfg.senders || {})[(centralCfg.aliases || {})[centralSender] || centralSender]
);

// undefined = ještě nezkoušeno, null = nedostupný. Pozor: nesmí začínat na
// null — strážce níž testuje `!== undefined`, takže by se import nikdy nezkusil.
let centralAdapter;
async function getCentralAdapter() {
  if (centralAdapter !== undefined) return centralAdapter;
  try {
    centralAdapter = await import(CENTRAL_ADAPTER_PATH);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[MAIL] centrální adaptér ${CENTRAL_ADAPTER_PATH} se nepodařilo načíst: ` +
        `${err.message} — padám na env konfiguraci`
    );
    centralAdapter = null;
  }
  return centralAdapter;
}

// ── 2. Env konfigurace (produkce / Vercel) ─────────────────────────────
const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'Tělovýchovná jednota Krupka <noreply@krupka.example>',
};

const envSmtpEnabled = Boolean(SMTP.host && SMTP.user && SMTP.pass);

// SMTP_PASS je u Resend zároveň API klíč → HTTP cesta má lepší doručitelnost.
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.SMTP_PASS || '';
const resendEnabled = Boolean(RESEND_API_KEY);
const RESEND_FROM = process.env.SMTP_FROM || 'Tělovýchovná jednota Krupka <info@tjkrupka.cz>';

// Veřejný stav — routes.js podle něj zobrazuje emailMode.
const smtpEnabled = centralEnabled || envSmtpEnabled || resendEnabled;

async function sendViaResendApi(to, subject, body) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'airbag-pwa/0.1 (+tjkrupka.cz)',
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text: body }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Resend API ${resp.status}: ${t.slice(0, 120)}`);
  }
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.secure,
      auth: { user: SMTP.user, pass: SMTP.pass },
    });
  }
  return transporter;
}

/** Prostý text → minimální HTML (tělo je plain text, ať zůstane čitelné). */
function textToHtml(body) {
  const esc = String(body)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${esc}</pre>`;
}

/** Vrací popisek použité cesty (pro log), nebo vyhodí chybu přenosu. */
async function deliver(to, subject, body) {
  if (centralEnabled) {
    const adapter = await getCentralAdapter();
    if (adapter) {
      const res = await adapter.send({
        to,
        subject: subject || '',
        html: textToHtml(body),
        text: body,
        sender: centralSender,
      });
      if (res.state === 'sent') return 'RESEND-API(central)';
      throw new Error(`${res.state}: ${res.error || res.sender || ''}`);
    }
  }
  if (resendEnabled) {
    await sendViaResendApi(to, subject || '', body);
    return 'RESEND-API(env)';
  }
  if (envSmtpEnabled) {
    await getTransporter().sendMail({ from: SMTP.from, to, subject: subject || '', text: body });
    return 'SMTP(env)';
  }
  return null;
}

async function send({ memberId, channel, to, subject, body }) {
  const msg = await D.Messages.create({ memberId, channel, to, subject, body });

  if (channel !== 'email' || !smtpEnabled) {
    // eslint-disable-next-line no-console
    console.log(`[STUB ${channel.toUpperCase()}] to=${to} subject=${subject || '(bez předmětu)'}`);
    return msg;
  }

  deliver(to, subject, body)
    .then((via) => {
      // eslint-disable-next-line no-console
      console.log(`[${via} OK] to=${to} subject=${subject}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[MAIL CHYBA] to=${to}: ${err.message} (zpráva zůstala v outboxu)`);
    });

  return msg;
}

function sendEmail(memberId, to, subject, body) {
  return send({ memberId, channel: 'email', to, subject, body });
}

function sendSms(memberId, to, body) {
  return send({ memberId, channel: 'sms', to, subject: null, body });
}

module.exports = {
  send,
  sendEmail,
  sendSms,
  smtpEnabled,
  resendEnabled,
  centralEnabled,
  // pro diagnostiku / testy
  _centralConfigPath: CENTRAL_CONFIG_PATH,
  _deliver: deliver,
};
