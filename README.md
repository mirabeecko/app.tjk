# Členská aplikace Tělovýchovné jednoty Krupka

Univerzální členská aplikace spolku (PWA). Digitalizuje členský životní cyklus:

**registrace → e-souhlasy (auditní stopa) → platba (test mode) → QR členská karta**

Členské výhody: **dopadová matrace (airbag)** je první ze zařízení spolku — aplikace
je postavená data-driven (tabulka `facilities`), takže další zařízení/výhody
(př. hala, posilovna, pronájmy) se přidají jedním řádkem v seedu a automaticky
se objeví na úvodu, v rezervacích i akcích.

Bonus MVP: rezervace slotů (dle zařízení), akce spolku s přihlašováním
(**momentálně skryté z UI** — backend připraven, viz poznámka níže),
merch objednávky.

> **Skryté akce:** sekce „Akce" je z rozhraní odstraněna (nav, landing, karta).
> Backend endpointy (`/api/events*`) i testy zůstávají funkční — vrátit ji lze
> jedním řádkem v `public/js/app.js` (route `#/akce`).

---

## Rychlý start

```bash
cd /Users/mb/dev/airbag-projekt/pwa
npm install          # poprvé
npm start            # → http://localhost:4310
```

Otevřete **http://localhost:4310** (mobilní i desktop prohlížeč; na mobilu ji lze
„instalovat" jako aplikaci — PWA manifest + service worker).

