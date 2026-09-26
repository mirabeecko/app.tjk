// views-dozor.js — POHLEDY DOZORU a SUPERADMINA (2026-09-27)
//
//   viewDozor()               — pracovní stránka dozoru (načtení QR → kompletní
//                               informace o členovi/nečlenovi + evidence vstupů).
//                               Účet dozoru má v UI odlišné barvy (role-dozor).
//   viewDozorPozvanka(token)  — veřejná stránka pro vytvoření účtu dozoru
//                               z pozvánky, kterou poslal vlastník e-mailem.
//   viewSuperAdminZakladna()  — vlastníkův okamžitý přehled členské základny.
//   viewSuperAdminDozor()     — správa účtů dozoru (pozvánky, rozšíření, odebrání).
'use strict';

/* =========================================================================
 * POMOCNÉ
 * ========================================================================= */

/** Datum + čas v českém tvaru (např. 27. 9. 2026 14:35). */
function czDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function czDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** „před 3 dny" — čitelné pro dozora. */
function relativeCz(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'právě teď';
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'včera';
  if (d < 30) return `před ${d} dny`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? 'před měsícem' : `před ${mo} měsíci`;
}

function statTile(label, value, sub, iconName) {
  return el('div', { class: 'stat-tile' }, [
    el('div', { class: 'st-top' }, [
      el('span', { class: 'st-ico' }, [ico(iconName || 'chart', 18)]),
      el('span', { class: 'st-label', text: label }),
    ]),
    el('div', { class: 'st-value', text: String(value) }),
    sub ? el('div', { class: 'st-sub', text: sub }) : null,
  ]);
}

/* =========================================================================
 * DOZOR — načtení QR a zobrazení informací
 * ========================================================================= */

let dozorLastCard = null;
let dozorCamera = null;

async function openCard(payload, { record = true } = {}) {
  const box = $('#dozor-result');
  if (!box) return;
  box.innerHTML = '';
  box.append(el('div', { class: 'loading-row' }, [el('span', { class: 'spinner' }), ' Načítám údaje…']));
  try {
    const res = await API.post('/dozor/lookup', { qrPayload: payload, record });
    renderCard(res.card, res.entryId);
  } catch (err) {
    box.innerHTML = '';
    box.append(el('div', { class: 'dozor-card denied' }, [
      el('div', { class: 'dc-head' }, [ico('x', 26), el('div', {}, [
        el('div', { class: 'dc-title', text: 'Vstup zamítnut' }),
        el('div', { class: 'dc-sub', text: (err && err.message) || 'QR kód nebyl rozpoznán.' }),
      ])]),
      el('div', { class: 'dc-body' }, [
        el('p', { text: 'Karta nebyla nalezena. Zkontrolujte, že jde o QR kód z členské aplikace TJ Krupka.' }),
      ]),
    ]));
  }
}

