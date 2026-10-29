// views-public.js — veřejné pohledy: úvod, registrace, přihlášení, souhlas rodiče.
'use strict';

/* ---------- ÚVOD (design Komárka 2026: hero + termíny + rychlé akce) ---------- */
const MESICE = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const MESICE_1 = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const hhmm = (d) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

/** Termíny z /api/events — jen budoucí, seřazené. Při chybě prázdné pole. */
async function nactiTerminy() {
  try {
    const res = await API.get('/events');
    const now = Date.now();
    return (res.events || [])
      .filter((e) => new Date(e.endsAt || e.startsAt).getTime() > now)
      .sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt));
  } catch (e) { return []; }
}

function terminKarta(e) {
  const s = new Date(e.startsAt);
  const k = e.endsAt ? new Date(e.endsAt) : null;
  const full = e.capacity && e.spotsLeft === 0;
  return el('article', { class: 'term' }, [
    el('div', { class: 'date' }, [
      el('span', { class: 'd', text: `${s.getDate()}.` }),
      el('span', { class: 'md' }, [el('b', { text: MESICE_1[s.getMonth()] }), DNY[s.getDay()]]),
    ]),
    el('h4', { text: e.title }),
    el('div', { class: 'info' }, [
      el('span', { class: 'pill free' }, [ico('clock', 12), `${hhmm(s)}${k ? '–' + hhmm(k) : ''}`]),
      el('span', { class: 'pill' }, [ico('pin', 12), e.facilityName || e.location || 'Dopadová matrace']),
      full ? el('span', { class: 'pill full', text: 'Obsazeno' }) : null,
    ]),
    el('div', { class: 'foot' }, [
      el('span', { class: 'spots' }, e.capacity
        ? [el('b', { text: String(e.spotsLeft) }), ` z ${e.capacity} míst volných`]
        : ['Volná kapacita']),
      el('a', { class: 'btn primary sm', href: isLoggedIn() ? '#/rezervace' : '#/registrace' }, ['Rezervovat', ico('arrow', 15)]),
    ]),
  ]);
}

/** Hero obrázek matrace + plovoucí karta „nejbližší termín" (plní se asynchronně). */
function heroArt(terminy) {
  const next = el('div', { class: 'nextcard' }, [
    el('span', { class: 'lbl' }, [ico('calendar', 12), 'Nejbližší termín']),
    el('div', { class: 'big', text: 'Načítám termíny…' }),
  ]);
  terminy.then((list) => {
    next.innerHTML = '';
    const e = list[0];
    next.append(el('span', { class: 'lbl' }, [ico('calendar', 12), 'Nejbližší termín']));
    if (!e) {
      next.append(el('div', { class: 'big', text: 'Termíny se připravují' }),
        el('div', { class: 'meta', text: 'Vypisujeme je podle počasí. Volné skákání podle rezervace.' }),
        el('a', { class: 'lnk', href: '#/rezervace' }, ['Volné sloty', ico('arrow', 14)]));
      return;
    }
    const s = new Date(e.startsAt);
    next.append(
      el('div', { class: 'big', text: `${DNY[s.getDay()][0].toUpperCase()}${DNY[s.getDay()].slice(1)} ${s.getDate()}. ${MESICE[s.getMonth()]}` }),
      el('div', { class: 'meta', text: `${e.title} · ${hhmm(s)}${e.capacity ? ` · ${e.spotsLeft} volných míst` : ''}` }),
      el('a', { class: 'lnk', href: '#terminy', onclick: (ev) => { ev.preventDefault(); const t = $('#terminy'); if (t) t.scrollIntoView({ behavior: 'smooth' }); } }, ['Všechny termíny', ico('arrow', 14)]),
    );
  });
  return el('div', { class: 'hero-art' }, [
    el('div', { class: 'shot cutout' }, [
      el('img', { src: '/img/airbag-matrace.webp', alt: 'Dopadová matrace Airbag Komárka', width: '650', height: '384', loading: 'eager' }),
      el('span', { class: 'tag', text: 'Matrace Airbag Komárka · 10 × 5 × 2 m' }),
    ]),
    next,
  ]);
}

function marquee() {
  const words = ['MTB', 'Dirt', 'BMX', 'Koloběžky', 'Děti od 8 let', 'Dozor na místě', '10 m matrace', 'QR vstup', 'Doprovod zdarma'];
  const track = el('div', { class: 'track' });
  for (let i = 0; i < 2; i++) words.forEach((w) => track.append(el('span', { text: w })));
  return el('div', { class: 'marquee', 'aria-hidden': 'true' }, [track]);
}

