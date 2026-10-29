#!/usr/bin/env python3
"""Stáhne woff2 fonty nového airbag webu (Archivo + Space Grotesk) do PWA.

Důvod: CSP app.tjkrupka.cz má font-src 'self', takže Google Fonts z CDN nejde.
Stahuje se přes CSS API s UA, který vrací woff2, jen latin + latin-ext.
"""
import re
import urllib.request
from pathlib import Path

DEST = Path("/Users/mb/dev/airbag-projekt/pwa/public/fonts")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

FAMILIES = {
    "archivo": ("Archivo", [600, 700, 800]),
    "spacegrotesk": ("Space Grotesk", [400, 500, 600, 700]),
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    urls = []
    for slug, (name, weights) in FAMILIES.items():
        q = f"family={name.replace(' ', '+')}:wght@" + ";".join(str(w) for w in weights)
        css = fetch(f"https://fonts.googleapis.com/css2?{q}&display=swap").decode()
        # bloky: /* subset */ @font-face { ... src: url(...) ... font-weight: NNN ... }
        for block in re.findall(r"/\*\s*([a-z0-9-]+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S):
            subset, body = block
            if subset not in ("latin", "latin-ext"):
                continue
            m_url = re.search(r"url\((https://[^)]+\.woff2)\)", body)
            m_w = re.search(r"font-weight:\s*(\d+)", body)
            if not m_url or not m_w:
                continue
            weight = m_w.group(1)
            fname = f"{slug}-{weight}-{subset}.woff2"
            data = fetch(m_url.group(1))
            (DEST / fname).write_bytes(data)
            urls.append((fname, name, weight, subset, len(data)))
    for fname, name, weight, subset, size in sorted(urls):
        print(f"{fname:42s} {name:14s} {weight} {subset:10s} {size:>7d} B")
    print("celkem:", len(urls), "souborů")


if __name__ == "__main__":
    main()
