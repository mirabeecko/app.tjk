# Ke schválení odpovědnou osobou — změny z 2026-09-28

Tento soubor **není právní dokument** a nic nepotvrzuje. Je to kontrolní seznam
toho, co musí před dalším provozem zařízení potvrdit odpovědná osoba spolku
(výbor / předseda a osoba odpovědná za pojištění).

> **Žádný z textů v aplikaci není označen jako právně schválený.** Nové znění
> dokumentů připravil spolek jako návrh; finální znění i rozsah pojistného krytí
> musí potvrdit odpovědná osoba (případně po právním posouzení).

---

## 1. Co se 28. 9. 2026 změnilo

| Změna | Stav |
|---|---|
| Dokument „Vzdání se práva na náhradu újmy (§ 2925 OZ)“ **vyřazen** (`vzdani_prava`, `status=retired`) | hotovo v aplikaci |
| Nový dokument **„Poučení o rizicích a potvrzení pravidel účasti“** (`pouceni_rizika`) — bez vzdání se práv, s výslovným uvedením, že potvrzení neomezuje zákonná práva účastníka | hotovo v aplikaci |
| Historické znění i starší souhlasy **zůstávají beze změny** v auditní stopě | hotovo (nic se nemazalo) |
| Provozní řád: pravidla platí pro **členy i nečleny** (členství není podmínkou vstupu) | hotovo v aplikaci |
| Provozní řád označen jako **PROZATÍMNÍ — čeká na doplnění parametrů** (tlak, hmotnost, věk, počasí, kotvení, sporty, nájezd, rozměry, umístění, pojištění, schvalovatel) | hotovo v aplikaci |
| **Praktická instruktáž** jako samostatný záznam (dozor, verze instruktáže, výsledek) | hotovo v aplikaci |
| **Provozní kniha** (denní kontrola, závady, přerušení/obnovení, mimořádné události, offline zápisy) | hotovo v aplikaci |
| **Vstup povolen** jen při vyhovující kontrole dne + přítomném dozoru + potvrzených dokumentech + instruktáži (+ ověřená vazba rodiče u nezletilých) | hotovo v aplikaci |
| **Ověření, že dokumenty potvrzuje sám účastník** (heslo účtu nebo jednorázový kód na jeho e-mail) | hotovo v aplikaci |
| **Ověření totožnosti u vstupu**: QR + kontrola fotografie dozorem, volitelně osobně zadaný vstupní PIN | hotovo v aplikaci |
| Nezletilí: **souhlas rodiče oddělen** od potvrzení účastníka + evidence, **kdo souhlas udělil a jak byla ověřena vazba na dítě** | hotovo v aplikaci |
| Protokol: rozlišuje „dokument potvrzen“ / „instruktáž absolvována“ / „vstup povolen“; **žádné podpisové linky**, výslovně uvedeno, že nejde o vlastnoruční podpis ani kvalifikované časové razítko | hotovo v aplikaci |

## 2. Co musí potvrdit odpovědná osoba (bez toho je řád PROZATÍMNÍ)

Hodnoty se doplňují **jen z dokumentace výrobce nebo z posouzení skutečného místa** —
nikdy odhadem. Stav a doplnění:

```bash
npm run params:list
npm run params:confirm -- --key <klíč> --value "<hodnota>" --source "<čím je doloženo>" --by "<kdo potvrdil>"
```

| Klíč | Co je potřeba dodat | Zdroj |
|---|---|---|
| `vyrobce` | výrobce, typ a výrobní číslo matrace | dokumentace výrobce |
| `rozmery` | rozměry zařízení (ověřit údaj provozovatele 2 × 5 × 10 m) | dokumentace výrobce |
| `tlak` | provozní tlak, tolerance, způsob měření | dokumentace výrobce |
| `hmotnost` | maximální hmotnost účastníka | dokumentace výrobce |
| `vek` | věkové omezení dle výrobce | dokumentace výrobce |
| `pocasi` | povětrnostní limity (vítr, déšť, námraza, vlhkost) | dokumentace výrobce + posouzení místa |
| `kotveni` | způsob kotvení, počet a únosnost kotevních bodů | dokumentace výrobce + posouzení místa |
| `sporty` | povolené sporty (jen MTB, nebo i jiné?) | dokumentace výrobce |
| `najezd` | parametry nájezdu (výška, sklon, dopadová zóna) | výrobce + posouzení místa |
| `revize` | termíny pravidelné kontroly a revize | dokumentace výrobce |
| `umisteni` | umístění zařízení (pozemek, přístup) | provozovatel |
| `pojisteni` | pojištění odpovědnosti spolku (smlouva, limit, krytí provozu airbagu) | pojišťovna / odpovědná osoba |
| `schvaleni` | kdo a kdy schválil provozní řád (jméno, funkce, datum) | výbor spolku |

## 3. Co ještě musí potvrdit člověk (mimo aplikaci)

1. **Právní posouzení textů** — „Poučení o rizicích a potvrzení pravidel účasti“,
   „Souhlas zákonného zástupce s účastí nezletilého“, provozní řád a jeho vsazení
   do podmínek členství (včetně vztahu ke stanovám).
2. **Pojištění odpovědnosti spolku** — musí krýt provoz dopadové matrace, včetně
   újmy na zdraví a činnosti dozoru; ověřit limity plnění a výluky.
3. **Úrazové pojištění účastníků** (doporučené, u nezletilých obzvlášť).
4. **Zásady GDPR** — doplnit, zda je u fotografie účastníka a u provozní knihy
   potřeba úprava informační povinnosti (foto se užívá k ověření totožnosti).
5. **Archivace provozní knihy** — potvrdit dobu (řád doporučuje 5 let, u nároků
   z újmy na zdraví je nutné posouzení delší lhůty).
6. **Kdo je „odpovědná osoba“ (dozor)** — určení výborem, rozsah pravidel
   a proškolení (v aplikaci se jméno dozoru u každého záznamu eviduje).

## 4. Jak doklady ověřit

```bash
npm test                                   # 183 kontrol (potvrzení, brána vstupu, provozní kniha…)
node scripts/verify-flows.js --export ../evidence-pack/ukazka   # toky: člen / nečlen / nezletilý + protokoly
node scripts/verify-consents.js            # přepočet otisků všech potvrzení (0 problémů = v pořádku)
```

Ukázky vyhotovených protokolů (HTML + PDF) jsou v
`airbag-projekt/evidence-pack/ukazka-2026-09-28/`.
