// views-public.js — veřejné pohledy: úvod, registrace, přihlášení, souhlas rodiče.
'use strict';

/* ---------- ÚVOD (rozdělení: před / po přihlášení) ---------- */
async function viewLanding() {
  const root = $('#view');
  root.innerHTML = '';

  const benefitsTitle = el('h2', { text: 'Členské výhody' });
  const benefitsGrid = el('div', { class: 'benefit-grid' });
  try {
    const { facilities } = await API.get('/facilities');
    for (const f of facilities) {
      benefitsGrid.append(el('div', { class: 'benefit-card' }, [
        el('span', { class: 'benefit-icon' }, [ico(f.icon || 'ticket')]),
        el('div', { class: 'benefit-body' }, [
          el('span', { class: 'benefit-name', text: f.name }),
          el('span', { class: 'benefit-desc', text: f.description }),
        ]),
        el('a', { class: 'btn small ghost', href: '#/rezervace', text: 'Rezervovat →' }),
      ]));
    }
  } catch (e) { /* offline */ }
  benefitsGrid.append(el('div', { class: 'benefit-card benefit-more' }, [
    el('span', { class: 'benefit-icon' }, [ico('arrow')]),
    el('div', { class: 'benefit-body' }, [
      el('span', { class: 'benefit-name', text: 'Další výhody' }),
      el('span', { class: 'benefit-desc', text: 'Připravujeme další zařízení a služby pro členy.' }),
    ]),
  ]));

  if (!isLoggedIn()) {
    /* ---------- NEPŘIHLÁŠENÝ: volba — ROČNÍ ČLENSTVÍ × JEDNORÁZOVÝ VSTUP ---------- */
    const intentStart = (intent) => {
      try { sessionStorage.setItem('tj_intent', intent); } catch (e) { /* noop */ }
      location.hash = '#/registrace';
    };
    const hero = el('section', { class: 'hero-full' }, [
      el('div', { class: 'hero-inner' }, [
        el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'hero-logo' }),
        el('span', { class: 'pill', text: 'Tělovýchovná jednota Krupka z.s.' }),
        el('h1', { text: 'Airbag. Skoky. Tvoje volba.' }),
        el('p', { class: 'lead', text: 'Dopadová matrace pro trénink MTB skoků. Staňte se členem TJK a užívejte členské výhody, nebo si kupte jednorázový vstup — v obou případech stačí registrace, souhlasy a platba.' }),
        el('div', { class: 'hero-cta' }, [
          el('button', { class: 'btn btn-lg', onclick: () => intentStart('clenstvi') }, [ico('shield', 17), ' ', 'Členství']),
          el('button', { class: 'btn ghost-dark', onclick: () => intentStart('vstup') }, [ico('ticket', 17), ' ', 'Jednorázový vstup']),
          el('a', { class: 'btn ghost-dark', href: '#/prihlaseni' }, [ico('key', 17), ' ', 'Mám účet — přihlásit']),
        ]),
        el('div', { class: 'hero-stats' }, [
          el('div', { class: 'hero-stat' }, [el('span', { class: 'hs-label', text: 'Členství TJK' }), el('span', { class: 'hs-value' }, [el('em', { text: '1' }), ' sleva na den'])]),
          el('div', { class: 'hero-stat' }, [el('span', { class: 'hs-label', text: 'Vstup AIRBAG — den' }), el('span', { class: 'hs-value', text: 'bez členství' })]),
          el('div', { class: 'hero-stat' }, [el('span', { class: 'hs-label', text: 'Do QR karty' }), el('span', { class: 'hs-value' }, [el('em', { text: '4' }), ' kroky'])]),
        ]),
      ]),
    ]);

    const steps = el('div', { class: 'steps' }, [
      ['1', 'Registrace'], ['2', 'Souhlasy'], ['3', 'Platba'], ['4', 'QR karta'],
    ].map(([n, t]) => el('div', { class: 'step' }, [el('div', { class: 'dot', text: n }), t])));

    const choice = el('div', {}, [
      el('h2', { text: 'Jak chcete airbag používat?' }),
      el('p', { class: 'muted', text: 'Obojí začíná registrací (jméno, e-mail…) a souhlasem s provozním řádem. Mladiství potřebují souhlas zákonného zástupce.' }),
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'list-row' }, [el('strong', { text: 'Členství TJK' }), el('span', { class: 'pick-sub', text: 'členské výhody + sleva na den' })]),
          el('p', { class: 'muted small', text: 'Přístup k zařízením spolku, rezervace, slevy na jednorázové vstupy, členská karta s QR. Nezletilí se souhlasem rodiče.' }),
          el('button', { class: 'btn', onclick: () => intentStart('clenstvi') }, [ico('shield', 16), ' ', 'Chci členství']),
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'list-row' }, [el('strong', { text: 'Jednorázový vstup — AIRBAG' }), el('span', { class: 'pick-sub', text: 'bez členství' })]),
          el('p', { class: 'muted small', text: 'Přístup k dopadové matraci bez členství. Mladiství se souhlasem zákonného zástupce. Členové TJK mají zvýhodněnou cenu.' }),
          el('button', { class: 'btn', onclick: () => intentStart('vstup') }, [ico('ticket', 16), ' ', 'Chci jednorázový vstup']),
        ]),
      ]),
    ]);

    const why = el('div', { class: 'card primary join-card' }, [
      el('h2', { text: 'Proč se stát členem' }),
      el('ul', { class: 'benefit-list' }, [
        ['Přístup k členským zařízením spolku', 'check'],
        ['Rezervace časových slotů dopředu', 'check'],
        ['Digitální členská karta s QR kódem', 'check'],
        ['Jednorázové vstupy za členské ceny', 'check'],
      ].map(([t]) => el('li', {}, [el('span', { class: 'bl-check' }, [ico('check', 13)]), t]))),
      el('button', { class: 'btn accent', onclick: () => intentStart('clenstvi') }, [ico('shield', 16), ' ', 'Stát se členem']),
    ]);

    const info = el('div', { class: 'card soft' }, [
      el('h3', { text: 'Podmínky provozu' }),
      el('p', { class: 'muted', text: 'Používání dopadové matrace se řídí provozním řádem. Každý uživatel uděluje souhlasy (provozní řád, čestné prohlášení, GDPR, vzdání se práva) s auditní stopou.' }),
      el('button', { class: 'btn ghost small', text: 'Provozní řád a podmínky', onclick: () => { location.hash = '#/podminky'; } }),
    ]);

    root.append(hero, steps, choice, benefitsTitle, benefitsGrid, why, info);
    return;
  }

  /* ---------- PŘIHLÁŠENÝ: členský dashboard ---------- */
  const m = me.member;
  const st = me.status;
  const kind = me.kind || 'neclen';            // 'clen' | 'neclen' (role uživatele)
  const isMember = kind === 'clen';
  const ageLabel = (me.ageType === 'MINOR' ? 'Mladistvý' : (me.ageType === 'ADULT' ? 'Dospělý' : 'Dospělý'));
  const accessOk = !!me.access;
  const statusLine = isMember
    ? `Členství je aktivní do ${fmtDate(m.validUntil)}.`
    : accessOk
      ? 'Máte aktivní jednorázový vstup — QR karta platí pro vstup.'
      : st === 'payment_pending' ? 'Čeká se na úhradu — dokončete platbu.'
        : st === 'consent_pending' || st === 'guardian_pending' ? 'Dokončete prosím souhlasy.'
          : st === 'registered' ? 'Dokončete registraci — souhlasy a platba.'
            : 'Nemáte aktivní členství ani vstup.';

  const welcome = el('section', { class: 'hero hero-member' }, [
    el('span', { class: 'pill', text: 'Členská aplikace' }),
    el('h1', { text: `Vítej, ${m.firstName}` }),
    el('p', { class: 'muted', text: statusLine }),
    el('div', { class: 'hero-status' }, [
      el('span', { class: 'tag ' + (isMember ? 'ok' : 'warn'), text: isMember ? 'ČLEN' : 'NEČLEN' }),
      el('span', { class: 'tag gray', text: ageLabel }),
      el('a', { class: 'btn small', href: '#/platba', text: isMember ? 'Koupit jednorázový vstup' : 'Koupit vstup / členství' }),
    ]),
  ]);

  const tiles = el('div', { class: 'tile-grid' }, [
    el('a', { class: 'tile', href: '#/karta' }, [
      el('span', { class: 'tile-icon green' }, [ico('ticket')]),
      el('span', { class: 'tile-body' }, [
        el('span', { class: 'tile-title', text: 'QR karta' }),
        el('span', { class: 'tile-sub', text: 'Karta pro vstup' }),
      ]),
    ]),
    el('a', { class: 'tile', href: '#/rezervace' }, [
      el('span', { class: 'tile-icon gold' }, [ico('clock')]),
      el('span', { class: 'tile-body' }, [
        el('span', { class: 'tile-title', text: 'Rezervace' }),
        el('span', { class: 'tile-sub', text: 'Rezervujte si čas' }),
      ]),
    ]),
    el('a', { class: 'tile', href: '#/merch' }, [
      el('span', { class: 'tile-icon orange' }, [ico('bag')]),
      el('span', { class: 'tile-body' }, [
        el('span', { class: 'tile-title', text: 'Merch' }),
        el('span', { class: 'tile-sub', text: 'Oblečení a doplňky' }),
      ]),
    ]),
  ]);

  root.append(welcome, tiles, benefitsTitle, benefitsGrid);
}

