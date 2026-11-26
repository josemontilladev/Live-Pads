// ─────────────────────────────────────────────────────────────────────────
// Caja de ritmos desde una grabación de batería — lógica pura (probada en
// tests/drumTranscribe.test.mjs). La parte de audio (bandas, pulsos) está en
// live/drumFromRecording.js.
//
//  1. transcribe(features, grid) → compases con lo que suena en cada paso:
//       · bombo  = subida en GRAVES (<120 Hz)
//       · caja   = subida en MEDIOS (200-1500 Hz) y en el «ruido» de la bordonera (2-6 kHz)
//       · hi-hat = subida en AGUDOS (>8 kHz)
//       · crash  = agudos que siguen sonando (>0,5 s) al empezar un compás
//     Fuerza de cada golpe: X acento · x normal · o suave (como la caja de ritmos).
//  2. segment(bars) → secciones: compases parecidos juntos; un redoble (mucha caja al
//     final del compás) o un crash marcan los cambios. Cada tipo → Intro / Verso / Coro /
//     Puente / Final (se pueden cambiar a mano).
//  3. buildGroove(bars, sections) → el ritmo (cada sección = su compás más repetido;
//     el redoble = el más típico) y el ARREGLO: el orden y los compases de la grabación.
// ─────────────────────────────────────────────────────────────────────────

export const HOP = 0.01;   // s por bloque de las envolventes
export const DRUM_VOICES = ['kick', 'snare', 'hhc', 'crash'];

/** Fuerza de ataque por bloque: cuánto sube (dB) sobre lo que sonaba justo antes. */
export function onsetStrength(envDb) {
  const n = envDb.length, out = new Float32Array(n);
  for (let f = 3; f < n; f++) {
    const before = Math.max(envDb[f - 3], envDb[f - 2]);
    const rise = Math.max(envDb[f], envDb[f + 1] ?? envDb[f]) - before;
    out[f] = rise > 0 ? rise : 0;
  }
  return out;
}

/**
 * Pasos de la rejilla: cada pulso se divide en spb partes. grid = { beats, beatsPerBar, downbeats? }
 * → [{ t, bar, step, dur }] (solo compases enteros desde el primer tiempo fuerte).
 */
export function gridSteps({ beats, beatsPerBar = 4, downbeats = null }, spb = 4, shift = 0) {
  const bs = (beats || []).filter(Number.isFinite);
  if (bs.length < beatsPerBar + 1) return [];
  // Primer tiempo fuerte: el primer «downbeat» que coincide con un pulso.
  let first = 0;
  if (downbeats && downbeats.length) {
    const d0 = downbeats[0];
    let best = Infinity;
    bs.forEach((b, i) => { if (Math.abs(b - d0) < best) { best = Math.abs(b - d0); first = i; } });
  }
  first += shift;
  const out = [];
  for (let i = first, bar = 0; i + beatsPerBar < bs.length; i += beatsPerBar, bar++) {
    for (let b = 0; b < beatsPerBar; b++) {
      const t0 = bs[i + b], t1 = bs[i + b + 1], dur = (t1 - t0) / spb;
      for (let s = 0; s < spb; s++) out.push({ t: t0 + s * dur, bar, step: b * spb + s, dur });
    }
  }
  return out;
}

/** ¿Tresillos (shuffle, 6/8) o semicorcheas? Compara la energía de ataque en 1/3 y en 1/4 de pulso. */
export function detectSpb(odf, beats) {
  let tri = 0, quad = 0;
  const at = (t) => { const f = Math.round(t / HOP); let m = 0; for (let k = f - 2; k <= f + 2; k++) if (odf[k] > m) m = odf[k]; return m; };
  for (let i = 0; i + 1 < beats.length; i++) {
    const d = beats[i + 1] - beats[i];
    tri += at(beats[i] + d / 3) + at(beats[i] + (2 * d) / 3);
    quad += at(beats[i] + d / 4) + at(beats[i] + (3 * d) / 4);
  }
  return tri > quad * 1.25 ? 3 : 4;
}

const pct = (arr, q) => { const a = Array.from(arr).filter((x) => x > 0).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 1; };
const velChar = (v) => (v >= 0.82 ? 'X' : v >= 0.5 ? 'x' : v > 0 ? 'o' : '-');

