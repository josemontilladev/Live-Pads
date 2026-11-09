// Secciones automáticas para la onda de Pads.
//
// 1) detectSectionsInBackground(buffer, …): analiza la pista en un Worker
//    (sectionWorker.js → sectionDetector.js, el mismo motor de Stems) y devuelve
//    los cambios de sección ajustados al compás.
// 2) buildAutoMarkers(sections, lyrics, duration): convierte esa detección en
//    marcadores con nombres como los del menú «+ Sección» (Intro, Verso 1, Pre
//    Coro, Coro, Puente, Final…). Si la letra de la canción trae sus secciones
//    y el número cuadra con lo cantado, usa los nombres de la letra.
//
// Es un punto de partida: el usuario arrastra/renombra lo que no cuadre.

import { detectSectionHeader } from './lyricsFormat.js';
import { mono22050 } from '../analysis/analysisAudio.js';

const NICE = { 'INTRO': 'Intro', 'VERSO': 'Verso', 'PRE-CORO': 'Pre Coro', 'CORO': 'Coro', 'PUENTE': 'Puente',
  'INSTRUMENTAL': 'Instrumental', 'INTERLUDIO': 'Interludio', 'SOLO': 'Solo', 'FINAL': 'Final', 'TAG': 'Tag' };
const CUE_CANON = { 'intro': 'INTRO', 'verso': 'VERSO', 'pre-coro': 'PRE-CORO', 'coro': 'CORO', 'puente': 'PUENTE',
  'instrumental': 'INSTRUMENTAL', 'outro': 'FINAL' };
// Secciones sin canto: en la letra no suelen estar y en el audio no se cuentan.
const NON_VOCAL = new Set(['INTRO', 'INSTRUMENTAL', 'INTERLUDIO', 'SOLO', 'FINAL']);

/** Secciones de la letra en orden: [{ canon, num }]. */
export function lyricSections(lyrics) {
  const out = [];
  String(lyrics || '').split(/\r?\n/).forEach((line) => {
    const h = detectSectionHeader(line);
    if (h) out.push(h);
  });
  return out;
}

function nameOf(canon, num) {
  const base = NICE[canon] || canon;
  return num ? `${base} ${num}` : base;
}

/**
 * @param {{atSec:number, cueId:string}[]} sections  salida de detectSections
 * @param {string} [lyrics]
 * @param {number} [duration]
 * @returns {{label:string, t:number}[]}
 */
export function buildAutoMarkers(sections, lyrics, duration) {
  if (!Array.isArray(sections) || !sections.length) return [];
  // 1) Tipo de cada tramo y fusión de tramos seguidos del mismo tipo (el detector
  //    a veces parte un coro largo en dos mitades: es una sola sección).
  let segs = [];
  sections.slice().sort((a, b) => a.atSec - b.atSec).forEach((s) => {
    const canon = CUE_CANON[s.cueId] || 'VERSO';
    const t = Math.max(0, Math.round(s.atSec * 10) / 10);
    if (duration && t >= duration - 1) return;
    if (segs.length && segs[segs.length - 1].canon === canon) return;
    segs.push({ canon, t });
  });
  if (!segs.length) return [];

  // 2) Nombres de la letra: si sus secciones cantadas son tantas como los tramos
  //    cantados detectados, se usan tal cual y en orden (Verso 1, Coro, Verso 2…).
  const lyr = lyricSections(lyrics).filter((h) => !NON_VOCAL.has(h.canon));
  const vocal = segs.filter((s) => !NON_VOCAL.has(s.canon));
  if (lyr.length && lyr.length === vocal.length) {
    vocal.forEach((s, i) => { s.canon = lyr[i].canon; s.num = lyr[i].num; });
    return segs.map((s) => ({ label: nameOf(s.canon, s.num), t: s.t }));
  }

  // 3) Si no: versos numerados (Verso 1, Verso 2…), el resto con su nombre.
  let v = 0;
  return segs.map((s) => ({ label: s.canon === 'VERSO' ? `Verso ${++v}` : nameOf(s.canon), t: s.t }));
}

/**
 * Analiza la pista sin congelar la app.
 * @param {AudioBuffer} buffer
 * @param {{bpm?:number, beatsPerBar?:number}} [opts]
 * @returns {Promise<{atSec:number, cueId:string, label:string}[]>}
 */
export function detectSectionsInBackground(buffer, opts = {}) {
  return runWorker(buffer, opts).then((d) => (d && d.sections) || []);
}

/** Rejilla de compases de la pista: { bpm, beatsPerBar, offsetSec } (o null). */
export function barGridInBackground(buffer, opts = {}) {
  return runWorker(buffer, { ...opts, mode: 'grid' });
}

function runWorker(buffer, { bpm = 0, beatsPerBar = 4, mode = 'sections' } = {}) {
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker(new URL('../stems/sectionWorker.js', import.meta.url), { type: 'module' }); }
    catch (_) { resolve(null); return; }
    const done = (v) => { try { worker.terminate(); } catch (_) {} resolve(v); };
    const timer = setTimeout(() => done(null), 90000);
    worker.onmessage = (e) => { clearTimeout(timer); done(e.data || null); };
    worker.onerror = () => { clearTimeout(timer); done(null); };
    // Mono a 22 050 Hz: la misma versión que usan los análisis (la calcula el motor de
    // audio fuera de este hilo y se guarda). Antes se mezclaba aquí con un bucle sobre
    // millones de muestras en cada llamada: en portátiles congelaba la app medio segundo.
    // Se manda una copia (memcpy) porque la guardada la comparten otros análisis.
    mono22050(buffer).then((m) => {
      const mono = m.slice();
      worker.postMessage({ left: mono, right: null, sampleRate: 22050, bpm: Number(bpm) || 0, beatsPerBar, mode }, [mono.buffer]);
    }).catch(() => { clearTimeout(timer); done(null); });
  });
}