/* ---------- PRAVIDLA PROVOZU (základní pravidla) ---------- */
async function viewRules() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(
    el('h1', { text: 'Pravidla provozu' }),
    el('p', { class: 'muted', text: 'Jak se používá zařízení spolku, kdo na něj může a co se stane při porušení pravidel.' })
  );

  // rychlý přehled (klíčové informace na první pohled)
  const quick = el('div', { class: 'hero-stats' }, [
    el('div', { class: 'hero-stat' }, [el('span', { class: 'hs-label', text: 'Členský příspěvek' }), el('span', { class: 'hs-value' }, [el('em', { text: '200' }), ' Kč/rok'])]),
    el('div', { class: 'hero-stat' }, [el('span', { class: 'hs-label', text: 'Vstup AIRBAG' }), el('span', { class: 'hs-value', text: '300 / 600 Kč' })]),
  ]);
  root.append(quick);

  // pravidla (každé s ikonou)
  const RULES = [
    { icon: 'user', t: 'Pouze pro členy', d: 'Zařízení spolku jsou určena především pro členy. Návštěvy jsou možné pouze v doprovodu člena a jen s vědomím dozoru.' },
    { icon: 'ban', t: 'Vždy jen jedna osoba', d: 'Na matraci skáče vždy pouze jedna osoba — nikdy více lidí najednou. Další čeká v bezpečné vzdálenosti.' },

    { icon: 'calendar', t: 'Rezervace slotů', d: 'Slot si předem rezervujte v aplikaci (sekce Rezervace). Bez rezervace záleží na volné kapacitě — přednost mají rezervovaní.' },
    { icon: 'alert', t: 'Bezpečnost na prvním místě', d: 'Používání je na vlastní odpovědnost. Člen potvrzuje zdravotní způsobilost čestným prohlášením. Při zdravotních potížích se nepokračuje.' },
    { icon: 'bag', t: 'Vhodné vybavení', d: 'Vhodná obuv a oblečení bez zipů a ostrých předmětů. Na zařízení se nevstupuje s ostrými nástroji ani v botách s hroty.' },
    { icon: 'shield', t: 'Pokyny dozoru jsou závazné', d: 'V případě nebezpečí nebo sporu rozhoduje dozor. Jeho pokyny je nutné vždy uposlechnout.' },
  ];

  const card = el('div', { class: 'card' });
  for (const r of RULES) {
    card.append(el('div', { class: 'rule-row' }, [
      el('span', { class: 'rule-icon' }, [ico(r.icon, 14)]),
      el('div', {}, [
        el('div', { class: 'rule-title', text: r.t }),
        el('div', { class: 'rule-desc', text: r.d }),
      ]),
    ]));
  }
  root.append(card);

  // porušení pravidel
  const sanctions = el('div', { class: 'card' }, [
    el('h3', { text: 'Porušení pravidel' }),
    el('p', { class: 'muted small', text: 'Dodržování pravidel chrání vás i ostatní členy. Při porušení postupuje spolek takto:' }),
    el('div', { class: 'rule-row' }, [
      el('span', { class: 'rule-icon', style: 'background:var(--primary-soft);color:var(--primary)' }, [ico('info', 14)]),
      el('div', {}, [
        el('div', { class: 'rule-title', text: '1. Napomenutí dozorem' }),
        el('div', { class: 'rule-desc', text: 'Drobná porušení (např. vybavení) řeší dozor napomenutím na místě.' }),
      ]),
    ]),
    el('div', { class: 'rule-row' }, [
      el('span', { class: 'rule-icon', style: 'background:var(--primary-soft);color:var(--primary)' }, [ico('alert', 14)]),
      el('div', {}, [
        el('div', { class: 'rule-title', text: '2. Dočasný zákaz vstupu' }),
        el('div', { class: 'rule-desc', text: 'Při opakovaném nebo závažném porušení může dozor zakázat vstup až na 30 dní.' }),
      ]),
    ]),
    el('div', { class: 'rule-row' }, [
      el('span', { class: 'rule-icon', style: 'background:var(--danger-soft);color:var(--danger)' }, [ico('ban', 14)]),
      el('div', {}, [
        el('div', { class: 'rule-title', text: '3. Vyloučení rozhodnutím výboru' }),
        el('div', { class: 'rule-desc', text: 'Závažné porušení (ohrožení zdraví, poškození zařízení) řeší výbor — až vyloučením ze spolku.' }),
      ]),
    ]),
  ]);
  root.append(sanctions);

  // odkaz na plné znění
  root.append(el('div', { class: 'card soft' }, [
    el('h3', { text: 'Provozní řád a podmínky' }),
    el('p', { class: 'muted small', text: 'Kompletní znění provozního řádu, čestného prohlášení, GDPR a vzdání se práva na náhradu újmy. Verze dokumentů jsou součástí auditní stopy souhlasů.' }),
    el('a', { class: 'btn ghost small', href: '#/podminky', text: 'Zobrazit provozní řád a podmínky →' }),
  ]));
}