/**
 * features = { low, mid, noise, high } envolventes en dB por bloque de HOP s.
 * grid = { beats, beatsPerBar, downbeats } · spb (4 semicorcheas / 3 tresillos).
 * → { spb, steps: n, bars: [{ t0, t1, hits: { kick: [v…], snare, hhc, crash } }] } (v 0..1)
 */
export function transcribe(features, grid, { spb = null } = {}) {
  const odf = { low: onsetStrength(features.low), mid: onsetStrength(features.mid), noise: onsetStrength(features.noise), high: onsetStrength(features.high) };
  const all = new Float32Array(odf.low.length);
  for (let f = 0; f < all.length; f++) all[f] = odf.low[f] + odf.mid[f] + odf.noise[f] + odf.high[f];
  const sp = spb || detectSpb(all, grid.beats || []);
  const bpb = grid.beatsPerBar || 4;
  let st = gridSteps(grid, sp);
  if (!st.length) return { spb: sp, steps: 0, bars: [] };
  const n = bpb * sp;
  // Cada banda en cada paso (±30 % del paso): ¿hay ataque (sube ≥ 6 dB)? y ¿a qué nivel llega?
  // Fuerza 0..1: nivel del golpe frente a los golpes fuertes de esa banda (percentil 90);
  // 18 dB por debajo = 0. Así no importa lo alta que esté la grabación, y la bordonera o
  // los graves que se cuelan en otro golpe (mucho más flojos) no cuentan como golpe.
  // Crash: los agudos siguen SIN BAJAR medio segundo (un hi-hat cae entre golpe y golpe).
  const isCrash = (t) => {
    const f0 = Math.round(t / HOP);
    let peak = -200; for (let f = f0 - 2; f <= f0 + 4; f++) if (features.high[f] > peak) peak = features.high[f];
    let min = Infinity; for (let f = f0 + 15; f < f0 + 50 && f < features.high.length; f++) if (features.high[f] < min) min = features.high[f];
    return min !== Infinity && min >= peak - 18;
  };
  const RISE = 6;
  const levels = (steps) => {
    const lvl = { low: [], mid: [], noise: [], high: [] };
    for (const s of steps) {
      const a = Math.max(0, Math.floor((s.t - 0.3 * s.dur) / HOP)), b = Math.ceil((s.t + 0.3 * s.dur) / HOP);
      for (const k of Object.keys(lvl)) {
        let rise = 0, peak = -200;
        for (let f = a; f <= b && f < odf[k].length; f++) { if (odf[k][f] > rise) rise = odf[k][f]; if (features[k][f] > peak) peak = features[k][f]; }
        lvl[k].push(rise >= RISE ? peak : null);
      }
    }
    // Referencia LOCAL (±2 compases): un coro con platos fuertes no deja «flojos» los
    // hi-hats del verso. Sin bajar más de 15 dB de la referencia de toda la canción (que un
    // tramo casi en silencio no convierta el ruido en golpes).
    const nm = {};
    const p90 = (arr) => { const a = arr.filter((v) => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.9)] : null; };
    const W = 2 * n;
    // En los agudos, la referencia sin los crash (un hi-hat se compara con hi-hats).
    const crashStep = steps.map((x) => x.step % (steps[0] ? 1 : 1) === 0 && isCrash(x.t));
    for (const k of Object.keys(lvl)) {
      const refArr = k === 'high' ? lvl[k].map((v, i) => (crashStep[i] ? null : v)) : lvl[k];
      const g = p90(refArr) ?? 0;
      nm[k] = lvl[k].map((v, i) => {
        if (v == null) return 0;
        const loc = p90(refArr.slice(Math.max(0, i - W), i + W + 1));
        const ref = Math.max(g - 15, loc ?? g);
        return Math.max(0, Math.min(1.2, 1 + (v - ref) / 18));
      });
    }
    return nm;
  };
  let norm = levels(st);
  // ¿Dónde empieza el compás? El detector de pulsos acierta el pulso pero a veces pone el
  // primer tiempo uno antes o después. En casi toda la música de iglesia (pop, worship,
  // rock, gospel) la caja va en 2 y 4 y el bombo en 1: se elige el desplazamiento que mejor
  // lo cumple (solo en 4/4 y si hay caja suficiente para decidirlo).
  if (bpb === 4 && !grid.fixedDownbeat) {
    const score = [0, 0, 0, 0];
    st.forEach((x, i) => {
      if (x.step % sp) return;
      const beat = x.step / sp, snare = 0.5 * norm.mid[i] + 0.5 * norm.noise[i], kick = norm.low[i];
      for (let k = 0; k < 4; k++) {
        const pos = (beat - k + 8) % 4;   // tiempo del compás si el compás empezara k pulsos más tarde
        score[k] += (pos === 1 || pos === 3 ? snare : -snare) + (pos === 0 ? 0.5 * kick : 0);
      }
    });
    let best = 0; for (let k = 1; k < 4; k++) if (score[k] > score[best] * 1.15 + 1) best = k;
    if (best) { st = gridSteps(grid, sp, best); norm = levels(st); }
  }
  const bars = [];
  st.forEach((s, i) => {
    if (!bars[s.bar]) bars[s.bar] = { t0: s.t, t1: s.t, hits: { kick: new Array(n).fill(0), snare: new Array(n).fill(0), hhc: new Array(n).fill(0), crash: new Array(n).fill(0) } };
    const bar = bars[s.bar];
    bar.t1 = s.t + s.dur;
    const L = norm.low[i], M = norm.mid[i], N = norm.noise[i], H = norm.high[i];
    // Bombo: graves claros y no es (solo) el golpe de caja.
    if (L >= 0.4 && L >= 0.6 * Math.max(M, N)) bar.hits.kick[s.step] = L;
    // Caja: medios y ruido de bordonera a la vez.
    const sn = 0.5 * M + 0.5 * N;
    const kickHere = L >= 0.5;
    if (kickHere ? (N >= 0.72 && M >= 0.6) : (M >= 0.35 && N >= 0.3 && sn >= 0.42)) bar.hits.snare[s.step] = Math.min(1, sn);
    // Hi-hat: agudos (puede sonar junto al bombo o la caja).
    if (H >= 0.4 && (H >= 0.7 * N || sn < 0.42)) bar.hits.hhc[s.step] = Math.min(1, H);
    // Crash: en la primera parte del pulso, agudos fuertes que se quedan sonando.
    if (H >= 0.5 && s.step % sp === 0 && isCrash(s.t)) { bar.hits.crash[s.step] = Math.min(1, H); bar.hits.hhc[s.step] = 0; }
  });
  return { spb: sp, steps: n, bars: bars.filter(Boolean) };
}

