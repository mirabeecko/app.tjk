// app.js — hash router + navigace + start aplikace.
'use strict';

/* -------------------------------------------------------------------------
 * LENIVÉ NAČÍTÁNÍ SKRIPTŮ (výkon)
 * Administrátorský a dozorový kód potřebuje jen zlomek uživatelů. Načítáme ho
 * až ve chvíli, kdy na takovou stránku uživatel skutečně jde — běžný návštěvník
 * tak nestahuje ~50 kB JS, který nikdy nepoužije.
 * ----------------------------------------------------------------------- */
const SKRIPT_ADMIN = '/js/views-admin.js?v=56';
const SKRIPT_DOZOR = '/js/views-dozor.js?v=56';
const _nactene = {};
function nactiSkript(src) {
  if (_nactene[src]) return _nactene[src];
  _nactene[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Skript se nepodařilo načíst: ' + src));
    document.body.append(s);
  });
  return _nactene[src];
}

const routes = [
  { pattern: /^#\/?$/, view: viewLanding, name: 'Úvod', icon: 'home' },
  { pattern: /^#\/registrace$/, view: viewRegister, name: 'Registrace', icon: 'edit', kicker: 'Nový účet' },
  { pattern: /^#\/prihlaseni$/, view: viewLogin, name: 'Přihlášení', icon: 'key', kicker: 'Účet' },
  { pattern: /^#\/prihlaseni\/(.+)$/, view: (m) => viewLoginToken(m[1]) },
  { pattern: /^#\/souhlasy$/, view: viewConsent, name: 'Souhlasy', icon: 'shield', kicker: 'Registrace · krok 2' },
  { pattern: /^#\/souhlas-rodice\/(.+)$/, view: (m) => viewGuardian(m[1]) },
  { pattern: /^#\/platba$/, view: viewPayment, name: 'Platba', icon: 'card', kicker: 'Vstup a členství' },
  { pattern: /^#\/platba\/(.+)$/, view: (m) => viewGateway(m[1]) },
  { pattern: /^#\/potvrzeni\/(.+)$/, view: (m) => viewReceipt(m[1]) },
  { pattern: /^#\/karta$/, view: viewCard, name: 'Členská karta', icon: 'ticket', kicker: 'Vstup na matraci' },
  // Akce spolku jsou momentálně SKRYTÉ z UI (backend a testy připravené) —
  // route se vrátí jedním řádkem: { pattern: /^#\/akce$/, view: viewEvents, name: 'Akce', icon: 'calendar' },
  { pattern: /^#\/pravidla$/, view: viewRules, name: 'Pravidla provozu', icon: 'shield', kicker: 'Bezpečnost', auth: true },
  { pattern: /^#\/profil$/, view: viewProfile, name: 'Profil', icon: 'user', kicker: 'Můj účet' },
  { pattern: /^#\/notifikace$/, view: viewNotifications, name: 'Notifikace', icon: 'bell', kicker: 'Můj účet' },
  // ---- SPRÁVA (kód se dotahuje lenivě) ----
  { pattern: /^#\/admin$/, view: () => viewAdmin(), lazy: SKRIPT_ADMIN, name: 'Správa', icon: 'dashboard', kicker: 'Správa spolku' },
  { pattern: /^#\/admin\/(.+)$/, view: (m) => viewAdminDetail(m[1]), lazy: SKRIPT_ADMIN },
  { pattern: /^#\/superadmin$/, view: () => viewSuperAdmin(), lazy: SKRIPT_ADMIN, name: 'Vlastník', icon: 'shield', kicker: 'Vlastník' },
  { pattern: /^#\/katalog-admin$/, view: () => viewAdminCatalog(), lazy: SKRIPT_ADMIN, name: 'Katalog (admin)', icon: 'bag', kicker: 'Vlastník' },
  { pattern: /^#\/outbox$/, view: () => viewOutbox(), name: 'E-maily', icon: 'mail', kicker: 'Vývoj' },
  // ---- DOZOR (role dozor / výbor / superadmin) ----
  { pattern: /^#\/dozor$/, view: () => viewDozor(), lazy: SKRIPT_DOZOR, name: 'Dozor', icon: 'qr', kicker: 'Dozor na místě', dozor: true },
  { pattern: /^#\/dozor-pozvanka\/(.+)$/, view: (m) => viewDozorPozvanka(m[1]), lazy: SKRIPT_DOZOR },
  // ---- VLASTNÍK: přehled základny + správa dozoru (pouze miroslavbrozek@gmail.com) ----
  { pattern: /^#\/zakladna$/, view: () => viewSuperAdminZakladna(), lazy: SKRIPT_DOZOR, name: 'Členská základna', icon: 'users', kicker: 'Vlastník', owner: true },
  { pattern: /^#\/superadmin-dozor$/, view: () => viewSuperAdminDozor(), lazy: SKRIPT_DOZOR, name: 'Správa dozoru', icon: 'qr', kicker: 'Vlastník', owner: true },
  { pattern: /^#\/podminky$/, view: viewDocs, name: 'Podmínky', icon: 'file', kicker: 'Dokumenty', auth: true },
  // POZOR: viewBookings žije ve views-admin.js — MUSÍ být obalené v lazy šipce,
  // jinak by se na něj router odkazoval v okamžiku sestavení a spadl by celý
  // start aplikace (ReferenceError). Rezervace proto dotahuje admin skript.
  { pattern: /^#\/rezervace$/, view: () => viewBookings(), lazy: SKRIPT_ADMIN, name: 'Rezervace', icon: 'clock', kicker: 'Termíny' },
  // Merch je momentálně SKRYTÝ — žádný merch ještě neexistuje, takže se
  // v aplikaci nesmí zobrazovat žádné produkty. Route se vrací jedním řádkem:
  // { pattern: /^#\/merch$/, view: viewMerch, name: 'Merch', icon: 'bag' },
];

async function render() {
  const hash = location.hash || '#/';
  const route = routes.find((r) => r.pattern.test(hash));
  if (!route) { location.hash = '#/'; return; }

  // načti session (pokud ještě není)
  if (!me) await refreshMe().catch(() => {});

  // Pravidla a dokumenty k odsouhlasení jsou jen pro přihlášené (zadání 2026-10-29)
  if (route.auth && !isLoggedIn()) {
    toast('Pravidla a dokumenty uvidíte po přihlášení.');
    location.hash = '#/prihlaseni';
    return;
  }
  const match = hash.match(route.pattern);
  _routeNow = route;
  { const v = $('#view'); if (v) v.className = 'view'; }
  document.body.dataset.screen = (route.name || 'jine').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  closeMenu();
  try {
    // kód správy/dozoru se dotáhne, až když je potřeba
    if (route.lazy) await nactiSkript(route.lazy);
    await route.view(match);
  } catch (err) {
    console.error('CHYBA POHLEDU:', err);
    const root = $('#view');
    root.innerHTML = '';
    root.append(
      el('h1', { text: 'Chyba' }),
      el('div', { class: 'alert err', text: err.message || String(err) }),
      el('a', { class: 'btn', href: '#/', text: 'Zpět na úvod' })
    );
  }
  renderNav();
  renderTopbar(route.name);
  decoratePage();
  window.scrollTo(0, 0);
  refreshNotifBadge().catch(() => {});
}
let notifUnread = 0;
async function refreshNotifBadge() {
  if (!isLoggedIn()) { notifUnread = 0; return; }
  try {
    notifUnread = await fetchUnreadCount();
  } catch (e) { notifUnread = 0; }
  // aktualizovat badge v DOM
  document.querySelectorAll('.notif-badge').forEach((b) => {
    b.textContent = notifUnread > 0 ? String(notifUnread) : '';
    b.style.display = notifUnread > 0 ? '' : 'none';
  });
}

function renderNav() {
  const hash = location.hash || '#/';
  const topnav = $('#topnav');
  const bottomnav = $('#bottomnav');
  const mobileMenu = $('#mobile-menu');
  const topActs = $('#top-acts');
  topnav.innerHTML = '';
  bottomnav.innerHTML = '';
  if (mobileMenu) mobileMenu.innerHTML = '';
  if (topActs) topActs.innerHTML = '';
  // Vzhled podle role: účet dozoru / výboru / superadmina má odlišné barvy
  applyRoleTheme();
  // Trvale viditelný pruh s CELÝM jménem a rolí přihlášeného profilu.
  renderIdentityBar();

  // Aktivní položka: „Přehled" (#/) se musí rozsvítit taky
  const isActive = (href) => (href === '#/' ? (hash === '#/' || hash === '') : hash.startsWith(href));
  const logged = isLoggedIn();
  document.body.classList.toggle('is-logged', logged);

  // ---- skupiny položek (design Komárka 2026) ----
  const mainItems = [
    { href: '#/', label: 'Přehled', icon: 'home' },
    { href: '#/rezervace', label: 'Rezervace', icon: 'clock' },
  ].concat(logged ? [
    { href: '#/karta', label: 'Karta', icon: 'ticket' },
    { href: '#/pravidla', label: 'Pravidla', icon: 'shield' },
    { href: '#/podminky', label: 'Provozní řád', icon: 'file' },
  ] : []);
  // práce na place a správa — v hlavičce jako rozbalovací „Správa"
  const workItems = [];
  if (logged && isDozor()) workItems.push({ href: '#/dozor', label: 'Dozor — kontrola QR', icon: 'qr', highlight: 'dozor' });
  if (logged && isStaff()) workItems.push({ href: '#/admin', label: 'Správa členů', icon: 'dashboard' });
  const ownerItems = (logged && isSuperAdmin()) ? [
    { href: '#/zakladna', label: 'Členská základna', icon: 'users', highlight: 'owner' },
    { href: '#/superadmin-dozor', label: 'Správa dozoru', icon: 'qr', highlight: 'owner' },
    { href: '#/superadmin', label: 'Vlastník', icon: 'shield', highlight: 'owner' },
    { href: '#/katalog-admin', label: 'Katalog', icon: 'bag', highlight: 'owner' },
  ] : [];
  const accountItems = logged ? [
    { href: '#/profil', label: 'Můj profil', icon: 'user' },
    { href: '#/notifikace', label: 'Notifikace', icon: 'bell' },
    { href: '#/outbox', label: 'E-maily (dev)', icon: 'mail' },
  ] : [
    { href: '#/prihlaseni', label: 'Přihlásit se', icon: 'key' },
    { href: '#/registrace', label: 'Registrace', icon: 'edit' },
  ];

  // ---- HLAVIČKA (desktop): vodorovné „pilulky" + rozbalovací Správa ----
  for (const it of mainItems) {
    topnav.append(el('a', { class: 'nav-a' + (isActive(it.href) ? ' on' : ''), href: it.href, text: it.label }));
  }
  if (workItems.length || ownerItems.length) {
    const all = workItems.concat(ownerItems);
    const drop = el('details', { class: 'nav-drop' + (all.some((i) => isActive(i.href)) ? ' on' : '') });
    const panel = el('div', { class: 'drop-panel' });
    const addGroup = (title, items) => {
      if (!items.length) return;
      panel.append(el('div', { class: 'drop-title', text: title }));
      for (const it of items) {
        panel.append(el('a', {
          class: 'drop-item' + (isActive(it.href) ? ' on' : '') + (it.highlight ? ` hl-${it.highlight}` : ''),
          href: it.href,
        }, [el('span', { class: 'drop-ico' }, [ico(it.icon, 16)]), el('span', { text: it.label })]));
      }
    };
    addGroup('Provoz', workItems);
    addGroup('Vlastník', ownerItems);
    drop.append(el('summary', { class: 'nav-a' }, [
      el('span', { text: isSuperAdmin() ? 'Vlastník' : 'Správa' }), ico('chevron', 14),
    ]), panel);
    topnav.append(drop);
  }

  // ---- pravá strana hlavičky: notifikace + hlavní akce ----
  if (topActs) {
    if (logged) {
      topActs.append(
        el('a', { class: 'icon-btn', href: '#/notifikace', 'aria-label': 'Notifikace', title: 'Notifikace' }, [
          ico('bell', 18), el('span', { class: 'notif-badge', style: 'display:none' }),
        ]),
        el('a', { class: 'btn primary sm top-cta', href: '#/platba' }, [ico('ticket', 16), el('span', { text: 'Koupit vstup' })]),
      );
    } else {
      topActs.append(
        el('a', { class: 'btn sm top-ghost', href: '#/prihlaseni' }, [ico('key', 16), el('span', { text: 'Přihlásit' })]),
        el('a', { class: 'btn primary sm top-cta', href: '#/registrace' }, [ico('edit', 16), el('span', { text: 'Registrace' })]),
      );
    }
  }

  // ---- panel „Více" (mobil): profil nahoře + všechny sekce ----
  if (mobileMenu) {
    if (logged) {
      mobileMenu.append(el('a', { class: 'mm-profile', href: '#/profil', onclick: () => closeMenu() }, [
        el('span', { class: 'mm-ava', text: memberFullName(me.member).split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() }),
        el('span', { class: 'mm-ptxt' }, [
          el('strong', { text: memberFullName(me.member) }),
          el('span', { text: `${roleLabel(me.member.role)} · ${me.member.email || ''}` }),
        ]),
        ico('arrow', 16),
      ]));
    }
    const sections = [
      { title: 'Aplikace', items: mainItems },
      { title: 'Provoz', items: workItems },
      { title: 'Vlastník', items: ownerItems },
      { title: 'Účet', items: accountItems },
    ];
    for (const sec of sections) {
      if (!sec.items.length) continue;
      mobileMenu.append(el('div', { class: 'mm-section', text: sec.title }));
      const grid = el('div', { class: 'mm-grid' });
      for (const it of sec.items) {
        const a = el('a', {
          href: it.href,
          class: 'mm-item' + (isActive(it.href) ? ' active' : '') + (it.highlight ? ` hl-${it.highlight}` : ''),
        }, [
          el('span', { class: 'mm-icon' }, [ico(it.icon, 18)]),
          el('span', { class: 'mm-label', text: it.label }),
          it.href === '#/notifikace' ? el('span', { class: 'notif-badge', style: 'display:none' }) : null,
        ]);
        a.addEventListener('click', () => closeMenu());
        grid.append(a);
      }
      mobileMenu.append(grid);
    }
  }

  // ---- SPODNÍ LIŠTA (mobil): 2 + velké tlačítko uprostřed + 2 ----
  const tab = (it) => el('a', { href: it.href, class: 'tab' + (isActive(it.href) ? ' active' : '') }, [
    el('span', { class: 'ico' }, [ico(it.icon)]),
    el('span', { class: 'tab-l', text: it.label }),
  ]);
  bottomnav.append(tab({ href: '#/', label: 'Přehled', icon: 'home' }));
  bottomnav.append(tab({ href: '#/rezervace', label: 'Rezervace', icon: 'clock' }));
  const fab = logged
    ? { href: '#/karta', label: 'Karta', icon: 'qr' }
    : { href: '#/registrace', label: 'Registrace', icon: 'edit' };
  bottomnav.append(el('a', { href: fab.href, class: 'tab tab-fab' + (isActive(fab.href) ? ' active' : '') }, [
    el('span', { class: 'fab' }, [ico(fab.icon, 24)]),
    el('span', { class: 'tab-l', text: fab.label }),
  ]));
  if (logged && isDozor()) bottomnav.append(tab({ href: '#/dozor', label: 'Dozor', icon: 'qr' }));
  else if (logged && isStaff()) bottomnav.append(tab({ href: '#/admin', label: 'Správa', icon: 'dashboard' }));
  else if (logged) bottomnav.append(tab({ href: '#/profil', label: 'Profil', icon: 'user' }));
  else bottomnav.append(tab({ href: '#/prihlaseni', label: 'Přihlásit', icon: 'key' }));
  const moreTab = el('button', { type: 'button', class: 'tab bn-more', 'aria-label': 'Další nabídka', 'aria-controls': 'mobile-menu' }, [
    el('span', { class: 'ico' }, [ico('menu')]),
    el('span', { class: 'tab-l', text: 'Více' }),
  ]);
  moreTab.addEventListener('click', (ev) => {
    ev.stopPropagation();           // jinak by ho hned zavřel posluchač „klik mimo menu"
    const more = $('#more-btn');
    if (more) more.click();
    moreTab.classList.toggle('active', $('#mobile-menu').classList.contains('open'));
  });
  bottomnav.append(moreTab);
  bottomnav.hidden = false;
}

/* ---------- HLAVIČKY STRÁNEK (design Komárka) ----------
   Každý pohled začíná prostým <h1>. Tady z něj uděláme hlavičku ve stylu webu
   Airbag Komárka: malý „kicker" s ikonou + velký nadpis s posledním slovem
   ve značkové barvě + podtitulek. Běží přes MutationObserver, takže funguje
   i u pohledů, které se překreslují samy (bez routeru). */
let _routeNow = null;
function decoratePage() {
  const root = $('#view');
  if (!root) return;
  const h1 = root.querySelector(':scope > h1');
  if (!h1 || h1.dataset.dec) return;
  h1.dataset.dec = '1';
  const r = _routeNow || {};
  const head = el('div', { class: 'page-head' });
  head.append(el('span', { class: 'kicker' }, [ico(r.icon || 'home', 14), el('span', { text: r.kicker || 'Členská aplikace' })]));
  // poslední slovo nadpisu do <em> (barva role / limetka)
  const textNodes = [...h1.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
  const last = textNodes[textNodes.length - 1];
  if (last) {
    const s = last.textContent.replace(/\s+$/, '');
    const i = s.lastIndexOf(' ');
    if (i > 0) {
      const em = document.createElement('em');
      em.textContent = s.slice(i + 1);
      last.textContent = s.slice(0, i + 1);
      last.after(em);
    } else if (textNodes.length === 1 && !h1.querySelector('*')) {
      h1.innerHTML = '';
      const em = document.createElement('em');
      em.textContent = s;
      h1.append(em);
    }
  }
  h1.before(head);
  head.append(h1);
  const next = head.nextElementSibling;
  if (next && next.tagName === 'P' && (next.classList.contains('muted') || next.classList.contains('lead'))) {
    next.classList.add('sub');
    head.append(next);
  }
}
(function watchView() {
  const start = () => {
    const root = $('#view');
    if (!root) return;
    let raf = 0;
    new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; decoratePage(); });
    }).observe(root, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // tenká barevná linka nahoře = průběh scrollu (jako na webu)
  window.addEventListener('scroll', () => {
    const pr = $('#prog');
    if (!pr) return;
    const h = document.documentElement.scrollHeight - innerHeight;
    pr.style.width = (h > 0 ? Math.min(100, (scrollY / h) * 100) : 0) + '%';
  }, { passive: true });
  // rozbalovací „Správa" v hlavičce: zavřít klikem mimo
  document.addEventListener('click', (ev) => {
    document.querySelectorAll('.nav-drop[open]').forEach((d) => { if (!d.contains(ev.target)) d.removeAttribute('open'); });
  });
})();

/* ---------- hamburger / „více" menu ---------- */
function closeMenu() {
  const menu = $('#mobile-menu');
  const btn = $('#menu-btn');
  const more = $('#more-btn');
  if (!menu) return;
  menu.classList.remove('open');
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  [btn, more].forEach((b) => {
    if (b) {
      b.classList.remove('active');
      b.setAttribute('aria-expanded', 'false');
    }
  });
}

function setupMenu() {
  const menu = $('#mobile-menu');
  const btn = $('#menu-btn');
  const more = $('#more-btn');
  if (!menu) return;
  const toggle = (ev, button) => {
    ev.stopPropagation();
    const open = menu.classList.toggle('open');
    menu.hidden = !open;
    // Na mobilu schováme spodní dock, dokud je menu otevřené (jinak ho překrývá)
    document.body.classList.toggle('menu-open', open);
    [btn, more].forEach((b) => {
      if (b && b !== button) b.classList.remove('active');
    });
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
  };
  if (btn) btn.addEventListener('click', (ev) => toggle(ev, btn));
  if (more) more.addEventListener('click', (ev) => toggle(ev, more));
  // zavření kliknutím mimo menu
  document.addEventListener('click', (ev) => {
    if (menu.classList.contains('open') && !menu.contains(ev.target) && !(btn && btn.contains(ev.target)) && !(more && more.contains(ev.target))) {
      closeMenu();
    }
  });
  // zavření klávesou Escape
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeMenu();
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', async () => {
  // /me a /facilities běží SOUBĚŽNĚ (dřív na sebe čekaly v sérii).
  const mePromise = refreshMe().catch(() => {});
  loadFacilities().catch(() => {});
  setupMenu();
  await mePromise;
  render();
});