function secHead(icon, kicker, title, em, sub, extra) {
  return el('div', { class: 'sec-head' }, [
    el('div', { class: 'txt' }, [
      el('span', { class: 'kicker' }, [ico(icon, 14), kicker]),
      el('h2', {}, [title + ' ', el('em', { text: em })]),
      sub ? el('p', { class: 'sub', text: sub }) : null,
    ]),
    extra || null,
  ]);
}

function sekceTerminy(terminy) {
  const grid = el('div', { class: 'terms' }, [el('div', { class: 'term skeleton' }), el('div', { class: 'term skeleton' }), el('div', { class: 'term skeleton' })]);
  const status = el('span', { class: 'terms-status' }, [el('span', { class: 'dot' }), 'načítám…']);
  terminy.then((list) => {
    grid.innerHTML = '';
    status.className = 'terms-status ' + (list.length ? 'live' : 'off');
    status.lastChild.textContent = list.length ? `${list.length} ${list.length === 1 ? 'termín' : list.length < 5 ? 'termíny' : 'termínů'} v plánu` : 'zatím bez vypsaných termínů';
    if (!list.length) {
      grid.append(el('div', { class: 'cell empty-terms' }, [
        el('span', { class: 'ic' }, [ico('calendar', 19)]),
        el('h3', { text: 'Další termíny brzy' }),
        el('p', { text: 'Akce vypisujeme podle počasí a obsazenosti. Mezitím si můžeš rezervovat volný slot na matraci.' }),
        el('a', { class: 'btn sm', href: '#/rezervace' }, ['Volné sloty', ico('arrow', 15)]),
      ]));
      return;
    }
    list.slice(0, 6).forEach((e) => grid.append(terminKarta(e)));
  });
  return el('section', { class: 'sec', id: 'terminy' }, [
    secHead('calendar', 'Termíny', 'Kdy se', 'skáče', 'Termíny vypisujeme podle počasí a obsazenosti. Rezervovat mohou aktivní členové spolku.', status),
    grid,
  ]);
}