/** Compás → cadenas de la caja de ritmos ({ kick: 'X---x---…' }) sin las pistas vacías. */
export function barStrings(bar) {
  const o = {};
  for (const v of DRUM_VOICES) { const s = bar.hits[v].map(velChar).join(''); if (/[Xxo]/.test(s)) o[v] = s; }
  return o;
}

// Distancia entre dos compases (0 = iguales, 1 = nada en común): por instrumento, qué parte
// de sus golpes no coincide; el bombo y la caja pesan más que el hi-hat (que suele ir igual
// en toda la canción y es lo primero que cambia de verso a coro… o no).
const W8 = { kick: 0.45, snare: 0.35, hhc: 0.2 };
export function barDist(a, b) {
  let d = 0, w = 0;
  for (const v of ['kick', 'snare', 'hhc']) {
    const x = a.hits[v], y = b.hits[v];
    let diff = 0, uni = 0;
    for (let i = 0; i < x.length; i++) { const p = x[i] > 0, q = y[i] > 0; if (p || q) { uni++; if (p !== q) diff++; } }
    if (uni) { d += W8[v] * (diff / uni); w += W8[v]; }
  }
  return w ? d / w : 0;
}
const CHANGE = 0.2, SAME = 0.15;
const density = (bar) => ['kick', 'snare', 'hhc'].reduce((n, v) => n + bar.hits[v].filter((x) => x > 0).length, 0);