Reálné e-maily (přihlašovací odkazy, notifikace): nakopírujte `.env.example` na
`.env` a vyplňte `SMTP_*` proměnné (viz sekce [Přihlašování a e-maily](#přihlašování-a-e-maily)).

Reset dat (smaže lokální DB a znovu nasadí ceník, dokumenty, demo účty):

```bash
npm run reset
```

---

## Platební brána (Stripe Checkout)

Platby probíhají přes **Stripe Checkout** (hostovaná platební stránka): údaje
o kartě zadává člen přímo na stránce Stripe, přes náš server nikdy neprojde
číslo karty ani CVV (PCI DSS řeší Stripe). Potvrzení platby doručuje **webhook**
(`POST /api/payments/webhook`, událost `checkout.session.completed`) — platbu
nelze potvrdit ručně (endpoint `/payments/:id/confirm` funguje jen v test mode).

Konfigurace v `.env` (vzor: `.env.example`):

```
STRIPE_SECRET_KEY=sk_test_...        # test | sk_live_... pro reálné platby
STRIPE_WEBHOOK_SECRET=whsec_...      # secret z Dashboard → Webhooks
```

- Bez `STRIPE_SECRET_KEY` běží **test mode** (lokální simulace platby — žádná
  reálná interakce se Stripe; hodí se pro vývoj a testy).
- S testovacím klíčem (`sk_test_...`) se platby přesměrují na Stripe testovací
  stránku — použijte testovací kartu `4242 4242 4242 4242`.
- Webhook secret je **povinný pro reálný provoz**: bez něj se webhook odmítá
  (fail-closed, 400). Webhook se nastaví v Stripe Dashboard
  (Developers → Webhooks) na URL `https://<host>/api/payments/webhook`
  s událostí `checkout.session.completed`.
- Lokální vývoj: `stripe listen --forward-to localhost:4310/api/payments/webhook`
  (CLI Stripe) a výsledný `whsec_...` do `.env`.
- Webhook endpoint přijímá **raw body** (Express `express.raw`) — montuje se
  v `server.js` před `express.json`, aby šel ověřit Stripe podpis.

| Režim | `STRIPE_SECRET_KEY` | Co se stane při platbě |
|---|---|---|
| **test mode** | (prázdné) | lokální simulace, tlačítko „Zaplatit (úspěch)" |
| **Stripe test** | `sk_test_...` | přesměrování na Stripe testovací stránku (karta 4242…) |
| **Stripe live** | `sk_live_...` | reálná platba na Stripe |

## Jednorázové vstupy (produkty)

Kromě členství aplikace prodává **jednorázové vstupy** (produkty s odlišnou cenou
pro členy a nečleny; další produkty se přidávají v `seed.js` → `PRODUCTS`):

- **Nečlen:** registrace → souhlasy → koupě (`purpose=produkt`, `productCode=airbag_day`)
  za **nečlenskou cenu 600 Kč** → oprávnění (entitlement) + QR karta.
- **Člen:** koupě za **členskou cenu 300 Kč** (nákup členství neprodlužuje).
- **Mladiství:** vstup je možný po souhlasu zákonného zástupce (stejný e-souhlas
  jako u členství) — právní krytí zajišťují souhlasy + auditní stopa.
- Délka vstupu se v UI neuvádí — vztahuje se k **provozní době (9:00–19:00)**;
  technická hodnota `validity_hours` (nyní 4 h) se upřesní později.

Ceny produktů žijí v tabulce `products` (`member_price_czk` / `nonmember_price_czk`).

## Přihlašování a e-maily

Přihlašování funguje **magic linkem bez hesla**: uživatel zadá e-mail, na který
přijde odkaz (platí 15 minut, jednorázový). Po kliknutí je přihlášen.
Přihlásit se tak mohou i **stávající členové** — stačí, aby existovali v tabulce
`members` (stejný e-mail, kterým se registrovali). Ověřeno: schéma `public.members`
v `supabase/schema.sql` i lokální `src/schema.sql` mají `email` UNIQUE a role
`member | dozor | vybor | superadmin`.

| Režim | Kdy | Kam jde e-mail |
|---|---|---|
| **SMTP (produkce)** | `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` v `.env` | reálně na adresu uživatele |
| **Stub (vývoj)** | bez SMTP proměnných (výchozí) | nikam — dev inbox na `/#/outbox` + konzole serveru |

Konfigurace v `.env` (vzor: `.env.example`):

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=prihlaseni@krupka.cz
SMTP_PASS=********
SMTP_FROM=Tělovýchovná jednota Krupka <noreply@krupka.cz>
```

- `.env` je v `.gitignore` — credentials nikdy do gitu.
- Režim je vidět v aplikaci: přihlašovací stránka podle něj zobrazí příslušnou
  informaci („odkaz přijde e-mailem" vs „testovací režim — dev inbox").
- Outbox (`/#/outbox`) se plní vždy — slouží zároveň jako jednoduchá evidence
  odeslaných zpráv (kdo, co, kdy).
- SMS zůstávají ve stub režimu (do reálného SMS providera se zapojí v `src/mailer.js`).

---

## Co je hotovo

| Funkce | Stav |
|---|---|
| Registrace člena (údaje, typ členství, věková validace) | ✅ |
| E-souhlas: Provozní řád + čestné prohlášení + GDPR + vzdání se práva § 2925 OZ | ✅ |
| **Auditní stopa souhlasů** (verze dokumentu + SHA-256 hash + timestamp + IP + identita, nelze obejít) | ✅ |
| E-souhlas zákonného zástupce (odkaz e-mailem; SMS — stub) | ✅ |
| Platba členského příspěvku — **Stripe Checkout** (test/live dle klíče) | ✅ |
| **Jednorázové vstupy** (AIRBAG den: 300 Kč člen / 600 Kč nečlen, oprávnění) | ✅ |
| Historie plateb + účtenka (potvrzení o úhradě) | ✅ |
| Digitální členská karta s QR kódem (offline dostupná) | ✅ |
| Kontrola členství dozorem (načtení QR) | ✅ |
| Role: člen / dozor / výbor | ✅ |
| PWA: manifest + service worker + offline (karta + provozní řád) | ✅ |
| Rezervace slotů (9–19 h, 60 min, dle zařízení) | ✅ bonus |
| Akce spolku + přihlášení na akci (kapacita, deadline) | ✅ backend (UI skryté) |
| Členské výhody (facilities — data-driven, airbag je první) | ✅ |
| Merch (tričko, mikina, čepice, samolepky, bandana) | ✅ bonus |
| Dev inbox (stub e-maily/SMS — co by uživatel dostal) | ✅ |

## Otestované toky (npm test — 74 checků)

1. **Dospělý člen**: registrace (kategorie se určí sama z data narození — dospele/mladez/dite) → souhlasy (platba bez souhlasu = 409, nelze obejít) → platba test mode → active → QR karta → účtenka.
2. **Mladistvý (16 let)**: registrace s povinnými údaji rodiče → stub e-mail rodiči (odkaz platí 7 dní, jednorázový) → souhlas rodiče přes odkaz (odkaz nelze použít 2×) → souhlasy člena → platba → active.
3. **Souhlas rodiče — resend a expirace**: „Znovu odeslat e-mail rodiči" rotuje token (starý odkaz zneplatní), expirovaný odkaz → 404, resend pro člena bez souhlasu → 409.
4. **Dozor**: přehled členů, statistiky, kontrola QR karty (platná i falešná), auditní detail člena. Běžný člen do adminu nevidí (403).
5. **Bonus**: rezervace (duplicita = 409), merch objednávka, akce s přihlašováním, facilities, superadmin (vlastník).

## Struktura

```
pwa/
├── server.js            # lokální běh: Express + listen (VPS / vývoj)
├── api/index.js         # VERCEL serverless entry (export Express app)
├── vercel.json          # Vercel routing (vše → api/index)
├── src/
│   ├── app.js           # stavba Express aplikace (sdílená pro server i Vercel)
│   ├── db.js            # FASÁDA datové vrstvy (DB_DRIVER: sqlite | postgres)
│   ├── db-sqlite.js     # SQLite driver (lokální vývoj/testy)
│   ├── db-postgres.js   # Postgres driver (produkce, schéma `app`, přes `pg`)
│   ├── schema.sql       # SQLite schéma (lokální)
│   ├── seed.js          # ceník, verze dokumentů, demo účty (SEED_DEMO), merch
│   ├── routes.js        # REST API (registrace, souhlasy, platby, karta, admin…)
│   ├── auth.js          # session cookie + role guardy (async loadSession)
│   ├── payments.js      # ADAPTER platební brány (Stripe Checkout / test mode)
│   ├── mailer.js        # e-maily: SMTP (nodemailer) / STUB outbox; SMS stub
│   └── rate-limit.js    # in-memory rate limiter (login/register/guardian)
├── docs/                # právní dokumenty (zdroj znění, hashují se do auditní stopy)
├── public/              # PWA frontend (vanilla JS, žádný build step)
├── supabase/
│   ├── schema-app.sql   # PRODUKČNÍ Postgres schéma (schema `app`) — aplikujte v SQL editoru
│   └── schema.sql       # (historická varianta — nahrazena schema-app.sql)
├── tests/
│   └── api.test.js      # end-to-end testy (npm test, 79 checků, sqlite driver)
└── data/                # SQLite soubor (lokální vývoj)
```

## Bezpečnost

- **Žádné credentials v kódu.** Platby běží v test mode; reálná brána se připojí
  přes env proměnné (GoPay/Comgate/Stripe) — mění se jen `src/payments.js`.
- **Karta ani CVV se nikdy neukládají** — platební údaje řeší výhradně brána (PCI DSS).
- E-maily: reálné odesílání přes SMTP, pokud je nakonfigurováno v `.env`
  (jinak stub → dev inbox na `/#/outbox`). **Dev inbox je chráněn přihlášením
  a v režimu SMTP se automaticky zavře** (obsahuje magic linky — audit Fáze 1).
- Souhlasy: verzovaný dokument + SHA-256 + timestamp + IP + UA + identita
  (member/guardian) — viz tabulka `consents`.
- Role: `member` / `dozor` / `vybor` / `superadmin` (vlastník) — admin API
  chráněno role guardem, superadmin API navíc e-mail whitelistem.
- Session: httpOnly cookie, SameSite=Strict, `Secure` v produkci.
- Rate limiting: `/login`, `/register`, `/guardian/:token` (per IP) —
  ochrana před e-mail bombingem a enumerací.
- Bezpečnostní hlavičky: CSP, X-Frame-Options=DENY, Referrer-Policy, nosniff.
- Supabase sync: **výchozí režim `dry-run`** (nic nezapisuje). Reálný zápis
  (`on`) až po ručním odsouhlasení mapování — PATCH posílá jen vyplněná pole
  a nikdy nedegraduje roli člena evidence.

## Vlastník aplikace (superadmin)

Speciální admin rozhraní na `/#/superadmin` je dostupné **výhradně**
`miroslavbrozek@gmail.com` (role `superadmin` + e-mail whitelist v `src/auth.js`,
proměnná `SUPERADMIN_EMAIL`). Vlastník jako jediný vidí:

- kompletní přehled všech členů (kontakt, typ členství, role, status, platnost),
- typy členství a počty členů v nich,
- QR kartu každého člena (payload + QR obrázek) a ověření platnosti,
- načtení/ověření QR payloadu (stejně jako dozor).

Ostatní role (dozor, výbor, člen) dostanou 403. Seed vytváří demo účet
`miroslavbrozek@gmail.com` s rolí `superadmin` (idempotentně povýší i existující
účet se stejným e-mailem).

## Přidání další členské výhody / zařízení

Aplikace je data-driven: nové zařízení (hala, posilovna, pronájem…) se přidá
jedním záznamem v `src/seed.js` (pole `FACILITIES` v `seedFacilities()`):

```js
{ code: 'hala', name: 'Sportovní hala', shortName: 'Hala',
  description: 'Pronájem haly pro členy se slevou.', icon: 'home' },
```

Automaticky se projeví: sekce „Členské výhody" na úvodu, výběr zařízení
v rezervacích (`/#/rezervace`) a akce lze vázat na zařízení (`facility_id`).
Ikony: viz `ICONS` v `public/js/ui.js` (Lucide-style).

## Propojení se Supabase členskou evidencí (public.members)

Supabase projekt (stejný jako WebDo24): `https://mljqltwcdqknezuqpisb.supabase.co` —
tabulka `public.members` je existující členská evidence TJ Krupka (import z IS ČUS;
sloupce `name, surname, born, mail, …`, PK je číselné `id_cus`, NE `id`).

Režimy `SUPABASE_SYNC` v `.env` (vzory v `.env.example`):

- `off` (výchozí) — žádná komunikace, čistý no-op (testy běží v tomto režimu).
- `dry-run` — počítá a loguje, co by poslal, nic nezapíše (bezpečný test).
- `on` — reálný upsert (INSERT/PATCH přes PostgREST, service role key).

Co sync dělá:

1. **Registrace** → nový člen se automaticky odešle do evidence
   (`name/surname/born/mail/phone/street/city/zip`, role 2, údaje zákonného
   zástupce → `name_parents/vztah/mail_parents/phone_parents`).
2. **Platba/aktivace** → `member_from/member_to` se propsají do evidence.
3. **Přihlášení člena, který je JEN v evidenci** → automatický import do lokální DB
   (kategorie dle věku, údaje rodiče z evidence; nezletilému rovnou přijde e-mail
   se souhlasem) a pokračuje standardním flow (souhlasy → platba).
4. **Vlastník (`/#/superadmin`)** → karta „Synchronizace se Supabase evidencí"
   ukazuje stav režimu a tlačítko „Odeslat celou evidenci do Supabase"
   (`POST /api/superadmin/sync`, stav: `GET /api/superadmin/sync-status`).

Poznámky: upsert se řeší ručně (tabulka nemá unikátní index na `mail`) —
SELECT `mail=ilike.*` → PATCH dle `id_cus`, jinak POST. Service role key se
nikdy neloguje ani nevrací v odpovědích. Pro zapnutí: vyplňte
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_SYNC=on` v `.env`
a restartujte server.

## Migrace na Supabase/Postgres (hotová v kódu)

Datová vrstva je **driver-agnostická** (`DB_DRIVER=sqlite|postgres` v `.env`):

- `sqlite` (výchozí) — lokální vývoj a testy (soubor `data/airbag.db`).
- `postgres` — produkce. Tabulky aplikace žijí ve **schématu `app`**
  (`supabase/schema-app.sql`) — NE v `public`, kde je členská evidence
  TJ Krupka (`public.members`, import z IS ČUS).

Nasazení na produkci:

1. **Supabase:** spusťte `supabase/schema-app.sql` v SQL editoru (Dashboard → SQL).
2. **`.env`:** `DB_DRIVER=postgres` + `DATABASE_URL` (pooler connection string
   z Dashboard → Project Settings → Connection string; použijte Transact/Transaction
   pooler na portu 6543 — přátelský k serverless), `SEED_DEMO=false`.
3. **Vercel:** projekt na subdoméně (např. `app.tjkrupka.cz`), Framework = Other,
   build `npm install` + `npm run build` (není potřeba), output = `api/index.js`
   (serverless entry — viz `vercel.json`). Všechny env proměnné z `.env`
   nastavte v Vercel → Settings → Environment Variables.
4. **Stripe webhook:** v Stripe Dashboard → Developers → Webhooks přidejte
   `https://<host>/api/payments/webhook`, událost `checkout.session.completed`,
   a `whsec_...` vložte do `.env` (`STRIPE_WEBHOOK_SECRET`).
5. **DNS (WEDOS):** CNAME `app` → `cname.vercel-dns.com` (nebo dle pokynů Vercel).

Poznámky: seed se spouští automaticky před prvním requestem (idempotentní
upserty). Vlastník (`miroslavbrozek@gmail.com`, superadmin) se vytvoří vždy;
demo role účty jen s `SEED_DEMO` != false. Auth zůstává magic-link (vlastní
session), Supabase Auth je možný budoucí upgrade.

## Demo účty (lokální vývoj)

Registrace probíhá bez hesla — přihlášení magic linkem (odkaz je v dev inboxu).
Pro test rolí existují seed účty: `dozor@airbag.test` (dozor), `vybor@airbag.test`
(výbor) — přihlásíte se přes `/#/prihlaseni` a odkaz najdete v `/#/outbox`.

## Omezení / co zbývá (MVP)

- Reálná platební brána: **připraveno (Stripe Checkout)** — stačí vložit
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` do `.env` a založit webhook.
- Reálné e-maily: připraveno (SMTP), stačí vyplnit `.env`; SMS zůstávají stub.
- PDF účtenky (nyní digitální potvrzení v aplikaci).
- Připomínky obnovení členství (e-mailem, po zapojení reálného maileru).
- Schválení nových členů výborem je připraveno (status `registered` → admin
  může `active`/`rejected`), výchozí tok je plně automatický.
- Ověřit finální znění právních dokumentů advokátem (viz 05-pravni-dokumenty.md).