/* ---------- PODMÍNKY (provozní řád, offline dostupný) ---------- */
async function viewDocs() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Provozní řád a podmínky' }), el('p', { class: 'muted', text: 'Aktuální znění dokumentů spolku. Verze i hash dokumentu jsou součástí auditní stopy souhlasů.' }));
  let docs = [];
  try {
    docs = (await API.get('/docs')).docs;
  } catch (e) {
    root.append(el('div', { class: 'alert warn', text: 'Nepodařilo se načíst dokumenty — zobrazuji offline kopii.' }));
    docs = await loadOfflineDocs();
  }
  for (const d of docs) {
    root.append(el('details', { class: 'doc-details' }, [
      el('summary', { text: `${d.title} (verze ${d.version})` }),
      el('div', { class: 'doc-body' }, [
        el('div', { text: d.content }),
        el('p', { class: 'mono muted', text: `SHA-256: ${d.contentHash}` }),
      ]),
    ]));
  }
  // offline kopie pro režim bez připojení
  if (docs.length) saveOfflineDocs(docs);
}

/* ---------- REGISTRACE ---------- */
async function viewRegister() {
  const root = $('#view');
  root.innerHTML = '';

  const brand = el('a', { class: 'auth-brand', href: '#/' }, [
    el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'brand-logo' }),
    el('span', { class: 'auth-brand-text' }, [
      el('strong', { text: 'Tělovýchovná jednota Krupka' }),
      el('small', { text: 'členská aplikace' }),
    ]),
  ]);

  // Záměr z úvodu (členství × jednorázový vstup) — jen UX, registrace je společná
  let intent = 'clenstvi';
  try { intent = sessionStorage.getItem('tj_intent') || 'clenstvi'; } catch (e) { /* noop */ }
  const dailyIntent = intent === 'vstup';
  const intentNote = dailyIntent
    ? 'Registrujete se pro jednorázový vstup na airbag. Po registraci udělíte souhlasy a koupíte si denní vstup (600 Kč, pro členy 300 Kč). Mladiství pokračují přes souhlas zákonného zástupce.'
    : 'Registrujete se pro členství TJK. Po registraci udělíte souhlasy a zaplatíte členský příspěvek (200 Kč/rok). Kategorie se určí sama podle data narození — nezletilí potřebují souhlas rodiče.';

  const card = el('div', { class: 'auth-card' }, [
    el('h1', { text: dailyIntent ? 'Registrace pro jednorázový vstup' : 'Registrace pro členství TJK' }),
    el('p', { class: 'muted', text: intentNote }),
  ]);

  const form = el('form', { id: 'reg-form' }, [
    el('div', { class: 'card auth-section' }, [
      el('h3', { text: 'Osobní údaje' }),
      el('div', { class: 'form-grid' }, [
        el('div', {}, [el('label', { text: 'Jméno' }), el('input', { type: 'text', name: 'firstName', required: true, autocomplete: 'given-name' })]),
        el('div', {}, [el('label', { text: 'Příjmení' }), el('input', { type: 'text', name: 'lastName', required: true, autocomplete: 'family-name' })]),
        el('div', {}, [el('label', { text: 'Datum narození' }), el('input', { type: 'date', name: 'birthDate', required: true, max: new Date().toISOString().slice(0, 10) })]),
        el('div', {}, [el('label', { text: 'E-mail' }), el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })]),
        el('div', { class: 'full' }, [el('label', { text: 'Ulice a číslo popisné' }), el('input', { type: 'text', name: 'street', required: true })]),
        el('div', {}, [el('label', { text: 'Město' }), el('input', { type: 'text', name: 'city', required: true })]),
        el('div', {}, [el('label', { text: 'PSČ' }), el('input', { type: 'text', name: 'zip', required: true, inputmode: 'numeric' })]),
        el('div', { class: 'full' }, [el('label', { text: 'Telefon (volitelné)' }), el('input', { type: 'tel', name: 'phone' })]),
        el('div', {}, [el('label', { text: 'Pohlaví (volitelné, pro statistiky)' }), el('select', { name: 'gender' }, ['', 'muz', 'zena'].map((o) => el('option', { value: o, text: o === '' ? '—' : o === 'muz' ? 'Muž' : 'Žena' })))]),
        el('div', { class: 'full' }, [
          el('label', { text: 'Fotografie (povinné)' }),
          el('div', { class: 'photo-upload' }, [
            el('input', { type: 'file', id: 'reg-photo', name: 'photoFile', accept: 'image/*', style: 'display:none' }),
            el('div', { id: 'reg-photo-preview', class: 'photo-preview', text: 'Vybrat fotografii' }),
            el('button', { type: 'button', class: 'btn small', text: 'Nahrát fotografii', onclick: () => $('#reg-photo').click() }),
            el('p', { class: 'muted small', text: 'Nahrajte portrétovou fotku (JPG/PNG/WebP, max 3 MB). Požaduje se při registraci.' }),
          ]),
        ]),
      ]),
    ]),

    el('div', { class: 'card auth-section' }, [
      el('h3', { text: 'Kategorie členství' }),
      el('p', { class: 'muted', text: 'Určí se automaticky podle věku. Všechny kategorie stojí stejně: 200 Kč ročně.' }),
      el('div', { id: 'age-category' }),
    ]),

    el('div', { class: 'card auth-section', id: 'guardian-card', hidden: true }, [
      el('h3', { text: 'Zákonný zástupce (rodič)' }),
      el('p', { class: 'guardian-note', text: 'Nezletilý člen potřebuje souhlas zákonného zástupce. Vyplňte prosím údaje rodiče — na jeho e-mail zašleme bezpečný odkaz k elektronickému podpisu souhlasu (platí 7 dní).' }),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'full' }, [el('label', { text: 'Jméno a příjmení zákonného zástupce' }), el('input', { type: 'text', name: 'guardianName' })]),
        el('div', {}, [el('label', { text: 'Vztah k dítěti' }), el('select', { name: 'guardianRelation' }, ['matka', 'otec', 'jiný zákonný zástupce'].map((o) => el('option', { value: o, text: o })))]),
        el('div', {}, [el('label', { text: 'E-mail zákonného zástupce' }), el('input', { type: 'email', name: 'guardianEmail' })]),
        el('div', { class: 'full' }, [el('label', { text: 'Telefon zákonného zástupce (volitelné)' }), el('input', { type: 'tel', name: 'guardianPhone' })]),
      ]),
    ]),

    el('button', { class: 'btn btn-cta btn-block', type: 'submit', text: 'Odeslat registraci' }),
  ]);

  card.append(form);

  const switchLink = el('p', { class: 'auth-switch' }, [
    'Už jste členem? ',
    el('a', { href: '#/prihlaseni', text: 'Přihlásit se' }),
  ]);

  root.append(brand, el('div', { class: 'auth-wrap auth-wide' }, [card, switchLink]));

  const categoryBox = $('#age-category');
  const guardianCard = $('#guardian-card');
  const birthInput = $('[name="birthDate"]', form);

  // živý náhled kategorie + podmínky souhlasu rodiče
  function updateAgeCategory() {
    const age = birthInput.value ? calcAge(birthInput.value) : null;
    categoryBox.innerHTML = '';
    if (age === null) {
      categoryBox.append(el('div', { class: 'age-cat-hint', text: 'Vyplňte datum narození — kategorie se zobrazí sama.' }));
      guardianCard.hidden = true;
      return;
    }
    const code = membershipTypeForAge(age);
    const categories = [
      { code: 'dite', label: 'Dítě', range: 'do 15 let', icon: 'baby', note: 'Pouze s doprovodem zákonného zástupce (doprovod zdarma).' },
      { code: 'mladez', label: 'Mládež', range: '15–18 let', icon: 'user', note: 'Se souhlasem zákonného zástupce.' },
      { code: 'dospele', label: 'Dospělý', range: '18+ let', icon: 'users', note: 'Plné členství bez dalších podmínek.' },
    ];
    for (const c of categories) {
      const active = c.code === code;
      const box = el('div', { class: 'age-cat' + (active ? ' active' : '') }, [
        el('span', { class: 'age-cat-ico', 'aria-hidden': 'true' }, [ico(c.icon)]),
        el('div', { class: 'age-cat-body' }, [
          el('strong', { text: `${c.label} (${c.range})` }),
          el('small', { text: c.note }),
        ]),
        el('span', { class: 'age-cat-check', 'aria-hidden': 'true' }, active ? [ico('check')] : []),
      ]);
      categoryBox.append(box);
    }
    const minor = age < 18;
    guardianCard.hidden = !minor;
    // povinné atributy jen když je rodič potřeba
    for (const n of ['guardianName', 'guardianRelation', 'guardianEmail']) {
      const inp = $(`[name="${n}"]`, form);
      if (minor) inp.setAttribute('required', ''); else inp.removeAttribute('required');
    }
  }
  birthInput.addEventListener('change', updateAgeCategory);
  birthInput.addEventListener('input', updateAgeCategory);

  // Fotografie: čtení souboru → data-URL + preview
  let photoData = '';
  const photoInput = $('#reg-photo');
  const photoPreview = $('#reg-photo-preview');
  if (photoInput && photoPreview) {
    photoInput.addEventListener('change', (ev) => {
      const file = (ev.target.files || [])[0];
      if (!file) return;
      if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
        toast('Vyberte obrázek (JPG/PNG/WebP)', true);
        return;
      }
      if (file.size > 3 * 1024 * 1024) {
        toast('Fotografie je příliš velká (max 3 MB)', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        photoData = reader.result;
        photoPreview.style.backgroundImage = `url(${photoData})`;
        photoPreview.classList.add('has-photo');
        photoPreview.textContent = '';
      };
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFieldErrors(form);
    const data = readForm(form);
    const age = data.birthDate ? calcAge(data.birthDate) : null;
    const payload = {
      firstName: data.firstName, lastName: data.lastName, birthDate: data.birthDate,
      street: data.street, city: data.city, zip: data.zip,
      email: data.email, phone: data.phone,
      gender: data.gender || null,
      photo: photoData,
    };
    if (!photoData) {
      fieldError(form, 'photoFile', 'Fotografie je povinná.');
      const pv = $('#reg-photo-preview');
      if (pv) pv.classList.add('err');
      toast('Nahrajte prosím fotografii', true);
      return;
    }
    const guardianVisible = !guardianCard.hidden;
    if (guardianVisible) {
      payload.guardian = {
        name: data.guardianName, relation: data.guardianRelation,
        email: data.guardianEmail, phone: data.guardianPhone,
      };
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = 'Odesílám…';
    try {
      const res = await API.post('/register', payload);
      await refreshMe();
      if (guardianVisible) {
        toast('Registrace odeslána — rodič obdrží e-mail se souhlasem');
        location.hash = '#/souhlasy';
      } else {
        toast('Registrace proběhla úspěšně');
        location.hash = '#/souhlasy';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Odeslat registraci';
      toast(err.message, true);
      if (err.data && err.data.missing) Object.entries(err.data.missing).forEach(([k, v]) => fieldError(form, k, v));
    }
  });

  // prvotní stav
  updateAgeCategory();
}

/* ---------- PŘIHLÁŠENÍ (magic link přes e-mail) ---------- */
async function viewLogin() {
  const root = $('#view');
  root.innerHTML = '';

  // Režim e-mailů (smtp / stub) — v produkci vždy smtp. Text "Testovací režim"
  // odstraněn: běžný uživatel nesmí vidět dev-inbox hlášku. Kdyby /config selhalo,
  // předpokládáme smtp (reálné odesílání), ne stub.
  let emailMode = 'smtp';
  try {
    const cfg = await API.get('/config');
    emailMode = cfg.emailMode || 'smtp';
  } catch (e) { /* offline: předpokládáme smtp */ }

  const brand = el('a', { class: 'auth-brand', href: '#/' }, [
    el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'brand-logo' }),
    el('span', { class: 'auth-brand-text' }, [
      el('strong', { text: 'Tělovýchovná jednota Krupka' }),
      el('small', { text: 'členská aplikace' }),
    ]),
  ]);

  const card = el('div', { class: 'auth-card' }, [
    el('h1', { text: 'Vítejte zpět' }),
    el('p', { class: 'muted', text: 'Přihlaste se e-mailem — odkaz pro přihlášení vám přijde na vaši adresu.' }),
  ]);

  const form = el('form', { id: 'login-form' }, [
    el('label', { text: 'E-mail' }),
    el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', placeholder: 'vas@email.cz' }),
    el('button', { class: 'btn', type: 'submit', text: 'Poslat odkaz k přihlášení' }),
  ]);

  const showSent = (devMessageId) => {
    card.innerHTML = '';
    card.append(el('div', { class: 'auth-success' }, [
      el('span', { class: 'auth-ico' }, [ico('mail', 30)]),
      el('h2', { text: 'Zkontrolujte svůj e-mail' }),
      el('p', { class: 'muted', text: 'Odkaz k přihlášení jsme odeslali na vaši adresu. Platí 15 minut a lze ho použít pouze jednou.' }),
      el('button', { class: 'btn secondary', text: 'Zpět na přihlášení', onclick: () => viewLogin() }),
    ]));
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = readForm(form);
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = 'Odesílám…';
    try {
      const res = await API.post('/login', { email: data.email });
      showSent(res.devMessageId);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Poslat odkaz k přihlášení';
      toast(err.message, true);
    }
  });

  card.append(form);

  // Přihlášení / registrace přes Google (Cesta A: ID token z Google Identity Services)
  const googleBtn = el('div', { class: 'auth-google' }, [
    el('button', { id: 'google-login-btn', class: 'btn secondary btn-block', text: 'Pokračovat přes Google' }),
    el('div', { class: 'auth-divider', text: 'nebo' }),
  ]);
  card.append(googleBtn);

  // Načti Google Identity Services (GIS) — skript z accounts.google.com (povoleno v CSP).
  function loadGoogleScript() {
    return new Promise((resolve) => {
      if (window.google && window.google.accounts) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  const gBtn = $('#google-login-btn');
  if (gBtn) {
    gBtn.addEventListener('click', async () => {
      gBtn.disabled = true;
      gBtn.textContent = 'Přihlašuji přes Google…';
      try {
        await loadGoogleScript();
        if (!window.google || !window.google.accounts) throw new Error('Google Identity se nenačetlo.');
        // IdTokenProvider: zobrazí Google přihlašovací okno, vrátí id_token → pošleme na server.
        const client = window.google.accounts.id;
        client.initialize({
          client_id: '354181163168-p7vdibos71mu3lmciutlo5tjuqs9jd5e.apps.googleusercontent.com',
          callback: async (resp) => {
            try {
              const r = await API.post('/auth/google', { idToken: resp.credential });
              await refreshMe();
              toast(r.created ? 'Registrace Googlem proběhla' : 'Přihlášeno Googlem');
              location.hash = '#/';
            } catch (e) {
              toast(e.message, true);
            }
            gBtn.disabled = false;
            gBtn.textContent = 'Pokračovat přes Google';
          },
        });
        client.prompt(); // zobrazí Google okno (funguje i v iframe/bez popup)
      } catch (e) {
        gBtn.disabled = false;
        gBtn.textContent = 'Pokračovat přes Google';
        toast(e.message, true);
      }
    });
  }

  const switchLink = el('p', { class: 'auth-switch' }, [
    'Ještě nejste členem? ',
    el('a', { href: '#/registrace', text: 'Registrovat se' }),
  ]);

  root.append(brand, card, switchLink);
}

// Potvrzení odkazu z e-mailu (stub)
async function viewLoginToken(token) {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Přihlašuji…' }), el('p', { class: 'muted', text: 'Ověřuji odkaz.' }));
  try {
    const res = await API.post(`/login/${encodeURIComponent(token)}`);
    await refreshMe();
    toast('Přihlášeno');
    location.hash = '#/karta';
  } catch (err) {
    root.innerHTML = '';
    root.append(el('h1', { text: 'Neplatný odkaz' }), el('div', { class: 'alert err', text: err.message }));
  }
}

/* ---------- E-SOUHLAS ZÁKONNÉHO ZÁSTUPCE (veřejný odkaz) ---------- */
async function viewGuardian(token) {
  const root = $('#view');
  root.innerHTML = '';

  let data;
  try {
    data = await API.get(`/guardian/${encodeURIComponent(token)}`);
  } catch (e) {
    root.append(
      el('div', { class: 'auth-wrap' }, [
        el('div', { class: 'auth-brand' }, [
          el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'brand-logo' }),
          el('span', { class: 'auth-brand-text' }, [
            el('strong', { text: 'Tělovýchovná jednota Krupka' }),
            el('small', { text: 'členská aplikace' }),
          ]),
        ]),
        el('div', { class: 'auth-card' }, [
          el('h1', { text: 'Odkaz není platný' }),
          el('div', { class: 'alert err', text: e.message }),
          el('p', { class: 'muted', text: 'Požádejte člena o nový e-mail se souhlasem — v aplikaci je tlačítko „Znovu odeslat e-mail rodiči“.' }),
        ]),
      ])
    );
    return;
  }

  const m = data.member;
  root.append(el('div', { class: 'auth-wrap' }, [
    el('a', { class: 'auth-brand', href: '#/' }, [
      el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'brand-logo' }),
      el('span', { class: 'auth-brand-text' }, [
        el('strong', { text: 'Tělovýchovná jednota Krupka' }),
        el('small', { text: 'členská aplikace' }),
      ]),
    ]),
    el('div', { class: 'auth-card' }, [
      el('h1', { text: 'Souhlas zákonného zástupce' }),
      el('div', { class: 'guardian-child' }, [
        el('span', { class: 'guardian-child-ico', 'aria-hidden': 'true' }, [ico('baby')]),
        el('div', {}, [
          el('strong', { text: `${m.firstName} ${m.lastName}` }),
          el('small', { text: `Narozen(a): ${m.birthDate} · Kategorie: ${MEMBERSHIP_LABEL[m.membershipType] || m.membershipType}` }),
        ]),
      ]),
      el('p', { class: 'muted', text: 'Tímto souhlasem potvrzujete, že jako zákonný zástupce souhlasíte s členstvím výše uvedeného nezletilého a s níže uvedenými dokumenty. Souhlas bude opatřen časovým razítkem a uložen do auditní stopy.' }),
      el('p', { class: 'alert warn small', text: 'Odkaz je jednorázový a platí 7 dní od odeslání.' }),
    ]),
  ]));

  const form = el('form', { class: 'card auth-section' }, [
    el('h3', { text: 'Vaše údaje (zákonný zástupce)' }),
    el('div', { class: 'form-grid' }, [
      el('div', {}, [el('label', { text: 'Jméno a příjmení' }), el('input', { type: 'text', name: 'name', required: true, value: data.guardian.name || '' })]),
      el('div', {}, [el('label', { text: 'Vztah k dítěti' }), el('select', { name: 'relation', required: true }, ['matka', 'otec', 'jiný zákonný zástupce'].map((o) => el('option', { value: o, text: o })))]),
      el('div', {}, [el('label', { text: 'E-mail' }), el('input', { type: 'email', name: 'email', required: true, value: data.guardian.email || '' })]),
      el('div', {}, [el('label', { text: 'Telefon (volitelné)' }), el('input', { type: 'tel', name: 'phone' })]),
    ]),
  ]);

  const docLabels = {
    provozni_rad: 'Souhlas s Provozním řádem',
    cestne_prohlaseni: 'Čestné prohlášení o zdravotní způsobilosti',
    gdpr: 'Souhlas se zpracováním osobních údajů (GDPR)',
    vzdani_prava: 'Vzdání se práva na náhradu újmy (§ 2925 OZ)',
  };

  const checks = [];
  for (const d of data.docs) {
    const label = docLabels[d.docKey] || d.title;
    const check = el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', name: `doc-${d.docKey}`, value: d.docKey }),
      el('span', {}, [
        el('span', { class: 'check-title', text: label }),
        el('span', { class: 'check-desc', text: `verze ${d.version} · ${d.contentHash.slice(0, 12)}…` }),
        el('details', { class: 'doc-details' }, [
          el('summary', { text: 'Zobrazit plné znění' }),
          el('div', { class: 'doc-body', text: d.content }),
        ]),
      ]),
    ]);
    check.addEventListener('change', () => check.classList.toggle('checked', $('input', check).checked));
    checks.push(check);
    form.append(check);
  }

  const btn = el('button', { class: 'btn btn-cta btn-block', type: 'submit', text: 'Udělit souhlas zákonného zástupce' });
  form.append(btn);

  root.append(el('div', { class: 'auth-wrap auth-wide' }, [form]));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data2 = readForm(form);
    const docKeys = checks.filter((c) => $('input', c).checked).map((c) => $('input', c).value);
    if (docKeys.length !== data.docs.length) { toast('Zaškrtněte souhlas se všemi dokumenty', true); return; }
    btn.disabled = true;
    btn.textContent = 'Ukládám souhlas…';
    try {
      const res = await API.post(`/guardian/${encodeURIComponent(token)}`, {
        name: data2.name, relation: data2.relation, email: data2.email, phone: data2.phone, docKeys,
      });
      root.innerHTML = '';
      root.append(
        el('div', { class: 'auth-wrap' }, [
          el('div', { class: 'auth-brand' }, [
            el('img', { src: '/img/tjk-logo.png', alt: 'TJ Krupka', class: 'brand-logo' }),
            el('span', { class: 'auth-brand-text' }, [
              el('strong', { text: 'Tělovýchovná jednota Krupka' }),
              el('small', { text: 'členská aplikace' }),
            ]),
          ]),
          el('div', { class: 'auth-card' }, [
            el('h1', { text: 'Souhlas udělen' }),
            el('div', { class: 'auth-success', 'aria-hidden': 'true' }, [ico('check')]),
            el('div', { class: 'alert ok' }, [
              el('p', { text: `Souhlas zákonného zástupce pro ${m.firstName} ${m.lastName} byl zaznamenán s časovým razítkem (${res.recorded.length} dokumentů).` }),
              el('p', { class: 'small', text: 'Záznam je součástí auditní stopy — kdo, s čím, kdy a odkud souhlasil.' }),
            ]),
            el('a', { class: 'btn btn-cta btn-block', href: '#/', text: 'Zpět na úvod' }),
          ]),
        ])
      );
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Udělit souhlas zákonného zástupce';
      toast(err.message, true);
    }
  });

  // formulář je vložen výše v auth-wrap (auth-wide)
}

