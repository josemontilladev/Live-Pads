// ─────────────────────────────────────────────────────────────────────────
// Service Worker de LivePads Móvil.
// · Shell (html/css/js/manifest/iconos): network-first con caída a caché —
//   las actualizaciones entran con una recarga, y sin red la app abre igual.
// · Pads (assets/pads/*.mp3): cache-first — 12 loops que no cambian; tras la
//   primera reproducción quedan para siempre.
// · El AUDIO del repertorio NO pasa por aquí: lo gestiona la app con su propio
//   Cache Storage (las URLs firmadas de R2 cambian en cada petición).
// ─────────────────────────────────────────────────────────────────────────

const SHELL_CACHE = 'lpm-shell-v1';
const PADS_CACHE = 'lpm-pads-v1';

const SHELL = [
  '.', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/audio.js', 'js/cloud.js', 'js/config.js',
  'js/metronome.js', 'js/pads.js', 'js/supabase.js',
  'assets/icon.png', 'assets/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, PADS_CACHE, 'lpm-media-v1'].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Supabase/R2: la app decide

  // Pads y clicks: cache-first (assets inmutables).
  if (url.pathname.includes('/assets/pads/') || url.pathname.includes('/assets/click/')) {
    e.respondWith(
      caches.open(PADS_CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // Shell: network-first con caída a caché.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
