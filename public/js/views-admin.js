// views-admin.js — pohledy pro dozor a výbor: přehled členů, detail, kontrola QR, statistiky.
'use strict';

/* ---------- ADMIN: přehled členů ---------- */
async function viewAdmin() {
  const root = $('#view');
  root.innerHTML = '';

  if (!isStaff()) {
    root.append(el('div', { class: 'alert err', text: 'Tato sekce je pouze pro dozor a výbor spolku.' }));
    return;
  }

  root.append(el('h1', { text: 'Správa členů' }), el('p', { class: 'muted', text: 'Přehled členů, stav souhlasů a plateb. (Dozor / výbor)' }));

  // Dozor / výbor: jen kontrola QR karty — NIKDY nevidí seznam všech členů.
  // Seznam členů mají pouze admin (superadmin) — viz '/admin/members' guard.
  if (!isSuperAdmin()) {
    root.append(el('div', { class: 'alert info', text: 'Přehled všech členů je dostupný pouze administrátorovi spolku. Vy zde máte kontrolu členství přes QR kartu.' }));
    const door = el('div', { class: 'card' }, [
      el('h3', { text: 'Kontrola členství (QR)' }),
      el('p', { class: 'muted small', text: 'Zadejte payload QR karty (text začínající TJK:) nebo ji naskenujte.' }),
      el('input', { type: 'text', id: 'qr-input', placeholder: 'TJK:12:abc…', class: 'mono' }),
      el('div', { id: 'qr-result' }),
      el('button', { class: 'btn', id: 'qr-check', text: 'Ověřit kartu' }),
    ]);
    root.append(door);
    $('#qr-check').addEventListener('click', async () => {
      const payload = $('#qr-input').value.trim();
      if (!payload) { toast('Zadejte payload QR karty', true); return; }
      try {
        const r = await API.post('/check-card', { qrPayload: payload });
        const box = $('#qr-result');
        box.innerHTML = '';
        box.append(el('div', { class: `alert ${r.ok ? 'ok' : 'err'}` }, [
          el('div', {}, [el('strong', { text: r.memberName }), ` (ID ${(r.memberId || '').slice(0, 8)}…)`]),
          el('div', { text: r.message }),
          el('div', { class: 'small muted', text: `Platnost do ${fmtDate(r.validUntil)}` }),
        ]));
      } catch (err) {
        const box = $('#qr-result');
        box.innerHTML = '';
        box.append(el('div', { class: 'alert err', text: err.message }));
      }
    });
    return;
  }

  let stats = null, members = [];
  try {
    [stats, members] = await Promise.all([API.get('/admin/stats'), API.get('/admin/members')]);
    members = members.members;
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }

  const statCard = el('div', { class: 'card' }, [
    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon orange' }, [ico('user')]), el('span', { class: 'st-label', text: 'Celkem členů' }), el('div', { class: 'st-value', text: String(stats.total) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon green' }, [ico('check')]), el('span', { class: 'st-label', text: 'Aktivních' }), el('div', { class: 'st-value', text: String(stats.statuses.active || 0) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon gold' }, [ico('card')]), el('span', { class: 'st-label', text: 'Vybrané příspěvky' }), el('div', { class: 'st-value', text: fmtCzk(stats.paidCzk) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon blue' }, [ico('clock')]), el('span', { class: 'st-label', text: 'Čeká na platbu' }), el('div', { class: 'st-value', text: String(stats.statuses.payment_pending || 0) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon blue' }, [ico('shield')]), el('span', { class: 'st-label', text: 'Čeká na rodiče' }), el('div', { class: 'st-value', text: String(stats.pendingGuardian) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon green' }, [ico('check')]), el('span', { class: 'st-label', text: 'Úhrad celkem' }), el('div', { class: 'st-value', text: String(stats.paidCount) })]),
    ]),
  ]);
  root.append(statCard);

  // kontrola QR karty
  const checkCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Kontrola členství (QR)' }),
    el('p', { class: 'muted small', text: 'Zadejte payload QR karty (text začínající TJK:) nebo ji naskenujte.' }),
    el('input', { type: 'text', id: 'qr-input', placeholder: 'TJK:12:abc…', class: 'mono' }),
    el('div', { id: 'qr-result' }),
    el('button', { class: 'btn', id: 'qr-check', text: 'Ověřit kartu' }),
  ]);
  root.append(checkCard);

  $('#qr-check').addEventListener('click', async () => {
    const payload = $('#qr-input').value.trim();
    if (!payload) { toast('Zadejte payload QR karty', true); return; }
    try {
      const r = await API.post('/check-card', { qrPayload: payload });
      const box = $('#qr-result');
      box.innerHTML = '';
      box.append(el('div', { class: `alert ${r.ok ? 'ok' : 'err'}` }, [
        el('div', {}, [el('strong', { text: r.memberName }), ` (ID ${(r.memberId||"").slice(0,8)}…)`]),
        el('div', { text: r.message }),
        el('div', { class: 'small muted', text: `Platnost do ${fmtDate(r.validUntil)}` }),
      ]));
    } catch (err) {
      const box = $('#qr-result');
      box.innerHTML = '';
      box.append(el('div', { class: 'alert err', text: err.message }));
    }
  });

  // tabulka členů
  const table = el('div', { class: 'card' }, [el('h3', { text: 'Seznam členů' })]);
  const t = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['ID', 'Jméno', 'Typ', 'Status', 'Souhlasy', 'Platba'].map((h) => el('th', { text: h })))]),
    el('tbody'),
  ]);
  const tbody = $('tbody', t);
  for (const m of members) {
    const consentOk = m.consentOk && m.guardianOk;
    const tr = el('tr', { onclick: () => { location.hash = `#/admin/${m.id}`; }, style: 'cursor:pointer' }, [
      el('td', { class: 'mono', text: m.id.slice(0, 8) }),
      el('td', { text: m.name }),
      el('td', { text: MEMBERSHIP_LABEL[m.membershipType] || m.membershipType }),
      el('td', {}, [statusTag(m.status)]),
      el('td', {}, [el('span', { class: `tag ${consentOk ? 'ok' : 'warn'}`, text: consentOk ? 'OK' : 'chybí' })]),
      el('td', { text: m.paid ? '✓' : '—' }),
    ]);
    tbody.append(tr);
  }
  table.append(t);
  root.append(table);
}

