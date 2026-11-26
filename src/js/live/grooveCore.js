// ─────────────────────────────────────────────────────────────────────────
// Lógica pura de la «Caja de ritmos» (live/groovePlayer.js, live/grooveUI.js).
// Sin navegador: se prueba en Node (tests/groove.test.mjs).
//
// Un ritmo tiene PISTAS (cada una con su sonido del drum pad, volumen y
// silencio) y SECCIONES (intro, verso, coro, puente, redoble, final) con los
// pasos de cada pista:  X = acento · x = golpe · o = suave · - = nada.
// ─────────────────────────────────────────────────────────────────────────

import { GROOVES } from '../data/grooves.js';

// D (Pre-coro) y E (Interludio): solo en ritmos que las usan (p. ej. sacados de una grabación).
// «rest» (Silencio): la batería calla ese compás (solo en el arreglo de una grabación).
export const PARTS = ['intro', 'A', 'D', 'B', 'C', 'E', 'fill', 'end'];
export const EXTRA_PARTS = ['D', 'E'];
export const PART_LABEL = { intro: 'Intro', A: 'Verso', D: 'Pre-coro', B: 'Coro', C: 'Puente', E: 'Interludio', fill: 'Redoble', end: 'Final', rest: 'Silencio' };
export const LOOP_PARTS = ['intro', 'A', 'D', 'B', 'C', 'E']; // se repiten hasta que pidas otra

// Instrumentos (todos reales). El orden es el de las pistas en pantalla.
export const VOICES = [
  { id: 'kick', label: 'Bombo' }, { id: 'snare', label: 'Caja' }, { id: 'clap', label: 'Palmas' },
  { id: 'hhc', label: 'Hi-hat' }, { id: 'hho', label: 'Hi-hat abierto' }, { id: 'ride', label: 'Ride' },
  { id: 'crash', label: 'Crash' }, { id: 'tomH', label: 'Tom agudo' }, { id: 'tomL', label: 'Tom grave' },
  { id: 'shaker', label: 'Shaker' }, { id: 'tamb', label: 'Pandereta' },
];
export const VOICE_IDS = VOICES.map((v) => v.id);
export const voiceLabel = (v) => (VOICES.find((x) => x.id === v) || {}).label || v;

// Colores de pista (como en un secuenciador): se reparten en orden.
export const TRACK_COLORS = ['#a855f7', '#22d3ee', '#f43f5e', '#c6f432', '#f472b6', '#fb923c', '#60a5fa', '#fbbf24', '#2dd4bf', '#e879f9', '#94a3b8', '#4ade80'];

// Kits: SOLO muestras de los kits del drum pad (data/banks.js · KIT_BANKS).
const S = 'assets/Drums Pad/99 Drum Samples/Samples/';
const SHARED = {
  hhc: S + 'hihat-acoustic01.wav', hho: S + 'openhat-acoustic01.wav', tomH: S + 'tom-acoustic01.wav', tomL: S + 'tom-acoustic02.wav',
  shaker: S + 'shaker-shuffle.wav', tamb: S + 'perc-tambo.wav',
};
export const GROOVE_KITS = [
  { id: 'acoustic', name: 'Acústico', files: { ...SHARED,
    kick: S + 'kick-acoustic01.wav', snare: S + 'snare-acoustic01.wav', clap: S + 'clap-fat.wav', ride: S + 'ride-acoustic01.wav', crash: S + 'crash-acoustic.wav' } },
  { id: 'gospel', name: 'Gospel en vivo', files: { ...SHARED,
    kick: S + 'kick-deep.wav', snare: S + 'snare-brute.wav', clap: S + 'clap-slapper.wav', ride: S + 'ride-acoustic02.wav', crash: S + 'crash-tape.wav' } },
  { id: 'modern', name: 'Worship moderno', files: { ...SHARED,
    kick: S + 'kick-big.wav', snare: S + 'snare-big.wav', clap: S + 'clap-808.wav', hhc: S + 'hihat-808.wav', hho: S + 'openhat-808.wav', ride: S + 'ride-acoustic01.wav', crash: S + 'crash-808.wav' } },
];
// Nivel de partida de cada instrumento (los platos, más bajos).
const VOICE_VOL = { kick: 1, snare: 0.85, clap: 0.6, hhc: 0.5, hho: 0.45, ride: 0.45, crash: 0.5, tomH: 0.8, tomL: 0.85, shaker: 0.5, tamb: 0.5 };

const VEL = { X: 1, x: 0.75, o: 0.4 };
export const steps = (g) => g.beats * g.spb;
export const cellVel = (c) => VEL[c] || 0;
/** Ciclo de una casilla al hacer clic: nada → golpe → acento → suave → nada. */
export function nextCell(c) { return { '-': 'x', x: 'X', X: 'o', o: '-' }[c] || 'x'; }

const kitById = (id) => GROOVE_KITS.find((k) => k.id === id) || GROOVE_KITS[0];
const resolveKit = (k) => (k && typeof k === 'object' ? k : kitById(k));

