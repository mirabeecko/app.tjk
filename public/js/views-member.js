// views-member.js — přihlášené pohledy: souhlasy, platba, QR karta, profil.
'use strict';

/* ---------- E-SOUHLAS S PODMÍNKAMI (hlavní funkce) ---------- */
async function viewConsent() {
  const root = $('#view');
  root.innerHTML = '';

  if (!me || !me.member) {
    root.append(el('h1', { text: 'Souhlasy a dokumenty' }), el('div', { class: 'alert warn', text: 'Pro pokračování se přihlaste.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }
  const m = me.member;

  const steps = el('div', { class: 'steps' }, [
    ['1', 'Registrace'], ['2', 'Souhlasy'], ['3', 'Platba'], ['4', 'QR karta'],
  ].map(([n, t], i) => el('div', { class: `step ${i === 1 ? 'active' : ''}` }, [el('div', { class: 'dot', text: n }), t])));

  root.append(el('h1', { text: 'Souhlasy a dokumenty' }), steps);
  root.append(el('div', { class: 'alert info' }, [
    el('strong', { text: 'Co potvrzujete: ' }),
    el('span', { text: 'souhlasy jsou rozdělené — členství, služby a (u nezletilých) zákonný zástupce. Každý souhlas se ukládá s verzí dokumentu, časovým razítkem, IP a identitou do auditní stopy.' }),
  ]));

  // čekající souhlas rodiče
  if (m.guardianStatus === 'pending') {
    const resendBtn = el('button', {
      class: 'btn ghost small', type: 'button', text: 'Znovu odeslat e-mail rodiči',
      onclick: async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true; b.textContent = 'Odesílám…';
        try { await API.post('/guardian-resend'); toast('E-mail se souhlasem byl znovu odeslán'); b.textContent = 'Odesláno'; }
        catch (err) { b.disabled = false; b.textContent = 'Znovu odeslat e-mail rodiči'; toast(err.message, true); }
      },
    });
    root.append(el('div', { class: 'card warn' }, [
      el('h3', { text: 'Čeká se na souhlas zákonného zástupce' }),
      el('p', { text: 'Odkaz pro e-souhlas rodiče byl odeslán e-mailem (platí 7 dní). Dokud nebude potvrzen, nelze dokončit nákup.' }),
      el('p', { class: 'small muted', text: `Rodič: ${m.guardianName || ''} (${m.guardianEmail || ''})` }),
      el('div', { class: 'row-gap', style: 'margin-top:12px' }, [resendBtn]),
    ]));
  }

  // obsahy dokumentů pro „zobrazit plné znění"
  let docsMap = {};
  try {
    const res = await API.get('/docs');
    for (const d of res.docs) docsMap[d.docKey] = d;
  } catch (e) { /* offline */ }

  // skupiny ze serveru (členství → služba → zástupce)
  let groups = [];
  let guard = null;
  try { const g = await API.get('/consent-groups'); groups = g.groups || []; guard = g.guardian || null; }
  catch (e) { root.append(el('div', { class: 'alert err', text: e.message })); return; }

  const allChecks = [];
  const submitBtns = [];
  let totalMissing = 0;

  groups.forEach((group, gi) => {
    if (group.key === 'guardian') return; // zástupce se řeší zvlášť níže
    const missing = group.docs.filter((d) => !d.signed).length;
    totalMissing += missing;
    const head = el('div', { class: 'list-row' }, [
      el('span', {}, [
        el('strong', { text: `${gi + 1}. ${group.title}` }),
        el('span', { class: 'small muted', text: missing ? ` · ${missing} zbývá` : '' }),
      ]),
      el('span', { class: 'tag ' + (missing ? 'warn' : 'ok'), text: missing ? `${missing} zbývá` : 'Hotovo' }),
    ]);
    const card = el('div', { class: 'card' }, [head]);
    for (const d of group.docs) {
      const doc = docsMap[d.docKey] || {};
      const check = el('label', { class: `check ${d.signed ? 'checked' : ''}` }, [
        el('input', { type: 'checkbox', name: `doc-${d.docKey}`, value: d.docKey, checked: d.signed, disabled: d.signed }),
        el('span', {}, [
          el('span', { class: 'check-title', text: doc.title || d.docKey + (d.signed ? ' ✓' : '') }),
          el('span', { class: 'check-desc', text: `verze ${d.version}${d.signed ? ' · podepsáno' : ''}` }),
          el('details', { class: 'doc-details' }, [
            el('summary', { text: 'Zobrazit plné znění' }),
            el('div', { class: 'doc-body', text: doc.content || '(text není dostupný offline)' }),
          ]),
        ]),
      ]);
      check.addEventListener('change', () => { if (!$('input', check).disabled) check.classList.toggle('checked', $('input', check).checked); });
      card.append(check);
      if (!d.signed) allChecks.push(check);
    }
    root.append(card);
  });

  // ZÁSTUPCE — krok
  if (guard) {
    const missingG = guard.docs.filter((d) => !d.signed).length;
    totalMissing += missingG;
    const card = el('div', { class: 'card ' + (guard.guardianGranted && missingG === 0 ? 'accent' : 'warn') }, [
      el('div', { class: 'list-row' }, [
        el('strong', { text: 'Zákonný zástupce (nezletilý)' }),
        el('span', { class: 'tag ' + (guard.guardianGranted && missingG === 0 ? 'ok' : 'warn'), text: guard.guardianGranted ? (missingG ? `${missingG} zbývá` : 'Potvrzeno') : 'Čeká se na souhlas' }),
      ]),
    ]);
    if (guard.guardianGranted) {
      for (const d of guard.docs) {
        card.append(el('div', { class: 'list-row' }, [
          el('span', { text: docsMap[d.docKey] ? docsMap[d.docKey].title : d.docKey }),
          el('span', { class: 'tag ok', text: d.signed ? 'Podepsáno (rodič)' : 'chybí' }),
        ]));
      }
    } else {
      card.append(el('p', { class: 'muted small', text: `Na e-mail ${guard.guardianEmail || 'rodiče'} jsme odeslali odkaz. Po jeho otevření rodič potvrdí souhlas a zde se stav aktualizuje.` }));
      if (m.guardianStatus !== 'pending') {
        card.append(el('p', { class: 'small muted', text: 'Pokud odkaz nefunguje, použijte „Znovu odeslat" nahoře.' }));
      }
    }
    root.append(card);
  }

  // akce
  const canContinue = totalMissing === 0 && (!guard || guard.guardianGranted);
  if (allChecks.length === 0 && !canContinue && guard && !guard.guardianGranted) {
    // zbývá jen souhlas rodiče — CTA na platbu zatím ne
  }
  if (allChecks.length) {
    const btn = el('button', { class: 'btn', type: 'button', text: 'Uložit vybrané souhlasy' });
    btn.addEventListener('click', async () => {
      const docKeys = allChecks.filter((c) => $('input', c).checked).map((c) => $('input', c).value);
      if (!docKeys.length) { toast('Zaškrtněte dokumenty, se kterými souhlasíte', true); return; }
      btn.disabled = true; btn.textContent = 'Ukládám souhlas s časovým razítkem…';
      try {
        const res = await API.post('/consent', { docKeys });
        await refreshMe();
        toast(`Souhlas zaznamenán (${res.recorded.length} dokumentů)`);
        location.hash = '#/souhlasy';
        render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Uložit vybrané souhlasy';
        toast(err.message, true);
      }
    });
    root.append(btn);
  }

  if (canContinue) {
    root.append(el('a', { class: 'btn', href: '#/platba', text: 'Dokončeno — pokračovat k platbě →' }));
  } else if (!allChecks.length) {
    root.append(el('p', { class: 'muted small', style: 'text-align:center', text: guard && !guard.guardianGranted ? 'Po potvrzení rodiče zde dokončíte nákup.' : 'Po uložení souhlasů můžete pokračovat k platbě.' }));
  }
}
/* ---------- NÁKUP: roční členství × jednorázové vstupy ---------- */
async function viewPayment() {
  const root = $('#view');
  root.innerHTML = '';

  if (!me || !me.member) {
    root.append(el('div', { class: 'alert warn', text: 'Pro nákup se přihlaste.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }
  const m = me.member;
  const kind = me.kind || 'neclen'; // 'clen' | 'neclen'
  const isMember = kind === 'clen';
  const accessOk = !!me.access;

  root.append(el('h1', { text: 'Nákup a platby' }));

  // blokátory (souhlasy / guardian) — nelze platit bez nich
  if (me.missingConsents.length > 0) {
    root.append(el('div', { class: 'alert err' }, [
      el('strong', { text: 'Nelze platit — chybí souhlasy: ' }),
      el('span', { text: me.missingConsents.join(', ') }),
      el('div', {}, [el('a', { class: 'btn small ghost', href: '#/souhlasy', text: 'Dokončit souhlasy' })]),
    ]));
    return;
  }
  if (m.guardianStatus === 'pending') {
    root.append(el('div', { class: 'alert err', text: 'Nelze platit — čeká se na souhlas zákonného zástupce.' }), el('a', { class: 'btn secondary', href: '#/souhlasy', text: 'Zpět na souhlasy' }));
    return;
  }

  // platební režim + produkty z API (ceny člen/nečlen určuje server)
  let cfg = { paymentGateway: 'test' };
  try { cfg = await API.get('/config'); } catch (e) { /* offline */ }
  const isStripe = String(cfg.paymentGateway || '').startsWith('stripe');
  const stripeLive = cfg.paymentGateway === 'stripe-live';
  const gatewayNote = isStripe
    ? (stripeLive
      ? 'Platba probíhá přes Stripe (bezpečná platební brána). Údaje platební karty zadáte přímo na stránce Stripe.'
      : 'Testovací režim Stripe — k platbě použijte testovací kartu 4242 4242 4242 4242.')
    : 'Testovací režim — nic se reálně neplatí, tlačítko simuluje platební bránu.';

  // Katalog služeb z API — server vrací POUZE jednu variantu + jednu cenu
  // dle stavu uživatele (spec: uživatel nikdy nevidí obě ceny ani si nevybírá roli).
  let productsData = { membershipStatus: 'NON_MEMBER', ageType: null, isMember: false, membershipPriceCzk: 200, products: [] };
  try { productsData = await API.get('/products'); } catch (e) { /* offline */ }
  const membershipPrice = productsData.membershipPriceCzk || 200;
  const ageType = productsData.ageType || null;                 // ADULT | MINOR
  const ageLabel = ageType === 'MINOR' ? 'Mladistvý' : 'Dospělý';
  const memLabel = isMember ? 'ČLEN' : 'NEČLEN';
  const membershipOk = !!(productsData.membership && productsData.membership.ok);

  async function startPayment(purpose, productCode, btn, btnLabel) {
    btn.disabled = true;
    btn.textContent = 'Přesměrovávám na platební bránu…';
    try {
      const intent = await API.post('/payments', { purpose, productCode });
      if (intent.gateway === 'stripe') {
        location.href = intent.gatewayUrl;
      } else {
        location.hash = `#/platba/${intent.paymentId}`;
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = btnLabel;
      toast(err.message, true);
      if (err.code === 'CHYBI_DOKUMENTY' || err.code === 'POTREBA_OPATROVNIKA') {
        setTimeout(() => { location.hash = '#/souhlasy'; }, 1400);
      }
    }
  }

  const body = el('div', {});

  // ── STATUS uživatele (spec §17): ČLEN/NEČLEN · Dospělý/Mladistvý
  const statusText = isMember
    ? `Člen TJK — členství platné do ${fmtDate(m.validUntil)}.`
    : productsData.membershipStatus === 'MEMBERSHIP_PENDING'
      ? 'Rozpracované členství — dokončete dokumenty a platbu.'
      : productsData.membershipStatus === 'MEMBERSHIP_EXPIRED'
        ? 'Členství vypršelo — obnovte ho a využijete členské ceny.'
        : accessOk
          ? 'Nečlen s aktivním jednorázovým vstupem.'
          : 'Nečlen — můžete si koupit vstup nebo se stát členem.';
  body.append(el('div', { class: 'alert ' + (isMember ? 'ok' : 'info') }, [
    el('span', {}, [
      el('strong', { text: `${memLabel} · ${ageLabel}` }),
      el('span', { text: ' — ' + statusText }),
    ]),
  ]));

  // ── ROČNÍ ČLENSTVÍ TJK
  if (isMember) {
    body.append(el('div', { class: 'card' }, [
      el('h3', { text: 'Členství TJK' }),
      el('div', { class: 'list-row' }, [el('span', { text: 'Stav' }), el('strong', { class: 'tag ok', text: `ČLEN do ${fmtDate(m.validUntil)}` })]),
      el('p', { class: 'muted small', text: 'Prodloužení zaplatíte po vypršení členství.' }),
    ]));
  } else {
    // karta členství = CTA „stát se členem" (bez členské ceny služeb zde)
    const memCard = el('div', { class: 'card primary join-card' }, [
      el('h3', { text: 'Staň se členem TJK' }),
      el('p', { class: 'muted', text: 'Členové mají zvýhodněné ceny služeb a přístup k zařízením spolku.' }),
      el('div', { class: 'list-row' }, [el('span', { text: 'Roční členství' }), el('strong', { class: 'price', style: 'color:#fff', text: `${fmtCzk(membershipPrice)} / rok` })]),
      el('p', { class: 'muted small', text: gatewayNote }),
      el('button', { class: 'btn accent', text: isStripe ? `Stát se členem (${fmtCzk(membershipPrice)} přes Stripe)` : `Stát se členem (${fmtCzk(membershipPrice)})` }),
    ]);
    const btn = $('button', memCard);
    // členství vyžaduje dokumenty členství + (u nezletilého) souhlas zástupce
    const memMissing = (productsData.membership && productsData.membership.missing) || { user: [], guardian: [], guardianNotGranted: false };
    const needsGuardian = ageType === 'MINOR' && (memMissing.guardianNotGranted || (memMissing.guardian || []).length > 0);
    if (memMissing.user.length || needsGuardian) {
      memCard.append(el('div', { class: 'alert warn', text: needsGuardian
        ? 'Tuto službu musí potvrdit zákonný zástupce.'
        : 'Nejprve potvrďte dokumenty k členství.' }));
      memCard.append(el('a', { class: 'btn ghost', href: '#/souhlasy', text: 'Dokončit dokumenty a souhlas' }));
      btn.style.display = 'none';
    } else {
      btn.addEventListener('click', () => startPayment('prispevek', null, btn, btn.textContent));
    }
    body.append(memCard);
  }

  // ── KATALOG SLUŽEB (jedna varianta = jeden produkt, jedna cena)
  const prods = productsData.products || [];
  if (prods.length) {
    body.append(el('h2', { style: 'margin-top:10px', text: 'Služby' }));
    for (const p of prods) {
      const card = el('div', { class: 'card' }, [el('h3', { text: p.name })]);
      if (p.available && p.price != null) {
        card.append(
          el('p', { class: 'muted small', text: p.description || '' }),
          el('div', { class: 'list-row' }, [
            el('span', { text: 'Jednorázový vstup' }),
            el('strong', { class: 'price', text: fmtCzk(p.price) }),
          ]),
          el('p', { class: 'muted small', text: gatewayNote })
        );
        // nezletilý bez souhlasu zástupce → nákup se neotevře, jen žádost
        const guardianMissing = p.requiresGuardian && me.guardianStatus !== 'granted';
        if (guardianMissing) {
          card.append(el('div', { class: 'alert warn', text: 'Tuto službu musí potvrdit zákonný zástupce.' }));
          card.append(el('a', { class: 'btn', href: '#/souhlasy', text: 'Vyžádat souhlas zákonného zástupce' }));
        } else {
          const btn = el('button', { class: 'btn', text: isStripe ? `Koupit ${fmtCzk(p.price)} přes Stripe` : `Koupit ${fmtCzk(p.price)}` });
          btn.addEventListener('click', () => startPayment('produkt', p.code, btn, btn.textContent));
          card.append(btn);
        }
      } else if (!isMember && p.hasMemberVariant) {
        // nečlen: členská varianta není koupitelná — jen promo na členství
        card.append(
          el('p', { class: 'muted small', text: 'Dostupné pouze členům TJK. Členové mají zvýhodněnou cenu.' }),
          el('a', { class: 'btn', href: '#/platba', text: 'Získat členství' })
        );
      } else {
        card.append(el('p', { class: 'muted small', text: 'Aktuálně nedostupné.' }));
      }
      body.append(card);
    }
  }

  // ── historie plateb
  const history = el('div', { class: 'card soft' }, [el('h3', { text: 'Historie plateb' })]);
  const pays = me.payments || [];
  if (!pays.length) history.append(el('div', { class: 'empty', text: 'Zatím žádné platby.' }));
  const purposeLabel = (p) => p.purpose === 'prispevek' ? 'Roční členství'
    : p.purpose === 'produkt' ? `Jednorázový vstup — ${p.productCode || ''}`.trim()
      : p.purpose === 'merch' ? 'Merch' : p.purpose;
  for (const p of pays) {
    history.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name', text: `${purposeLabel(p)} · ${fmtCzk(p.amountCzk)}` }),
        el('div', { class: 'l-sub', text: `${fmtDateTime(p.createdAt)} · ${p.gateway}` }),
      ]),
      el('span', { class: `tag ${p.status === 'paid' ? 'ok' : p.status === 'pending' ? 'blue' : 'bad'}`, text: p.status }),
    ]));
  }

  body.append(history);
  root.append(body);
}

/* ---------- platební brána (simulace) ---------- */
async function viewGateway(paymentId) {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Platební brána' }), el('p', { class: 'muted', text: 'Simulace platební brány — pouze testovací režim. Reálné platby probíhají přes Stripe Checkout.' }));

  let p;
  try {
    p = await API.get(`/payments/${paymentId}`);
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }

  // Platba přes Stripe sem nepatří — probíhá na stránce Stripe
  if (p.gateway === 'stripe') {
    root.append(el('div', { class: 'card' }, [
      el('div', { class: 'alert info', text: 'Tato platba probíhá přes Stripe Checkout. Dokončete ji na stránce platební brány.' }),
      el('a', { class: 'btn', href: '#/platba', text: 'Zpět na platbu' }),
    ]));
    return;
  }

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'alert info' }, [el('strong', { text: 'TEST MODE' }), el('span', { text: ' — žádná reálná platba. Údaje platební karty se nikde neukládají (PCI DSS řeší brána).' })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Částka' }), el('strong', { class: 'price', text: fmtCzk(p.amountCzk) })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Účel' }), el('span', { text: p.purpose === 'prispevek' ? 'Členský příspěvek' : p.purpose })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Reference' }), el('span', { class: 'mono', text: p.id.slice(0, 13) })]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn accent', id: 'ok-btn', text: 'Zaplatit (úspěch)' }),
      el('button', { class: 'btn secondary', id: 'no-btn', text: 'Zrušit' }),
    ]),
  ]);

  root.append(card);

  $('#ok-btn').addEventListener('click', async () => {
    const btn = $('#ok-btn');
    btn.disabled = true;
    btn.textContent = 'Zpracovávám…';
    try {
      const res = await API.post(`/payments/${paymentId}/confirm`);
      await refreshMe();
      toast('Platba uhrazena');
      location.hash = '#/potvrzeni/' + paymentId;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Zaplatit (úspěch)';
      toast(err.message, true);
    }
  });

  $('#no-btn').addEventListener('click', async () => {
    try { await API.post(`/payments/${paymentId}/fail`); } catch (e) { /* ignore */ }
    toast('Platba zrušena');
    location.hash = '#/platba';
  });
}