function renderCard(c, entryId) {
  if (!c) return;
  dozorLastCard = c;
  const box = $('#dozor-result');
  box.innerHTML = '';

  const allowed = c.access.allowed;
  const blocked = c.identity.blocked;

  // ---- hlavička: velký jasný verdikt ----
  const head = el('div', { class: 'dozor-card ' + (blocked ? 'blocked' : allowed ? 'allowed' : 'denied') }, [
    el('div', { class: 'dc-head' }, [
      ico(blocked ? 'ban' : allowed ? 'check' : 'x', 30),
      el('div', { class: 'dc-head-txt' }, [
        el('div', { class: 'dc-title', text: blocked ? 'ÚČET POZASTAVEN' : allowed ? 'VSTUP POVOLEN' : 'VSTUP ZAMÍTNUT' }),
        el('div', { class: 'dc-sub', text: c.access.message }),
      ]),
    ]),
  ]);

  // ---- identita + fotka ----
  const photoBox = el('div', { class: 'dc-photo' }, c.photo
    ? [el('img', { src: c.photo.url, alt: 'Fotografie člena', loading: 'lazy' }),
       c.photo.verified ? el('span', { class: 'photo-ok', text: '✓ ověřená' }) : el('span', { class: 'photo-warn', text: 'neověřená' })]
    : [el('div', { class: 'photo-none' }, [ico('user', 34), el('div', { text: 'bez fotografie' })])]);

  const identRows = [
    ['Jméno', c.identity.fullName + (c.identity.minor ? ` (${c.identity.age} let)` : '')],
    ['Členské číslo', c.identity.memberNo ? String(c.identity.memberNo) : '— (nečlen)'],
    ['E-mail', c.identity.email || '—'],
    ['Telefon', c.identity.phone || '—'],
    ['Typ účtu', c.identity.roleLabel],
  ];
  const ident = el('div', { class: 'dc-ident' }, [
    photoBox,
    el('div', { class: 'dc-fields' }, identRows.map(([k, v]) =>
      el('div', { class: 'dc-field' }, [
        el('span', { class: 'dc-k', text: k }),
        el('span', { class: 'dc-v', text: v }),
      ]))),
  ]);
  head.append(ident);

  // ---- členství ----
  const m = c.membership;
  const membership = el('div', { class: 'dc-section' }, [
    el('h3', {}, [ico('card', 18), ' Členství']),
    el('div', { class: 'dc-grid' }, [
      fieldBox('Stav', m.statusLabel, m.active ? 'ok' : 'warn'),
      fieldBox('Typ členství', m.kindLabel, m.kind === 'radne' ? 'ok' : ''),
      fieldBox('Platné od', m.validFrom ? czDate(m.validFrom) : '—'),
      fieldBox('Platné do', m.validUntil ? czDate(m.validUntil) : '—',
        m.daysLeft !== null && m.daysLeft !== undefined && m.daysLeft < 0 ? 'bad' : m.daysLeft !== null && m.daysLeft <= 14 ? 'warn' : ''),
      fieldBox('Zbývá', m.daysLeft === null || m.daysLeft === undefined ? '—' : `${m.daysLeft} dní`,
        m.daysLeft !== null && m.daysLeft <= 0 ? 'bad' : m.daysLeft !== null && m.daysLeft <= 14 ? 'warn' : 'ok'),
      fieldBox('Poslední platba', m.lastPaidAt ? czDate(m.lastPaidAt) : 'nikdy', m.paid ? 'ok' : 'bad'),
    ]),
    el('div', { class: 'dc-note' }, [
      ico('info', 15),
      el('span', { text: `Zapsáno v ${m.recorded.source}` +
        (m.recorded.setBy ? ` · zapsal ${m.recorded.setBy}` : ' · automaticky při registraci') +
        (m.recorded.setAt ? ` · ${czDate(m.recorded.setAt)}` : '') }),
    ]),
  ]);

  // ---- zákonný zástupce (u nezletilých) ----
  let guardian = null;
  if (c.guardian) {
    guardian = el('div', { class: 'dc-section' }, [
      el('h3', {}, [ico('baby', 18), ' Zákonný zástupce']),
      el('div', { class: 'dc-grid' }, [
        fieldBox('Jméno', c.guardian.name || '—'),
        fieldBox('Vztah', c.guardian.relation || '—'),
        fieldBox('Souhlas', ({ granted: 'udělen', pending: 'čeká', rejected: 'odmítnut', not_required: 'nevyžadován' })[c.guardian.consentStatus] || c.guardian.consentStatus,
          c.guardian.consentStatus === 'granted' ? 'ok' : 'warn'),
        fieldBox('Udělen', c.guardian.grantedAt ? czDate(c.guardian.grantedAt) : '—'),
      ]),
    ]);
  }

  // ---- dokumenty / souhlasy ----
  const docs = el('div', { class: 'dc-section' }, [
    el('h3', {}, [
      ico('shield', 18), ' Souhlasy a dokumenty',
      el('span', { class: 'count-chip ' + (c.documentsVerified ? 'ok' : 'warn'),
        text: c.documentsVerified ? 'vše ověřeno' : `${(c.documents || []).length} záznamů` }),
    ]),
    (c.documents && c.documents.length)
      ? el('div', { class: 'doc-list' }, c.documents.map((d) =>
        el('div', { class: 'doc-row' }, [
          ico(d.verified ? 'check' : 'alert', 16),
          el('div', { class: 'doc-main' }, [
            el('div', { class: 'doc-title', text: d.title }),
            el('div', { class: 'doc-meta', text: `${d.signerType === 'guardian' ? 'zákonný zástupce' : 'člen'} · ${d.signedBy} · ${czDateTime(d.grantedAt)} · verze ${d.version}` }),
          ]),
          el('span', { class: 'doc-state ' + (d.verified ? 'ok' : 'warn'), text: d.verified ? 'ověřeno' : 'neověřeno' }),
        ])))
      : el('p', { class: 'muted', text: 'Zatím žádné podepsané souhlasy.' }),
  ]);

  // ---- historie vstupů ----
  const entries = el('div', { class: 'dc-section' }, [
    el('h3', {}, [ico('clock', 18), ' Vstupy na airbag',
      el('span', { class: 'count-chip', text: `${c.entries.total}×` })]),
    (c.entries.recent && c.entries.recent.length)
      ? el('div', { class: 'entry-list' }, c.entries.recent.slice(0, 10).map((e) =>
        el('div', { class: 'entry-row ' + (e.ok ? 'ok' : 'no') }, [
          ico(e.ok ? 'check' : 'x', 15),
          el('span', { class: 'entry-when', text: czDateTime(e.at) }),
          el('span', { class: 'entry-rel', text: relativeCz(e.at) }),
          el('span', { class: 'entry-who', text: e.dozor ? `dozor: ${e.dozor}` : '' }),
        ])))
      : el('p', { class: 'muted', text: 'Zatím žádné zaznamenané vstupy.' }),
    entryId ? el('div', { class: 'dc-note ok' }, [ico('check', 15), el('span', { text: 'Tento vstup byl právě zaevidován.' })]) : null,
  ]);

  // ---- historie členství (audit) ----
  let audit = null;
  if (c.audit && c.audit.length) {
    audit = el('div', { class: 'dc-section collapsible' }, [
      el('h3', {}, [ico('file', 18), ' Historie členství']),
      el('div', { class: 'doc-list' }, c.audit.map((a) =>
        el('div', { class: 'doc-row' }, [
          ico('info', 16),
          el('div', { class: 'doc-main' }, [
            el('div', { class: 'doc-title', text: `${a.action}${a.kindTo ? ` → ${a.kindTo === 'radne' ? 'řádné' : 'sportovní'}` : ''}` }),
            el('div', { class: 'doc-meta', text: `${a.actor} · ${czDateTime(a.at)} · zdroj ${a.source}` }),
          ]),
        ]))),
    ]);
  }

  // POZOR: append(null) vloží do stránky text „null“ — a proto se sem přidávají
  // jen sekce, které skutečně existují (guardian jen u nezletilých, audit když je).
  head.append(...[membership, guardian, docs, entries, audit].filter(Boolean));
  box.append(head);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fieldBox(label, value, tone) {
  return el('div', { class: 'field-box ' + (tone || '') }, [
    el('span', { class: 'fb-k', text: label }),
    el('span', { class: 'fb-v', text: String(value) }),
  ]);
}

async function viewDozor() {
  if (!isLoggedIn()) { location.hash = '#/prihlaseni'; return; }
  applyRoleTheme();
  const root = $('#view');
  root.innerHTML = '';

  const meName = me && me.member ? me.member.firstName : '';
  root.append(el('div', { class: 'dozor-head' }, [
    el('div', {}, [
      el('h1', {}, [ typeof CZ !== 'undefined' ? CZ.greet(meName, 'Dobrý den') : `Dobrý den, ${meName}`, ' ', roleBadge() ]),
      el('p', { class: 'muted', text: 'Načtěte QR kód členské karty — zobrazí se stav členství, platnost, historie vstupů a souhlasy.' }),
    ]),
  ]));

  // ---- vstupní panel ----
  const input = el('input', { class: 'input', type: 'text', placeholder: 'Vložte nebo naskenujte QR kód…', autofocus: 'autofocus' });
  const form = el('form', { class: 'dozor-form' }, [
    input,
    el('button', { class: 'btn primary', type: 'submit' }, [ico('qr', 18), ' Načíst QR']),
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    openCard(v);
    input.value = '';
  });

  const camBtn = el('button', { class: 'btn ghost', type: 'button' }, [ico('qr', 18), ' Skenovat kamerou']);
  camBtn.addEventListener('click', () => toggleCamera(input));

  root.append(el('div', { class: 'panel dozor-panel' }, [
    form, camBtn,
    el('div', { id: 'dozor-cam', class: 'dozor-cam', hidden: 'hidden' }),
    el('div', { class: 'dozor-hint', text: 'Tip: QR kód najde člen v aplikaci v sekci „Členská karta“.' }),
  ]));

  root.append(el('div', { id: 'dozor-result', class: 'dozor-result' }));

  // ---- rychlý záznam návštěvníka bez QR ----
  const nName = el('input', { class: 'input', type: 'text', placeholder: 'Jméno návštěvníka' });
  const nKind = el('select', { class: 'input' }, [
    el('option', { value: 'neclen', text: 'Nečlen / host' }),
    el('option', { value: 'clen', text: 'Člen' }),
  ]);
  const nNote = el('input', { class: 'input', type: 'text', placeholder: 'Poznámka (nepovinné)' });
  const nForm = el('form', { class: 'manual-form' }, [nName, nKind, nNote,
    el('button', { class: 'btn', type: 'submit' }, [ico('edit', 16), ' Zaevidovat vstup']),
  ]);
  nForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nName.value.trim()) { toast('Zadejte jméno návštěvníka.', true); return; }
    try {
      await API.post('/dozor/entry', { personName: nName.value.trim(), kind: nKind.value, note: nNote.value.trim() });
      toast('Vstup zaevidován.');
      nName.value = ''; nNote.value = '';
      loadRecentEntries();
    } catch (err) { toast(err.message || 'Záznam se nepodařil.', true); }
  });

  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('edit', 18), ' Návštěvník bez QR kódu']),
    nForm,
  ]));

  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('chart', 18), ' Provoz airbagu za 30 dní']),
    el('div', { id: 'dozor-stats', class: 'stats-row' }, [el('span', { class: 'spinner' })]),
  ]));

  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('clock', 18), ' Poslední vstupy']),
    el('div', { id: 'dozor-recent' }, [el('span', { class: 'spinner' })]),
  ]));

  loadDozorStats();
  loadRecentEntries();
}

