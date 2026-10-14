// telegram.js — notifikace provozovatele na Telegram (Bot API).
//
// PROČ: vlastník chce o každé nové registraci vědět hned (dřív se to dozvěděl
// jen když se přihlásil do administrace). Posílá se přes BOT API stejným botem,
// kterého používá jeho asistent — v aplikaci tedy stačí token a chat id:
//   TELEGRAM_BOT_TOKEN  (token bota)
//   TELEGRAM_CHAT_ID    (kam posílat; DM vlastníka)
// Když některá chybí, funkce jen zaloguje a nic neposílá (vývoj/test bez bota).
//
// Záměrně NIKDY nevyhazuje chybu: notifikace nesmí shodit registraci člena.
'use strict';

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_HOME_CHANNEL || '').trim();

function enabled() {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

async function send(text) {
  if (!enabled()) return { ok: false, skipped: true };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.error(`[TELEGRAM CHYBA] ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
      return { ok: false, status: resp.status };
    }
    const data = await resp.json().catch(() => ({}));
    // eslint-disable-next-line no-console
    console.log(`[TELEGRAM OK] message_id=${(data && data.result && data.result.message_id) || '?'}`);
    return { ok: true, messageId: data && data.result && data.result.message_id };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[TELEGRAM CHYBA] ${err.message}${err.cause ? ' | cause: ' + (err.cause.code || err.cause.message || err.cause) : ''}`);
    return { ok: false, error: err.message };
  }
}

/** Escapuje text pro HTML parse_mode (jména mohou obsahovat < > &). */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Notifikace o nové registraci: kdo, jaký typ členství, jaký účel, kontakt. */
async function notifyRegistration(member, info = {}) {
  if (!member) return { ok: false };
  const radky = [
    '🆕 <b>Nová registrace v aplikaci TJK</b>',
    '',
    `<b>${esc(member.firstName)} ${esc(member.lastName)}</b> (č. ${esc(member.memberNo ?? '—')})`,
    `Typ: ${esc(member.membershipType || '—')} · Účel: ${info.intent === 'vstup' ? 'jednorázový vstup' : 'členství'}`,
    `E-mail: ${esc(member.email)}`,
    member.phone ? `Telefon: ${esc(member.phone)}` : null,
    info.guardianRequired ? '⚠️ Nezletilý — čeká se na souhlas zákonného zástupce.' : null,
    '',
    'Administrace: https://app.tjkrupka.cz/#/admin',
  ].filter((r) => r !== null);
  return send(radky.join('\n'));
}

/** Obecná zpráva provozovateli (rezervace, platba, ruční zásah…). */
async function notify(text) {
  return send(text);
}

module.exports = { enabled, send, notify, notifyRegistration, esc };
