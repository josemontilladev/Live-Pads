// ─────────────────────────────────────────────────────────────────────────
// Acordes de la pista cargada, compartidos por el panel «Detectar acordes» y la
// franja de acordes del espectro (seqWaveform). Un solo análisis por pista:
// se reduce a mono 11 025 Hz, se analiza en el Web Worker y se guarda en
// localStorage, así abrir el panel o encender la franja después es instantáneo.
// ─────────────────────────────────────────────────────────────────────────

import { CHORD_SR } from './chordEngine.js';
import { analyzeInWorker } from './chordWorker.js';
import { uploadForAnalysis, forgetUpload } from '../analysis/analysisAudio.js';
import { parseLyricStructure, keyOffset, parseChord } from '../ui/songStructure.js';
import { parseKey } from '../utils/musicKeys.js';

export const LS_PREFS = 'livepads.chords';
const LS_CACHE = 'livepads.chords.v2.';   // v2: letra/tonalidad como guía y duración mínima
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
const isRefined = (r, sig) => !!(r && r.src === 'btc' && (sig == null || r.ctx === sig));

const mod12 = (v) => ((v % 12) + 12) % 12;
/**
 * Qué sabe la canción de sí misma, para que el detector no «invente»:
 * - Con acordes en la letra: esos acordes (en el tono del AUDIO: el original puede
 *   estar en el tono del artista) son el vocabulario; lo demás casi no puede salir.
 * - Sin ellos: la tonalidad (la de la canción para la secuencia; la detectada para
 *   el original, que puede ir en otro tono) favorece sus acordes.
 * - El BPM, para que ningún acorde dure menos de 2 pulsos.
 */
export function chordContext(song, type, base) {
  if (!song) return null;
  const ctx = { bpm: Number(song.bpm) || 0 };
  let secs = [];
  try { secs = song.lyrics ? parseLyricStructure(song.lyrics) : []; } catch (_) { secs = []; }
  const names = new Set();
  for (const s of secs) for (const c of (s.chords || [])) if (c && c.n) names.add(c.n);
  const lyr = [...names].map((n) => parseChord(n)).filter(Boolean).map((c) => ({ r: c.r, m: c.q === 1 || c.q === 4 }));
  let off = null;
  if (lyr.length >= 2 && base && Array.isArray(base.seg) && base.seg.length) {
    off = keyOffset(secs, base.seg);
    if (off && off.score >= 0.45) {
      // acorde_letra = acorde_audio + k  →  acorde_audio = acorde_letra − k
      const seen = new Set();
      ctx.vocab = lyr.map((v) => ({ r: mod12(v.r - off.k), m: v.m })).filter((v) => { const k = v.r + (v.m ? 12 : 0); if (seen.has(k)) return false; seen.add(k); return true; });
    }
  }
  if (!ctx.vocab) {
    const pk = parseKey(song.key);
    if (pk && type === 'sequence') ctx.key = { k: pk.semitone, m: !!pk.minor };
    else if (pk && off && off.score >= 0.45) ctx.key = { k: mod12(pk.semitone - off.k), m: !!pk.minor };
    else if (base && Number.isFinite(base.k)) ctx.key = { k: base.k, m: !!base.m };
  }
  ctx.sig = JSON.stringify([ctx.vocab || null, ctx.key || null, ctx.bpm || 0]);
  return ctx;
}

/** Funde los acordes que duran menos de `min` s con el vecino más largo (o igual). */
export function enforceMinDuration(seg, min) {
  if (!(min > 0) || !Array.isArray(seg)) return seg;
  let out = seg.map((x) => ({ ...x }));
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      if (x.e - x.s >= min) continue;
      const p = out[i - 1], n = out[i + 1];
      const into = !p ? n : !n ? p : ((p.e - p.s) >= (n.e - n.s) ? p : n);
      if (!into) continue;
      if (into === p) p.e = x.e; else n.s = x.s;
      out.splice(i, 1); i--; changed = true;
    }
    // Vecinos iguales tras fundir → uno solo.
    const m = [];
    for (const x of out) { const l = m[m.length - 1]; if (l && l.r === x.r && l.q === x.q) l.e = x.e; else m.push(x); }
    out = m;
    if (!changed) break;
  }
  return out;
}

export function canRefine() {
  return !!(window.electronAPI && window.electronAPI.analyzeChordsModel);
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
// `analysisBuffer`: lo que se analiza (p. ej. la mezcla de stems sin voz ni batería);
// `buffer` sigue siendo la pista cargada (su duración y su id).
export function refineChords(id, buffer, song = null, type = '', analysisBuffer = null) {
  if (!id || !buffer || !canRefine() || String(id).startsWith('yt.')) return Promise.resolve(null);
  const src = analysisBuffer ? '|stems' : '';
  const sig0 = song ? (chordContext(song, type, cacheGet(id))?.sig || '') + src : null;
  if (isRefined(cacheGet(id), sig0)) return Promise.resolve(null);
  if (refining.has(id)) return refining.get(id);
  const job = refineChain.then(async () => {
    const base = cacheGet(id);
    const ctx = song ? chordContext(song, type, base) : null;
    if (ctx) ctx.sig += src;
    if (!base || isRefined(base, ctx ? ctx.sig : null)) return null;
    const input = analysisBuffer || buffer;
    const args = () => ({ key: ctx && ctx.key, vocab: ctx && ctx.vocab });
    let r = await window.electronAPI.analyzeChordsModel({ token: await uploadForAnalysis(input), ...args() });
    if (r && r.missing) { forgetUpload(input); r = await window.electronAPI.analyzeChordsModel({ token: await uploadForAnalysis(input), ...args() }); }
    if (!r || !Array.isArray(r.seg) || !r.seg.length) {
      if (r && r.error) console.warn('[LivePads] acordes (modelo):', r.error);
      return null;
    }
    // Ningún acorde de menos de 2 pulsos (los cambios sueltos de 1 s eran ruido).
    const seg = ctx && ctx.bpm > 0 ? enforceMinDuration(r.seg, 2 * 60 / ctx.bpm) : r.seg;
    // Tono: el que se usó como guía si lo hay; si no, el que sale de los acordes.
    const key = (ctx && ctx.key) ? ctx.key : keyFromSegments(seg, base.d || buffer.duration, base);
    const res = { ...base, seg, k: key.k, m: key.m, src: 'btc', ctx: ctx ? ctx.sig : null, guide: r.prior || '', stems: !!analysisBuffer };
    cachePut(id, res);
    announce(id, res);
    return res;
  }).catch((e) => { console.warn('[LivePads] acordes (modelo):', e); return null; })
    .finally(() => refining.delete(id));
  refineChain = job.then(() => {}, () => {});
  refining.set(id, job);
  return job;
}
