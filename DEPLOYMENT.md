# 🚀 Nasazení (Web + Android/iOS mobilní appka)

Kompletní postup: web na Vercel + nativní appky (Capacitor) pro Android/iOS.
Předpoklady: `node` >= 18, `vercel` CLI, aplikace funguje lokálně (`npm test` = 103/103).

## Repozitář

Aplikace žije v `pwa/`. GitHub repo: **`mirabeecko/app.tjk`** (kořen = aplikace,
včetně `android/` a `ios/`).

```bash
cd pwa
git init && git remote add origin git@github.com:mirabeecko/app.tjk.git
git push -u origin main
```

## 1. Web — Vercel

### env proměnné (production)
V `pwa/` nastavte PRODUKČNÍ hodnoty (ne lokální test):

```bash
vercel env add DB_DRIVER production                    # → postgres
vercel env add DATABASE_URL production                 # → postgresql://postgres.…@aws-0-…pooler.supabase.com:6543/postgres
vercel env add SUPABASE_URL production                 # → https://mljqltwcdqknezuqpisb.supabase.co
vercel env add SUPABASE_SERVICE_ROLE_KEY production    # → service role key (Secret!)
vercel env add SUPABASE_SYNC production                # → dry-run (po kontrole: on)
vercel env add SEED_DEMO production                    # → false
vercel env add SUPERADMIN_EMAIL production             # → miroslavbrozek@gmail.com
vercel env add STRIPE_SECRET_KEY production            # → sk_test_… / sk_live_…
vercel env add STRIPE_WEBHOOK_SECRET production        # → whsec_…
```

Pozor: `.env` je v `.gitignore` → na Vercel nikdy neletí. Citlivé klíče přidávejte
jako **Secret** (výchozí typ), ne `--type config`.

### deploy
```bash
vercel --prod
```
`vercel.json` (`rewrites` → `/api/index`) + `api/index.js` obslouží i statiku z `public/`.
Seed běží jednou před prvním requestem (idempotentní upserty).

### ⚠️ POZOR: schéma produkční DB se neaktualizuje samo

`src/db-sqlite.js` si chybějící sloupce přidává za běhu (`ensureColumn`), ale
**`src/db-postgres.js` nic takového nedělá** — na produkci (Supabase) vzniká
schéma výhradně ručním spuštěním migrací ze `supabase/migrations/`. Když se
nasadí kód, který používá nový sloupec nebo tabulku, a migrace se zapomene,
**padá úplně všechno**: `ensureSeed` běží před každým requestem, takže i
`/api/me` nebo `/api/products` vrací 500 (přesně to se stalo 2026-09-26).

Před každým nasazením tedy:
```bash
ls supabase/migrations/            # co je v repu
# a porovnat s produkční DB (např. přes psql/DATABASE_URL):
#   select column_name from information_schema.columns
#    where table_schema='app' and table_name='consents';
```
Migrace jsou psané jako idempotentní (`IF NOT EXISTS`), takže se dají pustit opakovaně.

Rychlé ověření po deployi (nesmí být 500):
```bash
for p in /api/me /api/products /api/docs; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://app.tjkrupka.cz$p"
done
```

### ⚠️ POZOR: nenahrávejte strom, který někdo právě upravuje

`vercel --prod` posílá **pracovní strom**, ne poslední commit. Když aplikaci
zároveň upravuje někdo jiný (editor, jiná agentní session), můžete nahrát
rozepsaný soubor. 2026-09-26 se takto nasadil `src/seed.js`, kterému právě
chyběla deklarace `DOCS`, a protože seed běží před každým requestem, spadla
celá produkce (`ReferenceError: DOCS is not defined` → 500 na všem).

Postup, který to vyloučí — nasazovat ze zmrazeného snapshotu:
```bash
cd pwa && git status --short        # musí být prázdné (nebo změny vědomě zahrnout)
rm -rf /tmp/deploy-app && mkdir -p /tmp/deploy-app
rsync -a --exclude '.git' --exclude node_modules --exclude data --exclude '.npm-cache' \
      --exclude android --exclude ios --exclude www --exclude dist --exclude '.vercel-cli' ./ /tmp/deploy-app/
cp -r .vercel /tmp/deploy-app/      # propojení na projekt tjk-airbag
cd /tmp/deploy-app && vercel --prod
```

