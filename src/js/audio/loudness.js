// ─────────────────────────────────────────────────────────────────────────
// Volumen igualado entre canciones: cada pista se mide UNA vez (sonoridad
// integrada, al estilo LUFS: bloques de 400 ms, puerta absoluta −70 dB y
// relativa −10 dB) y se le aplica la ganancia que la deja en el mismo nivel
// que las demás. Así una secuencia masterizada fuerte no salta por encima de
// la anterior. La ganancia se limita (−9 … +6 dB) y el limitador de la pista
// sigue protegiendo los picos. Se puede desactivar en Ajustes → Audio.
// measure() es puro; probado en tests/loudness.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

// Nivel común por tipo = la mediana medida en una biblioteca real (60 + 60 pistas): las secuencias
// (multipistas con margen) rondan −24 dB y los originales masterizados −11 dB. Así, de media, nada cambia
// de volumen; solo se corrigen las que se salen (entre secuencias había hasta 17 dB de diferencia).
export const TARGETS = { sequence: -24, original: -11 };
export const TARGET_DB = -18;          // otros audios
const MAX_UP = 6, MAX_DOWN = -9;
const PREF = 'livepads.normalize';
const CACHE = 'livepads.loudness.v1';

/** Sonoridad integrada (dB) de canales Float32Array a `sr` Hz. -Infinity si es silencio. */
export function measure(channels, sr) {
  const n = channels[0] ? channels[0].length : 0;
  const hop = Math.max(1, Math.round(0.1 * sr));
  const step = 4;   // basta con 1 de cada 4 muestras para la energía (rápido en canciones largas)
  // Una sola pasada: energía de cada tramo de 100 ms, y cada bloque de 400 ms es la suma de
  // 4 tramos seguidos (antes se recorría cada muestra cuatro veces: ~70 ms de hilo bloqueado
  // al cargar una canción de 5 minutos).
  const hops = [];
  for (let s = 0; s + hop <= n; s += hop) {
    let e = 0, c = 0;
    for (const ch of channels) for (let i = s; i < s + hop; i += step) { e += ch[i] * ch[i]; c++; }
    hops.push([e, c]);
  }
  const levels = [];
  for (let k = 0; k + 4 <= hops.length; k++) {
    const e = hops[k][0] + hops[k + 1][0] + hops[k + 2][0] + hops[k + 3][0];
    const c = hops[k][1] + hops[k + 1][1] + hops[k + 2][1] + hops[k + 3][1];
    levels.push(e / Math.max(1, c));
  }
  if (!levels.length) return -Infinity;
  const db = (p) => 10 * Math.log10(p + 1e-12);
  const abs = levels.filter((p) => db(p) > -70);
  if (!abs.length) return -Infinity;
  const mean1 = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => db(p) > db(mean1) - 10);
  const mean2 = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  // RMS → dBFS (un seno a escala completa da −3 dB)
  return db(mean2);
}

/** Ganancia lineal para llevar `db` al nivel común de su tipo (sequence | original). */
export function gainFor(db, type = null) {
  if (!Number.isFinite(db)) return 1;
  const target = TARGETS[type] ?? TARGET_DB;
  const g = Math.max(MAX_DOWN, Math.min(MAX_UP, target - db));
  return Math.pow(10, g / 20);
}

export function normalizeOn() {
  try { return localStorage.getItem(PREF) !== '0'; } catch (_) { return true; }
}
export function setNormalize(on) {
  try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('livepads:normalize', { detail: { on: !!on } })); } catch (_) {}
}

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch (_) { return {}; } }

/** Sonoridad de un AudioBuffer (de la caché si ya se midió esta misma pista). */
export function bufferLoudness(id, buffer) {
  const c = readCache();
  if (id && Number.isFinite(c[id])) return c[id];
  const chans = [];
  for (let i = 0; i < Math.min(2, buffer.numberOfChannels); i++) chans.push(buffer.getChannelData(i));
  const db = measure(chans, buffer.sampleRate);
  if (id && Number.isFinite(db)) {
    const keys = Object.keys(c);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete c[k];
    c[id] = Math.round(db * 10) / 10;
    try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (_) {}
  }
  return db;
}

// ── Masterizado automático (audio/autoMasterCore.js) ───────────────────────
// Desactivado de serie: se enciende en Ajustes → Audio → Sonido general.
import { octaveProfile, masterGains } from './autoMasterCore.js';
const PREF_MASTER = 'livepads.autoMaster';
const CACHE_MASTER = 'livepads.master.v1';
export function autoMasterOn() { try { return localStorage.getItem(PREF_MASTER) === '1'; } catch (_) { return false; } }
export function setAutoMaster(on) {
  try { localStorage.setItem(PREF_MASTER, on ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('livepads:automaster', { detail: { on: !!on } })); } catch (_) {}
}
/** Correcciones { low, mud, high } (dB) de un AudioBuffer, de la caché si ya se midió. */
export function bufferMaster(id, buffer, musicOnRight = false) {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CACHE_MASTER) || '{}'); } catch (_) {}
  if (id && c[id]) return c[id];
  // Secuencia: el canal derecho es la música (el izquierdo lleva click y guía). Original: mezcla mono.
  let mono;
  if (musicOnRight && buffer.numberOfChannels > 1) mono = buffer.getChannelData(1);
  else {
    const a = buffer.getChannelData(0), b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
    mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = 0.5 * (a[i] + b[i]);
  }
  const g = masterGains(octaveProfile(mono, buffer.sampleRate));
  if (id) {
    const keys = Object.keys(c);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete c[k];
    c[id] = g;
    try { localStorage.setItem(CACHE_MASTER, JSON.stringify(c)); } catch (_) {}
  }
  return g;
}