/* ---------- dev inbox (stub e-maily a SMS) ---------- */
async function viewOutbox() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Dev inbox — odeslané zprávy (STUB)' }), el('p', { class: 'muted', text: 'Testovací režim: e-maily ani SMS se reálně neodesílají. Zde vidíte, co by člen/rodič dostal.' }));
  let messages = [];
  try {
    messages = (await API.get('/outbox')).messages;
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }
  if (!messages.length) {
    root.append(el('div', { class: 'empty', text: 'Zatím žádné zprávy.' }));
    return;
  }
  const card = el('div', { class: 'card' });
  for (const m of messages) {
    const linkMatch = m.body.match(/(https?:\/\/[^\s]+)/);
    const link = linkMatch ? linkMatch[1] : null;
    card.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name' }, [el('span', { class: `tag ${m.channel === 'sms' ? 'blue' : 'ok'}`, text: m.channel.toUpperCase() }), ` ${m.subject || 'SMS'}`]),
        el('div', { class: 'l-sub' }, [`${m.to} · ${fmtDateTime(m.createdAt)}`]),
        el('div', { class: 'small muted', text: m.body }),
        link ? el('div', {}, [el('a', { class: 'btn small ghost', href: link, text: 'Otevřít odkaz →' })]) : null,
      ]),
    ]));
  }
  root.append(card);
}