async function viewLanding() {
  const root = $('#view');
  root.innerHTML = '';
  root.classList.add('is-home');
  const terminy = nactiTerminy();

  let facilities = [];
  try { facilities = await loadFacilities(); } catch (e) { /* offline */ }
  const sekceVyhody = el('section', { class: 'sec' }, [
    secHead('zap', 'Členské výhody', 'Co spolek', 'nabízí', 'Zařízení a služby, které můžeš jako člen TJ Krupka využívat.'),
    el('div', { class: 'disc' }, facilities.map((f) => el('div', { class: 'dcard' }, [
      el('div', { class: 'top-line' }, [ico(f.icon || 'bike', 20), el('h3', { text: f.name })]),
      el('p', { text: f.description || '' }),
      el('div', { class: 'req' }, [el('b', { text: 'Rezervace: ' }), 'sloty po 60 minutách, na matraci vždy jeden jezdec.']),
    ])).concat([el('div', { class: 'dcard soon' }, [
      el('div', { class: 'top-line' }, [ico('arrow', 20), el('h3', { text: 'Další výhody' })]),
      el('p', { text: 'Připravujeme další zařízení a služby pro členy spolku.' }),
    ])])),
  ]);

  if (!isLoggedIn()) {
    /* ---------- NEPŘIHLÁŠENÝ: členství × jednorázový vstup ---------- */
    root.classList.add('is-public');
    const intentStart = (intent) => {
      try { sessionStorage.setItem('tj_intent', intent); } catch (e) { /* noop */ }
      location.hash = '#/registrace';
    };
    const hero = el('section', { class: 'k-hero' }, [
      el('div', { class: 'k-hero-txt' }, [
        el('span', { class: 'eyebrow' }, [ico('shield', 13), 'TJ Krupka · členská aplikace']),
        el('h1', {}, ['Airbag ', el('span', { class: 'g', text: 'Komárka' })]),
        el('p', { class: 'claim', text: 'Skákej bez rizika' }),
        el('p', { class: 'lead', text: 'Vstup na dopadovou matraci, rezervace, souhlasy a QR karta na jednom místě. Staň se členem TJ Krupka, nebo si kup jednorázový vstup — v obou případech stačí registrace, souhlasy a platba.' }),
        el('div', { class: 'hero-acts' }, [
          el('button', { class: 'btn primary', onclick: () => intentStart('clenstvi') }, [ico('shield', 17), 'Chci členství']),
          el('button', { class: 'btn pink', onclick: () => intentStart('vstup') }, [ico('ticket', 17), 'Jednorázový vstup']),
          el('a', { class: 'btn', href: '#/prihlaseni' }, [ico('key', 17), 'Mám účet']),
        ]),
        el('div', { class: 'chips' }, [
          el('span', { class: 'chip' }, [ico('edit', 14), 'Registrace ', el('b', { text: '2 min' })]),
          el('span', { class: 'chip' }, [ico('qr', 14), 'Vstup ', el('b', { text: 'QR kartou' })]),
          el('span', { class: 'chip' }, [ico('users', 14), 'Doprovod ', el('b', { text: 'zdarma' })]),
        ]),
      ]),
      heroArt(terminy),
    ]);

    const kroky = el('section', { class: 'sec' }, [
      secHead('edit', 'Registrace', 'Čtyři kroky a', 'jedeš', 'Nic se neinstaluje z obchodu — stačí prohlížeč v mobilu. Aplikaci si můžeš přidat na plochu.'),
      el('div', { class: 'reg' }, [
        el('ol', { class: 'k-steps' }, [
          ['Registrace', 'jméno, datum narození, e-mail a telefon. Podle věku se nastaví kategorie a u nezletilých režim souhlasu zákonného zástupce.'],
          ['Souhlasy', 'po registraci si v aplikaci přečteš a potvrdíš dokumenty spolku — jedním ověřovacím kódem z e-mailu.'],
          ['Platba', 'členství TJ Krupka nebo jednorázový vstup. Členové mají vstup za zvýhodněnou cenu.'],
          ['QR karta', 'v aplikaci vznikne karta s QR kódem. Ukážeš ji dozoru na místě a jdeš do rotace.'],
        ].map(([b, s]) => el('li', {}, [el('span', {}, [el('b', { text: b }), ` — ${s}`])]))),
        el('div', { class: 'price-side' }, [
          el('h3', { text: 'Jak chceš skákat?' }),
          el('div', { class: 'pick' }, [
            el('button', { class: 'pick-opt', onclick: () => intentStart('clenstvi') }, [
              el('span', { class: 'pick-ic' }, [ico('shield', 18)]),
              el('span', {}, [el('b', { text: 'Členství TJ Krupka' }), el('small', { text: 'rezervace, QR karta, levnější vstupy' })]),
              ico('arrow', 16),
            ]),
            el('button', { class: 'pick-opt pink' , onclick: () => intentStart('vstup') }, [
              el('span', { class: 'pick-ic' }, [ico('ticket', 18)]),
              el('span', {}, [el('b', { text: 'Jednorázový vstup' }), el('small', { text: 'bez členství, na jeden den' })]),
              ico('arrow', 16),
            ]),
          ]),
          el('p', { class: 'tiny muted', text: 'Mladiství potřebují souhlas zákonného zástupce — aplikace ho vyžádá e-mailem.' }),
        ]),
      ]),
    ]);

    // Pravidla a dokumenty k odsouhlasení se ukazují až po přihlášení (zadání 2026-10-29)
    root.append(hero, marquee(), sekceTerminy(terminy), kroky, sekceVyhody);
    return;
  }

  /* ---------- PŘIHLÁŠENÝ: členský přehled ---------- */
  const m = me.member;
  const st = me.status;
  const kind = me.kind || 'neclen';            // 'clen' | 'neclen' (role uživatele)
  const isMember = kind === 'clen';
  const ageLabel = (me.ageType === 'MINOR' ? 'Mladistvý' : 'Dospělý');
  const accessOk = !!me.access;
  const statusLine = isMember
    ? `Členství je aktivní do ${fmtDate(m.validUntil)}. QR karta platí pro vstup na matraci.`
    : accessOk
      ? 'Máte aktivní jednorázový vstup — QR karta platí pro vstup.'
      : st === 'payment_pending' ? 'Čeká se na úhradu — dokončete platbu a karta se aktivuje.'
        : st === 'consent_pending' || st === 'guardian_pending' ? 'Dokončete prosím souhlasy — pak už jen platba.'
          : st === 'registered' ? 'Dokončete registraci — souhlasy a platba.'
            : 'Nemáte aktivní členství ani vstup. Kupte si vstup nebo členství.';
  const vok = (typeof CZ !== 'undefined' && CZ.vocative) ? CZ.vocative(m.firstName) : m.firstName;

  const hero = el('section', { class: 'k-hero' }, [
    el('div', { class: 'k-hero-txt' }, [
      el('span', { class: 'eyebrow' }, [el('span', { class: 'live-dot' }), isMember ? 'Členství aktivní' : (accessOk ? 'Vstup aktivní' : 'Účet bez aktivního vstupu')]),
      // Oslovení 5. pádem — „Vítej, Petře" (viz public/js/czech.js)
      el('h1', {}, ['Vítej, ', el('span', { class: 'g', text: vok || '' })]),
      el('p', { class: 'claim', text: 'Skákej bez rizika' }),
      el('p', { class: 'lead', text: statusLine }),
      el('div', { class: 'hero-acts' }, [
        el('a', { class: 'btn primary', href: '#/karta' }, [ico('qr', 17), 'Moje QR karta']),
        el('a', { class: 'btn', href: '#/rezervace' }, [ico('clock', 17), 'Rezervovat']),
        el('a', { class: 'btn pink', href: '#/platba' }, [ico('ticket', 17), isMember ? 'Jednorázový vstup' : 'Koupit vstup / členství']),
      ]),
      el('div', { class: 'chips' }, [
        el('span', { class: 'chip' }, [ico('user', 14), 'Uživatel ', el('b', { text: isMember ? 'Člen' : 'Nečlen' })]),
        el('span', { class: 'chip' }, [ico('calendar', 14), 'Platnost ', el('b', { text: isMember && m.validUntil ? `do ${fmtDate(m.validUntil)}` : (accessOk ? 'dnes' : '—') })]),
        el('span', { class: 'chip' }, [ico('baby', 14), 'Kategorie ', el('b', { text: ageLabel })]),
      ]),
    ]),
    heroArt(terminy),
  ]);

  // rychlé akce — bento jako na webu (podle role přibývají pracovní dlaždice)
  const cell = (cls, href, icon, title, text, tag) => el('a', { class: 'cell act ' + cls, href }, [
    el('span', { class: 'ic' }, [ico(icon, 19)]),
    tag ? el('span', { class: 'cell-tag', text: tag }) : null,
    el('h3', { text: title }),
    el('p', { text }),
    el('span', { class: 'go' }, ['Otevřít', ico('arrow', 14)]),
  ]);
  const cells = [
    cell('s4 hl', '#/karta', 'qr', 'QR karta', 'Ukaž ji dozoru u vstupu. Funguje i offline.'),
    cell('s4', '#/rezervace', 'clock', 'Rezervace', 'Vyber si volný slot na matraci.'),
    cell('s4', '#/platba', 'card', 'Vstupy a členství', 'Jednorázový vstup nebo roční členství.'),
  ];
  if (isDozor()) cells.push(cell('s4 work', '#/dozor', 'qr', 'Dozor — kontrola', 'Provozní den, kontrola QR a výbavy.', 'Dozor'));
  if (isStaff()) cells.push(cell('s4 work', '#/admin', 'dashboard', 'Správa členů', 'Přehled členů, souhlasů a plateb.', 'Výbor'));
  if (isSuperAdmin()) cells.push(cell('s4 owner', '#/zakladna', 'users', 'Členská základna', 'Statistiky členů a účty dozoru.', 'Vlastník'));
  cells.push(cell('s4', '#/profil', 'user', 'Můj profil', 'Údaje, fotka a dokumenty.'));
  const doplnky = [
    cell('s4', '#/pravidla', 'shield', 'Pravidla provozu', 'Výbava, rotace a bezpečnost.'),
    cell('s4', '#/notifikace', 'bell', 'Notifikace', 'Schválení členství a zprávy od spolku.'),
  ];
  while (cells.length % 3 && doplnky.length) cells.push(doplnky.shift());
  const akce = el('section', { class: 'sec' }, [
    secHead('zap', 'Rychlé akce', 'Co chceš', 'udělat', null),
    el('div', { class: 'bento' }, cells),
  ]);

  root.append(hero, marquee(), akce, sekceTerminy(terminy), sekceVyhody);
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
    { icon: 'user', t: 'Pro členy i nečleny', d: 'Na zařízení má vstup člen spolku s uhrazeným příspěvkem i nečlen s platným jednorázovým vstupem. Pravidla bezpečnosti a dozoru platí pro oba stejně — členství přináší jen zvýhodněnou cenu.' },
    { icon: 'ban', t: 'Vždy jen jedna osoba', d: 'Na matraci skáče vždy pouze jedna osoba — nikdy více lidí najednou. Další čeká v bezpečné vzdálenosti a vstupuje až po pokynu dozoru.' },
    { icon: 'shield', t: 'Podmínky vstupu (čl. 3 řádu)', d: 'Potvrzené dokumenty v aktuální verzi, absolvovaná praktická instruktáž u dozora, ověřená totožnost (QR karta + fotografie, případně vstupní PIN) a vyhovující denní kontrola zařízení s přítomným dozorem. Potvrzení dokumentů samo o sobě nestačí.' },
    { icon: 'calendar', t: 'Rezervace slotů', d: 'Slot si předem rezervujte v aplikaci (sekce Rezervace). Bez rezervace záleží na volné kapacitě — přednost mají rezervovaní.' },
    { icon: 'alert', t: 'Bezpečnost na prvním místě', d: 'Účast je dobrovolná a riziková — hrozí vážný úraz hlavy, páteře i končetin. Potvrzení dokumentů neomezuje vaše zákonná práva při vzniku újmy; odpovědnost provozovatele za stav zařízení a dohled zůstává.' },
    { icon: 'bag', t: 'Vhodné vybavení', d: 'Povinná je přilba s ochranou brady, chránič páteře, chrániče kolen a loktů a rukavice. Oblečení bez zipů a ostrých předmětů.' },
    { icon: 'shield', t: 'Pokyny dozoru jsou závazné', d: 'V případě nebezpečí nebo sporu rozhoduje dozor. Jeho pokyny je nutné vždy uposlechnout — včetně přerušení vaší účasti.' },
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
    el('p', { class: 'muted small', text: 'Kompletní znění provozního řádu, poučení o rizicích a potvrzení pravidel účasti, čestného prohlášení a GDPR. Verze dokumentů i otisky znění (SHA-256) jsou součástí auditní stopy potvrzení.' }),
    el('a', { class: 'btn ghost small', href: '#/podminky', text: 'Zobrazit provozní řád a podmínky →' }),
  ]));

  // Co ještě není potvrzené z dokumentace výrobce (řád je do té doby PROZATÍMNÍ)
  const params = el('div', { class: 'card' }, [
    el('h3', { text: 'Parametry čekající na doplnění' }),
    el('p', { class: 'muted small', text: 'Provozní řád neobsahuje odhadnuté technické limity. Tyto údaje se doplní z dokumentace výrobce nebo z posouzení skutečného místa a teprve pak je řád platný v plném rozsahu.' }),
    el('div', { id: 'op-params', class: 'doc-list' }, [el('span', { class: 'spinner' })]),
  ]);
  root.append(params);
  loadOpParameters();
}

