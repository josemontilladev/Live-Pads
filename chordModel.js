// ─────────────────────────────────────────────────────────────────────────
// Acordes con un modelo entrenado: BTC (Bi-directional Transformer for Chord
// recognition; Park et al., ISMIR 2019; licencia MIT), ejecutado en local con
// onnxruntime-node (GPU con DirectML si la hay, si no CPU). Proceso principal.
//
//  · logCqt(mono22050) → log|CQT| [cuadros × 144] igual que el entrenamiento:
//    librosa.cqt(sr 22050, hop 2048, 144 bandas desde C1, 24 por octava),
//    calculado en tramos de 10 s (108 cuadros por tramo), log(|C| + 1e-6).
//  · chordLogits(feat, modelPath, {mean, std}) → logits [cuadros × clases].
//
// El CQT replica librosa: cada banda es una sinusoide compleja con ventana de
// Hann de longitud Q·sr/f (Q = 1/α, α = (2^(2/24)−1)/(2^(2/24)+1)), normalizada
// en L1, y la respuesta se escala por √longitud. Para no pagar los filtros
// largos de las octavas graves a 22 050 Hz, cada octava se calcula sobre la
// señal diezmada a la mitad (como hace librosa), con el mismo resultado.
// ─────────────────────────────────────────────────────────────────────────

const SR = 22050, HOP = 2048, BINS = 144, BPO = 24, CHUNK = 220500, STEPS = 108;
const FMIN = 440 * Math.pow(2, (24 - 69) / 12);   // C1 = 32,703 Hz

const ALPHA = (Math.pow(2, 2 / BPO) - 1) / (Math.pow(2, 2 / BPO) + 1);
const Q = 1 / ALPHA;
const FREQS = Array.from({ length: BINS }, (_, k) => FMIN * Math.pow(2, k / BPO));
const LENGTHS = FREQS.map((f) => Q * SR / f);
const N_OCT = Math.ceil(BINS / BPO);

// FIR paso-bajo (mitad de banda) para diezmar por 2 entre octavas.
const HALF = (() => {
  const taps = 63, M = taps - 1, fc = 0.23, h = new Float32Array(taps);
  let s = 0;
  for (let n = 0; n < taps; n++) {
    const k = n - M / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / M) + 0.08 * Math.cos(4 * Math.PI * n / M);
    h[n] = sinc * w; s += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] /= s;
  return h;
})();
function decimate2(x) {
  const h = HALF, M = h.length - 1, half = M >> 1;
  const out = new Float32Array(Math.ceil(x.length / 2));
  for (let i = 0; i < out.length; i++) {
    const c = 2 * i;
    let acc = 0;
    for (let n = 0; n < h.length; n++) { const j = c + n - half; if (j >= 0 && j < x.length) acc += x[j] * h[n]; }
    out[i] = acc;
  }
  return out;
}

// Núcleos por banda a la frecuencia de muestreo de su octava: cos/sin con
// ventana, ya divididos por la suma de la ventana (norma L1) y multiplicados
// por √(longitud a 22 050 Hz) — la escala final de librosa.
const kernelCache = new Map();
function kernels(oct) {
  if (kernelCache.has(oct)) return kernelCache.get(oct);
  const ds = Math.pow(2, oct), sr = SR / ds;
  const out = [];
  const hi = BINS - oct * BPO, lo = Math.max(0, hi - BPO);
  for (let k = lo; k < hi; k++) {
    const f = FREQS[k], len = LENGTHS[k] / ds;
    const start = Math.floor(-len / 2), n = Math.ceil(len / 2) - start;   // como np.arange(-len//2, len//2)
    const re = new Float32Array(n), im = new Float32Array(n);
    let wsum = 0;
    for (let i = 0; i < n; i++) wsum += 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    const g = Math.sqrt(LENGTHS[k]) / wsum;
    for (let i = 0; i < n; i++) {
      const w = (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)) * g, ph = 2 * Math.PI * f * (start + i) / sr;
      re[i] = w * Math.cos(ph); im[i] = w * Math.sin(ph);
    }
    out.push({ k, start, re, im });
  }
  kernelCache.set(oct, out);
  return out;
}

/** log|CQT| de un tramo (Float32Array a 22 050 Hz) → [cuadros × 144] en `out` desde la fila `row0`. */
function chunkCqt(seg, out, row0, frames) {
  let x = seg;
  for (let oct = 0; oct < N_OCT; oct++) {
    const ds = Math.pow(2, oct), hop = HOP / ds;
    for (const { k, start, re, im } of kernels(oct)) {
      const n = re.length;
      for (let t = 0; t < frames; t++) {
        const c = t * hop + start;
        let a = 0, b = 0;
        const i0 = Math.max(0, -c), i1 = Math.min(n, x.length - c);
        for (let i = i0; i < i1; i++) { const v = x[c + i]; a += v * re[i]; b += v * im[i]; }
        out[(row0 + t) * BINS + k] = Math.log(Math.sqrt(a * a + b * b) + 1e-6);
      }
    }
    if (oct < N_OCT - 1) x = decimate2(x);
  }
}