/** Kamerové skenování QR (BarcodeDetector; bez podpory zobrazí vysvětlení). */
async function toggleCamera(input) {
  const box = $('#dozor-cam');
  if (!box) return;
  if (dozorCamera) {
    dozorCamera.getTracks().forEach((t) => t.stop());
    dozorCamera = null;
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  if (!('BarcodeDetector' in window)) {
    box.hidden = false;
    box.innerHTML = '';
    box.append(el('p', { class: 'muted', text: 'Tento prohlížeč neumí skenovat QR kamerou. Naskenujte kód jinou aplikací a vložte ho do pole výše.' }));
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    dozorCamera = stream;
    const video = el('video', { class: 'cam-video', autoplay: 'autoplay', playsinline: 'playsinline', muted: 'muted' });
    video.srcObject = stream;
    box.hidden = false;
    box.innerHTML = '';
    box.append(video, el('div', { class: 'muted', text: 'Namiřte kameru na QR kód…' }));
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!dozorCamera) return;
      try {
        const found = await detector.detect(video);
        if (found && found.length) {
          const value = found[0].rawValue;
          dozorCamera.getTracks().forEach((t) => t.stop());
          dozorCamera = null;
          box.hidden = true;
          box.innerHTML = '';
          openCard(value);
          return;
        }
      } catch (e) { /* pokračujeme */ }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    box.hidden = false;
    box.innerHTML = '';
    box.append(el('p', { class: 'muted', text: 'Kameru se nepodařilo zapnout (' + (err.message || err.name) + ').' }));
  }
}

