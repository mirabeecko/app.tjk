# 🚀 Nasazení na Vercel (app.tjkrupka.cz)

Kompletní postup nasazení členské aplikace. Předpoklady: `vercel` CLI nainstalované,
`node` >= 18, aplikace funguje lokálně (`npm test` = 94/94).

## 1. Přihlášení do Vercel (jedenkrát, interaktivně)

```bash
vercel login          # otevře prohlížeč — vyberte účet (stejný, kde je tjkrupka.cz)
vercel whoami         # ověření (měl by vypsat váš účet)
```

## 2. Nastavení env proměnných

V `pwa/` spusťte a vložte PRODUKČNÍ hodnoty (NE lokální sqlite/test!):

```bash
vercel env add DB_DRIVER production        # → postgres
vercel env add DATABASE_URL production     # → postgresql://postgres.mljqltwcdqknezuqpisb:...@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
vercel env add SUPABASE_URL production     # → https://mljqltwcdqknezuqpisb.supabase.co
vercel env add SUPABASE_SERVICE_ROLE_KEY production   # → service role key
vercel env add SUPABASE_SYNC production    # → dry-run (po odsouhlasení mapování: on)
vercel env add SEED_DEMO production        # → false (žádné demo účty dozora/výboru)
vercel env add SUPERADMIN_EMAIL production # → miroslavbrozek@gmail.com
# Stripe (test mode na začátek; LIVE až při ostrém provozu):
vercel env add STRIPE_SECRET_KEY production     # → sk_test_... (nebo sk_live_...)
vercel env add STRIPE_WEBHOOK_SECRET production # → whsec_...
```

Nebo je zadejte v Dashboardu: Vercel → projekt → Settings → Environment Variables.
Pozor: `.env` je v `.gitignore`, na Vercel se nikdy nekopíruje automaticky.

## 3. Deploy

```bash
cd /Users/mb/dev/airbag-projekt/pwa
vercel --prod
```

První běh se zeptá na projekt (jméno např. `tjk-airbag`), scope (váš účet) a
nastavení. Vercel si přečte `vercel.json` (vše → `api/index.js`).
Seed se spustí automaticky před prvním requestem (idempotentní upserty).

## 4. Doména (WEDOS)

1. Vercel → projekt → Settings → Domains → Add: `app.tjkrupka.cz` → Vercel ukáže
   cílový záznam (typicky CNAME `app.tjkrupka.cz` → `cname.vercel-dns.com`).
2. WEDOS admin → DNS → přidejte CNAME (nebo A record dle pokynů Vercelu).
3. Po propagaci (minuty až hodiny) otevřete https://app.tjkrupka.cz

## 5. Stripe webhook (produkce)

Po nasazení založte v Stripe Dashboardu (Developers → Webhooks → Add endpoint):

- URL: `https://app.tjkrupka.cz/api/payments/webhook`
- Událost: `checkout.session.completed`
- Secret `whsec_...` → nastavte v Vercel env (`STRIPE_WEBHOOK_SECRET`) → Redeploy.
- Volitelně druhá událost: `checkout.session.expired` (zrušené platby).

## 6. Kontrola po nasazení

```bash
curl -s https://app.tjkrupka.cz/api/config        # paymentGateway: stripe-test
curl -s -o /dev/null -w '%{http_code}\n' https://app.tjkrupka.cz/   # 200
```

Otestujte v prohlížeči: registrace → souhlasy → platba → QR karta.
Reálná platba v test mode: testovací karta `4242 4242 4242 4242`.

## 7. Před ostrým provozem (checklist)

- [ ] Supabase: rotace DB hesla (proběhlo chatem) — Dashboard → Database → Reset password
- [ ] Stripe: LIVE klíče (`sk_live_...`) + webhook secret live → Vercel env → redeploy
- [ ] Supabase sync: ověřit mapování polí → `SUPABASE_SYNC=on`
- [ ] Ceny denního vstupu dle payment linků (`src/seed.js` → `denni` / `denni_clen`)
- [ ] SMTP e-maily (`SMTP_*` env) — bez nich zůstává stub outbox
- [ ] Právní dokumenty schválené výborem/advokátem
- [ ] HTTPS automaticky (Vercel) — ověřit platný certifikát