/* ---------- ADMIN: detail člena (auditní stopa) ---------- */
async function viewAdminDetail(memberId) {
  const root = $('#view');
  root.innerHTML = '';
  if (!isSuperAdmin()) { root.append(el('div', { class: 'alert err', text: 'Nedostatečná práva — detail člena je dostupný pouze administrátorovi.' })); return; }

  root.append(el('h1', { text: 'Detail člena' }), el('a', { class: 'btn small ghost', href: '#/admin', text: '← Zpět na přehled' }));

  let d;
  try {
    d = await API.get(`/admin/members/${memberId}`);
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }
  const m = d.member;

  const info = el('div', { class: 'card' }, [
    el('h3', { text: `${m.firstName} ${m.lastName}` }),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'ID člena' }), el('span', { class: 'mono', text: m.id })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Datum narození' }), el('span', { text: m.birthDate })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Kontakt' }), el('span', { text: `${m.email}${m.phone ? ' · ' + m.phone : ''}` })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Typ členství' }), el('span', { text: MEMBERSHIP_LABEL[m.membershipType] || m.membershipType })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Status' }), statusTag(d.status)]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Platnost' }), el('span', { text: m.validUntil ? `do ${fmtDate(m.validUntil)}` : '—' })]),
    el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Zákonný zástupce' }), el('span', { text: d.member.guardianStatus === 'not_required' ? 'není vyžadován' : `${d.member.guardianName} (${d.member.guardianRelation}) — ${d.member.guardianStatus}` })]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn accent small', text: 'Schválit / aktivovat', onclick: () => setStatus(m.id, 'active') }),
      el('button', { class: 'btn secondary small', text: 'Zamítnout', onclick: () => setStatus(m.id, 'rejected') }),
    ]),
  ]);
  root.append(info);

  // AUDITNÍ STOPA
  const audit = el('div', { class: 'card' }, [el('h3', { text: 'Auditní stopa souhlasů' }), el('p', { class: 'muted small', text: 'Kdo, s čím, kdy a odkud souhlasil — nelze zpochybnit.' })]);
  if (!d.consents.length) audit.append(el('div', { class: 'empty', text: 'Žádné souhlasy.' }));
  for (const c of d.consents) {
    audit.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name', text: `${c.docKey} v${c.version} (${c.signerType === 'guardian' ? 'zákonný zástupce' : 'člen'})` }),
        el('div', { class: 'l-sub mono', text: `${c.grantedAt} · ${c.identity} · IP ${c.ip}${c.userAgent ? ' · ' + (c.userAgent || '').slice(0, 60) : ''}` }),
        el('div', { class: 'l-sub mono', text: `hash ${c.contentHash}` }),
      ]),
      el('span', { class: 'tag ok', text: 'podepsáno' }),
    ]));
  }
  root.append(audit);

  // platby
  const pays = el('div', { class: 'card' }, [el('h3', { text: 'Platby' })]);
  if (!d.payments.length) pays.append(el('div', { class: 'empty', text: 'Žádné platby.' }));
  for (const p of d.payments) {
    pays.append(el('div', { class: 'list-row' }, [
      el('div', {}, [
        el('div', { class: 'l-name', text: `${p.purpose} · ${fmtCzk(p.amount_czk)}` }),
        el('div', { class: 'l-sub', text: `${fmtDateTime(p.created_at)} · ${p.gateway}${p.receipt_no ? ' · účtenka ' + p.receipt_no : ''}` }),
      ]),
      el('span', { class: `tag ${p.status === 'paid' ? 'ok' : p.status === 'pending' ? 'blue' : 'bad'}`, text: p.status }),
    ]));
  }
  root.append(pays);

  async function setStatus(id, status) {
    try {
      await API.post(`/admin/members/${id}/status`, { status });
      toast('Status aktualizován');
      viewAdminDetail(id);
    } catch (e) {
      toast(e.message, true);
    }
  }
}

