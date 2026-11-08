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
  try {
    const s = localStorage.getItem(LS_CACHE + id);
    if (!s) return null;
    const r = JSON.parse(s);
    // Motor mejorado (v2): lo analizado con el anterior se vuelve a analizar; un escaneo de YouTube no se puede
    // repetir solo, así que esos se conservan.
    if ((r.v || 1) < 2 && !String(id).startsWith('yt.')) return null;
    return r;
  } catch (_) { return null; }
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

// ── Acordes precisos (en segundo plano) ───────────────────────────────────
// Primero se muestra el análisis rápido (motor clásico, en el navegador).
// Después, un modelo entrenado (BTC, en local, en un hilo aparte del proceso
// principal; unos segundos, con o sin GPU) vuelve a escuchar la pista y sus
// acordes sustituyen a los rápidos en la caché; se avisa con
// «livepads:chords-ready» y la franja se actualiza sola.
// Medido con 40 canciones de la biblioteca contra su cifrado: el tiempo con un
// acorde que está en el cifrado pasa del 74 % al 85 % (mejor en 35 de 40).
let refineChain = Promise.resolve();
const refining = new Map();
const isRefined = (r) => !!(r && r.src === 'btc');

export function canRefine() {
  return !!(window.electronAPI && window.electronAPI.analyzeChordsModel);
}

async function bufferToMono22050(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * 22050));
  const off = new OfflineAudioContext(1, len, 22050);
  const src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

// Tonalidad a partir de los acordes (la misma regla que la 2.ª pasada del motor):
// los grados de cada tono pesan por su duración; tónica, primer y último acorde suman.
const DEG_MAJ = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]];
const DEG_MIN = [[0, true], [3, false], [5, true], [7, true], [8, false], [10, false]];
export function keyFromSegments(seg, duration, prev) {
  const dur = new Float64Array(24);
  let first = -1, last = -1;
  for (const x of seg) {
    if (x.r < 0) continue;
    const b = x.r + ((x.q === 1 || x.q === 4) ? 12 : 0);
    dur[b] += x.e - x.s;
    if (first < 0) first = b;
    last = b;
  }
  let best = { k: prev ? prev.k : 0, m: prev ? prev.m : false, s: -1e9 };
  for (let k = 0; k < 12; k++) {
    for (const m of [false, true]) {
      let sc = 0;
      for (const [d, mi] of (m ? DEG_MIN : DEG_MAJ)) sc += dur[(k + d) % 12 + (mi ? 12 : 0)];
      const tonic = k + (m ? 12 : 0);
      sc += 0.6 * dur[tonic] + (last === tonic ? 0.12 * duration : 0) + (first === tonic ? 0.12 * duration : 0);
      if (m) sc -= 0.12 * duration;   // en alabanza casi todo es mayor
      if (sc > best.s) best = { k, m, s: sc };
    }
  }
  return { k: best.k, m: best.m };
}

/** Afinar los acordes de una pista con el modelo (una sola vez; en cola, de una en una). */
export function refineChords(id, buffer) {
  if (!id || !buffer || !canRefine() || String(id).startsWith('yt.')) return Promise.resolve(null);
  if (isRefined(cacheGet(id))) return Promise.resolve(null);
  if (refining.has(id)) return refining.get(id);
  const job = refineChain.then(async () => {
    const base = cacheGet(id);
    if (!base || isRefined(base)) return null;
    const mono = await bufferToMono22050(buffer);
    const r = await window.electronAPI.analyzeChordsModel({ mono });
    if (!r || !Array.isArray(r.seg) || !r.seg.length) {
      if (r && r.error) console.warn('[LivePads] acordes (modelo):', r.error);
      return null;
    }
    const key = keyFromSegments(r.seg, base.d || buffer.duration, base);
    const res = { ...base, seg: r.seg, k: key.k, m: key.m, src: 'btc' };
    cachePut(id, res);
    announce(id, res);
    return res;
  }).catch((e) => { console.warn('[LivePads] acordes (modelo):', e); return null; })
    .finally(() => refining.delete(id));
  refineChain = job.then(() => {}, () => {});
  refining.set(id, job);
  return job;
}