async function loadDozorStats() {
  const box = $('#dozor-stats');
  if (!box) return;
  try {
    const data = await API.get('/dozor/entries/summary?days=30');
    const s = data.summary || {};
    box.innerHTML = '';
    box.append(
      statTile('Vstupů celkem', s.total || 0, 'za 30 dní', 'chart'),
      statTile('Členové', s.clen || 0, 'z toho vstupů', 'users'),
      statTile('Nečlenové', s.neclen || 0, 'hosté', 'user'),
      statTile('Zamítnuto', s.denied || 0, 'nepovolené vstupy', 'ban'),
      statTile('Nejaktivnější', data.topMember ? data.topMember.name : '—',
        data.topMember ? `${data.topMember.count}× vstupů` : 'zatím žádný', 'ticket'),
    );
  } catch (err) {
    box.innerHTML = '';
    box.append(el('p', { class: 'muted', text: 'Statistiky se nepodařilo načíst.' }));
  }
}

async function loadRecentEntries() {
  const box = $('#dozor-recent');
  if (!box) return;
  try {
    const data = await API.get('/dozor/entries?limit=25');
    const rows = data.entries || [];
    box.innerHTML = '';
    if (!rows.length) {
      box.append(el('p', { class: 'muted', text: 'Zatím žádné vstupy.' }));
      return;
    }
    box.append(el('div', { class: 'entry-list' }, rows.map((e) =>
      el('div', { class: 'entry-row ' + (e.ok ? 'ok' : 'no') }, [
        ico(e.ok ? 'check' : 'x', 15),
        el('span', { class: 'entry-when', text: czDateTime(e.at) }),
        el('span', { class: 'entry-name', text: e.name + (e.memberNo ? ` (č. ${e.memberNo})` : '') }),
        el('span', { class: 'entry-kind', text: e.kind === 'clen' ? 'člen' : 'nečlen' }),
        el('span', { class: 'entry-who', text: e.dozor || '' }),
      ]))));
  } catch (err) {
    box.innerHTML = '';
    box.append(el('p', { class: 'muted', text: 'Přehled vstupů se nepodařilo načíst.' }));
  }
}

