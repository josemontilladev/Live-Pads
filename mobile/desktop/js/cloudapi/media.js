// ─────────────────────────────────────────────────────────────────────────
// Resolución de MEDIOS en la nube para el renderer desktop.
// Convierte rutas livepads://app/<path> (audio y carátulas) en URLs
// reproducibles desde Cloudflare R2:
//   · Streaming: URL firmada de R2 (soporta range → seek en el audio).
//   · Offline: si ya está en Cache Storage, sirve un objectURL local.
// La caché usa la MISMA clave que la app móvil (mismo origen) → lo descargado
// en el móvil también sirve aquí y viceversa.
// ─────────────────────────────────────────────────────────────────────────

import { invokeFunction } from './supabase.js';

const CACHE_NAME = 'lpm-media-v1';
let LIB = null;

export function setLibraryId(id) { LIB = id; }

function relFrom(url) {
  const m = String(url || '').match(/^livepads:\/\/app\/(.+)$/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function cacheKey(rel) { return `https://r2-cache.local/${LIB}/${encodeURI(rel)}`; }

async function signGet(rel) {
  const r = await invokeFunction('r2-sign', { libraryId: LIB, path: rel, op: 'get' });
  if (!r || !r.url) throw new Error(r && r.error ? r.error : 'No se pudo firmar.');
  return r.url;
}

// livepads:// → URL reproducible (objectURL cacheado u URL firmada de R2).
// Para PISTAS grandes (canción): streaming por URL firmada (no carga en RAM).
export async function cloudResolve(livepadsUrl) {
  const rel = relFrom(livepadsUrl);
  if (!rel || !LIB) return livepadsUrl;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(rel));
    if (hit) return URL.createObjectURL(await hit.blob());
  } catch (_) { /* sin Cache API: seguimos a streaming */ }
  try { return await signGet(rel); } catch (_) { return livepadsUrl; }
}

// Igual, pero para ARCHIVOS PEQUEÑOS (samples de kit, carátulas): SIEMPRE
// baja una vez a Cache Storage y devuelve un blob local → el 2º uso (cambiar de
// kit, re-render) es instantáneo, sin volver a la red.
export async function cloudResolveFile(livepadsUrl) {
  const rel = relFrom(livepadsUrl);
  if (!rel || !LIB) return livepadsUrl;
  try {
    const cache = await caches.open(CACHE_NAME);
    let hit = await cache.match(cacheKey(rel));
    if (!hit) {
      const url = await signGet(rel);
      const res = await fetch(url);
      if (!res.ok) return url;
      await cache.put(cacheKey(rel), res.clone());
      hit = res;
    }
    return URL.createObjectURL(await hit.blob());
  } catch (_) {
    try { return await signGet(rel); } catch (__) { return livepadsUrl; }
  }
}

// ── Descarga offline (setlist completo) ────────────────────────────────────
async function prefetchOne(rel) {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(cacheKey(rel))) return false;
  const url = await signGet(rel);
  const res = await fetch(url);
  if (!res.ok) throw new Error('descarga ' + res.status);
  await cache.put(cacheKey(rel), new Response(await res.blob()));
  return true;
}

// Rutas de los samples de los kits de batería personalizados (para descargar).
function drumRels(drums) {
  const rels = [];
  const kits = drums && Array.isArray(drums.kits) ? drums.kits : [];
  const PADS = ['c_kick', 'c_snare', 'c_hhc', 'c_clap', 'c_perc1', 'c_perc2', 'c_crash', 'c_ride'];
  kits.forEach((k) => PADS.forEach((id) => { const r = relFrom(k[id]); if (r) rels.push(r); }));
  return rels;
}

// Descarga TODO a la caché local: audios + carátulas de las canciones y los
// samples de los kits. Así la app en la nube reacciona rápido y sirve offline.
export async function prefetchAll(songs, drums, onProgress) {
  const rels = [];
  (songs || []).forEach((s) => {
    const a = s.audio || {};
    [a.sequence, a.original, s.cover].forEach((u) => { const r = relFrom(u); if (r) rels.push(r); });
  });
  drumRels(drums).forEach((r) => rels.push(r));
  const uniq = [...new Set(rels)];
  let done = 0, got = 0, failed = 0;
  for (const rel of uniq) {
    onProgress && onProgress(++done, uniq.length);
    try { if (await prefetchOne(rel)) got++; } catch (_) { failed++; }
  }
  return { got, failed, total: uniq.length };
}
// Compat: prefetch solo canciones.
export function prefetchSongs(songs, onProgress) { return prefetchAll(songs, null, onProgress); }

// ── Carátulas: reemplaza <img src="livepads://…"> por la URL resuelta ──────
const coverCache = new Map();
async function resolveCoverImg(img) {
  const src = img.getAttribute('src') || '';
  if (!src.startsWith('livepads://')) return;
  img.setAttribute('data-cloud-resolving', '1');
  let resolved = coverCache.get(src);
  if (!resolved) { resolved = await cloudResolve(src); coverCache.set(src, resolved); }
  if (resolved && resolved !== src) img.src = resolved;
}
export function watchCovers() {
  const scan = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img[src^="livepads://"]:not([data-cloud-resolving])').forEach(resolveCoverImg);
  };
  scan(document);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG' && (n.getAttribute('src') || '').startsWith('livepads://')) resolveCoverImg(n);
        scan(n);
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