/** Výpis parametrů čekajících na potvrzení (bez vymyšlených hodnot). */
async function loadOpParameters() {
  const box = $('#op-params');
  if (!box) return;
  try {
    const data = await API.get('/op-parameters');
    box.innerHTML = '';
    if (!data.parameters.length) { box.append(el('p', { class: 'muted small', text: 'Žádné parametry.' })); return; }
    for (const p of data.parameters) {
      box.append(el('div', { class: 'doc-row' }, [
        ico(p.status === 'potvrzeno' ? 'check' : 'alert', 15),
        el('div', { class: 'doc-main' }, [
          el('div', { class: 'doc-title', text: p.label }),
          el('div', { class: 'doc-meta', text: p.status === 'potvrzeno'
            ? `potvrzeno: ${p.value} · zdroj: ${p.sourceNote || '—'}${p.confirmedBy ? ` · ${p.confirmedBy}` : ''}`
            : `vyžaduje potvrzení: ${p.sourceRequired}` }),
        ]),
        el('span', { class: 'doc-state ' + (p.status === 'potvrzeno' ? 'ok' : 'warn'), text: p.status === 'potvrzeno' ? 'potvrzeno' : 'čeká na doplnění' }),
      ]));
    }
    if (!data.rulesFinal) {
      box.append(el('p', { class: 'muted small', text: `Provozní řád je do doplnění ${data.pendingCount} parametrů označen jako PROZATÍMNÍ. Texty také nejsou označeny jako právně schválené — finální znění a pojistné krytí potvrzuje odpovědná osoba spolku.` }));
    }
  } catch (err) {
    box.innerHTML = '';
    box.append(el('p', { class: 'muted small', text: 'Seznam parametrů se nepodařilo načíst.' }));
  }
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
  // Historické (vyřazené) dokumenty — kvůli dohledatelnosti starších potvrzení
  try {
    const retired = (await API.get('/docs?includeRetired=1&slim=1')).docs.filter((d) => d.status === 'retired');
    if (retired.length) {
      root.append(el('div', { class: 'card soft' }, [
        el('h3', { text: 'Historické dokumenty (už se nevyžadují)' }),
        el('p', { class: 'muted small', text: 'Tato znění se v aplikaci už nepoužívají jako podmínka vstupu. Zůstávají dohledatelná proto, že s nimi dřívější účastníci potvrdili souhlas — jejich potvrzení se nemažou ani nepřepisují.' }),
        ...retired.map((d) => el('div', { class: 'doc-row' }, [
          ico('info', 15),
          el('div', { class: 'doc-main' }, [
            el('div', { class: 'doc-title', text: `${d.title} (verze ${d.version})` }),
            el('div', { class: 'doc-meta', text: d.supersededBy ? `nahrazeno dokumentem: ${d.supersededByTitle || d.supersededBy}` : (d.statusNote || '') }),
          ]),
          el('span', { class: 'doc-state warn', text: 'historický' }),
        ])),
      ]));
    }
  } catch (e) { /* offline */ }
  // offline kopie pro režim bez připojení
  if (docs.length) saveOfflineDocs(docs);
}