/* =========================================================================
 * VYTVOŘENÍ ÚČTU DOZORU Z POZVÁNKY (veřejná stránka)
 * ========================================================================= */

async function viewDozorPozvanka(token) {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('div', { class: 'panel dozor-panel' }, [el('span', { class: 'spinner' })]));
  let info;
  try {
    info = await API.get(`/dozor/invite/${encodeURIComponent(token)}`);
  } catch (err) {
    root.innerHTML = '';
    root.append(el('div', { class: 'alert err', text: 'Odkaz není platný nebo už vypršel.' }));
    return;
  }
  root.innerHTML = '';

  if (!info.ok) {
    root.append(el('h1', { text: 'Pozvánka dozoru' }));
    root.append(el('div', { class: 'alert err', text: info.message }));
    root.append(el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přejít na přihlášení' }));
    return;
  }

  const fName = el('input', { class: 'input', type: 'text', value: info.firstName || '', placeholder: 'Jméno', required: 'required' });
  const lName = el('input', { class: 'input', type: 'text', value: info.lastName || '', placeholder: 'Příjmení', required: 'required' });
  const phone = el('input', { class: 'input', type: 'tel', placeholder: 'Telefon (nepovinné)' });
  const pass = el('input', { class: 'input', type: 'password', placeholder: 'Heslo (min. 8 znaků)', required: 'required', minlength: '8' });
  const pass2 = el('input', { class: 'input', type: 'password', placeholder: 'Heslo znovu', required: 'required', minlength: '8' });

  const form = el('form', { class: 'stack' }, [
    el('div', { class: 'field' }, [el('label', { text: 'E-mail (daný pozvánkou)' }), el('input', { class: 'input', type: 'email', value: info.email, readonly: 'readonly' })]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Jméno' }), fName]),
      el('div', { class: 'field' }, [el('label', { text: 'Příjmení' }), lName]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Telefon' }), phone]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Heslo' }), pass]),
      el('div', { class: 'field' }, [el('label', { text: 'Heslo znovu' }), pass2]),
    ]),
    el('button', { class: 'btn primary', type: 'submit' }, [ico('key', 18), ' Vytvořit účet dozoru']),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pass.value !== pass2.value) { toast('Hesla se neshodují.', true); return; }
    try {
      await API.post(`/dozor/invite/${encodeURIComponent(token)}/accept`, {
        firstName: fName.value.trim(), lastName: lName.value.trim(),
        phone: phone.value.trim(), password: pass.value,
      });
      toast('Účet dozoru je vytvořen. Přihlaste se.');
      location.hash = '#/prihlaseni';
    } catch (err) { toast(err.message || 'Účet se nepodařilo vytvořit.', true); }
  });

  root.append(el('h1', {}, ['Vytvoření účtu ', el('span', { class: 'role-badge dozor', text: 'DOZOR' })]));
  root.append(el('p', { class: 'muted' }, [
    `Vlastník spolku Vám zakládá přístup dozoru do členské aplikace. Odkaz je platný do ${czDateTime(info.expiresAt)}.`,
  ]));
  root.append(el('div', { class: 'panel dozor-panel' }, [form]));
  root.append(el('div', { class: 'dc-note' }, [ico('info', 15),
    el('span', { text: 'Účet dozoru nemusí být členem spolku. Slouží ke kontrole QR karet u airbagu.' })]));
}

/* =========================================================================
 * SUPERADMIN — přehled členské základny
 * ========================================================================= */