/* ---------- SUPERADMIN: vlastník aplikace (jen miroslavbrozek@gmail.com) ---------- */
async function viewSuperAdmin() {
  const root = $('#view');
  root.innerHTML = '';

  if (!isSuperAdmin()) {
    root.append(el('div', { class: 'alert err', text: 'Tato sekce je dostupná pouze vlastníkovi aplikace.' }));
    return;
  }

  root.append(el('h1', { text: 'Správa — vlastník' }), el('p', { class: 'muted', text: 'Kompletní přehled členů, typů členství a QR karet. Dostupný pouze vlastníkovi aplikace.' }));

  let data, types;
  try {
    [data, types] = await Promise.all([API.get('/superadmin/members'), API.get('/superadmin/member-types')]);
  } catch (e) {
    root.append(el('div', { class: 'alert err', text: e.message }));
    return;
  }
  const members = data.members || [];

  // statistiky
  const activeCount = members.filter((m) => m.status === 'active').length;
  const statCard = el('div', { class: 'card' }, [
    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon orange' }, [ico('user')]), el('span', { class: 'st-label', text: 'Členů celkem' }), el('div', { class: 'st-value', text: String(members.length) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon green' }, [ico('check')]), el('span', { class: 'st-label', text: 'Aktivních' }), el('div', { class: 'st-value', text: String(activeCount) })]),
      el('div', { class: 'stat-tile' }, [el('span', { class: 'st-icon blue' }, [ico('card')]), el('span', { class: 'st-label', text: 'Typů členství' }), el('div', { class: 'st-value', text: String(types.types.length) })]),
    ]),
  ]);
  root.append(statCard);

  // typy členství
  const typesCard = el('div', { class: 'card' }, [el('h3', { text: 'Typy členství' })]);
  const tt = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['Typ', 'Cena', 'Členů'].map((h) => el('th', { text: h })))]),
    el('tbody'),
  ]);
  const tbody = $('tbody', tt);
  for (const t of types.types) {
    tbody.append(el('tr', {}, [
      el('td', {}, [el('strong', { text: t.label }), el('div', { class: 'small muted', text: t.description })]),
      el('td', { text: fmtCzk(t.priceCzk) }),
      el('td', { text: String(t.memberCount) }),
    ]));
  }
  typesCard.append(tt);
  root.append(typesCard);

  // synchronizace se Supabase členskou evidencí
  const syncCard = el('div', { class: 'card' }, [
    el('h3', {}, [ico('users', 17), ' ', 'Synchronizace se Supabase evidencí']),
    el('p', { class: 'muted small', text: 'Noví členové a platby se do členské evidence (public.members) odesílají automaticky. Tlačítko odešle celou evidenci najednou.' }),
    el('div', { id: 'sa-sync-status', class: 'sa-sync-status', text: 'Načítám stav…' }),
    el('div', { class: 'row-gap', style: 'margin-top:12px' }, [
      el('button', { id: 'sa-sync-btn', class: 'btn ghost small', type: 'button', text: 'Odeslat celou evidenci do Supabase', onclick: async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true; b.textContent = 'Odesílám…';
        try {
          const res = await API.post('/superadmin/sync');
          const st = $('#sa-sync-status');
          if (res.mode === 'off') {
            st.textContent = 'Synchronizace je vypnutá (SUPABASE_SYNC=off v .env) — nic se neodeslalo.';
            st.className = 'sa-sync-status muted';
          } else if (res.mode === 'dry-run') {
            st.textContent = `Dry-run: ${res.total} členů zpracováno (${res.synced} OK), nic se nezapsalo. Podrobnosti v logu serveru.`;
            st.className = 'sa-sync-status warn';
          } else {
            st.textContent = `Odesláno: ${res.synced} z ${res.total} členů.`;
            st.className = 'sa-sync-status ok';
          }
          toast(res.mode === 'off' ? 'Sync je vypnutý — nastavte SUPABASE_SYNC v .env' : 'Sync dokončen');
        } catch (err) {
          toast(err.message, true);
        } finally {
          b.disabled = false; b.textContent = 'Odeslat celou evidenci do Supabase';
        }
      } }),
    ]),
  ]);
  root.append(syncCard);

  // Evidence IS ČUS (public.members) — celá členská evidence spolku.
  const ev = data.evidence && data.evidence.ok ? data.evidence.members : [];
  const evCard = el('div', { class: 'card' }, [
    el('h3', {}, [ico('db', 17), ' ', 'Evidence členů (Supabase / public.members)']),
    el('p', { class: 'muted small', text: 'Všech ' + ev.length + ' členů z členské evidence TJ Krupka (IS ČUS). Údaje čtené přímo z Supabase tabulky members. (Její zobrazení i čtení je dostupné pouze vám.)' }),
  ]);
  if (data.evidence && !data.evidence.ok) {
    evCard.append(el('div', { class: 'alert warn', text: 'Evidenci se nepodařilo načíst (' + (data.evidence.error || 'neznámá chyba') + '). Zkontrolujte SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' }));
  } else if (ev.length) {
    const evt = el('table', {}, [
      el('thead', {}, [el('tr', {}, ['ID', 'Jméno', 'E-mail', 'Telefon', 'Oddíl', 'Od', 'Do'].map((h) => el('th', { text: h })))]),
      el('tbody'),
    ]);
    const evBody = $('tbody', evt);
    for (const m of ev) {
      const tr = el('tr', {}, [
        el('td', { class: 'mono', text: String(m.idCus) }),
        el('td', {}, [el('strong', { text: m.fullName })]),
        el('td', { text: m.email || '—' }),
        el('td', { text: m.phone || '—' }),
        el('td', { text: m.oddil || '—' }),
        el('td', { class: 'mono', text: fmtDate(m.memberFrom) }),
        el('td', { class: 'mono', text: fmtDate(m.memberTo) }),
      ]);
      evBody.append(tr);
    }
    evCard.append(evt);
  } else {
    evCard.append(el('p', { class: 'muted', text: 'Evidence neobsahuje žádné členy.' }));
  }
  root.append(evCard);

  API.get('/superadmin/sync-status').then((s) => {
    const st = $('#sa-sync-status');
    if (!st) return;
    const cfgText = s.config && s.config.url ? ` · projekt ${s.config.url}` : ' · URL nenastavena';
    if (s.mode === 'on') {
      st.textContent = `Zapnuto (${s.mode})${cfgText} — noví členové se odesílají automaticky.`;
      st.className = 'sa-sync-status ok';
    } else if (s.mode === 'dry-run') {
      st.textContent = `Dry-run${cfgText} — zapisování je vypnuté, jen log.`;
      st.className = 'sa-sync-status warn';
    } else {
      st.textContent = `Vypnuto (${s.mode})${cfgText} — nastavte SUPABASE_SYNC=on v .env a restartujte.`;
      st.className = 'sa-sync-status muted';
    }
  }).catch(() => { /* ticho */ });

  // seznam členů + detail (všechny informace) + QR karta
  const membersCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Všichni členové' }),
    el('p', { class: 'muted small', text: 'Kliknutím na člena zobrazíte kompletní informace včetně QR karty.' }),
    el('div', { class: 'row-gap', style: 'margin-top:10px' }, [
      el('button', { class: 'btn ghost small', type: 'button', text: 'Export CSV (všichni členové)', onclick: () => exportMembersCsv(members) }),
    ]),
  ]);

  const qrPanel = el('div', { id: 'sa-qr', class: 'sa-qr', hidden: true });
  membersCard.append(qrPanel);

  const mt = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['ID', 'Jméno', 'E-mail', 'Typ členství', 'Role', 'Status', 'Platnost'].map((h) => el('th', { text: h })))]),
    el('tbody'),
  ]);
  const mbody = $('tbody', mt);
  for (const m of members) {
    const tr = el('tr', { style: 'cursor:pointer', class: 'sa-member-row' }, [
      el('td', { class: 'mono', text: m.id.slice(0, 8) }),
      el('td', { text: m.name }),
      el('td', { class: 'small', text: m.email }),
      el('td', { text: m.membershipLabel }),
      el('td', {}, [el('span', { class: `tag ${m.role === 'superadmin' ? 'warn' : m.role === 'dozor' || m.role === 'vybor' ? 'blue' : 'gray'}`, text: m.role })]),
      el('td', {}, [statusTag(m.status)]),
      el('td', { class: 'small', text: m.validUntil ? fmtDate(m.validUntil) : '—' }),
    ]);
    tr.addEventListener('click', async () => {
      // kompletní detail člena (vždy) + QR karta (pokud je vystavená)
      qrPanel.hidden = false;
      qrPanel.innerHTML = '';
      const dl = (label, value, mono) => el('div', { class: 'sa-dl-row' }, [el('span', { class: 'muted', text: label }), el('span', { class: mono ? 'mono' : '', text: value || '—' })]);
      const sec = (title, rows) => el('div', { class: 'sa-detail-sec' }, [el('h4', { text: title }), ...rows]);
      qrPanel.append(
        el('h3', {}, [ico('user', 17), ' ', `${m.name}`]),
        el('div', { class: 'row-gap', style: 'margin-bottom:14px' }, [
          el('span', { class: `tag ${m.role === 'superadmin' ? 'warn' : m.role === 'dozor' || m.role === 'vybor' ? 'blue' : 'gray'}`, text: m.role }),
          statusTag(m.status),
          m.paid ? el('span', { class: 'tag ok', text: 'příspěvek uhrazen' }) : el('span', { class: 'tag warn', text: 'příspěvek neuhrazen' }),
        ]),
        el('div', { class: 'sa-detail-grid' }, [
          sec('Osobní údaje', [
            dl('Jméno a příjmení', `${m.firstName} ${m.lastName}`),
            dl('Datum narození', m.birthDate ? fmtDate(m.birthDate) : null),
            dl('ID člena', m.id, true),
            dl('Pořadové č.', String(m.memberNo ?? '—')),
          ]),
          sec('Kontakt a adresa', [
            dl('E-mail', m.email),
            dl('Telefon', m.phone),
            dl('Ulice', m.street),
            dl('Město', m.city),
            dl('PSČ', m.zip),
          ]),
          sec('Členství', [
            dl('Kategorie', m.membershipLabel),
            dl('Platnost od', m.validFrom ? fmtDate(m.validFrom) : null),
            dl('Platnost do', m.validUntil ? fmtDate(m.validUntil) : null),
            dl('Registrován', m.createdAt ? fmtDateTime(m.createdAt) : null),
            dl('Poslední změna', m.updatedAt ? fmtDateTime(m.updatedAt) : null),
            dl('Udělené souhlasy', `${m.consentsCount} z 4`),
          ]),
          m.guardianStatus && m.guardianStatus !== 'not_required' ? sec('Zákonný zástupce', [
            dl('Jméno', m.guardianName),
            dl('Vztah', m.guardianRelation),
            dl('E-mail', m.guardianEmail),
            dl('Telefon', m.guardianPhone),
            dl('Stav souhlasu', m.guardianStatus === 'granted' ? 'udělen' : m.guardianStatus === 'pending' ? 'čeká se' : m.guardianStatus),
            dl('Udělen', m.guardianGrantedAt ? fmtDateTime(m.guardianGrantedAt) : null),
          ]) : null,
        ])
      );
      // QR karta se načítá zvlášť — její absence nesmí skrýt detail
      try {
        const card = await API.get(`/superadmin/members/${m.id}/card`);
        qrPanel.append(
          el('div', { class: 'sa-qr-inner', style: 'margin-top:16px' }, [
            el('img', { src: card.qrDataUrl, alt: 'QR karta člena' }),
            el('div', { class: 'sa-qr-info' }, [
              el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Typ členství' }), el('strong', { text: card.membershipLabel })]),
              el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Status' }), statusTag(card.status)]),
              el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Platnost' }), el('span', { text: card.validUntil ? `do ${fmtDate(card.validUntil)}` : '—' })]),
              el('div', { class: 'list-row' }, [el('span', { class: 'muted', text: 'Payload' }), el('span', { class: 'mono', text: card.qrPayload })]),
              el('button', { class: 'btn small ghost', text: 'Ověřit platnost karty' }),
            ]),
          ])
        );
        const verifyBtn = qrPanel.querySelector('button');
        verifyBtn.addEventListener('click', async () => {
          try {
            const r = await API.post('/check-card', { qrPayload: card.qrPayload });
            toast(`${r.memberName} (ID ${(r.memberId || '').slice(0, 8)}…) — ${r.message}`);
          } catch (e) { toast(e.message, true); }
        });
      } catch (e) {
        qrPanel.append(el('div', { class: 'alert warn small', style: 'margin-top:14px', text: `QR karta zatím není vystavená.` }));
      }
    });
    mbody.append(tr);
  }
  membersCard.append(mt);
  root.append(membersCard);

  // načtení QR payloadu (skener/vstup)
  const scanCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Načíst QR kartu' }),
    el('p', { class: 'muted small', text: 'Zadejte payload QR karty (text začínající TJK:) — ověří člena a stav členství.' }),
    el('input', { type: 'text', id: 'sa-qr-input', placeholder: 'TJK:12:abc…', class: 'mono' }),
    el('div', { id: 'sa-qr-result' }),
    el('button', { class: 'btn', id: 'sa-qr-check', text: 'Ověřit kartu' }),
  ]);
  root.append(scanCard);

  $('#sa-qr-check').addEventListener('click', async () => {
    const payload = $('#sa-qr-input').value.trim();
    if (!payload) { toast('Zadejte payload QR karty', true); return; }
    try {
      const r = await API.post('/check-card', { qrPayload: payload });
      const box = $('#sa-qr-result');
      box.innerHTML = '';
      box.append(el('div', { class: `alert ${r.ok ? 'ok' : 'err'}` }, [
        el('div', {}, [el('strong', { text: r.memberName }), ` (ID ${(r.memberId||"").slice(0,8)}…)`]),
        el('div', { text: r.message }),
        el('div', { class: 'small muted', text: `Platnost do ${fmtDate(r.validUntil)}` }),
      ]));
    } catch (err) {
      const box = $('#sa-qr-result');
      box.innerHTML = '';
      box.append(el('div', { class: 'alert err', text: err.message }));
    }
  });
}

