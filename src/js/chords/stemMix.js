// ─────────────────────────────────────────────────────────────────────────
// Pistas separadas (stems) de una canción como fuente para los análisis:
//  - armónica: bajo + teclados + guitarras + «otros», SIN voz ni batería. Los
//    acordes se detectan mucho mejor sin la melodía cantada (notas de paso) ni
//    los golpes de batería encima.
//  - voz: para saber qué tramos son cantados (secciones).
//
// Solo se usan si ya están en este equipo (no se descarga nada para esto) y si
// duran lo mismo que la pista cargada: los stems suelen salir de separar el
// ORIGINAL; si la pista cargada es la secuencia (otra duración/estructura), sus
// tiempos no cuadrarían y se analiza la mezcla como siempre.
// ─────────────────────────────────────────────────────────────────────────
import { getSongStems } from '../stems/songStems.js';
import { detectStemRole } from '../stems/stemRole.js';

const HARMONIC = new Set(['bass', 'keys', 'guitar', 'other']);
const memo = new Map();   // clave → Promise<{harmonic, vocals}>

let decodeCtx = null;
function ctx() {
  if (!decodeCtx) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decodeCtx = new AC(1, 1, 44100);
  }
  return decodeCtx;
}

async function decode(url) {
  if (!window.electronAPI || !window.electronAPI.readAudioFile) return null;
  try {
    const ab = await window.electronAPI.readAudioFile(url);
    if (!ab || !ab.byteLength) return null;
    return await ctx().decodeAudioData(ab.slice ? ab.slice(0) : ab);
  } catch (_) { return null; }
}

/** Suma de varios AudioBuffer a uno mono (a la frecuencia del primero). */
function mixMono(buffers) {
  const list = buffers.filter(Boolean);
  if (!list.length) return null;
  const sr = list[0].sampleRate;
  const len = Math.max(...list.map((b) => Math.round(b.duration * sr)));
  const out = new Float32Array(len);
  for (const b of list) {
    const ratio = b.sampleRate / sr;
    const chs = [];
    for (let c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c));
    const n = Math.min(len, Math.floor(b.length / ratio));
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i * ratio);
      let v = 0;
      for (const ch of chs) v += ch[j];
      out[i] += v / chs.length;
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 1) for (let i = 0; i < len; i++) out[i] /= peak;
  const buf = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: 1, sampleRate: sr });
  buf.copyToChannel(out, 0);
  return buf;
}

/**
 * @param {object} song
 * @param {number} refDuration  duración (s) de la pista cargada
 * @returns {Promise<{harmonic: AudioBuffer|null, vocals: AudioBuffer|null}>}
 */
export function stemBuffers(song, refDuration) {
  const none = { harmonic: null, vocals: null };
  const stems = getSongStems(song);
  if (!stems.length || !(refDuration > 0)) return Promise.resolve(none);
  const key = (song.cloudId || song.id) + '|' + stems.map((s) => s.url).join(',') + '|' + Math.round(refDuration);
  if (memo.has(key)) return memo.get(key);
  const job = (async () => {
    const kind = (s) => s.kind || detectStemRole(s.name || '').kind;
    const harm = stems.filter((s) => HARMONIC.has(kind(s)));
    const voc = stems.filter((s) => kind(s) === 'vocals');
    if (!harm.length && !voc.length) return none;
    const [hb, vb] = await Promise.all([
      Promise.all(harm.map((s) => decode(s.url))),
      Promise.all(voc.map((s) => decode(s.url))),
    ]);
    // Que cuadren en el tiempo con la pista cargada (±0,6 s).
    const fits = (b) => b && Math.abs(b.duration - refDuration) <= 0.6;
    const h = hb.filter(fits), v = vb.filter(fits);
    return { harmonic: h.length ? mixMono(h) : null, vocals: v.length ? mixMono(v) : null };
  })().catch(() => none);
  memo.set(key, job);
  return job;
}
