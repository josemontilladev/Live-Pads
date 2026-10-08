// ─────────────────────────────────────────────────────────────────────────
// Acordes de la pista cargada, compartidos por el panel «Detectar acordes» y la
// franja de acordes del espectro (seqWaveform). Un solo análisis por pista:
// se reduce a mono 11 025 Hz, se analiza en el Web Worker y se guarda en
// localStorage, así abrir el panel o encender la franja después es instantáneo.
// ─────────────────────────────────────────────────────────────────────────

import { CHORD_SR } from './chordEngine.js';
import { analyzeInWorker } from './chordWorker.js';

export const LS_PREFS = 'livepads.chords';
const LS_CACHE = 'livepads.chords.v1.';
const MAX_CACHE = 40;

export function chordPrefs() {
  const p = { basic: true, latin: false, tab: 'track', lane: false };
  try { Object.assign(p, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (_) {}
  return p;
}
export function saveChordPrefs(p) {
  try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('livepads:chord-prefs', { detail: p })); } catch (_) {}
}

export function cacheGet(id) {
  try { const s = localStorage.getItem(LS_CACHE + id); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
export function cacheDel(id) { try { localStorage.removeItem(LS_CACHE + id); } catch (_) {} }
export function cachePut(id, result) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_CACHE)) keys.push(k);
    }
    // Si hay demasiados, se borran los más viejos (la fecha va dentro).
    if (keys.length >= MAX_CACHE) {
      keys.map(k => { let at = 0; try { at = JSON.parse(localStorage.getItem(k)).at || 0; } catch (_) {} return [k, at]; })
        .sort((a, b) => a[1] - b[1]).slice(0, keys.length - MAX_CACHE + 1)
        .forEach(([k]) => { try { localStorage.removeItem(k); } catch (_) {} });
    }
    localStorage.setItem(LS_CACHE + id, JSON.stringify({ ...result, at: Date.now() }));
  } catch (_) { /* sin espacio: simplemente no se guarda */ }
}
// Avisa a quien muestre acordes (panel, espectro) que esta pista ya tiene resultado.
function announce(id, result) {
  try { window.dispatchEvent(new CustomEvent('livepads:chords-ready', { detail: { id, result } })); } catch (_) {}
}

/** Clave de caché de una pista: canción + tipo (secuencia/original) + duración. */
export function trackChordId(song, type, buffer) {
  return `${(song && (song.id || song.title)) || 'pista'}.${type || 'audio'}.${buffer ? Math.round(buffer.duration) : 0}`;
}

// AudioBuffer (cualquier frecuencia y canales) → mono 11 025 Hz con el remuestreo
// nativo del navegador (filtrado correcto, rapidísimo).
export async function bufferToMono(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * CHORD_SR));
  const off = new OfflineAudioContext(1, len, CHORD_SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}
// Archivo → decodificado directamente a 11 025 Hz y promediado a mono.
export async function fileToMono(arrayBuffer) {
  const off = new OfflineAudioContext(1, 1, CHORD_SR);
  const buf = await off.decodeAudioData(arrayBuffer);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  const g = 1 / buf.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

const inflight = new Map(); // id → Promise (si el panel y el espectro piden la misma pista a la vez)

/** Acordes de un AudioBuffer: de la caché o analizándolo (una sola vez aunque lo pidan dos). */
export function analyzeBufferCached(id, buffer, onProgress, force = false) {
  if (!force) {
    const c = cacheGet(id);
    if (c) return Promise.resolve(c);
    if (inflight.has(id)) return inflight.get(id);
  }
  const job = (async () => {
    const x = await bufferToMono(buffer);
    const r = await analyzeInWorker(x, onProgress);
    cachePut(id, r);
    announce(id, r);
    return r;
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/** Igual, para un archivo elegido por la persona. */
export async function analyzeFileCached(id, file, onProgress) {
  const c = cacheGet(id);
  if (c) return c;
  const x = await fileToMono(await file.arrayBuffer());
  const r = await analyzeInWorker(x, onProgress);
  cachePut(id, r);
  return r;
}
