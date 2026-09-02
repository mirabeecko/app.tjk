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

  if (channel === 'email' && smtpEnabled) {
    getTransporter()
      .sendMail({ from: SMTP.from, to, subject: subject || '', text: body })
      .then(() => {
        // eslint-disable-next-line no-console
        console.log(`[SMTP OK] to=${to} subject=${subject}`);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[SMTP CHYBA] to=${to}: ${err.message} (zpráva zůstala v outboxu)`);
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

module.exports = { send, sendEmail, sendSms, smtpEnabled };