/** ¿Redoble? Mucha caja (o golpes) en el último pulso, más que en el resto del compás. */
export function isFill(bar, spb = 4) {
  const n = bar.hits.snare.length, lastBeat = n - spb;
  const sn = bar.hits.snare, k = bar.hits.kick;
  let endHits = 0, restHits = 0;
  for (let i = 0; i < n; i++) { const h = (sn[i] > 0 ? 1 : 0) + (k[i] > 0 && i >= lastBeat ? 0.5 : 0); if (i >= n / 2) endHits += h; else restHits += sn[i] > 0 ? 1 : 0; }
  let lastBeatSn = 0; for (let i = lastBeat; i < n; i++) if (sn[i] > 0) lastBeatSn++;
  return lastBeatSn >= Math.min(3, spb) || endHits >= restHits + 3;
}
const silent = (bar) => density(bar) <= 1;

// Huella de un compás: en cada pulso, qué parte de sus pasos tiene bombo / caja / hi-hat /
// crash (4 instrumentos × pulsos) — más robusta que paso a paso con una batería real.
function signature(bar, spb) {
  const out = [];
  for (const v of DRUM_VOICES) {
    const h = bar.hits[v], beats = h.length / spb;
    for (let q = 0; q < beats; q++) { let c = 0; for (let k = 0; k < spb; k++) if (h[q * spb + k] > 0) c++; out.push(c / spb); }
  }
  return out;
}
const sigDist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
const meanSig = (sigs) => { if (!sigs.length) return null; const m = new Array(sigs[0].length).fill(0); for (const x of sigs) x.forEach((v, i) => { m[i] += v / sigs.length; }); return m; };

/**
 * Secciones: [{ from, to (incl.), type, part, fill }] — type = grupo de tramos parecidos,
 * part = parte del ritmo (intro / A verso / B coro / C puente / end / rest = la batería calla).
 * Como un músico: se compara cada punto con los 4 compases de antes y de después (sin los
 * redobles); un tramo dura al menos 4 compases; se corta mejor donde hay redoble o crash.
 * Los silencios (la batería calla) son siempre un tramo aparte.
 */
