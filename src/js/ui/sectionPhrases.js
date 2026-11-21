// ─────────────────────────────────────────────────────────────────────────
// Secciones con forma musical:
//  - regularizePhrases: cada límite cae en un compás real y, si mover un límite
//    un compás hace que la sección dure un múltiplo de 4 (o de 2) compases, se
//    mueve: en alabanza casi todo va en frases de 4/8/16 compases, y el detector
//    de novedad suele quedarse un compás corto o largo.
//  - unifyRepeats: dos tramos con la misma progresión compás a compás son la
//    misma sección (el coro suena igual cada vez): reciben el mismo nombre.
// Funciones puras (sin DOM), probadas en tests/sectionPhrases.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

/** Inicios de compás (s) a partir de la rejilla: los reales si los hay. */
export function barTimes(grid, dur) {
  if (!grid) return [];
  const out = [];
  if (Array.isArray(grid.downbeats) && grid.downbeats.length >= 2) {
    out.push(...grid.downbeats);
    const bar = grid.barSec || (grid.downbeats[grid.downbeats.length - 1] - grid.downbeats[0]) / (grid.downbeats.length - 1);
    let t = out[out.length - 1] + bar;
    while (bar > 0 && t < dur) { out.push(t); t += bar; }
    return out;
  }
  const bar = grid.barSec, off = grid.off || 0;
  if (!(bar > 0)) return [];
  for (let t = off; t < dur; t += bar) out.push(t);
  return out;
}

const nearest = (bars, t) => {
  let lo = 0, hi = bars.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bars[mid] <= t) lo = mid; else hi = mid; }
  return Math.abs(bars[lo] - t) <= Math.abs(bars[hi] - t) ? lo : hi;
};
// Qué tan «musical» es una longitud en compases.
const phraseScore = (n) => (n <= 0 ? -9 : n % 8 === 0 ? 3 : n % 4 === 0 ? 2 : n % 2 === 0 ? 1 : 0);

/**
 * @param {{label:string,t:number}[]} markers  ordenados por tiempo
 * @param grid  { downbeats?, barSec, off }
 * @param {number} dur
 */
export function regularizePhrases(markers, grid, dur) {
  const bars = barTimes(grid, dur);
  if (!Array.isArray(markers) || markers.length < 2 || bars.length < 4) return markers;
  const out = markers.map((m) => ({ ...m }));
  // El primero (normalmente el inicio de la canción) no se toca.
  const pos = out.map((m, i) => (i === 0 ? null : nearest(bars, m.t)));
  for (let i = 1; i < out.length; i++) {
    const prev = i === 1 ? (out[0].t <= bars[0] + 0.5 ? 0 : nearest(bars, out[0].t)) : pos[i - 1];
    const next = i + 1 < out.length ? pos[i + 1] : null;
    let best = pos[i], bestGain = 0;
    const base = phraseScore(pos[i] - prev) + (next != null ? phraseScore(next - pos[i]) : 0);
    for (const d of [-1, 1]) {
      const p = pos[i] + d;
      if (p - prev < 2 || (next != null && next - p < 2) || p < 0 || p >= bars.length) continue;
      const gain = phraseScore(p - prev) + (next != null ? phraseScore(next - p) : 0) - base;
      // Solo si mejora claramente (p. ej. de 7 a 8 compases), no por empate.
      if (gain >= 2 && gain > bestGain) { best = p; bestGain = gain; }
    }
    pos[i] = best;
    out[i].t = Math.round(bars[best] * 1000) / 1000;
  }
  // Sin duplicados (dos límites en el mismo compás).
  return out.filter((m, i) => i === 0 || m.t > out[i - 1].t + 0.01);
}

const chordAt = (det, t) => {
  for (const x of det) if (x.s <= t && t < x.e) return x.r < 0 ? 'N' : x.r + ((x.q === 1 || x.q === 4) ? 'm' : '');
  return 'N';
};
const baseOf = (label) => String(label || '').replace(/\s*\d+$/, '').trim();

/**
 * Tramos con la misma progresión (compás a compás, ≥ 75 % y ≥ 4 compases) → mismo nombre.
 * @param {{label:string,t:number}[]} markers
 * @param {{s,e,r,q}[]} det  acordes detectados
 */
export function unifyRepeats(markers, det, grid, dur) {
  const bars = barTimes(grid, dur);
  if (!Array.isArray(markers) || markers.length < 3 || !Array.isArray(det) || !det.length || bars.length < 8) return markers;
  const barSec = grid.barSec || (bars[1] - bars[0]);
  const seqs = markers.map((m, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].t : dur;
    return bars.filter((b) => b >= m.t - 0.05 && b < end - 0.05).map((b) => chordAt(det, b + barSec / 2));
  });
  const out = markers.map((m) => ({ ...m }));
  for (let j = 1; j < out.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = seqs[i], b = seqs[j], n = Math.min(a.length, b.length);
      if (n < 4 || Math.max(a.length, b.length) > n * 1.6) continue;
      let same = 0;
      for (let k = 0; k < n; k++) if (a[k] === b[k] && a[k] !== 'N') same++;
      if (same / n >= 0.75 && baseOf(out[i].label) !== baseOf(out[j].label)) { out[j].label = baseOf(out[i].label); break; }
      if (same / n >= 0.75) break;
    }
  }
  // Versos numerados en orden (Verso 1, Verso 2…).
  let v = 0;
  return out.map((m) => (baseOf(m.label) === 'Verso' ? { ...m, label: `Verso ${++v}` } : m));
}
