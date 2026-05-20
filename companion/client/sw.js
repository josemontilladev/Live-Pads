// Minimal service worker — caches the shell so the Companion opens
// instantly on phones (even before the WS handshake completes), and
// survives a brief WiFi blip without showing a browser error page.
// WebSocket traffic isn't intercepted; only static assets are.

const CACHE = 'livepads-companion-v1';
const SHELL = [
  './',
  './index.html',
  './companion.css',
  './companion.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only intercept same-origin GET requests for our shell. WebSocket
  // upgrades go through their own protocol and never hit `fetch`.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate: serve from cache fast, refresh in background
  // so the next load picks up any client updates the cabin shipped.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
