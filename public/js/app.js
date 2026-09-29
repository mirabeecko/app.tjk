// app.js — hash router + navigace + start aplikace.
'use strict';

/* -------------------------------------------------------------------------
 * LENIVÉ NAČÍTÁNÍ SKRIPTŮ (výkon)
 * Administrátorský a dozorový kód potřebuje jen zlomek uživatelů. Načítáme ho
 * až ve chvíli, kdy na takovou stránku uživatel skutečně jde — běžný návštěvník
 * tak nestahuje ~50 kB JS, který nikdy nepoužije.
 * ----------------------------------------------------------------------- */
const SKRIPT_ADMIN = '/js/views-admin.js?v=41';
const SKRIPT_DOZOR = '/js/views-dozor.js?v=41';
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
  { pattern: /^#\/notifikace$/, view: viewNotifications, name: 'Notifikace', icon: 'bell' },
  // ---- SPRÁVA (kód se dotahuje lenivě) ----
  { pattern: /^#\/admin$/, view: () => viewAdmin(), lazy: SKRIPT_ADMIN, name: 'Správa', icon: 'dashboard' },
  { pattern: /^#\/admin\/(.+)$/, view: (m) => viewAdminDetail(m[1]), lazy: SKRIPT_ADMIN },
  { pattern: /^#\/superadmin$/, view: () => viewSuperAdmin(), lazy: SKRIPT_ADMIN, name: 'Vlastník', icon: 'shield' },
  { pattern: /^#\/katalog-admin$/, view: () => viewAdminCatalog(), lazy: SKRIPT_ADMIN, name: 'Katalog (admin)', icon: 'bag' },
  { pattern: /^#\/outbox$/, view: () => viewOutbox(), name: 'E-maily', icon: 'mail' },
  // ---- DOZOR (role dozor / výbor / superadmin) ----
  { pattern: /^#\/dozor$/, view: () => viewDozor(), lazy: SKRIPT_DOZOR, name: 'Dozor', icon: 'qr', dozor: true },
  { pattern: /^#\/dozor-pozvanka\/(.+)$/, view: (m) => viewDozorPozvanka(m[1]), lazy: SKRIPT_DOZOR },
  // ---- VLASTNÍK: přehled základny + správa dozoru (pouze miroslavbrozek@gmail.com) ----
  { pattern: /^#\/zakladna$/, view: () => viewSuperAdminZakladna(), lazy: SKRIPT_DOZOR, name: 'Členská základna', icon: 'users', owner: true },
  { pattern: /^#\/superadmin-dozor$/, view: () => viewSuperAdminDozor(), lazy: SKRIPT_DOZOR, name: 'Správa dozoru', icon: 'qr', owner: true },
  { pattern: /^#\/podminky$/, view: viewDocs, name: 'Podmínky', icon: 'file' },
  // POZOR: viewBookings žije ve views-admin.js — MUSÍ být obalené v lazy šipce,
  // jinak by se na něj router odkazoval v okamžiku sestavení a spadl by celý
  // start aplikace (ReferenceError). Rezervace proto dotahuje admin skript.
  { pattern: /^#\/rezervace$/, view: () => viewBookings(), lazy: SKRIPT_ADMIN, name: 'Rezervace', icon: 'clock' },
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

  const match = hash.match(route.pattern);
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
  topnav.innerHTML = '';
  bottomnav.innerHTML = '';
  if (mobileMenu) mobileMenu.innerHTML = '';
  // Vzhled podle role: účet dozoru má odlišné barvy (na první pohled poznat)
  applyRoleTheme();
  // Trvale viditelný pruh s CELÝM jménem a rolí přihlášeného profilu.
  // Volá se při každém překreslení (tj. na každé obrazovce i po přihlášení).
  renderIdentityBar();

  const isActive = (href) => hash.startsWith(href) && href !== '#/';

  // hlavní položky (viditelné v top navu na desktopu)
  const mainItems = [
    { href: '#/', label: 'Úvod', icon: 'home' },
    { href: '#/rezervace', label: 'Rezervace', icon: 'clock' },
  ];

  // sekundární položky (do „více" menu / sekcí)
  const moreItems = [];
  // ZVÝRAZNĚNÁ položka pro účet s právy dozoru — musí být na první pohled vidět
  if (isLoggedIn() && isDozor()) {
    moreItems.push({ href: '#/dozor', label: 'Dozor — kontrola QR', icon: 'qr', highlight: 'dozor' });
  }
  moreItems.push(
    { href: '#/karta', label: 'Členská karta', icon: 'ticket' },
    { href: '#/pravidla', label: 'Pravidla provozu', icon: 'shield' },
    { href: '#/podminky', label: 'Provozní řád', icon: 'file' },
  );
  if (isLoggedIn() && isStaff()) moreItems.push({ href: '#/admin', label: 'Správa', icon: 'dashboard' });
  // Vlastník: okamžitý přehled členské základny + správa účtů dozoru
  if (isLoggedIn() && isSuperAdmin()) {
    moreItems.push({ href: '#/zakladna', label: 'Členská základna', icon: 'users', highlight: 'owner' });
    moreItems.push({ href: '#/superadmin-dozor', label: 'Správa dozoru', icon: 'qr', highlight: 'owner' });
  }
  if (isLoggedIn() && isSuperAdmin()) moreItems.push({ href: '#/superadmin', label: 'Vlastník', icon: 'shield' });
  if (isLoggedIn() && isSuperAdmin()) moreItems.push({ href: '#/katalog-admin', label: 'Katalog (admin)', icon: 'bag' });
  // Notifikace (schválení/neschválení členství) — badge s počtem nepřečtených
  if (isLoggedIn()) moreItems.push({ href: '#/notifikace', label: 'Notifikace', icon: 'bell', badge: true });
  // Dev inbox (outbox) je chráněn přihlášením — nabídka jen pro přihlášené
  if (isLoggedIn()) moreItems.push({ href: '#/outbox', label: 'E-maily (dev)', icon: 'mail' });

  // top nav (desktop): hlavní položky + CTA
  for (const it of mainItems) {
    topnav.append(el('a', { class: 'nav-btn' + (isActive(it.href) ? ' active' : ''), href: it.href, text: it.label }));
  }
  if (isLoggedIn()) {
    // Chip s profilem: CELÉ jméno + zkratka role (křestní jméno nestačí)
    topnav.append(el('a', {
      class: 'nav-btn cta nav-me',
      href: '#/profil',
      title: `Přihlášený profil: ${memberFullName(me.member)} — ${roleLabel(me.member.role)} (${me.member.email || ''})`,
    }, [
      ico('user', 15),
      el('span', { class: 'nav-me-name', text: memberFullName(me.member) }),
      el('span', { class: 'nav-me-role', text: roleShort(me.member.role) }),
    ]));
  } else {
    topnav.append(el('a', { class: 'nav-btn ghost-cta', href: '#/prihlaseni' }, [ico('key', 15), ' ', 'Přihlásit se']));
    topnav.append(el('a', { class: 'nav-btn cta', href: '#/registrace' }, [ico('edit', 15), ' ', 'Registrace']));
  }

  // mobilní / „více" menu (sekce)
  if (mobileMenu) {
    const sections = [
      { title: 'Hlavní', items: mainItems.concat([{ href: '#/karta', label: 'Členská karta', icon: 'ticket' }]) },
      { title: 'Informace', items: [{ href: '#/pravidla', label: 'Pravidla provozu', icon: 'shield' }, { href: '#/podminky', label: 'Provozní řád', icon: 'file' }] },
      {
        title: 'Účet',
        items: isLoggedIn()
          ? [{ href: '#/profil', label: `Přihlášený profil: ${memberFullName(me.member)} — ${roleLabel(me.member.role)}`, icon: 'user', highlight: me.member.role === 'superadmin' ? 'owner' : (isDozor() ? 'dozor' : null) }]
              .concat(isDozor() ? [{ href: '#/dozor', label: 'Dozor — kontrola QR', icon: 'qr', highlight: 'dozor' }] : [])
              .concat(isStaff() ? [{ href: '#/admin', label: 'Správa', icon: 'dashboard' }] : [])
              .concat(isSuperAdmin() ? [{ href: '#/zakladna', label: 'Členská základna', icon: 'users', highlight: 'owner' }] : [])
              .concat(isSuperAdmin() ? [{ href: '#/superadmin-dozor', label: 'Správa dozoru', icon: 'qr', highlight: 'owner' }] : [])
              .concat(isSuperAdmin() ? [{ href: '#/superadmin', label: 'Vlastník', icon: 'shield' }] : [])
              .concat([{ href: '#/notifikace', label: 'Notifikace', icon: 'bell' }])
              .concat([{ href: '#/outbox', label: 'E-maily (dev)', icon: 'mail' }])
          : [{ href: '#/prihlaseni', label: 'Přihlásit se', icon: 'key' }, { href: '#/registrace', label: 'Registrace', icon: 'edit' }],
      },
    ];
    for (const sec of sections) {
      const h = el('div', { class: 'mm-section', text: sec.title });
      mobileMenu.append(h);
      for (const it of sec.items) {
        const a = el('a', {
          href: it.href,
          class: 'mm-item' + (isActive(it.href) ? ' active' : '') + (it.highlight ? ` hl-${it.highlight}` : ''),
        }, [
          el('span', { class: 'mm-icon' }, [ico(it.icon, 18)]),
          el('span', { text: it.label }),
          it.href === '#/notifikace' ? el('span', { class: 'notif-badge', style: 'display:none' }) : null,
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
  if (isLoggedIn() && isDozor()) bottomnav.append(el('a', { href: '#/dozor', class: 'dozor-nav' + (isActive('#/dozor') ? ' active' : '') }, [
    el('span', { class: 'ico' }, [ico('qr')]),
    el('span', { text: 'Dozor' }),
  ]));
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
  await refreshMe().catch(() => {});
  setupMenu();
  render();
});