/* ---------- rezervace (univerzální — dle zařízení/výhody) ---------- */
async function viewBookings() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Rezervace' }));

  if (!me || me.status !== 'active') {
    root.append(el('div', { class: 'alert warn', text: 'Rezervovat mohou pouze aktivní členové s uhrazeným příspěvkem.' }));
    if (me) root.append(el('a', { class: 'btn', href: '#/platba', text: 'K platbě' }));
    return;
  }

  // seznam zařízení (airbag + budoucí rozšíření)
  let facilities = [];
  try {
    facilities = (await API.get('/facilities')).facilities;
  } catch (e) { /* offline */ }
  if (!facilities.length) facilities = [{ code: 'airbag', name: 'Dopadová matrace', shortName: 'Airbag' }];

  const facilitySel = el('select', { id: 'bk-facility' }, facilities.map((f) => el('option', { value: f.code, text: f.name })));
  const today = new Date();
  const dateInput = el('input', {
    type: 'date', id: 'bk-date', value: today.toISOString().slice(0, 10),
    min: today.toISOString().slice(0, 10),
  });
  const slotsBox = el('div', { id: 'bk-slots', class: 'slot-grid' });
  const myBookings = el('div', { class: 'card soft', id: 'bk-mine' });

  const load = async () => {
    const date = dateInput.value;
    const code = facilitySel.value;
    try {
      const res = await API.get(`/bookings?date=${date}&facility=${encodeURIComponent(code)}`);
      slotsBox.innerHTML = '';
      const facName = (res.facility && res.facility.name) || '';
      for (const s of res.slots) {
        const mine = s.bookedBy === me.member.id;
        const slot = el('div', { class: `slot ${s.taken ? 'taken' : ''} ${mine ? 'mine' : ''}`, text: `${s.start.slice(11, 16)}–${s.end.slice(11, 16)}` });
        if (!s.taken) {
          slot.addEventListener('click', async () => {
            try {
              await API.post('/bookings', { date, hour: parseInt(s.start.slice(11, 13), 10), facility: code });
              toast('Rezervace potvrzena');
              load();
            } catch (e) { toast(e.message, true); }
          });
        }
        slotsBox.append(slot);
      }
    } catch (e) {
      slotsBox.innerHTML = '';
      slotsBox.append(el('div', { class: 'alert err', text: e.message }));
    }
  };

  dateInput.addEventListener('change', load);
  facilitySel.addEventListener('change', load);
  root.append(el('div', { class: 'card' }, [
    el('label', { text: 'Zařízení' }), facilitySel,
    el('label', { text: 'Datum' }), dateInput,
    el('p', { class: 'muted small', text: 'Sloty po 60 minutách. Na zařízení je vždy jen jedna osoba.' }),
    slotsBox,
  ]), myBookings);
  load();
}

