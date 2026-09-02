// app.js — hash router + navigace + start aplikace.
'use strict';

const routes = [
  { pattern: /^#\/?$/, view: viewLanding, name: 'Úvod', icon: 'home' },
  { pattern: /^#\/registrace$/, view: viewRegister, name: 'Registrace', icon: 'edit' },
  { pattern: /^#\/prihlaseni$/, view: viewLogin, name: 'Přihlášení', icon: 'key' },
  { pattern: /^#\/prihlaseni\/(.+)$/, view: (m) => viewLoginToken(m[1]) },
  { pattern: /^#\/souhlasy$/, view: viewConsent, name: 'Souhlasy', icon: 'shield' },
  { pattern: /^#\/souhlas-rodice\/(.+)$/, view: (m) => viewGuardian(m[1]) },
  { pattern: /^#\/platba$/, view: viewPayment, name: 'Platba', icon: 'card' },
  { pattern: /^#\/platba\/(.+)$/, view: (m) => viewGateway(m[1]) },
  { pattern: /^#\/potvrzeni\/(.+)$/, view: (m) => viewReceipt(m[1]) },
  { pattern: /^#\/karta$/, view: viewCard, name: 'Členská karta', icon: 'ticket' },
  // Akce spolku jsou momentálně SKRYTÉ z UI (backend a testy připravené) —
  // route se vrátí jedním řádkem: { pattern: /^#\/akce$/, view: viewEvents, name: 'Akce', icon: 'calendar' },
  { pattern: /^#\/pravidla$/, view: viewRules, name: 'Pravidla provozu', icon: 'shield' },
  { pattern: /^#\/profil$/, view: viewProfile, name: 'Profil', icon: 'user' },
  { pattern: /^#\/admin$/, view: viewAdmin, name: 'Správa', icon: 'dashboard' },
  { pattern: /^#\/admin\/(.+)$/, view: (m) => viewAdminDetail(m[1]) },
  { pattern: /^#\/superadmin$/, view: viewSuperAdmin, name: 'Vlastník', icon: 'shield' },
  { pattern: /^#\/katalog-admin$/, view: viewAdminCatalog, name: 'Katalog (admin)', icon: 'bag' },
  { pattern: /^#\/outbox$/, view: viewOutbox, name: 'E-maily', icon: 'mail' },
  { pattern: /^#\/podminky$/, view: viewDocs, name: 'Podmínky', icon: 'file' },
  { pattern: /^#\/rezervace$/, view: viewBookings, name: 'Rezervace', icon: 'clock' },
  { pattern: /^#\/merch$/, view: viewMerch, name: 'Merch', icon: 'bag' },
];

async function render() {
  const hash = location.hash || '#/';
  const route = routes.find((r) => r.pattern.test(hash));
  if (!route) { location.hash = '#/'; return; }

  // načti session (pokud ještě není)
  if (!me) await refreshMe().catch(() => {});

  const match = hash.match(route.pattern);
  try {
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
}

function renderNav() {
  const hash = location.hash || '#/';
  const topnav = $('#topnav');
  const bottomnav = $('#bottomnav');
  const mobileMenu = $('#mobile-menu');
  topnav.innerHTML = '';
  bottomnav.innerHTML = '';
  if (mobileMenu) mobileMenu.innerHTML = '';

  const isActive = (href) => hash.startsWith(href) && href !== '#/';

  // hlavní položky (viditelné v top navu na desktopu)
  const mainItems = [
    { href: '#/', label: 'Úvod', icon: 'home' },
    { href: '#/rezervace', label: 'Rezervace', icon: 'clock' },
  ];

  // sekundární položky (do „více" menu / sekcí)
  const moreItems = [
    { href: '#/karta', label: 'Členská karta', icon: 'ticket' },
    { href: '#/merch', label: 'Merch', icon: 'bag' },
    { href: '#/pravidla', label: 'Pravidla provozu', icon: 'shield' },
    { href: '#/podminky', label: 'Provozní řád', icon: 'file' },
  ];
  if (isLoggedIn() && isStaff()) moreItems.push({ href: '#/admin', label: 'Správa', icon: 'dashboard' });
  if (isLoggedIn() && isSuperAdmin()) moreItems.push({ href: '#/superadmin', label: 'Vlastník', icon: 'shield' });
  if (isLoggedIn() && isSuperAdmin()) moreItems.push({ href: '#/katalog-admin', label: 'Katalog (admin)', icon: 'bag' });
  // Dev inbox (outbox) je chráněn přihlášením — nabídka jen pro přihlášené
  if (isLoggedIn()) moreItems.push({ href: '#/outbox', label: 'E-maily (dev)', icon: 'mail' });

  // top nav (desktop): hlavní položky + CTA
  for (const it of mainItems) {
    topnav.append(el('a', { class: 'nav-btn' + (isActive(it.href) ? ' active' : ''), href: it.href, text: it.label }));
  }
  if (isLoggedIn()) {
    topnav.append(el('a', { class: 'nav-btn cta', href: '#/profil' }, [ico('user', 15), ' ', me.member.firstName]));
  } else {
    topnav.append(el('a', { class: 'nav-btn ghost-cta', href: '#/prihlaseni' }, [ico('key', 15), ' ', 'Přihlásit se']));
    topnav.append(el('a', { class: 'nav-btn cta', href: '#/registrace' }, [ico('edit', 15), ' ', 'Registrace']));
  }

  // mobilní / „více" menu (sekce)
  if (mobileMenu) {
    const sections = [
      { title: 'Hlavní', items: mainItems.concat([{ href: '#/karta', label: 'Členská karta', icon: 'ticket' }, { href: '#/merch', label: 'Merch', icon: 'bag' }]) },
      { title: 'Informace', items: [{ href: '#/pravidla', label: 'Pravidla provozu', icon: 'shield' }, { href: '#/podminky', label: 'Provozní řád', icon: 'file' }] },
      {
        title: 'Účet',
        items: isLoggedIn()
          ? [{ href: '#/profil', label: `Můj profil — ${me.member.firstName}`, icon: 'user' }]
              .concat(isStaff() ? [{ href: '#/admin', label: 'Správa', icon: 'dashboard' }] : [])
              .concat(isSuperAdmin() ? [{ href: '#/superadmin', label: 'Vlastník', icon: 'shield' }] : [])
              .concat([{ href: '#/outbox', label: 'E-maily (dev)', icon: 'mail' }])
          : [{ href: '#/prihlaseni', label: 'Přihlásit se', icon: 'key' }, { href: '#/registrace', label: 'Registrace', icon: 'edit' }],
      },
    ];
    for (const sec of sections) {
      const h = el('div', { class: 'mm-section', text: sec.title });
      mobileMenu.append(h);
      for (const it of sec.items) {
        const a = el('a', { href: it.href, class: 'mm-item' + (isActive(it.href) ? ' active' : '') }, [
          el('span', { class: 'mm-icon' }, [ico(it.icon, 18)]),
          el('span', { text: it.label }),
        ]);
        a.addEventListener('click', () => closeMenu());
        mobileMenu.append(a);
      }
    }
  }

  // bottom nav (mobile)
  const mobileItems = [
    { href: '#/', label: 'Úvod', icon: 'home' },
    { href: '#/karta', label: 'Karta', icon: 'ticket' },
    { href: '#/rezervace', label: 'Rezervace', icon: 'clock' },
    isLoggedIn()
      ? { href: '#/profil', label: 'Profil', icon: 'user' }
      : { href: '#/prihlaseni', label: 'Přihlásit', icon: 'key' },
  ];
  if (isLoggedIn() && isStaff()) mobileItems.splice(4, 0, { href: '#/admin', label: 'Správa', icon: 'dashboard' });
  if (isLoggedIn() && isSuperAdmin()) mobileItems.splice(4, 0, { href: '#/superadmin', label: 'Vlastník', icon: 'shield' });

  for (const it of mobileItems) {
    bottomnav.append(el('a', { href: it.href, class: isActive(it.href) ? 'active' : '' }, [
      el('span', { class: 'ico' }, [ico(it.icon)]),
      el('span', { text: it.label }),
    ]));
  }
  bottomnav.hidden = false;
}

/* ---------- hamburger / „více" menu ---------- */
function closeMenu() {
  const menu = $('#mobile-menu');
  const btn = $('#menu-btn');
  const more = $('#more-btn');
  if (!menu) return;
  menu.classList.remove('open');
  menu.hidden = true;
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
  await refreshMe().catch(() => {});
  setupMenu();
  render();
});