/* ---------- potvrzení / účtenka ---------- */
// Po Stripe Checkout se sem vrací úspěšná platba přes success_url. Webhook
// Stripe může dorazit s malým zpožděním → dotazujeme se, dokud není platba
// potvrzena (max ~60 s), pak zobrazíme účtenku.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function viewReceipt(paymentId) {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Potvrzení o platbě' }));

  // stav „zpracováváme" — dokud nepřijde potvrzení od brány
  const waiting = el('div', { class: 'card' }, [
    el('div', { class: 'alert info', id: 'receipt-wait' }, [
      el('strong', { text: 'Čekáme na potvrzení platby od platební brány…' }),
    ]),
    el('p', { class: 'muted small', text: 'Potvrzení obvykle dorazí do několika sekund. Tuto stránku můžete nechat otevřenou.' }),
  ]);
  root.append(waiting);

  let receipt = null;
  let lastErr = null;
  for (let i = 0; i < 30; i++) {
    try {
      receipt = await API.get(`/payments/${paymentId}/receipt`);
      break;
    } catch (e) {
      lastErr = e;
      if (e.status === 409) {
        await sleep(2000); // ještě nepotvrzeno → zkus znovu
        continue;
      }
      break; // jiná chyba (404, 403…) — nebudeme retryovat
    }
  }

  if (!receipt) {
    waiting.remove();
    root.append(el('div', { class: 'alert warn', text: lastErr && lastErr.message ? lastErr.message : 'Platba zatím nebyla potvrzena.' }));
    root.append(el('div', { class: 'row-gap' }, [
      el('a', { class: 'btn', href: '#/platba', text: 'Zpět na platbu' }),
      el('button', { class: 'btn ghost', text: 'Zkontrolovat znovu', onclick: () => viewReceipt(paymentId) }),
    ]));
    return;
  }

  await refreshMe();

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'alert ok', text: 'Platba byla úspěšně uhrazena — přístup/členství je aktivní a QR karta byla vystavena.' }),
    el('h3', { text: 'Účtenka (potvrzení o úhradě)' }),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Číslo účtenky' }), el('strong', { text: receipt.receiptNo })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Člen' }), el('span', { text: `${receipt.memberName} (č. ${receipt.memberNo})` })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Částka' }), el('span', { text: fmtCzk(receipt.amountCzk) })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Datum' }), el('span', { text: fmtDateTime(receipt.paidAt) })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Vystavil' }), el('span', { text: receipt.issuedBy })]),
    el('p', { class: 'small muted', text: receipt.note }),
  ]);

  root.append(card);
  root.append(el('a', { class: 'btn accent', href: '#/karta', text: 'Zobrazit členskou kartu (QR)' }));
}