/* ---------- offline cache dokumentů ---------- */
async function loadOfflineDocs() {
  try {
    const cached = localStorage.getItem('airbag_docs');
    return cached ? JSON.parse(cached) : [];
  } catch (e) { return []; }
}
function saveOfflineDocs(docs) {
  try { localStorage.setItem('airbag_docs', JSON.stringify(docs)); } catch (e) { /* quota */ }
}

function calcAge(birthDate) {
  // Časově bezpečný výpočet (bez posunu o časové pásmo) — shodný s backendem
  const [y, m, d] = String(birthDate).split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const md = today.getMonth() + 1 - m;
  if (md < 0 || (md === 0 && today.getDate() < d)) age--;
  return age;
}

let cachedMemberTypes = null;
async function fetchMemberTypes() {
  if (cachedMemberTypes) return cachedMemberTypes;
  // typy členství z ceníku (endpoint vrací i s cenami)
  const res = await API.get('/docs').catch(() => null);
  // ceník je součástí registrace — načteme z API /me? Ne. Použijeme lokální kopii z /docs?
  // Správný zdroj: endpoint /member-types (viz app.js init fetch). Fallback na pevný ceník:
  cachedMemberTypes = [
    { code: 'dospele', label: 'Dospělý (18+)', price_czk: 200, description: 'Plné členství, 200 Kč/rok.', requires_guardian: 0 },
    { code: 'mladez', label: 'Mládež (15–18 let)', price_czk: 200, description: 'Se souhlasem zákonného zástupce, 200 Kč/rok.', requires_guardian: 1 },
    { code: 'dite', label: 'Dítě (do 15 let)', price_czk: 200, description: 'Pouze s doprovodem zákonného zástupce, 200 Kč/rok.', requires_guardian: 1 },
  ];
  return cachedMemberTypes;
}