async function viewSuperAdminZakladna() {
  if (!isSuperAdmin()) { location.hash = '#/'; return; }
  applyRoleTheme();
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', {}, [ico('users', 26), ' Členská základna ']));

  const box = el('div', {});
  root.append(box);

  let ov;
  try {
    ov = await API.get('/superadmin/overview');
  } catch (err) {
    box.append(el('div', { class: 'alert err', text: 'Přehled se nepodařilo načíst: ' + (err.message || '') }));
    return;
  }

  // ---- hlavní čísla ----
  box.append(el('div', { class: 'stats-row' }, [
    statTile('Členů celkem', ov.total, 'v evidenci spolku', 'users'),
    statTile('Řádné členství', ov.radne, 'nejvyšší úroveň', 'shield'),
    statTile('Sportovní členství', ov.sportovni, 'standardní', 'ticket'),
    statTile('Pod 18 let', ov.minor, 'nezletilých', 'baby'),
    statTile('Aktivní', ov.active, 'platné členství', 'check'),
    statTile('Vypršelé', ov.expired, 'nutná obnova', 'expired'),
    statTile('Nezaplaceno', ov.unpaidCount, 'k upozornění', 'alert'),
    statTile('Účty dozoru', ov.dozorAccounts, 'nejsou členové', 'qr'),
  ]));

  // ---- nejaktivnější + provoz ----
  const top = ov.topVisitor;
  box.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('chart', 18), ' Provoz airbagu']),
    el('div', { class: 'stats-row' }, [
      statTile('Vstupů celkem', ov.entriesTotal, 'od začátku evidence', 'chart'),
      statTile('Za 30 dní', (ov.entries30 && ov.entries30.total) || 0,
        `${(ov.entries30 && ov.entries30.clen) || 0} členů / ${(ov.entries30 && ov.entries30.neclen) || 0} nečlenů`, 'clock'),
      statTile('Nejvíce vstupů', top ? top.name : '—', top ? `${top.count}× návštěv` : 'zatím bez dat', 'ticket'),
      statTile('Členové (30 dní)', (ov.entries30 && ov.entries30.clen) || 0, 'vstupů členů', 'users'),
    ]),
  ]));

  // ---- nezaplacené příspěvky ----
  const unpaidPanel = el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('alert', 18), ` Nezaplacený členský příspěvek (${ov.unpaidCount})`]),
  ]);
  if (!ov.unpaidCount) {
    unpaidPanel.append(el('p', { class: 'muted', text: 'Všichni členové mají příspěvek uhrazený.' }));
  } else {
    const btnAll = el('button', { class: 'btn primary' }, [ico('mail', 16), ' Poslat upozornění všem']);
    const btnDry = el('button', { class: 'btn ghost' }, [ico('info', 16), ' Zkusit nanečisto']);
    btnDry.addEventListener('click', async () => {
      try {
        const r = await API.post('/superadmin/unpaid/notify', { dryRun: true });
        toast(`Nanečisto: upozornění by se poslalo ${r.wouldSend} členům.`);
      } catch (err) { toast(err.message || 'Chyba.', true); }
    });
    btnAll.addEventListener('click', async () => {
      if (!confirm(`Poslat upozornění s odkazem na platbu ${ov.unpaidCount} členům?`)) return;
      btnAll.disabled = true;
      try {
        const r = await API.post('/superadmin/unpaid/notify', {});
        toast(`Odesláno ${r.sent} upozornění.`);
      } catch (err) { toast(err.message || 'Odeslání selhalo.', true); }
      btnAll.disabled = false;
    });
    unpaidPanel.append(el('div', { class: 'btn-row' }, [btnAll, btnDry]));
    unpaidPanel.append(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, ['Č.', 'Jméno', 'E-mail', 'Typ', 'Platnost do', 'Poslední platba', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, ov.unpaid.map((u) => el('tr', {}, [
          el('td', { text: u.memberNo ? String(u.memberNo) : '—' }),
          el('td', { text: u.name }),
          el('td', { text: u.email }),
          el('td', { text: u.membershipKind === 'radne' ? 'řádné' : 'sportovní' }),
          el('td', { text: u.validUntil ? czDate(u.validUntil) : '—' }),
          el('td', { text: u.neverPaid ? 'nikdy' : czDate(u.lastPaidAt) }),
          el('td', {}, [el('button', { class: 'btn tiny', onclick: async () => {
            try {
              await API.post('/superadmin/unpaid/notify', { memberIds: [u.id] });
              toast('Upozornění odesláno.');
            } catch (err) { toast(err.message || 'Chyba.', true); }
          } }, 'Upozornit')]),
        ]))),
      ]),
    ]));
  }
  box.append(unpaidPanel);

  // ---- historie zápisů členství ----
  try {
    const au = await API.get('/superadmin/audit?limit=25');
    const rows = au.audit || [];
    box.append(el('div', { class: 'panel' }, [
      el('h2', { class: 'panel-title' }, [ico('file', 18), ' Historie zápisů členství (kdo · kde · kdy)']),
      rows.length
        ? el('div', { class: 'doc-list' }, rows.map((a) => el('div', { class: 'doc-row' }, [
          ico('info', 16),
          el('div', { class: 'doc-main' }, [
            el('div', { class: 'doc-title', text: `${a.action}${a.kind_from || a.kind_to ? ` · ${a.kind_from || '—'} → ${a.kind_to || '—'}` : ''}` }),
            el('div', { class: 'doc-meta', text: `${a.actor_email || a.actor_name || 'systém'} · ${czDateTime(a.created_at)} · ${a.source}` }),
          ]),
        ])))
        : el('p', { class: 'muted', text: 'Zatím žádné záznamy.' }),
    ]));
  } catch (err) { /* nepovinné */ }
}