/* ---------- ČLENSKÁ KARTA (QR) — offline dostupná ---------- */
async function viewCard() {
  const root = $('#view');
  root.innerHTML = '';

  if (!me || !me.member) {
    root.append(el('h1', { text: 'Členská karta' }), el('div', { class: 'alert warn', text: 'Pro zobrazení karty se přihlaste.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }

  root.append(el('h1', { text: 'Členská karta' }));

  let cardData;
  try {
    cardData = await API.get('/card');
    saveCardOffline(cardData);
  } catch (e) {
    cardData = loadCardOffline();
    if (!cardData) {
      root.append(el('div', { class: 'alert warn', text: e.message }));
      root.append(el('a', { class: 'btn', href: '#/platba', text: 'K platbě' }));
      return;
    }
    root.append(el('div', { class: 'alert info', text: 'Offline režim — zobrazena uložená karta.' }));
  }

  // /api/card vrací kind ('clen'|'neclen') — zelená karta = přístup platný
  const kind = cardData.kind || (cardData.status === 'active' ? 'clen' : 'neclen');
  const accessOk = kind === 'clen' || !!cardData.accessUntil || cardData.status === 'active';
  const card = el('div', { class: 'card member-card' }, [
    el('div', { class: 'mc-inner' }, [
      el('div', { class: 'mc-info' }, [
        el('div', { class: 'mc-name', text: cardData.name }),
        el('div', { class: 'mc-no', text: `ID člena ${(cardData.memberId || '').slice(0, 8)}…` }),
        el('div', { class: 'mc-rows' }, [
          el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Uživatel' }), el('span', { text: kind === 'clen' ? 'Člen' : 'Nečlen' })]),
          el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Přístup' }), el('span', { text: cardData.accessUntil ? `do ${fmtDate(cardData.accessUntil)}` : '—' })]),
          el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Status' }), statusTag(cardData.status)]),
        ]),
      ]),
      el('div', { class: 'mc-qr' }, [
        el('img', { src: cardData.qrDataUrl, alt: 'QR kód členské karty' }),
        el('span', { class: 'qr-payload', text: cardData.qrPayload }),
      ]),
    ]),
  ]);

  root.append(card);
  root.append(el('div', { class: 'alert ' + (accessOk ? 'ok' : 'warn'), text: accessOk
    ? (kind === 'clen'
      ? `Členství aktivní do ${fmtDate(cardData.validUntil)} — karta platí pro vstup.`
      : `Aktivní jednorázový vstup do ${fmtDate(cardData.accessUntil)} — karta platí pro vstup.`)
    : 'Žádné aktivní členství ani vstup — karta neplatí.' }));
  if (!accessOk) root.append(el('a', { class: 'btn', href: '#/platba', text: 'Koupit členství nebo vstup' }));

  // offline: SW cachuje /api/card i tuto stránku
}

/* ---------- profil ---------- */
async function viewProfile() {
  const root = $('#view');
  root.innerHTML = '';
  if (!me || !me.member) {
    root.append(el('div', { class: 'alert warn', text: 'Nejste přihlášeni.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }
  const m = me.member;
  root.append(el('h1', { text: 'Můj profil' }));

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Jméno' }), el('strong', { text: `${m.firstName} ${m.lastName}` })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'ID člena' }), el('span', { class: 'mono', text: m.id })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Datum narození' }), el('span', { text: m.birthDate ? fmtDate(m.birthDate) : '—' })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'E-mail' }), el('span', { text: m.email })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Uživatel' }), el('span', { text: (me.kind || 'neclen') === 'clen' ? 'Člen' : 'Nečlen' })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Status' }), statusTag(me.status)]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Platnost' }), el('span', { text: m.validUntil ? `do ${fmtDate(m.validUntil)}` : '—' })]),
  ]);
  root.append(card);

  const btn = el('button', { class: 'btn secondary' }, [ico('logout', 16), ' Odhlásit se']);
  btn.addEventListener('click', async () => {
    try { await API.post('/logout'); } catch (e) { /* ignore */ }
    me = null;
    toast('Odhlášeno');
    location.hash = '#/';
  });
  root.append(btn);
}

