// build-www.js — sestaví složku www/ (webDir pro Capacitor) z public/.
// Kopíruje statické assety a do index.html vloží <script> s __API_BASE__,
// aby nativní wrapper (Android/iOS) volal PRODUKČNÍ backend místo lokálního
// /api (v nativním webview by relativní cesta mířila na file:///capacitor://).
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const wwwDir = path.join(root, 'www');

// API base pro nativní build — čteme z env (AP PAPI_BASE), výchozí produkce.
const apiBase = process.env.APP_API_BASE || 'https://tjk-airbag.vercel.app';

// 1) Čistě zkopírovat public/ -> www/
fs.rmSync(wwwDir, { recursive: true, force: true });
fs.mkdirSync(wwwDir, { recursive: true });
cp.execSync(`cp -R ${JSON.stringify(publicDir)}/. ${JSON.stringify(wwwDir)}`, { stdio: 'inherit' });

// 2) Injektovat __API_BASE__ před <script src="/js/api.js">
const indexPath = path.join(wwwDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const inject = `  <script>\n    window.__API_BASE__ = ${JSON.stringify(apiBase)};\n  </script>\n  <script src="/js/api.js"></script>`;
if (html.includes('window.__API_BASE__')) {
  // idempotence: přepsat stávající hodnotu
  html = html.replace(/window\.__API_BASE__\s*=\s*"[^"]*"/, `window.__API_BASE__ = ${JSON.stringify(apiBase)}`);
} else {
  html = html.replace('  <script src="/js/api.js"></script>', inject);
}
fs.writeFileSync(indexPath, html);

console.log(`[build-www] www/ sestaveno, __API_BASE__ = ${apiBase}`);