/* ---------- merch (bonus MVP) ---------- */
async function viewMerch() {
  const root = $('#view');
  root.innerHTML = '';
  root.append(el('h1', { text: 'Merch — Tělovýchovná jednota Krupka' }), el('p', { class: 'muted', text: 'Objednávka pro členy — osobní odběr na místě.' }));

  if (!me) {
    root.append(el('div', { class: 'alert warn', text: 'Merch je pouze pro členy — přihlaste se.' }), el('a', { class: 'btn', href: '#/prihlaseni', text: 'Přihlásit se' }));
    return;
  }

  let products = [];
  try {
    products = (await API.get('/merch')).products;
  } catch (e) { root.append(el('div', { class: 'alert err', text: e.message })); return; }

  const cart = [];
  const cartBox = el('div', { class: 'card', id: 'cart-box' });

  const renderCart = () => {
    cartBox.innerHTML = '';
    cartBox.append(el('h3', { text: 'Košík' }));
    if (!cart.length) { cartBox.append(el('div', { class: 'empty', text: 'Košík je prázdný.' })); return; }
    let total = 0;
    for (const item of cart) {
      total += item.priceCzk * item.qty;
      cartBox.append(el('div', { class: 'list-row' }, [
        el('span', { text: `${item.name}${item.size ? ' (' + item.size + ')' : ''} × ${item.qty}` }),
        el('span', { text: fmtCzk(item.priceCzk * item.qty) }),
      ]));
    }
    cartBox.append(el('div', { class: 'list-row' }, [el('strong', { text: 'Celkem' }), el('strong', { text: fmtCzk(total) })]));
    const orderBtn = el('button', { class: 'btn', text: 'Objednat a zaplatit' });
    orderBtn.addEventListener('click', async () => {
      try {
        const res = await API.post('/merch/orders', {
          items: cart.map((c) => ({ productId: c.id, qty: c.qty, size: c.size })),
        });
        toast('Objednávka vytvořena');
        location.hash = `#/platba/${res.order.payment_id || ''}`;
      } catch (e) { toast(e.message, true); }
    });
    cartBox.append(orderBtn);
  };

  for (const p of products) {
    const card = el('div', { class: 'card soft' }, [
      el('div', { class: 't-head' }, [el('span', { class: 't-name', text: p.name }), el('span', { class: 't-price', text: fmtCzk(p.price_czk) })]),
      el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
        p.size_required === 1 ? el('select', { class: 'size-sel' }, ['S', 'M', 'L', 'XL'].map((s) => el('option', { value: s, text: s }))) : el('span'),
        el('button', { class: 'btn small accent', text: 'Do košíku', onclick: (ev) => {
          const size = p.size_required === 1 ? $('.size-sel', card).value : null;
          const existing = cart.find((c) => c.id === p.id && c.size === size);
          if (existing) existing.qty++;
          else cart.push({ id: p.id, name: p.name, size, qty: 1, priceCzk: p.price_czk });
          renderCart();
        } }),
      ]),
    ]);
    root.append(card);
  }
  root.append(cartBox);
  renderCart();
}

