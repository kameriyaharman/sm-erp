/* SM ERP parent portal service worker.
 *
 * Caches only the app shell (pages, scripts, styles, icons) so the portal opens
 * offline or on a weak connection. API responses are NEVER cached: they carry a
 * child's private data and must always be fresh (fees, attendance).
 */
const VERSION = 'parent-v1';
const SHELL = ['/parent', '/parent.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafaf9;color:#1c1917">
<div style="text-align:center;padding:24px;max-width:320px"><p style="font-size:18px;font-weight:600;margin:0 0 8px">You are offline</p>
<p style="margin:0;color:#57534e">Connect to the internet to see the latest fees, attendance and homework.</p></div></body>`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return; // API host, uploads, etc.
  if (url.pathname.startsWith('/api/')) return;                               // never cache private data

  // Pages: network first, fall back to the cached shell, then to an offline note.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/parent')) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } })),
    );
    return;
  }

  // Static assets (hashed Next.js chunks, fonts, icons): cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
