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
let dozorLastPayload = null;
let dozorLastPin = null;
let dozorCamera = null;

/** Stavová „karta“ pro rozlišení: dokument × instruktáž × vstup. */
function stateBox(label, ok, emphasized) {
  return el('div', { class: 'state-box ' + (ok ? 'yes' : 'no') + (emphasized ? ' big' : '') }, [
    el('span', { class: 'sb-k', text: label }),
    el('span', { class: 'sb-v', text: ok ? 'ANO' : 'NE' }),
  ]);
}

async function openCard(payload, { record = true, identityPin = null } = {}) {
  const box = $('#dozor-result');
  if (!box) return;
  box.innerHTML = '';
  box.append(el('div', { class: 'loading-row' }, [el('span', { class: 'spinner' }), ' Načítám údaje…']));
  dozorLastPayload = payload;
  dozorLastPin = identityPin;
  try {
    const res = await API.post('/dozor/lookup', { qrPayload: payload, record, identityPin });
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

  // ---- PŘIPRAVENOST: tři ODDĚLENÉ skutečnosti (nesmějí se slévat) ----
  const acc = c.access || {};
  const statements = el('div', { class: 'dc-section' }, [
    el('h3', {}, [ico('info', 18), ' Stav podle provozního řádu (čl. 3)']),
    el('div', { class: 'state-row' }, [
      stateBox('Dokument potvrzen', acc.documentsConfirmed),
      stateBox('Instruktáž absolvována', acc.instructionCompleted),
      stateBox('Vstup / provoz povolen', acc.entryAllowed, true),
    ]),
    (acc.blocking && acc.blocking.length)
      ? el('div', { class: 'blocking-list' }, [
        el('div', { class: 'bl-title', text: 'Co brání vstupu:' }),
        ...acc.blocking.map((b) => el('div', { class: 'bl-item' }, [
          ico('alert', 15),
          el('span', { text: `${b.label}: ${b.message || ''}` }),
        ])),
      ])
      : null,
    // Denní kontrola a provozní den
    c.day ? el('div', { class: 'dc-note ' + (c.day.verdict === 'vyhovuje' ? '' : 'warn') }, [
      ico(c.day.verdict === 'vyhovuje' ? 'check' : 'alert', 15),
      el('span', { text: `Provozní den ${c.day.day}: kontrola ${c.day.verdict}${c.day.openedAt ? `, otevřel ${c.day.dozorName || '—'} (${czDateTime(c.day.openedAt)})` : ', provoz není otevřen'}${c.day.interrupted ? ` — PROVOZ PŘERUŠEN: ${c.day.interruptReason || ''}` : ''}` }),
    ]) : null,
    // Instruktáž
    c.instruction ? el('div', { class: 'dc-note ' + (c.instruction.ok ? '' : 'warn') }, [
      ico('shield', 15),
      el('span', { text: c.instruction.ok
        ? `Instruktáž absolvována ${czDateTime(c.instruction.last.instructedAt)} (dozor ${c.instruction.last.dozor || '—'}, verze instruktáže v${c.instruction.last.version}${c.instruction.last.source === 'offline' ? ', offline zápis' : ''}).`
        : `Instruktáž: ${c.instruction.message} (požadovaná verze v${c.instruction.expectedVersion})` }),
    ]) : null,
    // Ověření totožnosti
    c.identityCheck ? el('div', { class: 'dc-note ' + (c.identityCheck.pinOk === false ? 'warn' : '') }, [
      ico('user', 15),
      el('span', { text: `Ověření totožnosti: ${c.identityCheck.method}${c.identityCheck.note ? ` — ${c.identityCheck.note}` : ''}` }),
    ]) : null,
  ].filter(Boolean));

  // ---- zákonný zástupce (u nezletilých) ----
  let guardian = null;
  if (c.guardian) {
    const gBox = el('div', { class: 'dc-section' }, [
      el('h3', {}, [ico('baby', 18), ' Zákonný zástupce']),
      el('div', { class: 'dc-grid' }, [
        fieldBox('Jméno', c.guardian.name || '—'),
        fieldBox('Vztah', c.guardian.relation || '—'),
        fieldBox('Souhlas s účastí', ({
          granted: 'udělen', pending: 'čeká', rejected: 'odmítnut', not_required: 'nevyžadován',
        })[c.guardian.consentStatus] || c.guardian.consentStatus,
        c.guardian.consentStatus === 'granted' ? 'ok' : 'warn'),
        fieldBox('Udělen', c.guardian.grantedAt ? czDate(c.guardian.grantedAt) : '—'),
        fieldBox('Ověření vazby k dítěti', c.guardian.relationVerified ? 'ověřeno' : 'NEOVĚŘENO',
          c.guardian.relationVerified ? 'ok' : 'bad'),
      ]),
    ]);
    if (c.guardian.relationVerified) {
      gBox.append(el('div', { class: 'dc-note' }, [ico('check', 15),
        el('span', { text: `Vazbu ověřil ${c.guardian.verification.by || '—'} (${c.guardian.verification.method}) ${czDateTime(c.guardian.verification.at)}.` })]));
    } else {
      // Ověření vazby k dítěti provádí DOZOR podle dokladu (elektronický odkaz ji neprokazuje)
      const method = el('select', { class: 'input' }, [
        el('option', { value: '', text: '— způsob ověření —' }),
        el('option', { value: 'rodny_list', text: 'rodný list' }),
        el('option', { value: 'doklad_totoznosti', text: 'doklad totožnosti zákonného zástupce' }),
        el('option', { value: 'pribuzensky_doklad', text: 'jiný doklad o vztahu' }),
        el('option', { value: 'jine', text: 'jiné (uvedu v poznámce)' }),
      ]);
      const note = el('input', { class: 'input', type: 'text', placeholder: 'Poznámka k ověření (nepovinné)' });
      const btn = el('button', { class: 'btn small', type: 'button' }, [ico('check', 15), ' Zaznamenat ověření vazby']);
      btn.addEventListener('click', async () => {
        if (!method.value) { toast('Zvolte způsob ověření (podle jakého dokladu).', true); return; }
        btn.disabled = true;
        try {
          const r = await dozorPost('/dozor/guardian-verify', {
            memberId: c.identity.memberId, method: method.value, methodNote: note.value.trim(),
          });
          if (r.offline) toast('Offline režim: ověření uloženo v zařízení.', true);
          else toast(r.data.entryAllowed ? 'Vazba ověřena — podmínky vstupu jsou splněny.' : 'Vazba ověřena. Zbývá splnit další podmínky vstupu.');
          if (dozorLastPayload) await openCard(dozorLastPayload, { record: false, identityPin: dozorLastPin });
          renderProvozniKniha();
        } catch (err) { toast(err.message, true); btn.disabled = false; }
      });
      gBox.append(el('div', { class: 'dc-note warn' }, [ico('alert', 15),
        el('span', { text: 'Vazba zákonného zástupce k dítěti NENÍ ověřená. Ověřte ji podle dokladu — bez toho nezletilý nevstoupí. Elektronický odkaz ověřuje jen e-mailovou schránku.' })]));
      gBox.append(el('div', { class: 'stack' }, [method, note, el('div', { class: 'row-gap' }, [btn])]));
    }
    guardian = gBox;
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
  // Pořadí je záměrné: nejdřív STAV PODMÍNEK VSTUPU, pak členství → zástupce →
  // dokumenty → vstupy → audit (dozor musí na první pohled vidět, co chybí).
  head.append(...[statements, membership, guardian, docs, entries, audit].filter(Boolean));
  box.append(head);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fieldBox(label, value, tone) {
  return el('div', { class: 'field-box ' + (tone || '') }, [
    el('span', { class: 'fb-k', text: label }),
    el('span', { class: 'fb-v', text: String(value) }),
  ]);
}

/* =========================================================================
 * PROVOZNÍ KNIHA — offline fronta a zápis
 *
 * Postup při výpadku internetu (viz provozní řád čl. 10): dozor může otevřít
 * provozní den, zapsat kontrolu, instruktáž i vstup i bez připojení. Záznam se
 * uloží do zařízení a po obnovení připojení se doplní do provozní knihy
 * s označením „offline zápis“ (a s časem skutečného zápisu).
 * ========================================================================= */

const DOZOR_QUEUE_KEY = 'tjk_dozor_offline_queue';

function offlineQueue() {
  try { return JSON.parse(localStorage.getItem(DOZOR_QUEUE_KEY) || '[]'); } catch (e) { return []; }
}
function offlineQueueSave(q) {
  try { localStorage.setItem(DOZOR_QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* plné úložiště */ }
}
function offlineQueueAdd(endpoint, body) {
  const q = offlineQueue();
  const item = {
    id: `off-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    endpoint, body, at: new Date().toISOString(),
  };
  q.push(item);
  offlineQueueSave(q);
  return item;
}
function offlineQueueCount() { return offlineQueue().length; }

/** Zápis do provozní knihy s automatickým offline režimem. */
async function dozorPost(endpoint, body) {
  try {
    const res = await API.post(endpoint, body);
    return { ok: true, data: res, offline: false };
  } catch (err) {
    // Síťová chyba = offline režim (nikoli odmítnutí serverem)
    const offline = err && (err.offline === true || err.name === 'TypeError' || /fetch|network|Failed/i.test(err.message || ''));
    if (!offline) throw err;
    const item = offlineQueueAdd(endpoint, { ...body, source: 'offline', offlineRef: null });
    return { ok: true, data: { offline: true, queued: item.id }, offline: true };
  }
}

/** Přenesení offline zápisů do systému (po obnovení připojení). */
async function flushOfflineQueue() {
  const q = offlineQueue();
  if (!q.length) return { sent: 0, left: 0 };
  const left = [];
  let sent = 0;
  for (const item of q) {
    try {
      await API.post(item.endpoint, { ...item.body, source: 'offline', offlineRef: item.id, at: item.body.at || item.at });
      sent += 1;
    } catch (err) {
      left.push(item);
    }
  }
  offlineQueueSave(left);
  return { sent, left: left.length };
}

/** Panel provozní knihy: stav dne, denní kontrola, přerušení, záznamy. */
async function renderProvozniKniha() {
  const box = $('#provozni-kniha');
  if (!box) return;
  box.innerHTML = '';
  box.append(el('div', { class: 'loading-row' }, [el('span', { class: 'spinner' }), ' Načítám provozní knihu…']));

  let data;
  try {
    data = await API.get('/dozor/provozni-den');
  } catch (err) {
    box.innerHTML = '';
    box.append(el('p', { class: 'muted', text: 'Provozní kniha se nepodařilo načíst (offline?). Zkontrolujte připojení — offline zápisy se uloží do zařízení.' }));
    return;
  }
  box.innerHTML = '';

  const vLabel = { vyhovuje: 'VYHOVUJE', nevyhovuje: 'NEVYHOVUJE', ceka: 'ČEKÁ NA KONTROLU' }[data.verdict] || data.verdict;
  const tone = data.verdict === 'vyhovuje' ? 'ok' : data.verdict === 'nevyhovuje' ? 'bad' : 'warn';

  box.append(el('div', { class: 'provozni-head' }, [
    el('div', { class: 'ph-day' }, [ico('calendar', 18), ` Provozní den ${data.day}`]),
    el('span', { class: `tag ${tone}`, text: vLabel }),
    data.interrupted ? el('span', { class: 'tag bad', text: 'PROVOZ PŘERUŠEN' }) : null,
    data.closedAt ? el('span', { class: 'tag', text: 'DEN UKONČEN' }) : null,
    offlineQueueCount() ? el('span', { class: 'tag warn', text: `offline zápisů k přenosu: ${offlineQueueCount()}` }) : null,
  ].filter(Boolean)));

  if (data.opened) {
    box.append(el('div', { class: 'dc-note' }, [ico('check', 15),
      el('span', { text: `Provoz otevřel ${data.dozorName || '—'} (${czDateTime(data.openedAt)}) — dozor je na místě.` })]));
  } else {
    box.append(el('div', { class: 'dc-note warn' }, [ico('alert', 15),
      el('span', { text: 'Provozní den není otevřen. Bez zaznamenané vyhovující kontroly aplikace vstup nepovolí.' })]));
  }

  // ---- denní kontrola ----
  const CHECKS = [
    ['mattress', 'Matrace (plášť, švy, záplaty)'],
    ['pressure', 'Tlak / nafouknutí'],
    ['anchoring', 'Kotvení'],
    ['ramp', 'Nájezd'],
    ['surroundings', 'Okolí (dopadová zóna, překážky)'],
  ];
  const selects = {};
  const grid = el('div', { class: 'check-grid' }, CHECKS.map(([key, label]) => {
    const sel = el('select', { class: 'input' }, [
      el('option', { value: 'neprovedeno', text: '— neprovedeno —' }),
      el('option', { value: 'ok', text: 'vyhovuje' }),
      el('option', { value: 'zavada', text: 'závada' }),
    ]);
    const current = data.checks ? (data.checks.find((c) => c.key === key) || {}).value : 'neprovedeno';
    sel.value = current || 'neprovedeno';
    selects[key] = sel;
    return el('div', { class: 'check-item' }, [el('label', { text: label }), sel]);
  }));

  const checkNote = el('input', { class: 'input', type: 'text', placeholder: 'Poznámka ke kontrole (nepovinné)', value: data.checkNote || '' });
  const defects = el('input', { class: 'input', type: 'text', placeholder: 'Zjištěné závady (co je potřeba opravit)', value: data.defects || '' });
  const present = el('input', { type: 'checkbox', checked: 'checked' });

  const saveBtn = el('button', { class: 'btn primary', type: 'submit' }, [ico('check', 18), data.opened ? ' Uložit kontrolu' : ' Otevřít provozní den']);
  const checkForm = el('form', { class: 'stack' }, [
    grid,
    el('div', { class: 'form-row' }, [checkNote, defects]),
    el('label', { class: 'check' }, [present, el('span', { text: ' Potvrzuji, že jsem jako dozor přítomen na místě' })]),
    el('div', { class: 'row-gap' }, [saveBtn]),
  ]);
  checkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukládám…';
    const body = {
      day: data.day,
      mattress: selects.mattress.value,
      pressure: selects.pressure.value,
      anchoring: selects.anchoring.value,
      ramp: selects.ramp.value,
      surroundings: selects.surroundings.value,
      checkNote: checkNote.value.trim(),
      defects: defects.value.trim(),
      dozorPresent: present.checked,
    };
    try {
      const r = await dozorPost('/dozor/provozni-den', body);
      if (r.offline) {
        toast('Offline režim: kontrola uložena v zařízení, přenese se po obnovení připojení.', true);
      } else {
        toast(r.data.verdict === 'vyhovuje'
          ? 'Kontrola vyhovuje — provoz je otevřen, vstupy lze povolit.'
          : 'Kontrola NEVYHOVUJE — provoz nezahajujte a závadu odstraňte.', r.data.verdict !== 'vyhovuje');
      }
      renderProvozniKniha();
    } catch (err) {
      toast(err.message || 'Kontrolu se nepodařilo uložit.', true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = data.opened ? 'Uložit kontrolu' : 'Otevřít provozní den';
    }
  });
  box.append(el('details', { class: 'doc-details', open: data.opened ? null : 'open' }, [
    el('summary', { text: 'Denní kontrola zařízení (matrace, tlak, kotvení, nájezd, okolí)' }),
    el('div', { class: 'doc-body' }, [checkForm]),
  ]));

  // ---- přerušení / obnovení / ukončení ----
  const reason = el('input', { class: 'input', type: 'text', placeholder: 'Důvod přerušení (např. mokrý povrch, závada kotvení)' });
  const interruptBtn = el('button', { class: 'btn ghost', type: 'button' }, [ico('alert', 16), ' Přerušit provoz']);
  interruptBtn.addEventListener('click', async () => {
    if (!reason.value.trim()) { toast('Uveďte důvod přerušení.', true); return; }
    try {
      const r = await dozorPost('/dozor/provozni-den/preruseni', { action: 'interrupt', reason: reason.value.trim(), day: data.day });
      toast(r.offline ? 'Offline: přerušení uloženo v zařízení.' : 'Provoz přerušen — vstupy jsou zablokované.');
      renderProvozniKniha();
    } catch (err) { toast(err.message, true); }
  });
  const resumeBtn = el('button', { class: 'btn', type: 'button' }, [ico('check', 16), ' Obnovit provoz']);
  resumeBtn.addEventListener('click', async () => {
    try {
      const r = await dozorPost('/dozor/provozni-den/preruseni', { action: 'resume', note: reason.value.trim(), day: data.day });
      toast(r.offline ? 'Offline: obnovení uloženo v zařízení.' : 'Provoz obnoven.');
      renderProvozniKniha();
    } catch (err) { toast(err.message, true); }
  });
  const closeBtn = el('button', { class: 'btn ghost', type: 'button' }, [ico('clock', 16), ' Ukončit provozní den']);
  closeBtn.addEventListener('click', async () => {
    if (!confirm('Ukončit provozní den? Další vstupy budou možné až po novém otevření dne.')) return;
    try {
      await dozorPost('/dozor/provozni-den/ukonceni', { day: data.day });
      toast('Provozní den ukončen.');
      renderProvozniKniha();
    } catch (err) { toast(err.message, true); }
  });
  box.append(el('div', { class: 'stack' }, [reason, el('div', { class: 'row-gap' }, [interruptBtn, resumeBtn, closeBtn])]));

  // ---- záznamy dne ----
  if (data.records && data.records.length) {
    box.append(el('h3', { class: 'panel-title' }, [ico('file', 16), ` Záznamy dne (${data.records.length})`]));
    box.append(el('div', { class: 'doc-list' }, data.records.slice(-25).reverse().map((z) =>
      el('div', { class: 'doc-row' }, [
        ico(z.severity === 'critical' ? 'alert' : z.severity === 'warning' ? 'info' : 'check', 15),
        el('div', { class: 'doc-main' }, [
          el('div', { class: 'doc-title', text: z.text }),
          el('div', { class: 'doc-meta', text: `${z.dozor || '—'} · ${czDateTime(z.at)}${z.offline ? ' · offline zápis' : ''}` }),
        ]),
        el('span', { class: 'doc-state', text: z.type }),
      ]))));
  }
  box.append(el('p', { class: 'muted small', text: `Dnes zaznamenaných instruktáží: ${data.instructionsToday}. Instruktáž se od potvrzení dokumentů liší — viz panel „Praktická instruktáž“.` }));
}

/** Panel praktické instruktáže (záznam vytváří dozor PO instruktáži). */
function renderInstruktazPanel() {
  const box = $('#dozor-instruktaz');
  if (!box) return;
  const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Účastník (jméno, pokud nemá QR/účet)' });
  const memberId = el('input', { class: 'input', type: 'text', placeholder: 'ID účtu účastníka (vyplní se načtením QR)' });
  const result = el('select', { class: 'input' }, [
    el('option', { value: 'absolvoval', text: 'absolvoval' }),
    el('option', { value: 'neabsolvoval', text: 'neabsolvoval' }),
  ]);
  const reason = el('input', { class: 'input', type: 'text', placeholder: 'Důvod neabsolvování / poznámka' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, [ico('check', 18), ' Zaznamenat instruktáž']);
  const f = el('form', { class: 'stack' }, [
    el('p', { class: 'muted small', text: 'Záznam se vytváří AŽ po praktické instruktáži na místě. Ukládá se identita účastníka, identita dozoru, datum a čas, verze instruktáže a výsledek. Potvrzení dokumentů v aplikaci instruktáž nenahrazuje.' }),
    el('div', { class: 'form-row' }, [nameInput, memberId]),
    el('div', { class: 'form-row' }, [result, reason]),
    el('div', { class: 'row-gap' }, [btn]),
  ]);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameInput.value.trim() && !memberId.value.trim()) { toast('Zadejte účastníka (QR/ID účtu nebo jméno).', true); return; }
    if (result.value === 'neabsolvoval' && !reason.value.trim()) { toast('U výsledku „neabsolvoval“ uveďte důvod.', true); return; }
    btn.disabled = true;
    try {
      const r = await dozorPost('/dozor/instruction', {
        memberId: memberId.value.trim() || undefined,
        participantName: nameInput.value.trim() || undefined,
        result: result.value,
        reason: reason.value.trim(),
      });
      if (r.offline) toast('Offline režim: instruktáž uložena v zařízení (přenese se po připojení).', true);
      else toast(`Instruktáž zaznamenána (${r.data.instruction.result}, verze ${r.data.instruction.docVersion}).`);
      nameInput.value = ''; reason.value = '';
      renderProvozniKniha();
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  });
  box.append(f);
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
      el('p', { class: 'muted', text: 'Nejprve otevřete provozní den se zaznamenanou denní kontrolou. Vstup lze povolit jen tehdy, když kontrola vyhovuje, je přítomen dozor, účastník má potvrzené dokumenty, absolvovanou instruktáž a ověřenou totožnost.' }),
    ]),
  ]));

  // ---- 1) PROVOZNÍ KNIHA (musí být první: bez ní nelze nikoho vpustit) ----
  root.append(el('div', { class: 'panel dozor-panel' }, [
    el('h2', { class: 'panel-title' }, [ico('file', 18), ' Provozní kniha — denní kontrola a průběh provozu']),
    el('div', { id: 'provozni-kniha' }, [el('span', { class: 'spinner' })]),
  ]));

  // ---- 2) PRAKTICKÁ INSTRUKTÁŽ ----
  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('shield', 18), ' Praktická instruktáž (zaznamenává dozor)']),
    el('div', { id: 'dozor-instruktaz' }),
  ]));

  // ---- 3) QR KONTROLA VSTUPU ----
  const input = el('input', { class: 'input', type: 'text', placeholder: 'Vložte nebo naskenujte QR kód…', autofocus: 'autofocus' });
  // Ověření totožnosti: účastník s nastaveným PINem jej zadává osobně (zabrání
  // tomu, aby za jiného prošel vstup s cizí kartou).
  const pin = el('input', { class: 'input pin-input', type: 'password', inputmode: 'numeric', placeholder: 'Vstupní PIN účastníka (zadá účastník osobně)' });
  const form = el('form', { class: 'dozor-form' }, [
    input,
    pin,
    el('button', { class: 'btn primary', type: 'submit' }, [ico('qr', 18), ' Načíst QR a zkontrolovat']),
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    openCard(v, { identityPin: pin.value.trim() || null });
    input.value = '';
    pin.value = '';
  });

  const camBtn = el('button', { class: 'btn ghost', type: 'button' }, [ico('qr', 18), ' Skenovat kamerou']);
  camBtn.addEventListener('click', () => toggleCamera(input));

  root.append(el('div', { class: 'panel dozor-panel' }, [
    el('h2', { class: 'panel-title' }, [ico('qr', 18), ' Kontrola vstupu podle QR karty']),
    form, camBtn,
    el('div', { id: 'dozor-cam', class: 'dozor-cam', hidden: 'hidden' }),
    el('div', { class: 'dozor-hint', text: 'Tip: QR kód najde účastník v aplikaci v sekci „Členská karta“. Má-li nastavený vstupní PIN, vyzvěte jej, aby jej zadal osobně — jinak vstup nepovolte.' }),
  ]));

  root.append(el('div', { id: 'dozor-result', class: 'dozor-result' }));

  // ---- 4) rychlý záznam návštěvníka bez QR ----
  const nName = el('input', { class: 'input', type: 'text', placeholder: 'Jméno návštěvníka' });
  const nKind = el('select', { class: 'input' }, [
    el('option', { value: 'neclen', text: 'Nečlen / host' }),
    el('option', { value: 'clen', text: 'Člen' }),
  ]);
  const nNote = el('input', { class: 'input', type: 'text', placeholder: 'Poznámka (nepovinné)' });
  const nDoc = el('select', { class: 'input' }, [
    el('option', { value: 'manual+doklad', text: 'Ověřeno podle dokladu' }),
    el('option', { value: 'manual', text: 'Bez ověření dokladu (výjimka)' }),
  ]);
  const nForm = el('form', { class: 'manual-form' }, [nName, nKind, nDoc, nNote,
    el('button', { class: 'btn', type: 'submit' }, [ico('edit', 16), ' Zaevidovat vstup']),
  ]);
  nForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nName.value.trim()) { toast('Zadejte jméno návštěvníka.', true); return; }
    try {
      const r = await dozorPost('/dozor/entry', {
        personName: nName.value.trim(), kind: nKind.value,
        identityCheck: nDoc.value, note: nNote.value.trim(),
      });
      if (r.offline) toast('Offline režim: vstup uložen v zařízení, přenese se po připojení.', true);
      else toast('Vstup zaevidován.');
      nName.value = ''; nNote.value = '';
      loadRecentEntries();
    } catch (err) { toast(err.message || 'Záznam se nepodařil.', true); }
  });

  root.append(el('div', { class: 'panel' }, [
    el('h2', { class: 'panel-title' }, [ico('edit', 18), ' Návštěvník bez QR kódu']),
    el('p', { class: 'muted small', text: 'Ruční záznam podléhá stejným podmínkám: bez otevřeného provozního dne s vyhovující kontrolou aplikace vstup nepovolí.' }),
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

  // ---- OFFLINE: přenos zápisů po obnovení připojení ----
  if (offlineQueueCount()) {
    try {
      const r = await flushOfflineQueue();
      if (r.sent) toast(`Přeneseno ${r.sent} offline zápisů do provozní knihy.`);
      if (r.left) toast(`${r.left} offline zápisů se nepodařilo přenést — zkuste to znovu.`, true);
    } catch (e) { /* zůstává ve frontě */ }
  }

  renderProvozniKniha();
  renderInstruktazPanel();
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