/** log|CQT| de toda la canción (mono 22 050 Hz), por tramos de 10 s como en el entrenamiento. */
function logCqt(mono) {
  const spans = [];
  let cur = 0;
  while (mono.length > cur + CHUNK) { spans.push([cur, cur + CHUNK]); cur += CHUNK; }
  spans.push([cur, mono.length]);
  const fr = spans.map(([a, b]) => 1 + Math.floor((b - a) / HOP));
  const total = fr.reduce((s, v) => s + v, 0);
  const out = new Float32Array(total * BINS);
  let row = 0;
  spans.forEach(([a, b], i) => { chunkCqt(mono.subarray(a, b), out, row, fr[i]); row += fr[i]; });
  return { feat: out, frames: total };
}

let ort = null;
// Hilos del motor: por defecto ONNX usa TODOS los núcleos y, con acordes y pulso
// a la vez, la app entera iba lenta mientras analizaba. La mitad basta y deja
// el resto para la interfaz y el audio.
// Pulsos y acordes se analizan a la vez: entre los dos dejan siempre 2 núcleos libres para el
// audio y la interfaz (antes cada uno cogía la mitad y juntos llenaban el procesador).
// Y como mucho 4 hilos: medido, de 4 a 14 hilos solo gana ~10 % (33 s → 29 s en 5 min de audio).
const ORT_THREADS = Math.max(1, Math.min(4, Math.floor(((require('os').cpus().length || 4) - 2) / 2)));
const ortOptions = (p, threads) => ({ executionProviders: [p], intraOpNumThreads: threads || ORT_THREADS, interOpNumThreads: 1, enableCpuMemArena: false });
const sessions = new Map();
async function session(modelPath, ep, threads) {
  const key = modelPath + '|' + (ep || '') + '|' + (threads || 0);
  if (sessions.has(key)) return sessions.get(key);
  if (!ort) ort = require('onnxruntime-node');
  const order = ep === 'dml' ? ['dml', 'cpu'] : ['cpu'];   // CPU primero: más rápido y ligero que DirectML en gráficas integradas (medido)
  let last;
  for (const p of order) {
    try {
      const s = { s: await ort.InferenceSession.create(modelPath, ortOptions(p, threads)), ep: p };
      sessions.set(key, s);
      return s;
    } catch (e) { last = e; }
  }
  throw last;
}

/** Logits del modelo por cuadro: [frames × clases]. Normaliza con mean/std del entrenamiento. */
async function chordLogits(feat, frames, modelPath, { mean, std, ep, threads } = {}) {
  const { s, ep: used } = await session(modelPath, ep, threads);
  const nWin = Math.ceil(frames / STEPS);
  let classes = 0, out = null;
  const buf = new Float32Array(STEPS * BINS);
  for (let w = 0; w < nWin; w++) {
    buf.fill(0);   // el relleno del final va en cero DESPUÉS de normalizar (como el original)
    const r0 = w * STEPS, r1 = Math.min(frames, r0 + STEPS);
    for (let r = r0; r < r1; r++) for (let j = 0; j < BINS; j++) buf[(r - r0) * BINS + j] = (feat[r * BINS + j] - mean) / std;
    const res = await s.run({ features: new ort.Tensor('float32', buf, [1, STEPS, BINS]) });
    const lg = res.logits.data;
    if (!out) { classes = lg.length / STEPS; out = new Float32Array(frames * classes); }
    out.set(lg.subarray(0, (r1 - r0) * classes), r0 * classes);
  }
  return { logits: out, classes, ep: used };
}

// ── De logits a acordes ───────────────────────────────────────────────────
// Modelo de vocabulario amplio: 170 clases = 12 raíces × 14 calidades + X + N.
// Calidades del modelo → las de la app (0 '' · 1 m · 2 7 · 3 maj7 · 4 m7 · 5 sus4 · 6 sus2):
//   min maj dim aug min6 maj6 min7 minmaj7 maj7 7 dim7 hdim7 sus2 sus4
const VOCA_Q = [1, 0, 1, 0, 1, 0, 4, 1, 3, 2, 1, 4, 6, 5];
// Normalización con la que se entrenó (guardada en el checkpoint original).
const VOCA = { file: 'btc_chords_voca.onnx', mean: -2.2279878897355596, std: 1.7191329394436938 };
const FPS = STEPS / 10;
// Cambiar de acorde «cuesta» PEN (log-probabilidad): elegido midiendo 40 canciones de la
// biblioteca contra su cifrado (con 20 cambia al ritmo de la música y acierta más).
const PEN = 20;

function classToChord(c) {
  if (c >= 168) return { r: -1, q: 0, b: -1 };
  return { r: Math.floor(c / 14), q: VOCA_Q[c % 14], b: -1 };
}

