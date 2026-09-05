// sw.js — Service Worker: app shell cache + offline režim pro členskou kartu a provozní řád.
'use strict';

const CACHE = 'airbag-v29';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css?v=29',
  '/js/api.js?v=29',
  '/js/ui.js?v=29',
  '/js/views-public.js?v=29',
  '/js/views-member.js?v=29',
  '/js/views-admin.js?v=29',
  '/js/app.js?v=29',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// API odpovědi, které se cachují pro offline (členská karta, dokumenty)
const CACHEABLE_API = ['/api/card', '/api/docs'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // jen same-origin
  if (url.origin !== self.location.origin) return;

  // API: cache-first pro karta/docs, jinak network-only
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.some((p) => url.pathname.startsWith(p))) {
      event.respondWith(
        caches.match(event.request).then((cached) => {
          const network = fetch(event.request)
            .then((resp) => {
              if (resp && resp.ok) {
                const clone = resp.clone();
                caches.open(CACHE).then((c) => c.put(event.request, clone));
              }
              return resp;
            })
            .catch(() => cached);
          return cached || network;
        })
      );
    }
    return; // ostatní API neprochází SW cache
  }

  // navigace / app shell: network-first s fallbackem na cache (offline funguje)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', clone));
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // statické assety: cache-first
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((resp) => {
          if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'default')) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return resp;
        })
    )
  );
});
