// ─────────────────────────────────────────────────────────────────────────
// Service Worker del DESKTOP CLOUD (scope /desktop/).
// Deja TODO lo del mismo origen en memoria local para que la app reaccione
// rápido y funcione offline tras la primera carga:
//   · Assets pesados inmutables (pads .mp3/.wav, fuentes, imágenes): cache-first.
//   · Shell (js/css/html): network-first con caída a caché (las updates entran
//     con una recarga; sin red, abre igual).
// El audio/kits de R2 NO pasa por aquí (otra caché, la maneja media.js).
// ─────────────────────────────────────────────────────────────────────────

const SHELL = 'lpd-shell-v1';
const ASSETS = 'lpd-assets-v1';

// Precachea la portada para garantizar que la app ABRA sin internet.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['index.html', './']))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => ![SHELL, ASSETS].includes(k) && k.startsWith('lpd-')).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;       // R2/Supabase: la app decide
  if (e.request.method !== 'GET') return;

  // Assets inmutables (audio de pads, fuentes, imágenes): cache-first.
  if (/\.(mp3|wav|ogg|opus|m4a|woff2?|ttf|otf|png|jpe?g|webp|svg|ico)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // Shell (js/css/html): network-first con caída a caché.
  // Sin red, una navegación cae a la index.html cacheada → la app ABRE OFFLINE.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone())).catch(() => {});
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        if (e.request.mode === 'navigate') {
          const idx = await caches.match('index.html') || await caches.match('./');
          if (idx) return idx;
        }
        return Response.error();
      })
  );
});