// Calidades del modelo que suenan «menores» (min dim min6 min7 minmaj7 dim7 hdim7).
const MINORISH = new Set([0, 2, 4, 6, 7, 10, 11]);
// Acordes de cada tonalidad: [grado, ¿menor?]. Mayor: I ii iii IV V vi y bVII (muy
// común en alabanza). Menor: i III iv v V VI VII.
const DIA_MAJ = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true], [10, false]];
const DIA_MIN = [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]];
// Cuánto se castiga, por cuadro (log-prob), un acorde fuera de lo esperado:
// - con los acordes de la letra (vocab): casi prohibido (la letra manda).
// - con solo la tonalidad: castigo moderado (un acorde prestado claro aún sale).
const OUT_OF_VOCAB = 4;
const OUT_OF_KEY = 1.2;
/**
 * Preferencia por clase (log). opts.vocab = [{r, m}] acordes de la letra;
 * opts.key = {k, m} tonalidad. Sin nada, todo 0 (como antes).
 */
function buildPrior(classes, opts = {}) {
  const prior = new Float32Array(classes);
  const vocab = Array.isArray(opts.vocab) && opts.vocab.length ? opts.vocab : null;
  const key = opts.key && Number.isFinite(opts.key.k) ? opts.key : null;
  if (!vocab && !key) return null;
  const allowed = new Set();
  if (vocab) for (const v of vocab) allowed.add(((v.r % 12) + 12) % 12 + (v.m ? 12 : 0));
  else for (const [d, mi] of (key.m ? DIA_MIN : DIA_MAJ)) allowed.add((key.k + d) % 12 + (mi ? 12 : 0));
  const pen = vocab ? OUT_OF_VOCAB : OUT_OF_KEY;
  for (let c = 0; c < Math.min(classes, 168); c++) {
    const r = Math.floor(c / 14), minor = MINORISH.has(c % 14);
    if (!allowed.has(r + (minor ? 12 : 0))) prior[c] = -pen;
  }
  return prior;
}

/** Viterbi sobre log-softmax: quedarse no cuesta, cambiar cuesta `pen`. `prior` (opcional)
 *  suma a cada clase su preferencia (acordes de la letra o de la tonalidad). */
function smoothPath(logits, frames, classes, pen = PEN, prior = null) {
  const lp = new Float32Array(frames * classes);
  for (let f = 0; f < frames; f++) {
    const o = f * classes;
    let m = -Infinity;
    for (let c = 0; c < classes; c++) if (logits[o + c] > m) m = logits[o + c];
    let sum = 0;
    for (let c = 0; c < classes; c++) sum += Math.exp(logits[o + c] - m);
    const l = m + Math.log(sum);
    for (let c = 0; c < classes; c++) lp[o + c] = logits[o + c] - l + (prior ? prior[c] : 0);
  }
  const path = new Int32Array(frames);
  if (!frames) return path;
  let dp = lp.slice(0, classes);
  const bp = new Int32Array(frames * classes);
  for (let f = 1; f < frames; f++) {
    let bi = 0;
    for (let c = 1; c < classes; c++) if (dp[c] > dp[bi]) bi = c;
    const nd = new Float32Array(classes), o = f * classes;
    for (let c = 0; c < classes; c++) {
      const stay = dp[c], change = dp[bi] - pen;
      if (stay >= change) { nd[c] = stay + lp[o + c]; bp[o + c] = c; } else { nd[c] = change + lp[o + c]; bp[o + c] = bi; }
    }
    dp = nd;
  }
  let st = 0;
  for (let c = 1; c < classes; c++) if (dp[c] > dp[st]) st = c;
  for (let f = frames - 1; f >= 0; f--) { path[f] = st; if (f > 0) st = bp[f * classes + st]; }
  return path;
}

/** Tramos [{s, e, r, q, b}] a partir del camino por cuadros. */
function pathToSegments(path, duration) {
  const seg = [];
  for (let f = 0; f < path.length; f++) {
    const ch = classToChord(path[f]);
    const t = f / FPS, e = Math.min(duration, (f + 1) / FPS);
    const last = seg[seg.length - 1];
    if (last && last.r === ch.r && last.q === ch.q) last.e = e;
    else if (t < duration) seg.push({ s: t, e, ...ch });
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return seg.map((x) => ({ ...x, s: r3(x.s), e: r3(x.e) }));
}

/** Todo junto: mono 22 050 Hz → tramos de acordes. */
async function detectChords(mono, modelPath, opts = {}) {
  const { feat, frames } = logCqt(mono);
  const { logits, classes, ep } = await chordLogits(feat, frames, modelPath, { mean: VOCA.mean, std: VOCA.std, ep: opts.ep, threads: opts.threads });
  const prior = buildPrior(classes, opts);
  const path = smoothPath(logits, frames, classes, opts.pen != null ? opts.pen : PEN, prior);
  return { seg: pathToSegments(path, mono.length / SR), ep, prior: prior ? (opts.vocab && opts.vocab.length ? 'letra' : 'tono') : '' };
}

module.exports = { logCqt, chordLogits, detectChords, smoothPath, buildPrior, pathToSegments, classToChord, VOCA, SR, HOP, STEPS, BINS, FPS };