/* ---------- AKCE SPOLKU + přihlášení na akci ---------- */
async function viewEvents() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Akce spolku' }), el('p', { class: 'muted', text: 'Přehled plánovaných akcí a tréninků. Přihlásit se mohou aktivní členové.' }));

  let events = [];
  try {
    events = (await API.get('/events')).events;
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }

  if (!events.length) {
    root.append(el('div', { class: 'empty', text: 'Zatím nejsou naplánované žádné akce.' }));
    return;
  }

  const loggedIn = !!(me && me.member);
  const active = !!(me && me.status === 'active');
  if (!loggedIn) {
    root.append(el('div', { class: 'alert warn' }, [
      el('strong', { text: 'Přihlášení na akce: ' }),
      el('span', { text: 'seznam akcí je veřejný, ale přihlásit se můžete po přihlášení do aplikace.' }),
      el('a', { class: 'btn small ghost', href: '#/prihlaseni', text: 'Přihlásit se' }),
    ]));
  }

  const list = el('div', {});
  for (const e of events) {
    const dateStr = e.startsAt ? fmtDateTime(e.startsAt) : '—';
    const full = e.capacity != null && e.signupCount >= e.capacity;
    const started = e.startsAt ? new Date(e.startsAt) < new Date() : false;

    const card = el('div', { class: 'card event-card' }, [
      el('div', { class: 'event-head' }, [
        el('div', {}, [
          el('div', { class: 'event-title', text: e.title }),
          el('div', { class: 'event-meta' }, [
            el('span', { class: 'event-chip' }, [ico('calendar', 13), ' ', dateStr]),
            e.facilityName ? el('span', { class: 'event-chip' }, [ico('ticket', 13), ' ', e.facilityName]) : null,
            e.location ? el('span', { class: 'event-chip' }, [ico('edit', 13), ' ', e.location]) : null,
          ]),
        ]),
        e.signedUp ? el('span', { class: 'tag ok', text: 'Přihlášen' }) : null,
      ]),
      e.description ? el('p', { class: 'muted small', text: e.description }) : null,
      el('div', { class: 'event-foot' }, [
        el('span', { class: 'small muted', text: e.capacity != null ? `${e.signupCount} / ${e.capacity} přihlášeno` : `${e.signupCount} přihlášeno` }),
        !loggedIn || !active || started || full
          ? null
          : e.signedUp
            ? el('button', { class: 'btn small secondary', text: 'Odhlásit se' })
            : el('button', { class: 'btn small', text: 'Přihlásit se' }),
      ]),
    ]);

    const btn = card.querySelector('button');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (e.signedUp) {
            await API.delete(`/events/${e.id}/signup`);
            toast('Odhlášeno z akce');
          } else {
            await API.post(`/events/${e.id}/signup`, {});
            toast('Přihlášen na akci ✅'.replace(' ✅', ''));
          }
          viewEvents();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, true);
        }
      });
    }
    list.append(card);
  }
  root.append(list);
}

/* ---------- offline cache karty ---------- */
function saveCardOffline(cardData) {
  try { localStorage.setItem('airbag_card', JSON.stringify(cardData)); } catch (e) { /* quota */ }
}
function loadCardOffline() {
  try { return JSON.parse(localStorage.getItem('airbag_card')); } catch (e) { return null; }
}

async function fetchPrice(membershipType) {
  try {
    const types = await fetchMemberTypes();
    const t = types.find((x) => x.code === membershipType);
    if (t) return t.price_czk;
  } catch (e) { /* fallback */ }
  const fallback = { dospele: 200, mladez: 200, dite: 200, zakladni: 200, rodinne: 200, podporovatel: 200, vikend: 200, tyden: 200 };
  return fallback[membershipType] || 200;
}
