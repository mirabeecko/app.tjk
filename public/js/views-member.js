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

  // stejná grafika průběhu jako na /platba (hotovo zeleně, aktuální krok oranžově)
  root.append(el('h1', { text: 'Souhlasy a dokumenty' }), regSteps(1));
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

  // DOKLAD O PODPISU: co jsem podepsal(a), s jakým zněním, kdy a odkud + protokol k tisku
  root.append(await signedDocsCard());
}

/* ---------- DOKLAD O PODPISU (moje podepsané dokumenty) ---------- */
// Vypíše PŘESNÉ znění, které uživatel podepsal (ne dnešní verzi), s otiskem
// SHA-256 a údaji o podpisu. Protokol je samostatný doklad k tisku / uložení.
async function signedDocsCard() {
  const card = el('div', { class: 'card' }, [
    el('h3', { text: 'Podepsané dokumenty (doklad o podpisu)' }),
  ]);

  let bundle = null;
  try { bundle = await API.get(`/documents/signed/${me.member.id}`); } catch (e) { /* offline */ }

  if (!bundle || !bundle.consents.length) {
    card.append(el('p', { class: 'muted small', text: 'Zatím jste nepodepsal(a) žádný dokument. Po uložení souhlasů se zde objeví doklad s otiskem znění.' }));
    return card;
  }

  card.append(el('p', { class: 'muted small', text: `Protokol č. ${bundle.protocolNo}. U každého dokumentu je otisk SHA-256 znění, které jste potvrdil(a) — kdyby se text v evidenci dodatečně změnil, otisk to odhalí.` }));

  for (const c of bundle.consents) {
    card.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name', text: `${c.title} — verze ${c.version}` }),
        el('div', { class: 'l-sub', text: `${c.grantedAtLabel} · ${c.signerLabel} · IP ${c.ip}` }),
        el('div', { class: 'l-sub mono', text: `SHA-256 ${c.contentHash}` }),
      ]),
      el('span', { class: `tag ${c.integrity === 'OK' ? 'ok' : 'bad'}`, text: c.integrity === 'OK' ? 'otisk ověřen' : (c.integrity === 'CHYBI_TEXT' ? 'chybí znění' : 'ke kontrole') }),
    ]));
    card.append(el('details', { class: 'doc-details' }, [
      el('summary', { text: 'Zobrazit znění, které jsem podepsal(a)' }),
      el('div', { class: 'doc-body', text: c.text == null ? '(znění této verze se v systému nepodařilo dohledat)' : c.text }),
    ]));
  }

  card.append(el('div', { class: 'row-gap', style: 'margin-top:14px' }, [
    el('a', { class: 'btn small', href: `/api/documents/protocol/${me.member.id}`, target: '_blank', rel: 'noopener' }, [ico('file', 16), ' ', 'Protokol k tisku / PDF']),
    el('a', { class: 'btn small ghost', href: `/api/documents/protocol/${me.member.id}?download=1` }, [ico('arrow', 16), ' ', 'Uložit doklad (.html)']),
  ]));
  card.append(el('p', { class: 'muted small', style: 'margin-top:8px', text: 'Doklad si uložte nebo vytiskněte — obsahuje úplné znění podepsaných dokumentů, takže je průkazný i bez přístupu do aplikace.' }));

  return card;
}
/* ---------- SPOLEČNÉ PRVKY: kroky registrace + popisky dokumentů ---------- */
// Grafické pravidlo celého registračního toku: HOTOVO = zeleně, AKTUÁLNÍ KROK = oranžově,
// ZBÝVAJÍCÍ = jen obrysem (dashed). Z jediného pohledu je vidět, že registrace není hotová.
const REG_STEPS = ['Registrace', 'Souhlasy', 'Platba', 'QR karta'];

