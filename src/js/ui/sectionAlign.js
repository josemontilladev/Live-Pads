// ─────────────────────────────────────────────────────────────────────────
// Secciones alineadas a la canción, compás a compás.
//
// La letra trae sus secciones con sus acordes (Verso: G D Em C · Coro: C G D…).
// Aquí se recorre la canción por MEDIOS COMPASES (los compases reales del modelo
// de pulsos) y se busca el camino más probable por la letra (Viterbi):
//   · dentro de una sección se avanza por sus acordes (y se repite la progresión);
//   · al terminar se pasa a la siguiente sección de la letra, se repite una
//     anterior (un coro, el puente…) o entra un tramo instrumental que la letra
//     no escribe;
//   · las secciones empiezan siempre al principio de un compás y duran al menos
//     2 compases.
// Pistas extra (opcionales): la guía hablada de la secuencia (manda) y los cambios
// de textura del detector (ayudan un poco).
//
// alignSections(lyricSecs, det, grid, k, opts) → [{ t, label, lyricIdx }]
// Puro (sin DOM): se prueba en tests/sectionAlign.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import { NON_VOCAL } from './songStructure.js';

const mod = (a, n) => ((a % n) + n) % n;
const isMinorQ = (q) => q === 1 || q === 4;
const REPEATABLE = new Set(['CORO', 'PRE-CORO', 'PUENTE', 'TAG', 'INTERLUDIO', 'INSTRUMENTAL', 'VERSO']);

function match(d, c, k) {
  if (!d || d.r < 0 || !c) return 0;
  const r = mod(d.r + k, 12);
  if (r === c.r) return isMinorQ(d.q) === isMinorQ(c.q) ? 1 : 0.55;
  if (c.b >= 0 && r === c.b) return 0.45;
  return 0;
}

/** Secciones de la letra listas para alinear: repeticiones sin acordes heredan los de su igual; acordes repetidos seguidos, uno. */
export function sectionsWithChords(lyricSecs) {
  const out = lyricSecs.map((s) => ({ ...s, chords: (s.chords || []).slice() }));
  out.forEach((s, i) => {
    if (s.chords.length) return;
    const same = (f) => out.slice(0, i).reverse().find((o) => o.chords.length && f(o)) || out.slice(i + 1).find((o) => o.chords.length && f(o));
    const src = same((o) => o.canon === s.canon && (o.num || '') === (s.num || '')) || same((o) => o.canon === s.canon);
    if (src) s.chords = src.chords.slice();
  });
  for (const s of out) s.chords = s.chords.filter((c, i, a) => !i || !(c.r === a[i - 1].r && isMinorQ(c.q) === isMinorQ(a[i - 1].q)));
  return out;
}

/** Medios compases: [{ t, bar }] desde los compases reales (o una rejilla fija). */
export function halfBarFrames(grid, duration) {
  const out = [];
  const downs = grid && grid.downbeats && grid.downbeats.length > 2 ? grid.downbeats : null;
  if (downs) {
    if (downs[0] > 0.3) out.push({ t: 0, bar: true });
    for (let i = 0; i < downs.length; i++) {
      const a = downs[i], b = i + 1 < downs.length ? downs[i + 1] : Math.min(duration, a + (downs[i] - downs[i - 1 >= 0 ? i - 1 : 0] || 2));
      out.push({ t: a, bar: true });
      if (b - a > 0.6) out.push({ t: (a + b) / 2, bar: false });
    }
    return out.filter((f) => f.t < duration);
  }
  const bar = (grid && grid.barSec) || 2, off = (grid && grid.off) || 0;
  for (let t = off, i = 0; t < duration; t += bar / 2, i++) out.push({ t, bar: i % 2 === 0 });
  if (!out.length || out[0].t > 0.3) out.unshift({ t: 0, bar: true });
  return out;
}

/**
 * @param lyricSecs  parseLyricStructure()
 * @param det        acordes detectados [{s,e,r,q,b}]
 * @param grid       { downbeats?, barSec?, off? }
 * @param k          semitonos: acorde_letra = acorde_audio + k
 * @param opts       { duration, guide: [t], novelty: [t] }
 */