// Kits propios del drum pad → kit de la caja, reconociendo cada pad por su nombre.
const PAD_NAME_VOICE = [
  [/(hi-?hat|hh)\s*(open|abie|abierto)|open\s*hat|openhat/i, 'hho'],
  [/hi-?hat|\bhh\b|hihat|charles/i, 'hhc'],
  [/sub\s*kick/i, null], [/kick|bombo|bass\s*drum/i, 'kick'],
  [/snare|caja|redoblante|tarola/i, 'snare'], [/clap|palma/i, 'clap'],
  [/crash/i, 'crash'], [/ride/i, 'ride'], [/shaker|g[uü]ira|maraca/i, 'shaker'], [/tamb|pandero/i, 'tamb'],
  [/\b(floor|base|grave|low)\b|tom\s*3|tom\s*l/i, 'tomL'], [/tom/i, 'tomH'],
];
export function voiceForPadName(name) {
  for (const [re, v] of PAD_NAME_VOICE) if (re.test(name || '')) return v;
  return null;
}
/** Un kit del drum pad como kit de la caja (null si no tiene al menos bombo, caja y hi-hat). Lo que falte, del acústico. */
export function kitFromPads(bank) {
  const files = {};
  for (const p of bank.pads || []) {
    if (!p.sample || /fx|efx|swell|noise|boom/i.test(p.label || '')) continue;
    const v = voiceForPadName(p.label);
    if (v && !files[v]) files[v] = p.sample;
  }
  if (!files.kick || !files.snare || !files.hhc) return null;
  return { id: 'pad:' + bank.id, name: bank.name + ' (tu kit)', own: true, files: { ...GROOVE_KITS[0].files, ...files } };
}

/** Pistas de un ritmo (los incluidos se escriben por instrumento: aquí se convierten en pistas). */
export function withTracks(g, kitId = null) {
  if (Array.isArray(g.tracks) && g.tracks.length) return g;
  const kit = resolveKit(kitId || g.kit);
  const used = new Set();
  for (const p of Object.values(g.parts || {})) for (const v of Object.keys(p)) used.add(v);
  const tracks = VOICE_IDS.filter((v) => used.has(v)).map((v) => ({ id: v, voice: v, label: voiceLabel(v), file: kit.files[v], vol: VOICE_VOL[v] ?? 0.8, mute: false }));
  return { ...g, kit: kit.id, tracks };
}

/** Cambia el kit: cada pista de instrumento conocido toma la muestra de ese kit. */
export function applyKit(g, kitId) {
  const kit = resolveKit(kitId);
  return { ...g, kit: kit.id, tracks: g.tracks.map((t) => (t.voice && kit.files[t.voice] ? { ...t, file: kit.files[t.voice] } : t)) };
}

/** Sección de un ritmo; si no está escrita, una razonable. */
export function partOf(g, part) {
  if (part === 'rest') return {};
  const p = g.parts && g.parts[part];
  if (p && Object.keys(p).length) return p;
  const n = steps(g), A = (g.parts && g.parts.A) || {};
  const ofVoice = (v) => (g.tracks || []).filter((t) => t.voice === v).map((t) => t.id);
  if (part === 'intro') {
    const o = {};
    for (const t of g.tracks || []) if (['hhc', 'ride', 'shaker', 'tamb'].includes(t.voice) && A[t.id]) o[t.id] = A[t.id];
    return o;
  }
  if (part === 'end') {
    const o = {};
    for (const id of [...ofVoice('kick'), ...ofVoice('crash')]) o[id] = 'X'.padEnd(n, '-');
    return o;
  }
  if (part === 'fill') {
    const sn = ofVoice('snare')[0];
    return sn ? { [sn]: '-'.repeat(n >> 1) + 'x'.repeat(n - (n >> 1)) } : A;
  }
  if (part === 'C') return (g.parts && g.parts.B && Object.keys(g.parts.B).length) ? g.parts.B : A;
  return A;
}
export const isWritten = (g, part) => !!(g.parts && g.parts[part] && Object.keys(g.parts[part]).length);

/** Golpes de un paso: [{ track, vel }] (pistas en silencio, fuera). */
export function hitsAt(g, part, i) {
  const p = partOf(g, part), n = steps(g), out = [];
  for (const t of g.tracks || []) {
    if (t.mute) continue;
    const s = p[t.id];
    if (!s) continue;
    const v = VEL[s[i % n]];
    if (v) out.push({ track: t, vel: v });
  }
  return out;
}

/** Duración de un paso (s). */
export const stepDur = (bpm, g) => 60 / Math.max(20, bpm) / g.spb;

/** Retraso del swing para el paso i (no en tresillos; pasos impares). swing 1 = tresillo. */
export function swingOffset(i, g, swing, dur) {
  if (!swing || g.spb === 3 || i % 2 === 0) return 0;
  return Math.max(0, Math.min(1, swing)) * dur / 3;
}