Rychlá kontrola konzistence před nasazením (kromě `npm test`):
```bash
for f in $(find src -name '*.js'); do node --check "$f" || echo "SYNTAX: $f"; done
DB_DRIVER=postgres SEED_DEMO=false node -e "require('./src/seed').seed().then(()=>console.log('seed OK')).catch(e=>{console.error('SEED CHYBA:',e.message);process.exit(1)})"
```

### Když produkce vrací 500 a v logu nic není

Runtime logy teče `vercel logs <deployment-url>` (jen živě, build logy nestačí):

```bash
vercel logs https://tjk-airbag-<hash>-mirabeeckos-projects.vercel.app &
curl -s -o /dev/null -w '%{http_code}\n' https://app.tjkrupka.cz/api/products
```
Chyby z `ensureSeed` a error middleware se tisknou jako `Seed CHYBA:` / `CHYBA:`.
Na Hobby plánu umí `vercel rollback` jen o jednu verzi zpět — pro starší build
použijte `vercel promote <deployment-url>` (a tím i rychlou záchranu).

### ověření
```bash
curl -s https://tjk-airbag.vercel.app/api/config     # paymentGateway: stripe-test
curl -s -o /dev/null -w '%{http_code}\n' https://tjk-airbag.vercel.app/   # 200
```

### Vlastní doména (WEDOS, volitelné)
1. Vercel → projekt → Settings → Domains → Add `app.tjkrupka.cz`.
2. WEDOS → DNS → CNAME `app` → `cname.vercel-dns.com`.
3. Stripe webhook: POST `/api/payments/webhook`, událost `checkout.session.completed`.

## 2. Android / iOS — nativní appka (Capacitor)

Kapacitor wrapper kolem PWA. Web se buildí do `www/` (kopie `public/` + injektovaný
`__API_BASE__` → produkční backend), pak sync do nativních projektů.

```bash
npm run mobile:android    # build www + sync + otevřít Android Studio
npm run mobile:ios        # build www + sync + otevřít Xcode
```

Jednotlivé kroky:
```bash
npm run mobile:copy       # public/ → www/ (+ __API_BASE__)
npx cap sync              # www/ → android/ + ios/ (zkopíruje assety)
npx cap open android      # sestavení v Android Studiu (Gradle sync)
npx cap open ios          # sestavení v Xcode (potřebuje CocoaPods)
```

### ID aplikace
- `appId` = `cz.tjkrupka.app` (Android `applicationId` i iOS `PRODUCT_BUNDLE_IDENTIFIER`).
- Změna: `capacitor.config.json` → `appId`, pak `npx cap sync`.
- Aplikace volá backend přes `window.__API_BASE__` (default `https://tjk-airbag.vercel.app`).
  Změnit: `scripts/build-www.js` (`APP_API_BASE` env nebo konstanta), pak `npm run mobile:sync`.

### Build & publish (na vašem stroji)
- **Android**: otevřít v Android Studiu → Build → Generate Signed Bundle/APK.
  Vyžaduje Android SDK + JDK. Signovací keystore → upload do Play Console.
- **iOS**: otevřít v Xcode → signing team → Archive → Distribute (TestFlight/App Store).
  Vyžaduje macOS + Xcode + App Store Connect.

## 3. Před ostrým provozem (checklist)

- [ ] Stripe: LIVE klíče + LIVE webhook secret → Vercel env → redeploy
- [ ] Supabase sync: zkontrolovat mapování polí → `SUPABASE_SYNC=on`
- [ ] SMTP e-maily (`SMTP_*` env) — bez nich jen stub outbox
- [ ] Právní dokumenty schválené výborem/advokátem
- [ ] HTTPS automaticky (Vercel) — ověřit platný certifikát
