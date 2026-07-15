// ─────────────────────────────────────────────────────────────────────────
// Audio de la PWA: descarga firmada desde R2 con caché OFFLINE + reproductor
// Web Audio con paneo.
//
// · Las URLs firmadas caducan (10 min) y cambian en cada petición, así que el
//   Cache Storage usa una clave SINTÉTICA estable por archivo:
//       https://r2-cache.local/<libraryId>/<relPath>
//   Primera reproducción: red → caché. Siguientes: 0 red (culto sin WiFi ✓).
// · Un solo AudioContext para todo (player + pads + metrónomo) — política de
//   autoplay: se crea/resume en el primer gesto del usuario.
// ─────────────────────────────────────────────────────────────────────────

import { signGet } from './cloud.js';

const CACHE_NAME = 'lpm-media-v1';

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function cacheKey(libraryId, relPath) {
  return `https://r2-cache.local/${libraryId}/${encodeURI(relPath)}`;
}

// Bytes de un archivo de la biblioteca: caché primero, si no red firmada.
export async function loadFileBlob(libraryId, relPath, { onState } = {}) {
  const key = cacheKey(libraryId, relPath);
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(key);
    if (hit) return await hit.blob();
    onState?.('descargando');
    const url = await signGet(libraryId, relPath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Descarga falló (${res.status})`);
    const resForCache = res.clone();
    const blob = await res.blob();
    // Guardar sin bloquear la reproducción.
    cache.put(key, new Response(resForCache.body, {
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' },
    })).catch(() => {});
    return blob;
  } catch (err) {
    // Sin Cache API (contexto raro) → directo a red.
    if (err && /caches/i.test(String(err))) {
      const url = await signGet(libraryId, relPath);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Descarga falló (${res.status})`);
      return await res.blob();
    }
    throw err;
  }
}

// ¿Está ya offline este archivo?
export async function isFileCached(libraryId, relPath) {
  if (!relPath) return true; // nada que bajar = "listo"
  try {
    const cache = await caches.open(CACHE_NAME);
    return !!(await cache.match(cacheKey(libraryId, relPath)));
  } catch (_) { return false; }
}

// ¿Están TODOS los archivos de audio de una canción ya offline? (para el punto
// verde de "lista sin internet"). La carátula no cuenta: es opcional.
export async function isSongCached(libraryId, song) {
  const paths = [song.sequencePath, song.originalPath].filter(Boolean);
  if (!paths.length) return true;
  for (const p of paths) {
    if (!(await isFileCached(libraryId, p))) return false;
  }
  return true;
}

// Descarga a la caché los archivos de una canción (audio + carátula) que falten.
// Devuelve cuántos bajó.
export async function prefetchSong(libraryId, song) {
  const paths = [song.sequencePath, song.originalPath, song.coverPath].filter(Boolean);
  let got = 0;
  for (const p of paths) {
    if (await isFileCached(libraryId, p)) continue;
    try { await loadFileBlob(libraryId, p); got++; } catch (_) { /* seguimos con el resto */ }
  }
  return got;
}

// Borra TODO el audio cacheado (liberar espacio en la tablet).
export async function clearMediaCache() {
  try { await caches.delete(CACHE_NAME); return true; } catch (_) { return false; }
}

// Carátula → object URL para <img>. null si falla (la card muestra iniciales).
export async function loadCoverUrl(libraryId, relPath) {
  if (!relPath) return null;
  try {
    const blob = await loadFileBlob(libraryId, relPath);
    return URL.createObjectURL(blob);
  } catch (_) { return null; }
}

// ── Reproductor (una pista a la vez: secuencia u original) ─────────────────
export class Player {
  constructor() {
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.pan = null;
    this.playing = false;
    this.startedAt = 0;   // ctx.currentTime cuando arrancó
    this.offset = 0;      // segundos ya recorridos al pausar/seek
    this.volume = 1;
    this.panValue = 0;
    this.onEnded = null;
  }

  ensureNodes() {
    const c = audioCtx();
    if (!this.gain) {
      this.gain = c.createGain();
      this.pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (this.pan) {
        this.gain.connect(this.pan);
        this.pan.connect(c.destination);
      } else {
        this.gain.connect(c.destination);
      }
    }
    this.gain.gain.value = this.volume;
    if (this.pan) this.pan.pan.value = this.panValue;
  }

  async load(libraryId, relPath, opts) {
    this.stop();
    const blob = await loadFileBlob(libraryId, relPath, opts);
    const arr = await blob.arrayBuffer();
    this.buffer = await audioCtx().decodeAudioData(arr);
    this.offset = 0;
    return this.buffer.duration;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  get currentTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (audioCtx().currentTime - this.startedAt));
  }

  play() {
    if (!this.buffer || this.playing) return;
    this.ensureNodes();
    const c = audioCtx();
    this.source = c.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain);
    this.source.onended = () => {
      // onended también dispara en stop(); solo avisamos si llegó al final.
      if (this.playing && this.currentTime >= this.duration - 0.1) {
        this.playing = false;
        this.offset = 0;
        this.onEnded?.();
      }
    };
    this.source.start(0, this.offset % Math.max(0.01, this.duration));
    this.startedAt = c.currentTime;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.playing = false;
    try { this.source?.stop(); } catch (_) {}
    this.source = null;
  }

  stop() {
    this.playing = false;
    this.offset = 0;
    try { this.source?.stop(); } catch (_) {}
    this.source = null;
  }

  seek(seconds) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.offset = Math.max(0, Math.min(this.duration, seconds));
    if (wasPlaying) this.play();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  // -1 (todo izquierda) … 0 … +1 (todo derecha)
  setPan(p) {
    this.panValue = p;
    if (this.pan) this.pan.pan.value = p;
  }
}