function regSteps(currentIdx) {
  return el('div', { class: 'steps reg-steps' }, REG_STEPS.map((label, i) => el('div', {
    class: 'step ' + (i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo'),
  }, [
    el('div', { class: 'dot' }, i < currentIdx ? [ico('check', 15)] : String(i + 1)),
    label,
  ])));
}

// Server posílá klíče dokumentů (stanovy, gdpr…) — v UI má být lidský název.
const DOC_LABELS = {
  stanovy: 'Stanovy spolku',
  gdpr: 'Souhlas se zpracováním osobních údajů (GDPR)',
  provozni_rad: 'Souhlas s Provozním řádem',
  cestne_prohlaseni: 'Čestné prohlášení o zdravotní způsobilosti',
  vzdani_prava: 'Vzdání se práva na náhradu újmy',
  guardian_souhlas: 'Souhlas zákonného zástupce',
};
const docLabel = (key, titles) => (titles && titles[key]) || DOC_LABELS[key] || key;

/* ---------- NÁKUP A PLATBY (#/platba) = DOKONČENÍ REGISTRACE ---------- */
// Požadavky na tuto stránku:
//  · grafika musí na první pohled říct, že registrace NENÍ dokončená (progress + oranžový stav),
//  · hero stručně a srozumitelně vysvětlí výhody členství (člen 300 Kč / nečlen 600 Kč za den),
//  · uživatel si musí VYBRAT variantu (členství × jednorázový vstup) a musí to snadno pochopit,
//  · o platební bráně (Stripe) je na stránce POUZE JEDNA zmínka — úplně dole, ne u každé platby.
async function viewPayment() {
  const root = $('#view');
  root.innerHTML = '';

  if (!me || !me.member) {
    root.append(
      el('h1', { text: 'Dokončení registrace' }),
      el('div', { class: 'alert warn', text: 'Pro dokončení registrace a platbu se přihlaste.' }),
      el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' })
    );
    return;
  }

  const m = me.member;
  const isMember = (me.kind || 'neclen') === 'clen';
  const membershipStatus = me.membershipStatus || (isMember ? 'MEMBER' : 'NON_MEMBER');
  const accessOk = !!me.access;
  const registrationDone = isMember || accessOk;
  const consentsMissing = (me.missingConsents || []).length > 0;
  const guardianPending = m.guardianStatus === 'pending';
  const blocked = consentsMissing || guardianPending;

  // ── režim platební brány: zjišťujeme jen kvůli JEDINÉ poznámce na konci stránky
  let cfg = { paymentGateway: 'test' };
  try { cfg = await API.get('/config'); } catch (e) { /* offline */ }
  const isStripe = String(cfg.paymentGateway || '').startsWith('stripe');
  const stripeLive = cfg.paymentGateway === 'stripe-live';
  const gatewayNote = !isStripe
    ? 'Aktuálně běží testovací režim — platba se reálně neprovede, tlačítko pouze simuluje platební bránu.'
    : stripeLive
      ? 'Platbu zpracovává zabezpečená platební brána Stripe (karta, Apple Pay, Google Pay). Údaje o platební kartě zadáváte přímo na její stránce — aplikace je neukládá.'
      : 'Platbu zpracovává zabezpečená platební brána Stripe v testovacím režimu — k platbě použijte testovací kartu 4242 4242 4242 4242.';

  // ── ceny a katalog vždy ze serveru (cenu nikdy neurčuje klient)
  let productsData = { membershipStatus: membershipStatus, ageType: null, isMember: isMember, membershipPriceCzk: 200, membership: null, products: [] };
  try { productsData = await API.get('/products'); } catch (e) { /* offline */ }
  const membershipPrice = productsData.membershipPriceCzk || 200;
  const ageType = productsData.ageType || null;
  const ageLabel = ageType === 'MINOR' ? 'Mladistvý (do 18 let)' : 'Dospělý';
  const memLabel = isMember ? 'ČLEN' : 'NEČLEN';
  const prods = productsData.products || [];
  // Srovnání cen pro hero: ceny obou variant posílá server (marketing), závazná
  // cena pro platbu je vždy ta, kterou vrátí server pro stav uživatele.
  const entryProd = prods.find((p) => p.available && p.price != null) || prods[0] || null;
  const memberEntry = (entryProd && (entryProd.memberPrice != null ? entryProd.memberPrice : (isMember ? entryProd.price : null))) || null;
  const guestEntry = (entryProd && (entryProd.publicPrice != null ? entryProd.publicPrice : (!isMember ? entryProd.price : null))) || null;
  const priceKc = (n) => (n == null ? '—' : `${n} Kč`);
  const docTitles = {};
  try { const dd = await API.get('/docs'); for (const d of (dd.docs || [])) docTitles[d.docKey] = d.title; } catch (e) { /* offline */ }

  // ── ve kterém kroku registrace uživatel stojí (1 Registrace · 2 Souhlasy · 3 Platba · 4 QR karta)
  const stepIdx = registrationDone ? 4 : blocked ? 1 : 2;

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

  /* ================= HERO: stav registrace + vysvětlení výhod členství ================= */
  const hero = el('section', { class: 'hero-full pay-hero' }, [
    el('div', { class: 'hero-inner' }, [
      el('span', {
        class: 'pill ' + (registrationDone ? 'ok' : 'wait'),
        text: registrationDone ? 'Registrace dokončena' : `Registrace nedokončená — krok ${stepIdx + 1} ze 4`,
      }),
      el('h1', { text: registrationDone ? 'Registrace je hotová' : 'Dokončete registraci' }),
      el('p', {
        class: 'lead',
        text: registrationDone
          ? `Máte aktivní vstup. Další denní vstup si můžete koupit kdykoli — jako člen za ${priceKc(memberEntry)}, bez členství za ${priceKc(guestEntry)}.`
          : 'Zbývá poslední krok — platba. Vyberte si, jestli chcete členství TJK, nebo jednorázový vstup.',
      }),
      el('div', { class: 'reg-progress' }, [
        el('div', { class: 'track' }, [el('span', { class: 'fill', style: `width:${Math.round((stepIdx / REG_STEPS.length) * 100)}%` })]),
        el('span', { class: 'reg-progress-label', text: `${stepIdx} ze 4 kroků hotovo` }),
      ]),
      regSteps(stepIdx),
      el('div', { class: 'hero-stats' }, [
        el('div', { class: 'hero-stat member' }, [
          el('span', { class: 'hs-label', text: 'Denní vstup jako člen' }),
          el('span', { class: 'hs-value', text: priceKc(memberEntry) }),
        ]),
        el('div', { class: 'hero-stat guest' }, [
          el('span', { class: 'hs-label', text: 'Denní vstup bez členství' }),
          el('span', { class: 'hs-value', text: priceKc(guestEntry) }),
        ]),
        el('div', { class: 'hero-stat' }, [
          el('span', { class: 'hs-label', text: 'Členství TJK' }),
          el('span', { class: 'hs-value' }, [el('em', { text: String(membershipPrice) }), ' Kč/rok']),
        ]),
      ]),
      el('p', { class: 'hero-claim' }, [
        ico('info', 15),
        el('span', {
          text: (memberEntry != null && guestEntry != null)
            ? `Členství se vyplatí hned při prvním vstupu: ${fmtCzk(membershipPrice)} za rok + ${fmtCzk(memberEntry)} za vstup = ${fmtCzk(membershipPrice + memberEntry)} — tedy méně, než kolik stojí jediný vstup bez členství (${fmtCzk(guestEntry)}).`
            : 'Jako člen TJK platíte za denní vstup výrazně méně než nečlen a navíc máte rezervace časových slotů a členskou kartu s QR kódem.',
        }),
      ]),
    ]),
  ]);

  const body = el('div', {});

  /* ================= STAV UŽIVATELE (ČLEN / NEČLEN) ================= */
  const statusText = isMember
    ? `Členství je platné do ${fmtDate(m.validUntil)}.`
    : membershipStatus === 'MEMBERSHIP_PENDING'
      ? 'Rozpracované členství — dokončete dokumenty a platbu.'
      : membershipStatus === 'MEMBERSHIP_EXPIRED'
        ? 'Členství vypršelo — obnovte ho a získáte zpět členské ceny.'
        : accessOk
          ? 'Nečlen s aktivním jednorázovým vstupem.'
          : 'Nečlen — členství se vyplatí už při prvním vstupu.';
  body.append(el('div', { class: 'alert ' + (isMember ? 'ok' : 'warn') }, [
    el('span', {}, [
      el('strong', { text: `${memLabel} · ${ageLabel}` }),
      el('span', { text: ' — ' + statusText }),
    ]),
  ]));

  /* ================= BLOKÁTOR: chybějící souhlasy / souhlas rodiče ================= */
  if (blocked) {
    body.append(el('div', { class: 'card pay-locked' }, [
      el('span', { class: 'lock-ico' }, [ico('shield', 20)]),
      el('div', {}, [
        el('h3', { text: guardianPending ? 'Čeká se na souhlas zákonného zástupce' : 'Nejdřív potvrďte souhlasy' }),
        el('p', { class: 'muted small', text: guardianPending
          ? `Dokud rodič nepotvrdí souhlas, nelze registraci dokončit ani zaplatit. Odkaz jsme poslali na ${m.guardianEmail || 'e-mail zákonného zástupce'}.`
          : 'Bez potvrzených dokumentů nelze registraci dokončit ani zaplatit. Zbývá potvrdit:' }),
        consentsMissing ? el('ul', { class: 'missing-docs' }, (me.missingConsents || []).map((k) => el('li', { text: docLabel(k, docTitles) }))) : null,
        el('a', { class: 'btn small', href: '#/souhlasy', text: guardianPending ? 'Zobrazit stav souhlasu' : 'Dokončit souhlasy' }),
      ]),
    ]));
    body.append(el('p', { class: 'muted small', text: 'Variantu (členství × jednorázový vstup) vyberete hned po dokončení souhlasů.' }));
    root.append(hero, body);
    return;
  }

  /* ================= VÝBĚR VARIANTY: zelená = členství · oranžová = jednorázový vstup ================= */
  const defs = [];   // datové definice variant (karty se staví z nich)

  // ---- 1) ČLENSTVÍ TJK
  if (isMember) {
    // aktivní člen: členství je hotová věc → zelená karta bez volby
    defs.push({
      color: 'member', locked: true, badge: 'Aktivní členství', icon: 'shield',
      title: 'Členství TJK', sub: `Platné do ${fmtDate(m.validUntil)}`,
      price: [priceKc(memberEntry), el('small', { text: ' za denní vstup (členská cena)' })],
      perks: [
        [`Denní vstup na airbag za ${priceKc(memberEntry)}`, 'ok'],
        ['Rezervace časových slotů dopředu', 'ok'],
        ['Digitální členská karta s QR kódem', 'ok'],
      ],
      foot: `Roční členství máte zaplacené — prodloužíte ho po vypršení (${fmtDate(m.validUntil)}).`,
    });
  } else {
    const memEl = productsData.membership || null;
    const memOk = !!(memEl && memEl.ok);
    const memMissing = (memEl && memEl.missing && memEl.missing.user) || [];
    const memGuardian = !!(memEl && memEl.missing && (memEl.missing.guardianNotGranted || (memEl.missing.guardian || []).length));
    const expired = membershipStatus === 'MEMBERSHIP_EXPIRED';
    defs.push({
      color: 'member', locked: !memOk, icon: 'shield',
      badge: memOk ? 'Výhodnější' : 'Nejprve dokumenty',
      title: expired ? 'Obnovit členství TJK' : 'Členství TJK',
      sub: `Členství na 365 dní · ${ageLabel}`,
      price: [String(membershipPrice) + ' Kč', el('small', { text: ' / rok' })],
      perks: [
        [`Denní vstup na airbag za ${priceKc(memberEntry)} (nečlen platí ${priceKc(guestEntry)})`, 'ok'],
        ['Rezervace časových slotů dopředu', 'ok'],
        ['Digitální členská karta s QR kódem', 'ok'],
        ['Akce, tréninky a další zařízení spolku', 'ok'],
      ],
      foot: memOk
        ? `Členství platí 365 dní.${ageType === 'MINOR' ? ' U mladistvých ho potvrzuje zákonný zástupce.' : ''}`
        : el('span', {}, [
          memGuardian ? 'Tuto variantu musí potvrdit zákonný zástupce — najdete ho v souhlasu ' : 'Nejprve potvrďte dokumenty k členství (',
          memGuardian ? '' : el('strong', { text: memMissing.map((k) => docLabel(k, docTitles)).join(', ') || 'stanovy, GDPR' }),
          memGuardian ? '' : '). ',
          el('a', { href: '#/souhlasy', text: 'dokončit dokumenty' }),
        ]),
      label: expired ? 'Obnovení členství TJK (365 dní)' : 'Členství TJK (365 dní)',
      priceValue: membershipPrice, purpose: 'prispevek', productCode: null,
      cta: `${expired ? 'Obnovit členství' : 'Stát se členem'} — ${fmtCzk(membershipPrice)}`,
      note: 'Zaplatíte jednou za rok — členské ceny pak platí 365 dní.',
    });
  }

  // ---- 2) JEDNORÁZOVÉ VSTUPY (produkty ze serveru; cenu určuje stav uživatele)
  for (const p of prods) {
    if (p.available && p.price != null) {
      const isEntry = p.code === 'airbag_day';
      const title = isEntry ? 'Jednorázový vstup — AIRBAG' : p.name;
      defs.push({
        color: 'guest', icon: 'ticket',
        badge: isMember ? 'Členská cena' : 'Bez členství',
        title,
        sub: isMember ? 'Jednorázově — členská cena' : 'Bez členství — platíte za každý vstup',
        price: [String(p.price) + ' Kč', el('small', { text: isMember ? ' za vstup (členská cena)' : ' za každý vstup' })],
        perks: isEntry ? [
          ['Vstup na dopadovou matraci (airbag) na jeden den', 'ok'],
          isMember
            ? ['Rezervace slotů i členská karta (z členství)', 'ok']
            : ['Bez ročního příspěvku — platíte jen když přijdete', 'ok'],
          ['QR karta pro vstup vystavená hned po zaplacení', 'ok'],
        ] : [
          ['Jednorázový vstup bez členství', 'ok'],
          ['QR karta pro vstup vystavená hned po zaplacení', 'ok'],
        ],
        foot: isMember
          ? 'Vstup platí v den nákupu (provoz 9–19 h).'
          : 'Nečlen nemá rezervace slotů ani členské ceny dalších služeb — ty má jen členství.',
        label: title, priceValue: p.price, purpose: 'produkt', productCode: p.code,
        cta: `Koupit denní vstup — ${fmtCzk(p.price)}`,
        note: isMember ? 'Jednorázově, bez vlivu na vaše členství.' : 'Jednorázově — členství se tím nezakládá.',
      });
    } else if (!isMember && p.hasMemberVariant) {
      defs.push({
        color: 'guest', locked: true, badge: 'Jen pro členy', icon: 'ticket',
        title: p.name, sub: 'Dostupné pouze členům TJK',
        price: [el('small', { text: 'zvýhodněná cena pro členy' })],
        perks: [['Zvýhodněná cena je součástí členství', 'ok'], ['Členství získáte v zelené variantě', 'ok']],
        foot: 'Zvolte členství TJK a získáte i zvýhodněnou cenu této služby.',
      });
    } else {
      defs.push({
        color: 'guest', locked: true, badge: 'Nedostupné', icon: 'ticket',
        title: p.name, sub: 'Aktuálně nedostupné',
        price: [el('small', { text: '—' })],
        foot: 'Tato služba teď není v prodeji.',
      });
    }
  }

  const grid = el('div', { class: 'variant-grid', role: 'radiogroup', 'aria-label': 'Výběr varianty' });

  // potvrzovací lišta — vybraná varianta se musí potvrdit, aby bylo jasné, co se platí
  const ctaInfo = el('div', { class: 'pay-cta-info' }, [
    el('span', { class: 'pci-label', text: 'Vyberte variantu' }),
    el('span', { class: 'pci-value', text: 'Zatím nic není vybráno' }),
    el('span', { class: 'pci-note', text: 'Klikněte na jednu z možností výše.' }),
  ]);
  const ctaBtn = el('button', { class: 'btn', type: 'button', text: 'Nejprve vyberte variantu' });
  ctaBtn.disabled = true;
  const cta = el('div', { class: 'pay-cta' }, [ctaInfo, ctaBtn]);
  let selected = null;

  function pick(card, v) {
    selected = v;
    $$('.variant-card', grid).forEach((c) => {
      c.classList.remove('selected');
      if (c.hasAttribute('aria-checked')) c.setAttribute('aria-checked', 'false');
    });
    card.classList.add('selected');
    if (card.hasAttribute('aria-checked')) card.setAttribute('aria-checked', 'true');
    ctaInfo.innerHTML = '';
    ctaInfo.append(
      el('span', { class: 'pci-label', text: 'Vaše volba' }),
      el('span', { class: 'pci-value', text: `${v.label} — ${fmtCzk(v.priceValue)}` }),
      el('span', { class: 'pci-note', text: v.note })
    );
    ctaBtn.textContent = v.cta;
    ctaBtn.className = 'btn ' + v.color;
    ctaBtn.disabled = false;
    cta.className = 'pay-cta armed ' + v.color;
    cta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // potvrzení volby → spuštění platby vybrané varianty
  ctaBtn.addEventListener('click', () => {
    if (!selected) { toast('Vyberte prosím jednu z variant', true); return; }
    startPayment(selected.purpose, selected.productCode, ctaBtn, selected.cta);
  });

  function variantCard(d, onPick) {
    const attrs = { class: `variant-card ${d.color}` + (d.locked ? ' locked' : '') };
    if (!d.locked) {
      attrs.role = 'radio';
      attrs.tabindex = '0';
      attrs['aria-checked'] = 'false';
      attrs.onclick = () => onPick();
      attrs.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(); } };
    }
    return el('div', attrs, [
      el('span', { class: `variant-badge ${d.color}`, text: d.badge }),
      el('div', { class: 'variant-head' }, [
        el('span', { class: `variant-ico ${d.color}` }, [ico(d.icon, 22)]),
        el('div', { style: 'min-width:0' }, [
          el('span', { class: 'variant-title', text: d.title }),
          el('span', { class: 'variant-sub', text: d.sub }),
        ]),
        d.locked ? null : el('span', { class: 'variant-radio' }, [ico('check', 14)]),
      ]),
      el('div', { class: 'variant-price' }, d.price),
      (d.perks && d.perks.length) ? el('ul', { class: 'variant-perks' }, d.perks.map(([txt, kind]) => el('li', {}, [
        el('span', { class: 'pv-ico' }, [ico(kind === 'no' ? 'x' : 'check', 12)]),
        el('span', { text: txt }),
      ]))) : null,
      d.foot ? el('div', { class: 'variant-foot' }, d.foot) : null,
    ]);
  }

  const variants = [];   // vybíratelné varianty (karta + data)
  for (const d of defs) {
    const card = variantCard(d, () => pick(card, d));
    grid.append(card);
    if (!d.locked && d.purpose) variants.push({ card, v: d });
  }

  if (variants.length) {
    body.append(
      el('h2', { text: 'Vyberte si variantu' }),
      el('p', { class: 'muted small', text: 'Klikněte na jednu z možností a dole ji potvrďte tlačítkem. Zaplatíte jen to, co si vyberete.' }),
      grid, cta
    );
    // jediná volba (typicky člen) → předvybrat, ať je tlačítko hned připravené
    if (variants.length === 1) pick(variants[0].card, variants[0].v);
  } else {
    body.append(
      el('h2', { text: 'Vyberte si variantu' }),
      el('div', { class: 'card soft' }, [el('p', { class: 'muted small', text: 'Aktuálně není co zakoupit. Zkuste to prosím později, nebo nás kontaktujte.' })])
    );
  }

  /* ================= HISTORIE PLATEB ================= */
  const GATEWAY_LABELS = { stripe: 'platební karta', comgate: 'platební brána', test: 'testovací režim', seed: 'evidence' };
  const purposeLabel = (p) => p.purpose === 'prispevek' ? 'Členství TJK'
    : p.purpose === 'produkt' ? `Jednorázový vstup — ${p.productCode || ''}`.trim()
      : p.purpose === 'merch' ? 'Merch' : p.purpose;
  const statusLabel = (s) => s === 'paid' ? 'Zaplaceno' : s === 'pending' ? 'Čeká na platbu' : s;
  const history = el('div', { class: 'card soft' }, [el('h3', { text: 'Historie plateb' })]);
  const pays = me.payments || [];
  if (!pays.length) history.append(el('div', { class: 'empty', text: 'Zatím žádné platby.' }));
  for (const p of pays) {
    history.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name', text: `${purposeLabel(p)} · ${fmtCzk(p.amountCzk)}` }),
        el('div', { class: 'l-sub', text: `${fmtDateTime(p.createdAt)} · ${GATEWAY_LABELS[p.gateway] || p.gateway}` }),
      ]),
      el('span', { class: `tag ${p.status === 'paid' ? 'ok' : p.status === 'pending' ? 'blue' : 'bad'}`, text: statusLabel(p.status) }),
    ]));
  }
  body.append(history);

  // ── JEDINÁ zmínka o platební bráně na celé stránce (ať se to neopakuje u každé platby)
  body.append(el('div', { class: 'pay-note' }, [ico('card', 16), el('span', { text: gatewayNote })]));

  root.append(hero, body);
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

