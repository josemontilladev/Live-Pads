// ─────────────────────────────────────────────────────────────────────────
// Cada pista que se sube a la Biblioteca, con el menor peso posible.
//
//  · Pistas LARGAS (canción completa / multitrack, > 16 compases o > 45 s):
//      MP3 — 192 kbps estéreo, 128 kbps mono (Click y Guía siempre mono). Las que son
//      mono aunque vengan en estéreo (bajo, click, guía, muchas voces) se
//      guardan en mono. Sin escucha previa aparte: la pista ya pesa poco.
//      El MP3 mete ~1105 muestras de silencio al principio; se mide el desfase
//      exacto del codificador y se recorta del original, así la pista decodificada
//      empieza en la misma muestra que el WAV (todas quedan alineadas).
//  · Loops CORTOS: WAV de 16 bits (en mono si lo son) a su frecuencia original,
//      porque el MP3 dejaría un hueco en cada vuelta del bucle. FLAC se queda tal
//      cual (ya está comprimido sin pérdida). Escucha previa: WAV mono a 24 kHz.
//  · MP3 de origen: si ya está a ≤ 192 kbps (≤ 128 si es mono) se sube TAL CUAL,
//      sin volver a comprimir (rápido y sin perder calidad). Solo se recomprime si
//      así pesa bastante menos (p. ej. 320 kbps, o estéreo que en realidad es mono).
//      Un loop corto en MP3 se guarda como WAV para que no deje hueco al repetirse.
//  · La compresión corre en workers, varias pistas a la vez (una por núcleo).
// ─────────────────────────────────────────────────────────────────────────

import { audioBufferToMp3 } from '../audio/mp3Encode.js';
import { encodeMp3Async } from '../audio/mp3Pool.js';
import { audioBufferToWav } from './clickGenerator.js';
import { isMp3Name } from './mp3Info.js';

export const LONG_BARS = 16;
const LONG_SEC = 45;
const ALWAYS_MONO = new Set(['click', 'guide']);

export const isLongTrack = (r) => (r.bars > LONG_BARS) || (r.buffer && r.buffer.duration > LONG_SEC);

/** ¿Los dos canales son (casi) iguales? Entonces la pista es mono. */
export function isMonoBuffer(buffer) {
  if (buffer.numberOfChannels < 2) return true;
  const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
  let diff = 0, sum = 0;
  const step = Math.max(1, Math.floor(L.length / 400000));   // muestra ~400k puntos
  for (let i = 0; i < L.length; i += step) { const d = L[i] - R[i]; diff += d * d; sum += L[i] * L[i] + R[i] * R[i]; }
  return sum === 0 || diff / sum < 1e-4;                      // diferencia < -40 dB
}

// Canales recortados como Float32Array sueltos (se transfieren al worker).
function slicePcm(buffer, from, channels) {
  const len = Math.max(1, buffer.length - from);
  const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  if (channels === 1) {
    const o = new Float32Array(len);
    if (buffer.numberOfChannels > 1) for (let i = 0; i < len; i++) o[i] = (L[i + from] + R[i + from]) * 0.5;
    else o.set(L.subarray(from, from + len));
    return [o, null];
  }
  return [L.slice(from, from + len), R.slice(from, from + len)];
}

// Desfase del codificador para (canales, frecuencia, kbps): se mide una vez
// codificando un impulso y viendo dónde sale al decodificarlo.
const delays = new Map();
async function encoderDelay(channels, sampleRate, kbps) {
  const key = `${channels}/${sampleRate}/${kbps}`;
  if (delays.has(key)) return delays.get(key);
  let d = 1105;
  try {
    const n = sampleRate * 2, at = sampleRate;
    const b = new AudioBuffer({ numberOfChannels: channels, length: n, sampleRate });
    for (let c = 0; c < channels; c++) { const x = b.getChannelData(c); x[at] = 0.9; x[at + 1] = -0.9; }
    const mp3 = audioBufferToMp3(b, kbps);
    const dec = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(mp3.slice(0));
    const y = dec.getChannelData(0);
    let mi = 0, mv = 0;
    for (let i = 0; i < y.length; i++) { const v = Math.abs(y[i]); if (v > mv) { mv = v; mi = i; } }
    if (mi > at && mi - at < 5000) d = mi - at;
  } catch (_) { /* se queda el valor típico */ }
  delays.set(key, d);
  return d;
}

