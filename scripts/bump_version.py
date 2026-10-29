#!/usr/bin/env python3
"""Zvedne verzi assetů v PWA na zadané číslo.

Proč: statika se servíruje s `immutable` cache a service worker drží SHELL,
takže po každé změně CSS/JS se MUSÍ změnit `?v=` v index.html, lazy skriptech,
CACHE v sw.js a štítek verze v patičce — jinak si prohlížeč (i ten náš při
testu) vezme starý soubor a „změna se neprojeví".

Použití: python3 scripts/bump_version.py 50
"""
import re
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        raise SystemExit("použití: bump_version.py <číslo>")
    new = sys.argv[1]

    # 1) index.html — odkazy na statiku + štítek verze v patičce
    p = PUBLIC / "index.html"
    s = p.read_text()
    s = re.sub(r"\?v=\d+", f"?v={new}", s)
    s = re.sub(r">v\d+</span>", f">v{new}</span>", s)
    p.write_text(s)

    # 2) app.js — lazy načítané view skripty
    p = PUBLIC / "js" / "app.js"
    s = re.sub(r"\?v=\d+", f"?v={new}", p.read_text())
    p.write_text(s)

    # 3) sw.js — název cache + SHELL
    p = PUBLIC / "sw.js"
    s = p.read_text()
    s = re.sub(r"airbag-v\d+", f"airbag-v{new}", s)
    s = re.sub(r"\?v=\d+", f"?v={new}", s)
    p.write_text(s)

    print(f"verze -> v{new}")
    for f in ("index.html", "js/app.js", "sw.js"):
        hits = (PUBLIC / f).read_text().count(f"v={new}")
        print(f"  {f}: {hits} odkazů s ?v={new}")


if __name__ == "__main__":
    main()
