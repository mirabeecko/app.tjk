// md.js — malý převod Markdownu na HTML pro NÁHLED právních dokumentů.
//
// PROČ VLASTNÍ PŘEVOD: texty dokumentů jsou v `docs/*.md` (nadpisy `#`, seznamy,
// **tučné**, tabulky) a do 2026-10-15 se vkládaly do stránky jako holý text přes
// `white-space: pre-wrap` — uživatel tedy četl mřížky, hvězdičky a roury tabulek
// a stěžoval si, že je to nečitelné. Knihovnu (marked apod.) záměrně NEPŘIDÁVÁME:
// dokumenty jsou právně citlivé a do stránky se nesmí dostat nic, co v textu není
// (HTML, skript). Proto se VŠE eskaluje a obaluje se jen rozpoznané značky.
//
// Podporuje: nadpisy #–####, odstavce, odrážkové a číslované seznamy, **tučné**,
// `kód`, odkazy http(s), citace (> včetně nadpisů uvnitř), tabulky, vodorovnou
// čáru a zalomení řádku dvěma mezerami na konci.
'use strict';

function mdEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdInline(text) {
  let s = mdEscape(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/ {2}$/, '<br>');
  return s;
}

function mdTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function mdToHtml(markdown) {
  const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null; // 'ul' | 'ol'

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push('<p>' + paragraph.join(' ') + '</p>');
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) { out.push('</' + list + '>'); list = null; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');

    // Prázdný řádek ukončí odstavec, ale NE seznam — dokumenty mají mezi
    // odrážkami prázdné řádky a bez toho by každá odrážka byla vlastní seznam
    // (62 jednopoložkových seznamů místo 6 přehledných).
    if (!line.trim()) { flushParagraph(); continue; }

    // tabulka: řádek s rourami + oddělovač |---|---|
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushParagraph(); closeList();
      const hlavicka = mdTableRow(line);
      const radky = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        radky.push(mdTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push('<div class="doc-table-wrap"><table class="doc-table"><thead><tr>'
        + hlavicka.map((h) => '<th>' + mdInline(h.trim()) + '</th>').join('')
        + '</tr></thead><tbody>'
        + radky.map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c.trim()) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    // citace — obsah se vykresluje stejnými pravidly (bývá v ní i nadpis a tučné)
    if (/^>\s?/.test(line)) {
      flushParagraph(); closeList();
      const vnitrek = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        vnitrek.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      i -= 1;
      out.push('<blockquote>' + mdToHtml(vnitrek.join('\n')) + '</blockquote>');
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(); closeList();
      // # je v dokumentu název dokumentu → h2 (h1 patří stránce, ať nejsou dvě)
      const level = Math.min(4, heading[1].length) + 1;
      out.push(`<h${level}>` + mdInline(heading[2]) + `</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); closeList(); out.push('<hr>'); continue; }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + mdInline(bullet[1]) + '</li>');
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + mdInline(numbered[1]) + '</li>');
      continue;
    }

    closeList();
    paragraph.push(mdInline(line.trim()));
  }

  flushParagraph();
  closeList();
  return out.join('\n');
}