// Frecuencia del WAV original (cabecera), para no guardarlo a 48 kHz si era 44,1.
function wavSampleRate(bytes) {
  try {
    const v = new DataView(bytes);
    if (v.getUint32(0, false) !== 0x52494646) return 0;      // 'RIFF'
    const sr = v.getUint32(24, true);
    return sr >= 8000 && sr <= 192000 ? sr : 0;
  } catch (_) { return 0; }
}
async function render(buffer, sampleRate, channels) {
  const off = new OfflineAudioContext(channels, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  return off.startRendering();
}

// 128 kbps en mono también para Click y Guía: a 96 kbps el codificador remuestrea
// y el desfase deja de ser exacto (el click se adelantaba ~3,5 ms).
export function mp3Kbps(r, mono) {
  return mono ? 128 : 192;
}

const TOLERANCE = 1.08;   // un MP3 hasta un 8 % por encima del objetivo se deja tal cual

/** ¿Este MP3 de origen se puede subir sin recomprimir? */
export function keepMp3(r) {
  if (!r.mp3 || r.mp3Fixed) return false;
  const mono = ALWAYS_MONO.has(r.instrument) || isMonoBuffer(r.buffer);
  return r.mp3.kbps <= mp3Kbps(r, mono) * TOLERANCE;
}

/** Peso aproximado ANTES de subir (para avisar del espacio). */
export function estimateBytes(r) {
  if (isLongTrack(r)) {
    if (keepMp3(r)) return r.bytes.byteLength;
    const mono = ALWAYS_MONO.has(r.instrument) || isMonoBuffer(r.buffer);
    return Math.round(r.buffer.duration * mp3Kbps(r, mono) * 1000 / 8);
  }
  if (r.mp3) {
    const ch = isMonoBuffer(r.buffer) ? 1 : 2;
    return Math.round(r.buffer.duration * (r.mp3.sampleRate || 44100) * ch * 2 * 1.15);
  }
  return r.bytes.byteLength * 1.15;
}

/** Qué se hará con la pista al subirla (texto corto para la lista). */
export function planLabel(r) {
  if (isLongTrack(r)) {
    if (keepMp3(r)) return `MP3 tal cual (${r.mp3.kbps} kbps)`;
    const mono = ALWAYS_MONO.has(r.instrument) || isMonoBuffer(r.buffer);
    return `→ MP3 ${mp3Kbps(r, mono)} kbps${mono ? ' mono' : ''}`;
  }
  return /\.flac$/i.test(r.file.name) ? 'FLAC tal cual' : '→ WAV 16 bits (loop)';
}

/**
 * Prepara una fila de la subida.
 * @returns {Promise<{ audio:{name,bytes,ct}, preview:{name,bytes,ct}|null, before:number, after:number, format:string }>}
 */
export async function prepareTrack(r, baseName) {
  const before = r.bytes.byteLength;
  const mono = ALWAYS_MONO.has(r.instrument) || isMonoBuffer(r.buffer);
  const channels = mono ? 1 : Math.min(2, r.buffer.numberOfChannels);
  if (isLongTrack(r)) {
    // MP3 que ya pesa poco: se sube el archivo original, sin tocarlo.
    if (keepMp3(r)) {
      return { audio: { name: `${baseName}.mp3`, bytes: r.bytes, ct: 'audio/mpeg' }, preview: null, before, after: before,
        format: `MP3 original ${r.mp3.kbps} kbps` };
    }
    const kbps = mp3Kbps(r, mono);
    const d = await encoderDelay(channels, r.buffer.sampleRate, kbps);
    const [left, right] = slicePcm(r.buffer, d, channels);
    const bytes = await encodeMp3Async(left, right, r.buffer.sampleRate, kbps);
    // Si recomprimir un MP3 no ahorra, se queda el original.
    if (r.mp3 && !r.mp3Fixed && bytes.byteLength >= before * 0.9) {
      return { audio: { name: `${baseName}.mp3`, bytes: r.bytes, ct: 'audio/mpeg' }, preview: null, before, after: before,
        format: `MP3 original ${r.mp3.kbps} kbps` };
    }
    return { audio: { name: `${baseName}.mp3`, bytes, ct: 'audio/mpeg' }, preview: null, before, after: bytes.byteLength,
      format: `MP3 ${kbps} kbps${channels === 1 ? ' mono' : ''}` };
  }
  // Loop corto.
  let audio;
  if (/\.flac$/i.test(r.file.name)) audio = { name: `${baseName}.flac`, bytes: r.bytes, ct: 'audio/flac' };
  else {
    const sr = (r.mp3 && r.mp3.sampleRate) || wavSampleRate(r.bytes) || 44100;
    const wav = audioBufferToWav(await render(r.buffer, sr, channels));
    // Un MP3 se convierte a WAV siempre (el MP3 dejaría un hueco al repetirse).
    audio = { name: `${baseName}.wav`, bytes: (wav.byteLength < before || isMp3Name(r.file.name)) ? wav : r.bytes, ct: 'audio/wav' };
  }
  const prev = audioBufferToWav(await render(r.buffer, 24000, 1));
  return { audio, preview: { name: `preview/${baseName}.wav`, bytes: prev, ct: 'audio/wav' }, before,
    after: audio.bytes.byteLength + prev.byteLength, format: channels === 1 ? 'WAV mono' : 'WAV' };
}