/* ---------- NOTIFIKACE (schválení/neschválení členství) ---------- */
async function viewNotifications() {
  const root = $('#view');
  root.innerHTML = '';
  if (!me || !me.member) {
    root.append(el('div', { class: 'alert warn', text: 'Nejste přihlášeni.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }
  let data;
  try {
    data = await API.get('/notifications');
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }
  root.append(el('h1', { text: 'Notifikace' }));
  if (!data.notifications.length) {
    root.append(el('div', { class: 'empty', text: 'Zatím žádné notifikace.' }));
    return;
  }
  const card = el('div', { class: 'card' });
  for (const n of data.notifications) {
    const row = el('div', { class: 'list-row' + (n.read ? '' : ' is-unread') }, [
      el('div', {}, [
        el('div', { class: 'l-name' }, [el('strong', { text: n.title }), n.read ? '' : el('span', { class: 'tag warn', text: 'nové' })]),
        el('div', { class: 'l-sub', text: n.body }),
        el('div', { class: 'small muted', text: fmtDateTime(n.createdAt) }),
      ]),
    ]);
    card.append(row);
  }
  root.append(card);
  // označit vše jako přečtené
  API.post('/notifications/read-all').catch(() => {});
}

// Pomocná funkce pro badge (nepřečtené) — volá se z app.js
async function fetchUnreadCount() {
  try {
    const r = await API.get('/notifications/unread-count');
    return r.unread || 0;
  } catch (e) {
    return 0;
  }
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
  if (!me || !me.member || !cardData) return;
  try { localStorage.setItem(`airbag_card_${me.member.id}`, JSON.stringify(cardData)); } catch (e) { /* quota */ }
}
function loadCardOffline() {
  // Vrátí kartu JEN pokud patří přihlášenému členovi — jinak null (nikdy kartu jiného účtu).
  if (!me || !me.member) return null;
  try {
    const d = JSON.parse(localStorage.getItem(`airbag_card_${me.member.id}`));
    return d && d.memberId === me.member.id ? d : null;
  } catch (e) { return null; }
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
