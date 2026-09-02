// payments.js — platební brána: ADAPTER (Stripe Checkout / test mode).
//
// Stripe Checkout (hostovaná platební stránka): údaje o kartě zadává člen
// PŘÍMO na stránce Stripe — přes náš server neprojde nikdy žádné číslo karty
// ani CVV (PCI DSS řeší Stripe). Náš server jen vytvoří Checkout Session
// a webhook potvrdí dokončenou platbu.
//
// Rozhraní (vše async — datová vrstva vrací Promise v postgres režimu):
//   - createPaymentIntent({ memberId, amountCzk, purpose, gateway, origin })
//       → { paymentId, gatewayUrl, gateway, sessionId? }
//   - confirmPayment(paymentId)      → test mode: simuluje úspěšnou platbu
//   - failPayment(paymentId)         → test mode: simuluje zrušení
//   - handleWebhook(req, rawBody)    → Stripe webhook (fail-closed)
//
// Konfigurace (.env):
//   STRIPE_SECRET_KEY      sk_test_... / sk_live_... (bez něj = test mode)
//   STRIPE_WEBHOOK_SECRET  whsec_... (bez něj se webhook odmítá — fail-closed)
'use strict';

const D = require('./db');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe = null;
if (STRIPE_SECRET_KEY) {
  // Vlastní instance klienta; apiVersion necháváme na výchozí hodnotě SDK.
  // eslint-disable-next-line global-require
  stripe = require('stripe')(STRIPE_SECRET_KEY);
}

const stripeEnabled = !!stripe;

// test | live | off — dle prefixu klíče (sk_ = test, sk_live_ = live)
function stripeMode() {
  if (!STRIPE_SECRET_KEY) return 'off';
  return STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
}

// Režim pro UI: 'test' | 'stripe-test' | 'stripe-live'
function gatewayMode() {
  return stripeEnabled ? `stripe-${stripeMode()}` : 'test';
}

// Název produktu dle účelu platby (zobrazí se na platební stránce Stripe)
function productName(purpose, productCode) {
  if (purpose === 'prispevek') return 'Roční členství — Tělovýchovná jednota Krupka';
  if (purpose === 'produkt') return `Jednorázový vstup — ${productCode || 'AIRBAG'} (TJ Krupka)`;
  if (purpose === 'merch') return 'Merch — Tělovýchovná jednota Krupka';
  return `Platba — Tělovýchovná jednota Krupka (${purpose})`;
}

// Stripe Checkout Session — vytvoří hostovanou platební stránku.
// Návrat: { paymentId, gatewayUrl (stripe.com), gateway: 'stripe', sessionId }
async function createStripeSession({ memberId, amountCzk, purpose, productCode, origin }) {
  const payment = await D.Payments.create({ memberId, amountCzk, purpose, productCode, gateway: 'stripe' });
  const member = await D.Members.getById(memberId);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'czk',
        unit_amount: Math.round(amountCzk * 100), // Kč → haléře
        product_data: { name: productName(purpose, productCode) },
      },
    }],
    // Propojení webhooku s naší platbou — klíčové metadatové pole
    metadata: { paymentId: payment.id, memberId, purpose, productCode: productCode || '' },
    customer_email: member ? member.email : undefined,
    success_url: `${origin}/#/potvrzeni/${payment.id}`,
    cancel_url: `${origin}/#/platba`,
    locale: 'cs',
    // V test mode se nic reálně neúčtuje (testovací karty: 4242 4242 4242 4242)
  });
  // Stripe session id uložíme jako referenci (gateway_ref)
  await D.Payments.setGatewayRef(payment.id, session.id);
  return {
    paymentId: payment.id,
    gatewayUrl: session.url,
    gateway: 'stripe',
    sessionId: session.id,
  };
}

// Test mode (výchozí bez Stripe klíče): lokální simulace platby.
async function createPaymentIntent({ memberId, amountCzk, purpose, gateway = 'test', productCode, origin }) {
  if (stripe && gateway === 'stripe') {
    // Stripe Checkout — asynchronní tvorba session
    return createStripeSession({ memberId, amountCzk, purpose, productCode, origin }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[stripe] CHYBA vytvoření Checkout Session:', err.message);
      const e = new Error('Platba přes Stripe se nepodařila zahájit — zkuste to znovu.');
      e.code = 'STRIPE_CHYBA';
      throw e;
    });
  }
  const payment = await D.Payments.create({ memberId, amountCzk, purpose, productCode, gateway: 'test' });
  // V test mode je "přesměrování na bránu" lokální stránka /platba/{id}
  return {
    paymentId: payment.id,
    gatewayUrl: `/platba/${payment.id}`,
    gateway: 'test',
  };
}

// Test mode: simulace úspěšné platby
async function confirmPayment(paymentId) {
  const payment = await D.Payments.getById(paymentId);
  if (!payment) return null;
  if (payment.status === 'paid') return payment;
  return D.Payments.markPaid(paymentId, `TEST-${Date.now()}`);
}

async function failPayment(paymentId) {
  return D.Payments.markFailed(paymentId);
}

// Stripe webhook — ověří podpis (fail-closed) a zpracuje událost.
// rawBody = Buffer z express.raw (nesmí projít express.json, jinak se
// podpis neověří — Stripe podepisuje přesně původní payload).
//
// Podpis se ověřuje PŘÍMO (HMAC-SHA256 dle schématu Stripe) — nepotřebuje
// Stripe SDK ani API klíč, takže webhook funguje i v test mode.
const crypto = require('crypto');

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq > -1) parts[part.slice(0, eq).trim()] = part.slice(eq + 1);
  }
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  // tolerance 5 minut (Stripe default)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const body = Buffer.isBuffer(payload) ? payload.toString() : String(payload);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleWebhook(req, rawBody) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return { status: 400, error: 'WEBHOOK_NENAKONFIGUROVAN', message: 'Stripe webhook není nakonfigurován (chybí STRIPE_WEBHOOK_SECRET).' };
  }
  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    return { status: 400, error: 'NEPLATNY_PODPIS', message: 'Neplatný podpis webhooku.' };
  }
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString() : String(rawBody));
  } catch (err) {
    return { status: 400, error: 'NEPLATNY_PAYLOAD', message: 'Neplatný payload webhooku.' };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { paymentId } = session.metadata || {};
    if (session.payment_status !== 'paid') {
      return { status: 200, ignored: 'session not paid' };
    }
    const payment = paymentId ? await D.Payments.getById(paymentId) : null;
    if (!payment) {
      // Neznámá platba — vrátíme 200, aby Stripe nezkoušel retry do nekonečna
      return { status: 200, ignored: 'unknown payment' };
    }
    const paid = await D.Payments.markPaid(paymentId, session.id);
    // vracíme CELÝ řádek platby (vč. member_id) — routes.js podle něj aktivuje členství
    return { status: 200, paid };
  }

  return { status: 200, ignored: event.type };
}

module.exports = {
  createPaymentIntent,
  confirmPayment,
  failPayment,
  handleWebhook,
  stripeEnabled,
  stripeMode,
  gatewayMode,
  _stripe: stripe,
  _webhookSecret: STRIPE_WEBHOOK_SECRET,
};
