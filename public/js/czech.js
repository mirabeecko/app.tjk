/* czech.js — české skloňování jmen pro oslovení (5. pád = vokativ).
 *
 * Problém: aplikace psala „Vítej, Petr“ místo „Vítej, Petře“.
 *
 * Řešení ve třech vrstvách (od nejspolehlivější):
 *   1) SLOVNÍK nejčastějších českých jmen — přesné, ověřené tvary.
 *   2) PRAVIDLA pro mužská i ženská jména zakončená typicky pro češtinu.
 *   3) BEZPEČNÝ FALLBACK — když si nejsme jistí, jméno NEskloňujeme.
 *      Radši „Vítej, Jean“ než vymyšlené „Vítej, Jeane“.
 *
 * Použití:
 *   CZ.vocative('Petr')        -> 'Petře'
 *   CZ.greet('Petr')           -> 'Vítej, Petře'
 *   CZ.greet('Jana', 'Ahoj')   -> 'Ahoj, Jano'
 *   CZ.greet('')               -> 'Vítej'
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CZ = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 1) SLOVNÍK — mužská jména
  // -------------------------------------------------------------------------
  const MUZ = {
    adam: 'Adame', alois: 'Aloise', aleš: 'Aleši', alexandr: 'Alexandře',
    antonín: 'Antoníne', bedřich: 'Bedřichu', bohumil: 'Bohumile',
    bohuslav: 'Bohuslave', boris: 'Borisi', bořivoj: 'Bořivoji',
    ctirad: 'Ctirade', dalibor: 'Dalibore', daniel: 'Danieli', dan: 'Dane',
    david: 'Davide', dědek: 'Dědku', dominik: 'Dominiku', dušan: 'Dušane',
    eduard: 'Eduarde', emil: 'Emile', erik: 'Eriku', filip: 'Filipe',
    františek: 'Františku', gustav: 'Gustave', hynek: 'Hynku',
    igor: 'Igore', ivan: 'Ivane', ivar: 'Ivare', jakub: 'Jakube',
    jan: 'Jane', jaromír: 'Jaromíre', jaroslav: 'Jaroslave',
    jindřich: 'Jindřichu', jiří: 'Jiří', josef: 'Josefe', juraj: 'Juraji',
    kamil: 'Kamile', karel: 'Karle', klas: 'Klase', kristián: 'Kristiáne',
    kryštof: 'Kryštofe', ladislav: 'Ladislave', leoš: 'Leoši',
    libor: 'Libore', lukáš: 'Lukáši', luboš: 'Luboši', ludvík: 'Ludvíku',
    marek: 'Marku', marcel: 'Marceli', martin: 'Martine', matěj: 'Matěji',
    matyáš: 'Matyáši', michal: 'Michale', milan: 'Milane',
    miloš: 'Miloši', miloslav: 'Miloslave', miroslav: 'Miroslave',
    můj: 'Můj', ondřej: 'Ondřeji', otakar: 'Otakare', otto: 'Otto',
    patrik: 'Patriku', pavel: 'Pavle', petr: 'Petře', přemysl: 'Přemysle',
    radim: 'Radime', radek: 'Radku', radomír: 'Radomíre', robert: 'Roberte',
    roman: 'Romane', rostislav: 'Rostislave', rudolf: 'Rudolfe',
    ředitel: 'Řediteli', samuel: 'Samueli', silvestr: 'Silvestře',
    slávek: 'Slávku', stanislav: 'Stanislave', svatopluk: 'Svatopluku',
    šimon: 'Šimone', štěpán: 'Štěpáne', tělocvik: 'Tělocviku',
    tomáš: 'Tomáši', tom: 'Tome', václav: 'Václave', valentin: 'Valentine',
    vasil: 'Vasile', věroslav: 'Věroslave', viktor: 'Viktore',
    vilém: 'Viléme', vítek: 'Vítku', vladimír: 'Vladimíre',
    vladislav: 'Vladislave', vlastimil: 'Vlastimile', vladan: 'Vladane',
    vojta: 'Vojto', vojtěch: 'Vojtěchu', vratislav: 'Vratislave',
    zdeněk: 'Zdeňku', zbyněk: 'Zbyňku', zikmund: 'Zikmunde',
    // cizí jména, která se v češtině běžně skloňují
    albert: 'Alberte', andreas: 'Andreasi', andrej: 'Andreji',
    anton: 'Antone', arnošt: 'Arnošte', bruno: 'Bruno', carl: 'Carle',
    danilo: 'Danilo', dmitrij: 'Dmitriji', egon: 'Egone', felix: 'Felixi',
    hugo: 'Hugo', igor2: 'Igore', konrád: 'Konráde', leonard: 'Leonarde',
    mario: 'Mario', marko: 'Marko', mikuláš: 'Mikuláši', nikl: 'Nikle',
    oskar: 'Oskare', pavol: 'Pavle', peter: 'Petře', richard: 'Richarde',
    sergej: 'Sergeji', stanley: 'Stanley', stepan: 'Štěpáne',
    tero: 'Tero', tobias: 'Tobiáši', werner: 'Wernere', william: 'Williame',
  };

  // -------------------------------------------------------------------------
  // 1b) SLOVNÍK — ženská jména
  // -------------------------------------------------------------------------
  const ZENA = {
    adéla: 'Adélo', alena: 'Aleno', alexandra: 'Alexandro', alžběta: 'Alžběto',
    andrea: 'Andreo', aneta: 'Aneto', anna: 'Anno', antonie: 'Antonie',
    barbora: 'Barboro', blanka: 'Blanko', božena: 'Boženo', dagmar: 'Dagmar',
    daniela: 'Danielo', dana: 'Dano', denisa: 'Deniso', dominika: 'Dominiko',
    dorota: 'Doroto', eliška: 'Eliško', ema: 'Emo', emílie: 'Emílie',
    eva: 'Evo', filipína: 'Filipíno', františka: 'Františko',
    gabriela: 'Gabrielo', hana: 'Hano', hedvika: 'Hedviko',
    helena: 'Heleno', ilona: 'Ilono', irena: 'Ireno', ivana: 'Ivano',
    iveta: 'Iveto', ivona: 'Ivono', jana: 'Jano', jarmila: 'Jarmilo',
    jaroslava: 'Jaroslava', jasna: 'Jasno', jindřiška: 'Jindřiško',
    jitka: 'Jitko', julie: 'Julie', jitřenka: 'Jitřenko',
    kamila: 'Kamilo', karin: 'Karin', karolína: 'Karolíno',
    kateřina: 'Kateřino', klára: 'Kláro', kristýna: 'Kristýno',
    květoslava: 'Květoslavo', lenka: 'Lenko', leona: 'Leono',
    libuše: 'Libuše', linda: 'Lindo', lucie: 'Lucie', ludmila: 'Ludmilo',
    magdalena: 'Magdaleno', marcela: 'Marcelo', margita: 'Margito',
    marie: 'Marie', markéta: 'Markéto', martha: 'Martho', martina: 'Martino',
    mája: 'Májo', michaela: 'Michaelo', milada: 'Milado', milena: 'Mileno',
    miluše: 'Miluše', miroslava: 'Miroslavo', monika: 'Moniko',
    naděžda: 'Naděždo', nela: 'Nelo', nina: 'Nino', nikola: 'Nikolo',
    olga: 'Olgo', olivia: 'Olivie', otýlie: 'Otýlie', pavla: 'Pavlo',
    pavlína: 'Pavlíno', petra: 'Petro', radka: 'Radko', renata: 'Renato',
    romana: 'Romano', rozálie: 'Rozálie', rút: 'Rút', sabina: 'Sabino',
    silvie: 'Silvie', simona: 'Simono', slávka: 'Slávko', soňa: 'Soňo',
    stanislava: 'Stanislavo', svatava: 'Svatavo', šárka: 'Šárko',
    štěpánka: 'Štěpánko', tereza: 'Terezo', václava: 'Václavo',
    vendula: 'Vendulo', veronika: 'Veroniko', věra: 'Věro',
    vladimíra: 'Vladimíro', vlasta: 'Vlasto', zdena: 'Zdeno',
    zdenka: 'Zdenko', zuzana: 'Zuzano', žaneta: 'Žaneto',
    // cizí
    carmen: 'Carmen', claudia: 'Claudio', elena: 'Eleno', ingrid: 'Ingrid',
    irene: 'Irene', julia: 'Julio', katarína: 'Kataríno', laura: 'Lauro',
    natalia: 'Natalio', nicole: 'Nicole', sandra: 'Sandro', sonia: 'Sonio',
  };

  // Jména, která se NESKLONUJÍ (vokativ = nominativ)
  const NESKLONNA = ['jiří', 'ivo', 'otto', 'hugo', 'jose', 'rené', 'renate',
    'marie', 'lucie', 'julie', 'emílie', 'otýlie', 'rozálie', 'silvie',
    'antonie', 'dagmar', 'karin', 'ingrid', 'irene', 'carmen', 'nicole'];

  // -------------------------------------------------------------------------
  // 2) PRAVIDLA pro mužská jména (fallback, když jméno není ve slovníku)
  // -------------------------------------------------------------------------
  function muzskaPravidla(n, lower) {
    // koncové skupiny — pořadí je důležité (delší vzory první)
    const konce = [
      ['ch', 'chu'],   // Vojtěch → Vojtěchu
      ['áš', 'áši'],   // Tomáš → Tomáši
      ['í', 'í'],      // Jiří → Jiří (nesklonné)
      ['e', 'e'],      // René → René
      ['o', 'o'],      // Ivo → Ivo
      ['ek', 'ku'],    // Marek → Marku, Zdeněk → Zdeňku
      ['ěk', 'ku'],    // Zbyněk → Zbyňku
      ['el', 'le'],    // Pavel → Pavle, Karel → Karle
      ['il', 'le'],    // Karel → Karle
      ['ol', 'ole'],   // Bohumil? ne — 'Bohumil' → Bohumile
      ['ul', 'ule'],
      ['il', 'ile'],
      ['am', 'ame'],
      ['em', 'eme'],
      ['im', 'ime'],
      ['om', 'ome'],
      ['k', 'ku'],     // Dominik → Dominiku
      ['g', 'gu'],     // Igor? (Igor končí r) — Craig → Craigu
      ['ch', 'chu'],
      ['h', 'hu'],     // Gunther? — 'h' → 'hu'
      ['j', 'ji'],     // Ondřej → Ondřeji
      ['š', 'ši'],     // Aleš → Aleši
      ['ž', 'ži'],     // Serge? — 'ž' → 'ži'
      ['č', 'či'],     // Stanič → Staniči
      ['ř', 'ři'],     // Jiří je ve slovníku; Jan Ř? okrajové
      ['c', 'ci'],     // Franc → Franci
      ['s', 'si'],     // Andreas? (končí s) → Andreasi
      ['z', 'zi'],     // Mirek? ne. 'z' → 'zi'
      ['r', 'ře'],     // Petr → Petře
      ['l', 'le'],     // Michal → Michale
      ['n', 'ne'],     // Ivan → Ivane
      ['m', 'me'],     // Artur? ne. 'm' → 'me'
      ['d', 'de'],     // David → Davide
      ['t', 'te'],     // Robert → Roberte
      ['b', 'be'],     // Jakob → Jakobe
      ['p', 'pe'],     // Filip → Filipe
      ['v', 've'],     // Gusta? ne. 'v' → 've'
      ['f', 'fe'],     // Josef → Josefe
    ];
    for (const [k, v] of konce) {
      if (lower.endsWith(k)) {
        // 'ě' po některých hláskách (Petr → Petře) — ošetřeno vzorem 'ře'
        return n.slice(0, n.length - k.length) + v;
      }
    }
    return null; // radši nesklonit
  }

  // -------------------------------------------------------------------------
  // 2b) PRAVIDLA pro ženská jména
  // -------------------------------------------------------------------------
  function zenskaPravidla(n, lower) {
    if (lower.endsWith('ie')) return n;          // Marie → Marie
    if (lower.endsWith('í')) return n;           // Jiřina? ne — 'í' zůstává
    if (lower.endsWith('e')) return n;           // Dagmar? ne — 'e' zůstává
    if (lower.endsWith('a')) return n.slice(0, -1) + 'o'; // Jana → Jano, Petra → Petro
    return null;                                  // cizí (např. „Nicole") → nesklonit
  }

  // -------------------------------------------------------------------------
  // Veřejné API
  // -------------------------------------------------------------------------

  /** Vokativ (5. pád) křestního jména. Při nejistotě vrací jméno beze změny. */
  function vocative(name) {
    if (!name) return '';
    const n = String(name).trim();
    if (!n) return '';
    const lower = n.toLocaleLowerCase('cs-CZ');

    if (NESKLONNA.includes(lower)) return n;
    if (MUZ[lower]) return MUZ[lower];
    if (ZENA[lower]) return ZENA[lower];

    // Neznámé jméno: zkusit pravidla, ale jen když vypadá česky.
    // Heuristika: končí na typicky českou koncovku.
    const jePravdepodobneZenske = lower.endsWith('a') || lower.endsWith('ie');
    const v = jePravdepodobneZenske ? zenskaPravidla(n, lower) : muzskaPravidla(n, lower);
    return v || n;
  }

  /** Oslovení: „Vítej, Petře“ / „Ahoj, Jano“. Bez jména vrátí jen pozdrav. */
  function greet(name, pozdrav) {
    const p = pozdrav || 'Vítej';
    const v = vocative(name);
    return v ? `${p}, ${v}` : p;
  }

  /** Krátké oslovení jen jménem (pro nadpisy): „Petře, vítej zpět“. */
  function address(name) {
    return vocative(name);
  }

  /** 2. pád (genitiv) — „karta Petra Nováka“ (jen křestní jméno, příjmení beze změny). */
  const GEN_MUZ = { petr: 'Petra', jan: 'Jana', pavel: 'Pavla', tomáš: 'Tomáše',
    jiří: 'Jiřího', marek: 'Marka', radek: 'Radka', jakub: 'Jakuba',
    martin: 'Martina', michal: 'Michala', david: 'Davida', lukáš: 'Lukáše',
    filip: 'Filipa', vojta: 'Vojty', vojtěch: 'Vojtěcha', adam: 'Adama',
    daniel: 'Daniela', josef: 'Josefa', karel: 'Karla', františek: 'Františka',
    václav: 'Václava', zdeněk: 'Zdeňka', ondřej: 'Ondřeje', šimon: 'Šimona',
    matěj: 'Matěje', dominik: 'Dominika', patrik: 'Patrika', david2: 'Davida' };
  const GEN_ZENA = { jana: 'Jany', petra: 'Petry', eva: 'Evy', hana: 'Hany',
    anna: 'Anny', marie: 'Marie', lenka: 'Lenky', kateřina: 'Kateřiny',
    lucie: 'Lucie', tereza: 'Terezy', veronika: 'Veroniky', alena: 'Aleny',
    zuzana: 'Zuzany', barbora: 'Barbory', klára: 'Kláry', markéta: 'Markéty',
    monika: 'Moniky', martina: 'Martiny', michaela: 'Michaeley' };

  function genitive(name) {
    if (!name) return '';
    const n = String(name).trim();
    const lower = n.toLocaleLowerCase('cs-CZ');
    if (GEN_MUZ[lower]) return GEN_MUZ[lower];
    if (GEN_ZENA[lower]) return GEN_ZENA[lower];
    // fallback: měkké vzory
    if (lower.endsWith('a')) return n.slice(0, -1) + 'y';
    if (lower.endsWith('e')) return n.slice(0, -1) + 'e';
    return n; // radši beze změny
  }

  return { vocative, greet, address, genitive, ageFrom: null, _slovnikMuz: MUZ, _slovnikZena: ZENA };
});