// Compases para ritmos propios.
export const SIGS = [
  { id: '4/4', label: '4/4', beats: 4, spb: 4 },
  { id: '4/4t', label: '4/4 shuffle', beats: 4, spb: 3 },
  { id: '3/4', label: '3/4', beats: 3, spb: 4 },
  { id: '6/8', label: '6/8', beats: 2, spb: 3 },
  { id: '2/4', label: '2/4', beats: 2, spb: 4 },
];
export const sigOf = (g) => (g.spb === 3 && g.beats === 4 ? '4/4t' : (SIGS.find((s) => s.beats === g.beats && s.spb === g.spb) || {}).id || '');

/** Cambia el compás (rellena con silencios o recorta; con otra subdivisión, conserva los pulsos). */
export function resizeGroove(g, beats, spb) {
  const n = beats * spb, oldSpb = g.spb;
  const parts = {};
  for (const [k, p] of Object.entries(g.parts || {})) {
    parts[k] = {};
    for (const [v, s] of Object.entries(p)) {
      let t = s;
      if (oldSpb !== spb) {
        const b = Math.floor(s.length / oldSpb), arr = [];
        for (let q = 0; q < b; q++) { arr.push(s[q * oldSpb] || '-'); for (let r = 1; r < spb; r++) arr.push(spb === oldSpb * 2 && r === 2 ? (s[q * oldSpb + 1] || '-') : '-'); }
        t = arr.join('');
      }
      t = t.slice(0, n).padEnd(n, '-');
      if (/[Xxo]/.test(t)) parts[k][v] = t;
    }
  }
  return { ...g, beats, spb, parts };
}

/** Ritmo nuevo: bombo, caja y hi-hat vacíos para empezar a marcar. */
export function emptyGroove(kitId = 'acoustic') {
  const kitObj = resolveKit(kitId);
  const g = withTracks({ id: 'u' + Date.now().toString(36), name: 'Mi ritmo', genre: 'Míos', beats: 4, spb: 4, swing: 0, user: true, parts: { A: { kick: 'X---------------' } } }, kitId);
  const kit = kitObj;
  for (const v of ['snare', 'hhc']) g.tracks.push({ id: v, voice: v, label: voiceLabel(v), file: kit.files[v], vol: VOICE_VOL[v], mute: false });
  return g;
}

/** Pista nueva con un sonido. */
export function addTrack(g, { file, label, voice = null }) {
  let n = 1; while (g.tracks.some((t) => t.id === 't' + n)) n++;
  const t = { id: 't' + n, voice, label: label || 'Pista', file, vol: voice ? (VOICE_VOL[voice] ?? 0.8) : 0.8, mute: false };
  return { ...g, tracks: [...g.tracks, t] };
}
export function removeTrack(g, id) {
  const parts = {};
  for (const [k, p] of Object.entries(g.parts || {})) { parts[k] = { ...p }; delete parts[k][id]; }
  return { ...g, tracks: g.tracks.filter((t) => t.id !== id), parts };
}

/** ¿Ritmo bien formado? */
export function validGroove(g) {
  if (!g || !g.parts || !(g.beats > 0) || !(g.spb > 0)) return false;
  const n = steps(g), ids = new Set((g.tracks || []).map((t) => t.id));
  const known = (k) => (g.tracks ? ids.has(k) : VOICE_IDS.includes(k));
  return Object.values(g.parts).every((p) => Object.entries(p).every(([k, s]) => known(k) && typeof s === 'string' && s.length === n && /^[Xxo-]+$/.test(s)));
}

// ── Cambios de sección (al terminar cada compás) ─────────────────────────
// st = { part, queued, afterFill, ending }
export function startState(part = 'A') { return { part, queued: null, afterFill: null, ending: part === 'end' }; }

/** Pedir una sección: entra al acabar el compás. El redoble vuelve a la que sonaba (o a la que pidas después). */
export function queuePart(st, p) {
  const s = { ...st };
  if (p === 'fill') { s.queued = 'fill'; return s; }
  if (p !== 'end' && (s.queued === 'fill' || s.part === 'fill')) { s.afterFill = p; return s; }
  s.queued = p === s.part && p !== 'end' ? null : p;
  return s;
}

/** Fin de compás: qué suena en el siguiente. → { st, stop, crash } */
export function barEnd(st) {
  if (st.ending) return { st, stop: true, crash: false };
  const s = { ...st };
  if (s.queued === 'fill') {
    s.afterFill = s.afterFill || s.part;
    s.part = 'fill'; s.queued = null;
    return { st: s, stop: false, crash: false };
  }
  if (s.queued === 'end') { s.part = 'end'; s.queued = null; s.ending = true; return { st: s, stop: false, crash: false }; }
  if (s.part === 'fill') {
    s.part = s.queued || s.afterFill || 'A'; s.queued = null; s.afterFill = null;
    return { st: s, stop: false, crash: true };
  }
  if (s.queued) {
    const crash = s.queued === 'B' || s.queued === 'C' || (s.part === 'intro' && s.queued !== 'intro');
    s.part = s.queued; s.queued = null;
    return { st: s, stop: false, crash };
  }
  return { st: s, stop: false, crash: false };
}

export { GROOVES };