/* ---------- REGISTRACE ---------- */
async function viewRegister() {
  const root = $('#view');
  root.innerHTML = '';

  // Záměr z úvodu (členství × jednorázový vstup) — přepínač nahoře, jde změnit i tady
  let intent = 'clenstvi';
  try { intent = sessionStorage.getItem('tj_intent') || 'clenstvi'; } catch (e) { /* noop */ }
  let dailyIntent = intent === 'vstup';

  const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Co chcete' });
  const segOpt = (val, title, sub) => {
    const b = el('button', { type: 'button', class: 'seg-opt' + ((val === 'vstup') === dailyIntent ? ' on' : ''), role: 'radio' }, [
      el('b', { text: title }), el('small', { text: sub }),
    ]);
    b.addEventListener('click', () => {
      dailyIntent = val === 'vstup';
      try { sessionStorage.setItem('tj_intent', val); } catch (e) { /* noop */ }
      $$('.seg-opt', seg).forEach((x) => x.classList.toggle('on', x === b));
    });
    return b;
  };
  seg.append(
    segOpt('clenstvi', 'Členství TJ Krupka', '200 Kč/rok · levnější vstupy, rezervace'),
    segOpt('vstup', 'Jednorázový vstup', 'bez členství, platíš za každý vstup'),
  );

  const fld = (label, input, cls) => el('div', { class: 'fld' + (cls ? ' ' + cls : '') }, [el('label', { text: label }), input]);
  const form = el('form', { id: 'reg-form', class: 'card flow-card' }, [
    el('div', { class: 'flow-sec' }, [el('span', { class: 'flow-n', text: '1' }), el('h3', { text: 'Co chceš?' })]),
    seg,
    el('div', { class: 'flow-sec' }, [el('span', { class: 'flow-n', text: '2' }), el('h3', { text: 'Tvoje údaje' })]),
    el('div', { class: 'form-grid' }, [
      fld('Jméno', el('input', { type: 'text', name: 'firstName', required: true, autocomplete: 'given-name' })),
      fld('Příjmení', el('input', { type: 'text', name: 'lastName', required: true, autocomplete: 'family-name' })),
      fld('Datum narození', el('input', { type: 'date', name: 'birthDate', required: true, max: new Date().toISOString().slice(0, 10) })),
      fld('E-mail', el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
      fld('Ulice a číslo popisné', el('input', { type: 'text', name: 'street', required: true, autocomplete: 'street-address' }), 'full'),
      fld('Město', el('input', { type: 'text', name: 'city', required: true, autocomplete: 'address-level2' })),
      fld('PSČ', el('input', { type: 'text', name: 'zip', required: true, inputmode: 'numeric', autocomplete: 'postal-code' })),
      fld('Telefon (nepovinné)', el('input', { type: 'tel', name: 'phone', autocomplete: 'tel' })),
      fld('Pohlaví (nepovinné)', el('select', { name: 'gender' }, ['', 'muz', 'zena'].map((o) => el('option', { value: o, text: o === '' ? '—' : o === 'muz' ? 'Muž' : 'Žena' })))),
    ]),
    el('div', { id: 'age-category' }),
    el('div', { class: 'flow-sec' }, [el('span', { class: 'flow-n', text: '3' }), el('h3', { text: 'Fotka na kartu' })]),
    el('div', { class: 'photo-upload' }, [
      el('input', { type: 'file', id: 'reg-photo', name: 'photoFile', accept: 'image/*', style: 'display:none' }),
      el('div', { id: 'reg-photo-preview', class: 'photo-preview', text: 'Bez fotky', onclick: () => $('#reg-photo').click() }),
      el('div', {}, [
        el('button', { type: 'button', class: 'btn small', text: 'Vybrat fotku', onclick: () => $('#reg-photo').click() }),
        el('p', { class: 'muted small', text: 'Portrét, podle kterého tě dozor pozná. Zmenšíme ji automaticky.' }),
      ]),
    ]),
    el('div', { id: 'guardian-card', class: 'guardian-box', hidden: true }, [
      el('div', { class: 'flow-sec' }, [el('span', { class: 'flow-n', text: '4' }), el('h3', { text: 'Zákonný zástupce' })]),
      el('p', { class: 'muted small', text: 'Jsi mladší 18 let — rodiči pošleme e-mailem odkaz, kterým tvou účast potvrdí (platí 7 dní).' }),
      el('div', { class: 'form-grid' }, [
        fld('Jméno a příjmení rodiče', el('input', { type: 'text', name: 'guardianName' }), 'full'),
        fld('Vztah', el('select', { name: 'guardianRelation' }, ['matka', 'otec', 'jiný zákonný zástupce'].map((o) => el('option', { value: o, text: o })))),
        fld('E-mail rodiče', el('input', { type: 'email', name: 'guardianEmail' })),
        fld('Telefon rodiče (nepovinné)', el('input', { type: 'tel', name: 'guardianPhone' }), 'full'),
      ]),
    ]),
    el('button', { class: 'btn btn-cta btn-block', type: 'submit', text: 'Pokračovat k souhlasům →' }),
    el('p', { class: 'auth-switch' }, ['Už máš účet? ', el('a', { href: '#/prihlaseni', text: 'Přihlásit se' })]),
  ]);

  root.append(
    el('h1', { text: 'Registrace' }),
    el('p', { class: 'muted', text: 'Tři rychlé kroky: údaje, souhlasy, platba. Pak máš v mobilu QR kartu pro vstup.' }),
    regSteps(0),
    form,
  );

  const categoryBox = $('#age-category');
  const guardianCard = $('#guardian-card');
  const birthInput = $('[name="birthDate"]', form);

  // živý náhled kategorie + podmínky souhlasu rodiče
  function updateAgeCategory() {
    const age = birthInput.value ? calcAge(birthInput.value) : null;
    categoryBox.innerHTML = '';
    if (age === null) {
      // kategorie se ukáže sama po vyplnění data narození
      guardianCard.hidden = true;
      return;
    }
    const code = membershipTypeForAge(age);
    const CAT = { dite: ['Dítě (do 15 let)', 'jen s doprovodem zákonného zástupce'], mladez: ['Mládež (15–18 let)', 'se souhlasem zákonného zástupce'], dospele: ['Dospělý (18+)', 'bez dalších podmínek'] };
    const [cl, cn] = CAT[code] || CAT.dospele;
    categoryBox.append(el('div', { class: 'age-line' }, [ico('check', 15), el('span', {}, [el('b', { text: `Kategorie: ${cl}` }), ` — ${cn}`])]));
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

  // Fotografie: čtení souboru → zmenšení v prohlížeči → data-URL + preview.
  // Zmenšování (zmensiFotku) je v ui.js, protože ho používá i úprava profilu.
  let photoData = '';


  const photoInput = $('#reg-photo');
  const photoPreview = $('#reg-photo-preview');
  if (photoInput && photoPreview) {
    photoInput.addEventListener('change', async (ev) => {
      const file = (ev.target.files || [])[0];
      if (!file) return;
      if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
        toast('Vyberte obrázek (JPG/PNG/WebP)', true);
        return;
      }
      try {
        photoData = await zmensiFotku(file);
        photoPreview.style.backgroundImage = `url(${photoData})`;
        photoPreview.classList.add('has-photo');
        photoPreview.textContent = '';
      } catch (err) {
        photoData = '';
        photoPreview.style.backgroundImage = '';
        photoPreview.classList.remove('has-photo');
        toast(err.message, true);
      }
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
      // ÚČEL REGISTRACE se posílá serveru: 'vstup' nevyžaduje dokumenty členství
      // (stanovy) — členství není podmínkou vstupu pro nečleny.
      intent: dailyIntent ? 'vstup' : 'clenstvi',
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
      btn.textContent = 'Pokračovat k souhlasům →';
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
    el('label', { text: 'Heslo' }),
    el('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password', placeholder: '••••••••' }),
    el('button', { class: 'btn', type: 'submit', text: 'Přihlásit se' }),
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
    btn.textContent = 'Přihlašuji…';
    try {
      const res = await API.post('/login/password', { email: data.email, password: data.password });
      await refreshMe();
      toast('Přihlášeno');
      location.hash = '#/';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Přihlásit se';
      toast(err.message, true);
    }
  });

  card.append(form);
  card.append(el('p', { class: 'auth-switch smaller', text: 'Nemáte heslo? Už jste člen — zadejte e-mail a přes odkaz si ho nastavíte.' }));

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
      el('p', { class: 'muted', text: 'Tímto souhlasem potvrzujete, že jako zákonný zástupce souhlasíte s ÚČASTÍ výše uvedeného nezletilého (členství a/nebo jednorázový vstup) a s uvedeným dokumentem. Souhlas se ukládá s časovým údajem serveru a vaší e-mailovou identitou do auditní stopy aplikace.' }),
      el('p', { class: 'alert warn small', text: 'Souhlas neobsahuje vzdání se práva nezletilého na náhradu újmy a nic takového nepodepisujete — zákonná práva dítěte při vzniku újmy zůstávají nedotčena. Pravidla účasti potvrzuje sám nezletilý a praktickou instruktáž zaznamenává dozor na místě.' }),
      el('p', { class: 'alert info small', text: 'Tento odkaz ověřuje jen přístup k e-mailové schránce. Vazbu k dítěti ověří dozor při první účasti podle dokladu (např. rodného listu) a zaznamená ji.' }),
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
    pouceni_rizika: 'Poučení o rizicích a potvrzení pravidel účasti',
    guardian_souhlas: 'Souhlas zákonného zástupce s účastí nezletilého',
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

  // Výslovné prohlášení o zákonném zastoupení — bez něj nelze souhlas uložit.
  const declare = el('label', { class: 'check' }, [
    el('input', { type: 'checkbox', name: 'declareGuardian' }),
    el('span', {}, [
      el('span', { class: 'check-title', text: 'Prohlašuji, že jsem zákonným zástupcem uvedeného nezletilého' }),
      el('span', { class: 'check-desc', text: 'Beru na vědomí, že vazbu k dítěti ověří dozor podle dokladu při první účasti, a že tímto souhlasem se nevzdávám žádných práv nezletilého na náhradu újmy.' }),
    ]),
  ]);
  declare.addEventListener('change', () => declare.classList.toggle('checked', $('input', declare).checked));
  form.append(declare);

  root.append(el('div', { class: 'auth-wrap auth-wide' }, [form]));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data2 = readForm(form);
    const docKeys = checks.filter((c) => $('input', c).checked).map((c) => $('input', c).value);
    if (docKeys.length !== data.docs.length) { toast('Zaškrtněte souhlas se všemi dokumenty', true); return; }
    if (!$('input', declare).checked) { toast('Potvrďte prosím prohlášení, že jste zákonným zástupcem dítěte.', true); return; }
    btn.disabled = true;
    btn.textContent = 'Ukládám souhlas…';
    try {
      const res = await API.post(`/guardian/${encodeURIComponent(token)}`, {
        name: data2.name, relation: data2.relation, email: data2.email, phone: data2.phone,
        docKeys, declareGuardian: true,
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
              el('p', { text: `Souhlas zákonného zástupce s účastí ${m.firstName} ${m.lastName} byl zaznamenán (${res.recorded.length} dokument).` }),
              el('p', { class: 'small', text: 'Záznam je součástí auditní stopy (kdo, s čím, kdy a odkud). Jde o elektronický záznam v evidenci spolku — ne o vlastnoruční podpis ani o kvalifikované elektronické časové razítko.' }),
              el('p', { class: 'small', text: 'Vazba k dítěti zatím není ověřená — ověří ji dozor podle dokladu při první účasti nezletilého. Do té doby nezletilý na zařízení nevstoupí.' }),
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
  let messages = [];
  try {
    messages = (await API.get('/outbox')).messages;
  } catch (e) {
    // V produkci je reálné SMTP (Resend) → outbox je záměrně zavřený (403),
    // aby neunikal obsah e-mailů s přihlašovacími odkazy.
    root.append(el('h1', { text: 'Odeslané zprávy' }), el('p', { class: 'muted', text: 'Archiv odeslaných e-mailů a SMS.' }));
    root.append(el('div', { class: 'alert warn', text: e.message }));
    return;
  }
  root.append(el('h1', { text: 'Dev inbox — odeslané zprávy (STUB)' }), el('p', { class: 'muted', text: 'Testovací režim: e-maily ani SMS se reálně neodesílají. Zde vidíte, co by člen/rodič dostal.' }));
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