export function segment(bars, { spb = 4, win = 4, minLen = 4, cut = 0.05, same = 0.05 } = {}) {
  const N = bars.length;
  if (!N) return [];
  const fill = bars.map((b) => isFill(b, spb));
  const crashAt = bars.map((b) => b.hits.crash[0] > 0 || b.hits.crash[1] > 0);
  const quiet = bars.map((b) => silent(b));
  const sig = bars.map((b) => signature(b, spb));
  // Fronteras forzadas: entrar o salir de un silencio.
  const forced = new Set();
  for (let i = 1; i < N; i++) if (quiet[i] !== quiet[i - 1]) forced.add(i);
  // Novedad en cada punto.
  const nov = new Array(N).fill(0);
  for (let i = 1; i < N; i++) {
    if (quiet[i] || quiet[i - 1]) continue;
    const L = [], R = [];
    for (let k = i - 1; k >= 0 && L.length < win && !quiet[k]; k--) if (!fill[k]) L.push(sig[k]);
    for (let k = i; k < N && R.length < win && !quiet[k]; k++) if (!fill[k]) R.push(sig[k]);
    if (!L.length || !R.length) continue;
    nov[i] = sigDist(meanSig(L), meanSig(R)) + (fill[i - 1] ? 0.025 : 0) + (crashAt[i] ? 0.025 : 0);
  }
  // Picos de novedad, separados al menos minLen compases (y de las fronteras forzadas).
  const cuts = [...forced];
  const cand = [];
  for (let i = 1; i < N; i++) if (nov[i] >= cut) cand.push(i);
  cand.sort((x, y) => nov[y] - nov[x]);
  for (const i of cand) if (cuts.every((c) => Math.abs(c - i) >= minLen || (forced.has(c) && Math.abs(c - i) >= 2))) cuts.push(i);
  cuts.sort((x, y) => x - y);
  const runs = [];
  let from = 0;
  for (const c of [...cuts, N]) { if (c > from) runs.push({ from, to: c - 1 }); from = c; }
  // Tipos: tramos con huella media parecida → mismo tipo.
  const protos = [];
  for (const r of runs) {
    r.rest = quiet.slice(r.from, r.to + 1).every(Boolean);
    r.fill = !r.rest && fill[r.to] && r.to > r.from;
    if (r.rest) { r.type = -1; continue; }
    const body = []; for (let i = r.from; i <= r.to; i++) if (!fill[i] || i === r.from) body.push(sig[i]);
    r.sig = meanSig(body);
    let t = protos.findIndex((p) => sigDist(p, r.sig) <= same);
    if (t < 0) { t = protos.length; protos.push(r.sig); }
    r.type = t;
  }
  // Redobles «de músico»: el compás antes de un cambio de tramo o de un crash cuya segunda
  // mitad suena distinta a la sección (toms, caja seguida…). Se suman a los de mucha caja.
  const half = (x) => { const o = []; const per = x.length / DRUM_VOICES.length; for (let v = 0; v < DRUM_VOICES.length; v++) for (let q = per / 2; q < per; q++) o.push(x[v * per + q]); return o; };
  for (const r of runs) {
    if (r.rest || !r.sig) continue;
    const ref = half(r.sig);
    for (let i = r.from + 1; i <= r.to; i++) {
      const beforeChange = i === r.to || crashAt[i + 1];
      if (!fill[i] && beforeChange && sigDist(half(sig[i]), ref) > 0.16 && density(bars[i]) > 0) fill[i] = true;
    }
    r.fill = fill[r.to] && r.to > r.from;
  }
  // Tramos seguidos del mismo tipo → uno (los redobles de dentro se quedan en el arreglo).
  for (let i = runs.length - 1; i > 0; i--) {
    const a = runs[i - 1], b = runs[i];
    if (!a.rest && !b.rest && a.type === b.type) { a.to = b.to; a.fill = b.fill; runs.splice(i, 1); }
  }
  // Partes. Intensidad de un tipo: densidad de su huella.
  // Intensidad como la siente un músico: el crash (o ride en el crash) pesa más que bombo y
  // caja, y el hi-hat menos (unas corcheas de hi-hat no hacen un coro).
  const VW = { kick: 1, snare: 1, hhc: 0.4, crash: 1.6 };
  const dens = protos.map((p) => { const per = p.length / DRUM_VOICES.length; let d = 0; DRUM_VOICES.forEach((v, k) => { for (let q = 0; q < per; q++) d += VW[v] * p[k * per + q]; }); return d; });
  const played = runs.filter((r) => !r.rest);
  const first = played[0], last = played[played.length - 1];
  const count = (t) => runs.filter((r) => r.type === t).length;
  const isIntro = played.length > 2 && first && count(first.type) === 1 && dens[first.type] < 0.85 * Math.max(...dens);
  const isEnd = played.length > 2 && last && last !== first && count(last.type) === 1 && last.to - last.from <= 3;
  const main = protos.map((_, t) => t).filter((t) => !(isIntro && t === first.type) && !(isEnd && t === last.type));
  const barsOf = (t) => runs.filter((r) => r.type === t).reduce((n, r) => n + r.to - r.from + 1, 0);
  const ranked = main.slice().sort((x, y) => barsOf(y) - barsOf(x));
  const top = ranked.slice(0, 2).sort((x, y) => dens[x] - dens[y]);
  const partOfType = {};
  if (top[0] != null) partOfType[top[0]] = 'A';
  if (top[1] != null) partOfType[top[1]] = 'B';
  if (ranked[2] != null) partOfType[ranked[2]] = 'C';
  if (ranked[3] != null) partOfType[ranked[3]] = 'D';
  if (ranked[4] != null) partOfType[ranked[4]] = 'E';
  for (const t of ranked.slice(5)) {
    let best = 'A', bd = Infinity;
    for (const [tt, part] of Object.entries(partOfType)) { const d = sigDist(protos[t], protos[tt]); if (d < bd) { bd = d; best = part; } }
    partOfType[t] = best;
  }
  const out = runs.map((r) => ({
    from: r.from, to: r.to, type: r.type, fill: r.fill,
    part: r.rest ? 'rest' : isIntro && r === first ? 'intro' : isEnd && r === last ? 'end' : partOfType[r.type] || 'A',
  }));
  // Tramos seguidos con la misma parte → uno (el coro largo con sus redobles dentro).
  for (let i = out.length - 1; i > 0; i--) if (out[i].part === out[i - 1].part && out[i].part !== 'end') { out[i - 1].to = out[i].to; out[i - 1].fill = out[i].fill; out.splice(i, 1); }
  for (const r of out) r.fills = r.part === 'rest' ? [] : fill.map((f, i) => (f && i > r.from && i <= r.to ? i : -1)).filter((i) => i >= 0);
  return out;
}