/* =========================================================================
 * SUPERADMIN — správa účtů dozoru
 * ========================================================================= */

async function viewSuperAdminDozor() {
  if (!isSuperAdmin()) { location.hash = '#/'; return; }
  applyRoleTheme();
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', {}, [ico('qr', 26), ' Účty dozoru ']));

  // ---- formulář pozvánky ----
  const email = el('input', { class: 'input', type: 'email', placeholder: 'e-mail dozora', required: 'required' });
  const fName = el('input', { class: 'input', type: 'text', placeholder: 'Jméno' });
  const lName = el('input', { class: 'input', type: 'text', placeholder: 'Příjmení' });
  const phone = el('input', { class: 'input', type: 'tel', placeholder: 'Telefon' });
  const form = el('form', { class: 'stack' }, [
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'E-mail dozora' }), email]),
      el('div', { class: 'field' }, [el('label', { text: 'Telefon' }), phone]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Jméno' }), fName]),
      el('div', { class: 'field' }, [el('label', { text: 'Příjmení' }), lName]),
    ]),
    el('button', { class: 'btn primary', type: 'submit' }, [ico('mail', 16), ' Odeslat pozvánku e-mailem']),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await API.post('/superadmin/dozor/invite', {
        email: email.value.trim(), firstName: fName.value.trim(),
        lastName: lName.value.trim(), phone: phone.value.trim(),
      });
      toast(r.mailSent ? 'Pozvánka odeslána e-mailem.' : 'Pozvánka vytvořena (e-mail se neodeslal — předán odkaz).');
      showInviteLink(r.link, r.mailError);
      loadDozorAccounts();
      email.value = ''; fName.value = ''; lName.value = ''; phone.value = '';
    } catch (err) { toast(err.message || 'Pozvánku se nepodařilo vytvořit.', true); }
  });

  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('mail', 18), ' Pozvat nový účet dozoru']),
    el('p', { class: 'muted', text: 'Dozor nemusí být členem spolku. Na e-mail mu přijde odkaz pro vytvoření účtu; ten má platnost 14 dní.' }),
    form,
    el('div', { id: 'invite-link-box' }),
  ]));

  // ---- seznam účtů a pozvánek ----
  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('users', 18), ' Účty s právy dozoru']),
    el('div', { id: 'dozor-accounts' }, [el('span', { class: 'spinner' })]),
  ]));
  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('clock', 18), ' Pozvánky']),
    el('div', { id: 'dozor-invites' }, [el('span', { class: 'spinner' })]),
  ]));

  loadDozorAccounts();
}

function showInviteLink(link, mailError) {
  const box = $('#invite-link-box');
  if (!box) return;
  box.innerHTML = '';
  box.append(el('div', { class: 'dc-note ' + (mailError ? 'warn' : 'ok') }, [
    ico(mailError ? 'alert' : 'check', 15),
    el('span', { text: mailError
      ? `E-mail se nepodařilo odeslat (${mailError}). Předejte odkaz ručně:`
      : 'E-mail odeslán. Odkaz pro ruční předání:' }),
  ]));
  const inp = el('input', { class: 'input', type: 'text', value: link, readonly: 'readonly' });
  box.append(el('div', { class: 'copy-row' }, [inp,
    el('button', { class: 'btn tiny', onclick: () => { inp.select(); document.execCommand('copy'); toast('Odkaz zkopírován.'); } }, 'Kopírovat'),
  ]));
}

