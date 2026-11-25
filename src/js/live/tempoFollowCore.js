// ─────────────────────────────────────────────────────────────────────────
// Lógica pura del «Click que sigue al baterista» (live/tempoFollow.js).
// Sin navegador: se prueba en Node (tests/tempoFollow.test.mjs).
//
//  · OnsetPicker: decide qué tramos de energía son golpes (umbral adaptativo).
//  · estimateTempo(onsets, base): el tempo que toca la banda, buscado solo
//    cerca del BPM de la canción (±12 %), así nunca salta al doble o a la mitad.
//  · phaseError(t, next, interval): cuánto va el golpe por delante/detrás del click.
//  · smoothBpm(prev, est): cambia el tempo poco a poco (nada de saltos).
// ─────────────────────────────────────────────────────────────────────────

/** Golpes a partir de la «novedad» de energía de cada trocito de audio. */
export class OnsetPicker {
  constructor({ windowS = 1.5, minGapS = 0.09, k = 2.2, floor = 0.02 } = {}) {
    this.windowS = windowS; this.minGapS = minGapS; this.k = k; this.floor = floor;
    this.hist = []; this.last = -Infinity;
  }
  /** t = instante (s) del trocito; f = novedad (≥ 0). Devuelve true si es un golpe. */
  push(t, f) {
    const h = this.hist;
    h.push({ t, f });
    while (h.length && h[0].t < t - this.windowS) h.shift();
    if (h.length < 20) return false;
    const vals = h.map((x) => x.f).sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    const mad = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[vals.length >> 1];
    const thr = Math.max(this.floor, med + this.k * Math.max(mad, 1e-4) * 1.4826);
    if (f > thr && t - this.last >= this.minGapS) { this.last = t; return true; }
    return false;
  }
}

/**
 * Tempo de los golpes recientes, buscado en [base·(1−range), base·(1+range)].
 * Cada par de golpes vota por los tempos en los que su distancia cae en la
 * rejilla de corcheas. Devuelve { bpm, confidence } o null si hay pocos golpes
 * o no hay un tempo claro.
 */
export function estimateTempo(onsets, baseBpm, { range = 0.12, windowS = 8, now = null, minOnsets = 6 } = {}) {
  if (!baseBpm || !onsets || !onsets.length) return null;
  const end = now != null ? now : onsets[onsets.length - 1];
  const on = onsets.filter((t) => t >= end - windowS && t <= end);
  if (on.length < minOnsets) return null;
  const lo = baseBpm * (1 - range), hi = baseBpm * (1 + range);
  const sigma = 0.06; // tolerancia, en fracciones de corchea
  const pairs = [];
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const dt = on[j] - on[i];
    if (dt > 2.6) break;
    pairs.push(dt);
  }
  if (pairs.length < minOnsets) return null;
  let best = null, sum = 0, n = 0;
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += 0.1) {
    const sub = 30 / bpm; // corchea
    let s = 0;
    for (const dt of pairs) {
      const x = dt / sub, fr = x - Math.round(x);
      if (Math.round(x) >= 1) s += Math.exp(-(fr * fr) / (2 * sigma * sigma));
    }
    sum += s; n++;
    if (!best || s > best.s) best = { bpm, s };
  }
  const mean = sum / n;
  const confidence = mean > 0 ? best.s / mean : 0;
  if (confidence < 1.25) return null;
  return { bpm: Math.round(best.bpm * 10) / 10, confidence: Math.round(confidence * 100) / 100 };
}

/** Golpe en t frente a una rejilla cuyo próximo click es `next`: error en s, en [−I/2, I/2). >0 = el golpe va detrás. */
export function phaseError(t, next, interval) {
  if (!(interval > 0)) return 0;
  let e = (t - next) % interval;
  if (e < 0) e += interval;
  if (e >= interval / 2) e -= interval;
  return e;
}

/** Acerca el tempo poco a poco: como mucho `maxStep` BPM por paso. */
export function smoothBpm(prev, est, maxStep = 1.5) {
  if (!prev) return est;
  const d = Math.max(-maxStep, Math.min(maxStep, est - prev));
  return Math.round((prev + d) * 10) / 10;
}

/** Corrección de fase (s) a partir de los últimos errores cercanos al click. */
export function phaseNudge(errors, interval, { gain = 0.3, max = 0.02, near = 0.2 } = {}) {
  const ok = errors.filter((e) => Math.abs(e) < interval * near);
  if (ok.length < 3) return 0;
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
  return Math.max(-max, Math.min(max, avg * gain));
}