// Compás típico de un grupo: en cada paso, golpe si está en la mitad o más de los compases;
// la fuerza, la mediana de esos golpes.
function typicalBar(group, n) {
  const out = { hits: {} };
  for (const v of DRUM_VOICES) {
    out.hits[v] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const vals = group.map((b) => b.hits[v][i]).filter((x) => x > 0).sort((a, b) => a - b);
      if (vals.length * 2 >= group.length && vals.length) out.hits[v][i] = vals[Math.floor(vals.length / 2)];
    }
  }
  return out;
}

/**
 * Ritmo y arreglo desde los compases y sus secciones.
 * → { parts: { intro?, A, B?, C?, fill?, end? } (cadenas por pista), arrangement: [{ part, bars, fill }] }
 */
export function buildGroove(bars, sections, { steps: n = 16 } = {}) {
  const byPart = {};
  const fills = [];
  for (const s of sections) {
    if (s.part === 'rest') continue;
    const inner = new Set(s.fills || (s.fill ? [s.to] : []));
    for (let i = s.from; i <= s.to; i++) {
      if (inner.has(i)) { fills.push(bars[i]); continue; }
      (byPart[s.part] = byPart[s.part] || []).push(bars[i]);
    }
  }
  const parts = {};
  for (const [p, group] of Object.entries(byPart)) {
    const o = barStrings(typicalBar(group, n));
    // El crash suelto al empezar la sección lo pone el cambio de sección; si se toca «de ride»
    // (en varios pulsos de cada compás), se queda en el ritmo.
    if (o.crash && (o.crash.match(/[Xxo]/g) || []).length < 2) delete o.crash;
    if (Object.keys(o).length) parts[p] = o;
  }
  if (fills.length) { const o = barStrings(typicalBar(fills, n)); delete o.crash; if (Object.keys(o).length) parts.fill = o; }
  if (!parts.A) parts.A = parts.B || parts.C || parts.intro || { kick: 'X'.padEnd(n, '-') };
  // Arreglo: compás a compás, agrupado. Los redobles de dentro del tramo van en su sitio.
  const arrangement = [];
  const push = (part, crash) => { const l = arrangement[arrangement.length - 1]; if (l && l.part === part && !crash) l.bars++; else arrangement.push(crash ? { part, bars: 1, crash: true } : { part, bars: 1 }); };
  for (const s of sections) {
    if (s.part === 'rest') { arrangement.push({ part: 'rest', bars: s.to - s.from + 1 }); continue; }
    const inner = new Set(s.fills || (s.fill ? [s.to] : []));
    for (let i = s.from; i <= s.to; i++) {
      const crash = !!(bars[i] && bars[i].hits.crash.some((v, k) => v > 0 && k < 2)) && (i === s.from || inner.has(i - 1));
      if (inner.has(i)) { const l = arrangement[arrangement.length - 1]; if (l && l.part === (parts.fill ? 'fill' : s.part) && false) l.bars++; else arrangement.push({ part: parts.fill ? 'fill' : s.part, bars: 1 }); }
      else push(s.part, crash && (i === s.from || inner.has(i - 1)));
    }
  }
  return { parts, arrangement };
}

/** Parte que suena en el compás nº barIdx del arreglo (null = se acabó). */
export function arrangementPart(arrangement, barIdx) {
  const e = arrangementEntry(arrangement, barIdx);
  return e ? e.part : null;
}
/** { part, first (primer compás del tramo), crash (el tramo empezaba con crash) } o null. */
export function arrangementEntry(arrangement, barIdx) {
  let acc = 0;
  for (const a of arrangement || []) { if (barIdx < acc + a.bars) return { part: a.part, first: barIdx === acc, crash: !!a.crash }; acc += a.bars; }
  return null;
}
export const arrangementBars = (arrangement) => (arrangement || []).reduce((n, a) => n + a.bars, 0);
