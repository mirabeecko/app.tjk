// mailer.js — e-mail/SMS kanál.
// Reálné odesílání e-mailů přes SMTP (nodemailer), pokud jsou nastavené proměnné
// SMTP_HOST / SMTP_USER / SMTP_PASS (viz .env.example). Bez nich běží STUB režim:
// zprávy se ukládají do outboxu (tabulka messages), vypisují do konzole a jsou
// vidět v aplikaci na /#/outbox (dev inbox).
// Outbox se plní vždy — slouží zároveň jako jednoduchá auditní stopa odeslaných zpráv.
'use strict';

const nodemailer = require('nodemailer');
const D = require('./db');

const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'Tělovýchovná jednota Krupka <noreply@krupka.example>',
};

const smtpEnabled = Boolean(SMTP.host && SMTP.user && SMTP.pass);

// Resend API (HTTP) — lepší doručitelnost než SMTP. Použije se, když je RESEND_API_KEY.
// Jinak posílám přes SMTP (smtp.resend.com). Obojí jde na stejnou doménu.
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.SMTP_PASS || ''; // SMTP_PASS je API key u Resend
const resendEnabled = Boolean(RESEND_API_KEY);
const RESEND_FROM = process.env.SMTP_FROM || 'Tělovýchovná jednota Krupka <info@tjkrupka.cz>';

async function sendViaResendApi(to, subject, body) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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

async function send({ memberId, channel, to, subject, body }) {
  const msg = await D.Messages.create({ memberId, channel, to, subject, body });

  if (channel === 'email' && (smtpEnabled || resendEnabled)) {
    const doit = resendEnabled
      ? sendViaResendApi(to, subject || '', body)
      : getTransporter().sendMail({ from: SMTP.from, to, subject: subject || '', text: body });
    doit
      .then(() => {
        // eslint-disable-next-line no-console
        console.log(`[${resendEnabled ? 'RESEND-API' : 'SMTP'} OK] to=${to} subject=${subject}`);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[${resendEnabled ? 'RESEND-API' : 'SMTP'} CHYBA] to=${to}: ${err.message} (zpráva zůstala v outboxu)`);
      });
  } else {
    // eslint-disable-next-line no-console
    console.log(`[STUB ${channel.toUpperCase()}] to=${to} subject=${subject || '(bez předmětu)'}`);
  }
  return msg;
}

function sendEmail(memberId, to, subject, body) {
  return send({ memberId, channel: 'email', to, subject, body });
}

function sendSms(memberId, to, body) {
  return send({ memberId, channel: 'sms', to, subject: null, body });
}

module.exports = { send, sendEmail, sendSms, smtpEnabled, resendEnabled };