async function loadDozorAccounts() {
  const accBox = $('#dozor-accounts');
  const invBox = $('#dozor-invites');
  let data;
  try {
    data = await API.get('/superadmin/dozor');
  } catch (err) {
    if (accBox) { accBox.innerHTML = ''; accBox.append(el('p', { class: 'alert err', text: 'Seznam se nepodařilo načíst.' })); }
    return;
  }

  if (accBox) {
    accBox.innerHTML = '';
    const rows = data.accounts || [];
    const others = rows.filter((a) => a.role !== 'superadmin');
    if (!others.length) {
      accBox.append(el('p', { class: 'muted', text: 'Zatím žádné účty dozoru.' }));
    } else {
      accBox.append(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, ['Jméno', 'E-mail', 'Role', 'Stav', 'Uděleno', 'Akce'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, others.map((a) => el('tr', {}, [
            el('td', { text: a.name }),
            el('td', { text: a.email }),
            el('td', {}, [el('span', { class: 'role-badge dozor', text: a.roleLabel })]),
            el('td', { text: a.blocked ? 'přístup pozastaven' : 'aktivní' }),
            el('td', { text: a.grantedAt ? czDate(a.grantedAt) : '—' }),
            el('td', { class: 'actions' }, [
              a.role === 'dozor'
                ? el('button', { class: 'btn tiny', onclick: async () => {
                  if (!confirm(`Odebrat dozorovi ${a.name} funkci dozoru?`)) return;
                  try { await API.post(`/superadmin/dozor/revoke/${a.id}`, {}); toast('Funkce dozoru odebrána.'); loadDozorAccounts(); }
                  catch (e) { toast(e.message || 'Chyba.', true); }
                } }, 'Odebrat dozor')
                : el('button', { class: 'btn tiny', onclick: async () => {
                  try { await API.post(`/superadmin/dozor/grant/${a.id}`, {}); toast('Účet rozšířen o dozor.'); loadDozorAccounts(); }
                  catch (e) { toast(e.message || 'Chyba.', true); }
                } }, 'Rozšířit o dozor'),
              el('button', { class: 'btn tiny ghost', onclick: async () => {
                try {
                  await API.post(`/superadmin/members/${a.id}/${a.blocked ? 'unblock' : 'block'}`, {});
                  toast(a.blocked ? 'Přístup obnoven.' : 'Přístup pozastaven.');
                  loadDozorAccounts();
                } catch (e) { toast(e.message || 'Chyba.', true); }
              } }, a.blocked ? 'Obnovit přístup' : 'Pozastavit přístup'),
            ]),
          ]))),
        ]),
      ]));
    }
  }

  if (invBox) {
    invBox.innerHTML = '';
    const rows = data.invites || [];
    if (!rows.length) {
      invBox.append(el('p', { class: 'muted', text: 'Žádné pozvánky.' }));
    } else {
      const label = { ceka: 'čeká', vyuzita: 'využita', zrusena: 'zrušena', expirovana: 'vypršela' };
      invBox.append(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, ['E-mail', 'Stav', 'Platnost do', 'Vytvořena', 'Akce'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows.map((i) => el('tr', {}, [
            el('td', { text: i.email }),
            el('td', {}, [el('span', { class: 'chip ' + (i.status === 'ceka' ? 'ok' : 'muted'), text: label[i.status] || i.status })]),
            el('td', { text: czDateTime(i.expiresAt) }),
            el('td', { text: czDateTime(i.createdAt) }),
            el('td', { class: 'actions' }, [
              i.status === 'ceka'
                ? el('button', { class: 'btn tiny', onclick: async () => {
                  try {
                    const r = await API.post(`/superadmin/dozor/invite/${i.id}/resend`, {});
                    showInviteLink(r.link); toast(r.mailSent ? 'Nový odkaz odeslán.' : 'Nový odkaz vytvořen.');
                    loadDozorAccounts();
                  } catch (e) { toast(e.message || 'Chyba.', true); }
                } }, 'Poslat znovu')
                : null,
              i.status === 'ceka'
                ? el('button', { class: 'btn tiny ghost', onclick: async () => {
                  try { await API.post(`/superadmin/dozor/invite/${i.id}/revoke`, {}); toast('Pozvánka zrušena.'); loadDozorAccounts(); }
                  catch (e) { toast(e.message || 'Chyba.', true); }
                } }, 'Zrušit')
                : null,
            ]),
          ]))),
        ]),
      ]));
    }
  }
}