/* ---------- EXPORT CSV (vlastník — kompletní seznam členů) ---------- */
// Stáhne všechny členy se všemi informacemi jako CSV (BOM + středníky → Excel).
function exportMembersCsv(members) {
  const cols = [
    ['id', 'ID člena'], ['memberNo', 'Pořadové č.'], ['name', 'Jméno'],
    ['birthDate', 'Datum narození'], ['email', 'E-mail'], ['phone', 'Telefon'],
    ['street', 'Ulice'], ['city', 'Město'], ['zip', 'PSČ'],
    ['membershipLabel', 'Kategorie'], ['role', 'Role'], ['status', 'Status'],
    ['validFrom', 'Platnost od'], ['validUntil', 'Platnost do'],
    ['guardianName', 'Zák. zástupce'], ['guardianRelation', 'Vztah'],
    ['guardianEmail', 'E-mail zástupce'], ['guardianPhone', 'Tel. zástupce'],
    ['guardianStatus', 'Stav souhlasu'], ['consentsCount', 'Souhlasy'],
    ['paid', 'Příspěvek uhrazen'], ['createdAt', 'Registrován'], ['updatedAt', 'Poslední změna'],
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(([, label]) => esc(label)).join(';')];
  for (const m of members) {
    lines.push(cols.map(([key]) => esc(m[key])).join(';'));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clenove-tj-krupka-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exportováno ${members.length} členů`);
}

/* ============================================================
   ADMIN KATALOGU: produkty, varianty, dokumenty (superadmin)
   ============================================================ */
async function viewAdminCatalog() {
  const root = $('#view');
  root.innerHTML = '';
  if (!isSuperAdmin()) {
    root.append(el('h1', { text: 'Omezený přístup' }), el('div', { class: 'alert err', text: 'Tato sekce je dostupná pouze vlastníkovi aplikace.' }));
    return;
  }
  root.append(el('h1', { text: 'Konfigurace katalogu' }));
  root.append(el('p', { class: 'muted', text: 'Produkty, jejich varianty (cena/role/věk), povinné dokumenty a znění dokumentů. Změny se projeví okamžitě — bez nové verze aplikace. Nová verze textu dokumentu vyvolá u uživatelů nový souhlas.' }));

  let cat;
  try { cat = await API.get('/superadmin/catalog'); }
  catch (e) { root.append(el('div', { class: 'alert err', text: e.message })); return; }
  const docsByKey = {};
  for (const d of cat.docs || []) docsByKey[d.docKey] = d;
  const allDocKeys = Object.keys(docsByKey);

  const reload = async () => { viewAdminCatalog(); };
  const notice = (ok, txt) => { toast(txt, !ok); if (ok) setTimeout(reload, 700); };

  // ---- editor varianty (přidat / upravit)
  const checkRow = (name, checked) => el('label', { class: 'check', style: 'padding:6px 10px;margin:3px 0' }, [
    el('input', { type: 'checkbox', name, checked: !!checked, value: '1' }),
    el('span', { class: 'check-title', style: 'font-size:.85rem', text: name }),
  ]);
  function variantEditor(productCode, v) {
    const wrap = el('div', { class: 'card', style: 'border-color:var(--border-strong)' });
    wrap.append(el('h3', { text: v ? `Upravit variantu (${productCode})` : `Nová varianta (${productCode})` }));
    const sel = (name, opts, val, label) => {
      const row = el('div', {});
      row.append(el('label', { text: label }));
      row.append(el('select', { name }, opts.map((o) => el('option', { value: o, text: o, selected: val === o }))));
      return row;
    };
    const grid = el('div', { class: 'form-grid' });
    grid.append(sel('audience', ['PUBLIC', 'MEMBER'], (v && v.audience) || 'PUBLIC', 'Publikum'));
    grid.append(sel('age_type', ['ANY', 'ADULT', 'MINOR'], (v && v.ageType) || 'ANY', 'Věková kategorie'));
    const priceWrap = el('div', {});
    priceWrap.append(el('label', { text: 'Cena (Kč)' }));
    priceWrap.append(el('input', { type: 'number', name: 'price_czk', value: v ? v.priceCzk : '' }));
    grid.append(priceWrap);
    const sortWrap = el('div', {});
    sortWrap.append(el('label', { text: 'Pořadí' }));
    sortWrap.append(el('input', { type: 'number', name: 'sort_order', value: v ? (v.sortOrder || 0) : 0 }));
    grid.append(sortWrap);
    wrap.append(grid);
    // dokumenty
    const docBox = el('div', { class: 'form-grid', style: 'margin-top:8px' });
    const userCol = el('div', {});
    userCol.append(el('label', { text: 'Dokumenty (uživatel)' }));
    const vDocs = new Set((v && v.docKeys) || []);
    const userChecks = [];
    for (const k of allDocKeys) {
      const c = el('label', { class: 'check', style: 'padding:5px 9px;margin:2px 0' }, [
        el('input', { type: 'checkbox', name: 'doc', value: k, checked: vDocs.has(k) }),
        el('span', { class: 'check-title', style: 'font-size:.82rem', text: docsByKey[k].title }),
      ]);
      userChecks.push(c); userCol.append(c);
    }
    const guardCol = el('div', {});
    guardCol.append(el('label', { text: 'Zástupce podepisuje (nezletilý)' }));
    const sameAsUser = el('label', { class: 'check', style: 'padding:5px 9px' }, [
      el('input', { type: 'checkbox', name: 'guardian_same', checked: v ? v.guardianDocKeys === null : true, value: '1' }),
      el('span', { class: 'check-title', style: 'font-size:.82rem', text: 'Stejné jako u uživatele' }),
    ]);
    guardCol.append(sameAsUser);
    const gSet = new Set((v && v.guardianDocKeys) || []);
    const gChecks = [];
    for (const k of allDocKeys) {
      const c = el('label', { class: 'check', style: 'padding:5px 9px;margin:2px 0' }, [
        el('input', { type: 'checkbox', name: 'gdoc', value: k, checked: gSet.has(k) }),
        el('span', { class: 'check-title', style: 'font-size:.82rem', text: docsByKey[k].title }),
      ]);
      gChecks.push(c); guardCol.append(c);
    }
    docBox.append(userCol, guardCol);
    wrap.append(docBox);
    const act = el('label', { class: 'check', style: 'margin-top:8px' }, [
      el('input', { type: 'checkbox', name: 'active', checked: v ? !!v.active : true, value: '1' }),
      el('span', { class: 'check-title', text: 'Aktivní' }),
    ]);
    wrap.append(act);
    const btn = el('button', { class: 'btn', text: v ? 'Uložit změny' : 'Přidat variantu' });
    wrap.append(btn);
    btn.addEventListener('click', async () => {
      const payload = {
        id: v ? v.id : undefined,
        productCode,
        audience: $('[name="audience"]', wrap).value,
        ageType: $('[name="age_type"]', wrap).value,
        priceCzk: Number($('[name="price_czk"]', wrap).value),
        sortOrder: Number($('[name="sort_order"]', wrap).value) || 0,
        active: !!$('[name="active"]', wrap).checked,
        docKeys: userChecks.filter((c) => $('input', c).checked).map((c) => $('input', c).value),
      };
      const same = !!$('[name="guardian_same"]', wrap).checked;
      payload.guardianDocKeys = same ? null : gChecks.filter((c) => $('input', c).checked).map((c) => $('input', c).value);
      try {
        const res = await API.post('/superadmin/variants', payload);
        notice(true, res.ok ? 'Varianta uložena' : 'Chyba');
      } catch (err) { toast(err.message, true); }
    });
    return wrap;
  }

  // ---- produkty + varianty
  const prodHead = el('h2', { text: 'Produkty a varianty' });
  root.append(prodHead);
  const newProd = el('details', { class: 'doc-details' }, [
    el('summary', { text: '+ Nový produkt' }),
    el('div', { class: 'doc-body' }, [
      el('div', { class: 'form-grid' }, [
        el('div', {}, [el('label', { text: 'Kód (code)' }), el('input', { type: 'text', id: 'np-code' })]),
        el('div', {}, [el('label', { text: 'Název' }), el('input', { type: 'text', id: 'np-name' })]),
        el('div', {}, [el('label', { text: 'Jednotka' }), el('input', { type: 'text', id: 'np-unit', value: 'den' })]),
        el('div', {}, [el('label', { text: 'Platnost (h)' }), el('input', { type: 'number', id: 'np-hours', value: '1' })]),
      ]),
      el('button', { class: 'btn small', text: 'Vytvořit produkt' }),
    ]),
  ]);
  root.append(newProd);
  $('button', newProd).addEventListener('click', async () => {
    try {
      await API.post('/superadmin/products', {
        code: $('#np-code').value, name: $('#np-name').value,
        unit: $('#np-unit').value, validityHours: Number($('#np-hours').value),
      });
      notice(true, 'Produkt vytvořen');
    } catch (err) { toast(err.message, true); }
  });

  for (const p of cat.products || []) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', { style: 'display:flex;gap:8px;align-items:baseline;flex-wrap:wrap' }, [String(p.name || ''), el('span', { class: 'mono', text: ' ' + p.code })]));
    const vars = (cat.variants || []).filter((v) => v.productCode === p.code);
    for (const v of vars) {
      const row = el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', { class: 'l-name' }, [
            el('span', { class: 'tag ' + (v.audience === 'MEMBER' ? 'blue' : 'gray'), text: v.audience }),
            el('span', { class: 'tag gray', text: v.ageType }),
            el('strong', { style: 'margin-left:6px', text: `${fmtCzk(v.priceCzk)}` }),
            !v.active ? el('span', { class: 'tag bad', text: 'neaktivní' }) : null,
          ]),
          el('div', { class: 'l-sub mono', text: `docs: ${(v.docKeys || []).join(', ') || '—'} · zástupce: ${v.guardianDocKeys ? v.guardianDocKeys.join(', ') : 'jako uživatel'}` }),
        ]),
        el('button', { class: 'btn ghost small', text: 'Upravit' }),
      ]);
      const btn = row.querySelector('button');
      card.append(row);
      btn.addEventListener('click', async () => {
        const ed = variantEditor(p.code, v);
        if (card.contains(ed)) ed.remove(); else card.append(ed);
        ed.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    const addBtn = el('button', { class: 'btn ghost small', text: '+ Přidat variantu' });
    card.append(addBtn);
    addBtn.addEventListener('click', async () => {
      const ed = variantEditor(p.code, null);
      if (card.contains(ed)) ed.remove(); else card.append(ed);
    });
    root.append(card);
  }

  // ---- dokumenty
  root.append(el('h2', { text: 'Dokumenty (verzované)' }));
  const newDoc = el('details', { class: 'doc-details' }, [
    el('summary', { text: '+ Nový dokument' }),
    el('div', { class: 'doc-body' }, [
      el('div', { class: 'form-grid' }, [
        el('div', {}, [el('label', { text: 'Klíč (doc_key)' }), el('input', { type: 'text', id: 'nd-key' })]),
        el('div', {}, [el('label', { text: 'Název' }), el('input', { type: 'text', id: 'nd-title' })]),
      ]),
      el('label', { text: 'Znění' }),
      el('textarea', { id: 'nd-content', rows: 8, style: 'white-space:pre-wrap' }),
      el('button', { class: 'btn small', text: 'Publikovat v1' }),
    ]),
  ]);
  root.append(newDoc);
  $('button', newDoc).addEventListener('click', async () => {
    try {
      await API.post('/superadmin/docs', { docKey: $('#nd-key').value.trim(), title: $('#nd-title').value, content: $('#nd-content').value });
      notice(true, 'Dokument publikován (v1)');
    } catch (err) { toast(err.message, true); }
  });

  for (const d of cat.docs || []) {
    const det = el('details', { class: 'doc-details' }, [
      el('summary', { text: `${d.docKey} · v${d.version} — ${d.title}` }),
      el('div', { class: 'doc-body' }, [
        el('div', { class: 'l-sub mono muted', text: `SHA-256: ${d.contentHash} · platné od ${fmtDateTime(d.effectiveFrom)}` }),
        el('textarea', { id: `dc-${d.docKey}`, rows: 10, style: 'white-space:pre-wrap;width:100%;font-family:var(--font-mono);font-size:.8rem' }),
        el('div', { class: 'row-gap' }, [
          el('button', { class: 'btn small', text: 'Uložit jako novou verzi' }),
          el('span', { class: 'tag warn', text: 'Nová verze vyžádá nové souhlasy' }),
        ]),
      ]),
    ]);
    root.append(det);
    const ta = $(`#dc-${d.docKey}`, det);
    if (ta) ta.value = d.content;
    $('button', det).addEventListener('click', async () => {
      try {
        const res = await API.post('/superadmin/docs', { docKey: d.docKey, title: d.title, content: ta.value });
        notice(true, `Uloženo jako verze ${res.doc.version}`);
      } catch (err) { toast(err.message, true); }
    });
  }
}