export function alignSections(lyricSecs, det, grid, k, opts = {}) {
  const duration = opts.duration || (det.length ? det[det.length - 1].e : 0);
  const secs = sectionsWithChords(lyricSecs);
  const m = secs.length;
  if (!m || !duration) return [];
  const frames = halfBarFrames(grid, duration);
  const F = frames.length;
  if (F < 4) return [];
  const barSec = (grid && grid.barSec) || (frames.length > 2 ? (frames[frames.length - 1].t - frames[0].t) / (F / 2) : 2);

  // Acorde que más suena en cada medio compás.
  const chords = (det || []).filter((d) => d.r >= 0);
  const obs = new Array(F).fill(null);
  let ci = 0;
  for (let f = 0; f < F; f++) {
    const a = frames[f].t, b = f + 1 < F ? frames[f + 1].t : duration;
    while (ci < chords.length && chords[ci].e <= a) ci++;
    let best = null, bestO = 0;
    for (let j = ci; j < chords.length && chords[j].s < b; j++) {
      const o = Math.min(b, chords[j].e) - Math.max(a, chords[j].s);
      if (o > bestO) { bestO = o; best = chords[j]; }
    }
    obs[f] = best && bestO > (b - a) * 0.3 ? best : null;
  }

  // Pistas de cambio de sección por medio compás.
  const near = (arr, t, tol) => (arr || []).some((x) => Math.abs(x - t) <= tol);
  const guide = opts.guide && opts.guide.length ? opts.guide : null;
  const ev = frames.map((fr) => {
    if (!fr.bar) return -4;                                      // las secciones empiezan en compás
    let e = 0;
    if (guide) e += near(guide, fr.t, barSec * 0.3) ? 3 : -0.7;  // la guía manda (pero a veces no avisa)
    if (near(opts.novelty, fr.t, barSec * 0.9)) e += 0.6;
    return e;
  });

  // Estados: por sección j, sus acordes q (o uno libre si no tiene) × permanencia d (0..D-1, en medios compases);
  // más un estado instrumental «después de j» (j = -1: antes de empezar).
  const D = 4; // 2 compases
  const len = secs.map((s) => Math.max(1, s.chords.length));
  const base = []; let n = 0;
  for (let j = 0; j < m; j++) { base.push(n); n += len[j] * D; }
  const instBase = n; n += (m + 1) * D;                          // inst(j) para j=-1..m-1
  const inst = (j, d) => instBase + (j + 1) * D + d;
  const sid = (j, q, d) => base[j] + q * D + d;

  const emitSec = (f, j, q) => {
    const o = obs[f];
    const s = secs[j];
    if (!s.chords.length) return NON_VOCAL.has(s.canon) ? 0.15 : 0;
    if (!o) return 0;
    return 1.4 * match(o, s.chords[q], k) - 0.5;
  };
  const emitInst = () => 0.05;

  const secTrans = (from, to) => {                              // from: índice de sección (-1 = inicio)
    if (to === from + 1) return -0.9;
    if (to <= from) return (REPEATABLE.has(secs[to].canon) ? -1.7 : -2.6) - (to === from ? 0.3 : 0);
    return -1.4 - 0.7 * (to - from - 1);
  };

  const NEG = -1e9;
  let score = new Float64Array(n).fill(NEG);
  for (let j = 0; j < m; j++) score[sid(j, 0, 0)] = (j === 0 ? 0 : -1.5 - 0.5 * j) + emitSec(0, j, 0);
  score[inst(-1, 0)] = 0.2 + emitInst();
  const back = [];

  for (let f = 1; f < F; f++) {
    const nx = new Float64Array(n).fill(NEG), bp = new Int32Array(n).fill(-1);
    // Mejor salida de cada sección (y de cada instrumental) para entrar en otra.
    const exitBest = new Float64Array(m + 1).fill(NEG), exitArg = new Int32Array(m + 1).fill(-1);   // índice j+1
    for (let j = 0; j < m; j++) {
      const L = len[j];
      for (let q = 0; q < L; q++) for (let d = 0; d < D; d++) {
        const s = score[sid(j, q, d)];
        if (s <= NEG) continue;
        const pen = (d < D - 1 ? -1.4 : 0) + (secs[j].chords.length > 1 && q < L - 1 ? -0.5 : 0);
        if (s + pen > exitBest[j + 1]) { exitBest[j + 1] = s + pen; exitArg[j + 1] = sid(j, q, d); }
      }
    }
    const instExit = new Float64Array(m + 1).fill(NEG), instArg = new Int32Array(m + 1).fill(-1);
    for (let j = -1; j < m; j++) for (let d = 0; d < D; d++) {
      const s = score[inst(j, d)] + (d < D - 1 ? -1.0 : 0);
      if (s > instExit[j + 1]) { instExit[j + 1] = s; instArg[j + 1] = inst(j, d); }
    }
    // Dentro de cada sección: quedarse, avanzar de acorde o volver a empezar la progresión.
    for (let j = 0; j < m; j++) {
      const L = len[j];
      for (let q = 0; q < L; q++) for (let d = 1; d < D; d++) {
        const prevD = [d - 1]; if (d === D - 1) prevD.push(D - 1);
        let best = NEG, arg = -1;
        for (const pd of prevD) {
          const cands = [[q, 0], [q - 1, -0.3]];
          if (q === 0 && L > 1) cands.push([L - 1, -0.35]);
          for (const [pq, tr] of cands) {
            if (pq < 0) continue;
            const v = score[sid(j, pq, pd)] + tr;
            if (v > best) { best = v; arg = sid(j, pq, pd); }
          }
        }
        if (arg >= 0) { nx[sid(j, q, d)] = best + emitSec(f, j, q); bp[sid(j, q, d)] = arg; }
      }
      // Entrar en la sección j (acorde 0, permanencia 0).
      let best = NEG, arg = -1;
      for (let from = -1; from < m; from++) {
        const tr = from >= 0 ? secTrans(from, j) : (j === 0 ? -0.3 : -1.5 - 0.5 * j);
        if (from >= 0 && exitBest[from + 1] + tr > best) { best = exitBest[from + 1] + tr; arg = exitArg[from + 1]; }
        if (instExit[from + 1] + tr + 0.3 > best) { best = instExit[from + 1] + tr + 0.3; arg = instArg[from + 1]; }
      }
      // Un «Final» de la letra solo puede empezar en el último tramo de la canción.
      const late = secs[j].canon === 'FINAL' && frames[f].t < duration * 0.75 ? -6 : 0;
      if (arg >= 0) { nx[sid(j, 0, 0)] = best + ev[f] + late + emitSec(f, j, 0); bp[sid(j, 0, 0)] = arg; }
    }
    // Instrumentales: seguir, o entrar tras la sección j.
    for (let j = -1; j < m; j++) {
      for (let d = 1; d < D; d++) {
        let best = score[inst(j, d - 1)], arg = inst(j, d - 1);
        if (d === D - 1 && score[inst(j, D - 1)] > best) { best = score[inst(j, D - 1)]; arg = inst(j, D - 1); }
        if (best > NEG) { nx[inst(j, d)] = best + emitInst(); bp[inst(j, d)] = arg; }
      }
      if (j >= 0 && exitBest[j + 1] > NEG) { nx[inst(j, 0)] = exitBest[j + 1] - 1.6 + ev[f] + emitInst(); bp[inst(j, 0)] = exitArg[j + 1]; }
    }
    score = nx; back.push(bp);
  }

  // Camino.
  let cur = 0;
  for (let s = 1; s < n; s++) if (score[s] > score[cur]) cur = s;
  const path = new Int32Array(F);
  path[F - 1] = cur;
  for (let f = F - 1; f > 0; f--) { cur = back[f - 1][cur]; path[f - 1] = cur; }
  const where = (s) => {
    if (s >= instBase) { const j = Math.floor((s - instBase) / D) - 1; return { inst: true, j, d: (s - instBase) % D }; }
    let j = m - 1; while (j > 0 && base[j] > s) j--;
    return { inst: false, j, d: (s - base[j]) % D };
  };
  const out = [];
  for (let f = 0; f < F; f++) {
    const w = where(path[f]);
    const isStart = f === 0 || w.d === 0;
    if (!isStart) continue;
    let label, lyricIdx = -1;
    if (w.inst) label = f === 0 ? 'Intro' : 'Instrumental';
    else {
      label = secs[w.j].label; lyricIdx = w.j;
      if (secs[w.j].canon === 'INTRO' && out.length) label = 'Interludio';
    }
    const prev = out[out.length - 1];
    // Con guía, un coro que se repite seguido son dos secciones (la guía avisa las dos).
    if (prev && prev.label === label && prev.lyricIdx === lyricIdx && !(guide && near(guide, frames[f].t, barSec * 0.3))) continue;
    out.push({ t: +frames[f].t.toFixed(3), label, lyricIdx });
  }
  // Un instrumental al final es el final.
  const last = out[out.length - 1];
  if (last && last.label === 'Instrumental' && duration - last.t < barSec * 12) last.label = 'Final';
  return out;
}
