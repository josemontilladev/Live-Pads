// ─────────────────────────────────────────────────────────────────────────
// Pulsos y compases con Beat This! (CPJKU, Universidad J. Kepler de Linz;
// código y pesos con licencia MIT), en local con onnxruntime-node (GPU con
// DirectML si hay, si no CPU). Modelo convertido a ONNX: models/beat_this_final0.onnx
//
// Réplica exacta del preprocesado oficial (beat_this/preprocessing.py):
//   mono 22 050 Hz → STFT 1024 / salto 441 (50 fotogramas/s), Hann periódica,
//   centrado con reflexión, normalizado por √1024, magnitud → 128 bandas
//   mel (Slaney, 30–11 000 Hz) → log1p(1000·x).
// Inferencia por trozos de 1500 fotogramas con 6 de borde (keep_first) y el
// post-procesado «minimal»: máximos en ±70 ms con prob. > 0,5; cada compás se
// lleva al pulso más cercano.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const SR = 22050, N_FFT = 1024, HOP = 441, N_MELS = 128, F_MIN = 30, F_MAX = 11000, FPS = 50;
const CHUNK = 1500, BORDER = 6;

// ── Banco de filtros mel (torchaudio.functional.melscale_fbanks, slaney, norm=None) ──
function hzToMel(f) {
  const fSp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fSp, logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fSp;
}
function melToHz(m) {
  const fSp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fSp, logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fSp * m;
}
let FB = null;   // Float32Array [nFreqs * N_MELS]
function melBank() {
  if (FB) return FB;
  const nF = N_FFT / 2 + 1;
  const allF = new Float64Array(nF);
  for (let i = 0; i < nF; i++) allF[i] = (SR / 2) * i / (nF - 1);
  const mMin = hzToMel(F_MIN), mMax = hzToMel(F_MAX);
  const fPts = new Float64Array(N_MELS + 2);
  for (let i = 0; i < N_MELS + 2; i++) fPts[i] = melToHz(mMin + (mMax - mMin) * i / (N_MELS + 1));
  FB = new Float32Array(nF * N_MELS);
  for (let i = 0; i < nF; i++) {
    for (let m = 0; m < N_MELS; m++) {
      const down = (allF[i] - fPts[m]) / (fPts[m + 1] - fPts[m]);
      const up = (fPts[m + 2] - allF[i]) / (fPts[m + 2] - fPts[m + 1]);
      FB[i * N_MELS + m] = Math.max(0, Math.min(down, up));
    }
  }
  return FB;
}

// ── FFT real de 1024 (radix-2) ──
let TW = null, REV = null;
function fftSetup() {
  if (TW) return;
  const n = N_FFT;
  TW = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
  for (let i = 0; i < n / 2; i++) { TW.cos[i] = Math.cos(-2 * Math.PI * i / n); TW.sin[i] = Math.sin(-2 * Math.PI * i / n); }
  REV = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
}
function fft(re, im) {
  const n = N_FFT;
  for (let i = 0; i < n; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = TW.cos[k * step], wi = TW.sin[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Log-mel de Beat This! → Float32Array [frames * 128] (fila = fotograma). */
function logMel(x) {
  fftSetup();
  const fb = melBank();
  const nF = N_FFT / 2 + 1, pad = N_FFT / 2;
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N_FFT);
  // normalized="frame_length" de torchaudio: divide por √(longitud de ventana).
  const norm = 1 / Math.sqrt(N_FFT);
  const L = x.length;
  const frames = 1 + Math.floor(L / HOP);
  const out = new Float32Array(frames * N_MELS);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), mag = new Float64Array(nF);
  // Reflexión en los bordes (como torch.stft center=True, pad_mode='reflect').
  const at = (i) => { if (i < 0) i = -i; if (i >= L) i = 2 * (L - 1) - i; return x[Math.max(0, Math.min(L - 1, i))]; };
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - pad;
    for (let i = 0; i < N_FFT; i++) { re[i] = at(start + i) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < nF; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm;
    const o = f * N_MELS;
    for (let k = 0; k < nF; k++) {
      const v = mag[k];
      if (!v) continue;
      const row = k * N_MELS;
      for (let m = 0; m < N_MELS; m++) { const w = fb[row + m]; if (w) out[o + m] += v * w; }
    }
    for (let m = 0; m < N_MELS; m++) out[o + m] = Math.log1p(1000 * out[o + m]);
  }
  return { data: out, frames };
}

// ── Inferencia por trozos (split_piece + aggregate_prediction, keep_first) ──
async function predictLogits(session, ort, mel, frames, onProgress) {
  const starts = [];
  for (let s = -BORDER; s < frames - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (frames > CHUNK - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  const beat = new Float32Array(frames).fill(-1000), down = new Float32Array(frames).fill(-1000);
  const preds = [];
  for (let c = 0; c < starts.length; c++) {
    const start = starts[c];
    const len = Math.min(start + CHUNK, frames) - Math.max(start, 0);
    const left = Math.max(0, -start), right = Math.max(0, Math.min(BORDER, start + CHUNK - frames));
    const T = left + len + right;
    const buf = new Float32Array(T * N_MELS);
    buf.set(mel.subarray(Math.max(start, 0) * N_MELS, (Math.max(start, 0) + len) * N_MELS), left * N_MELS);
    const r = await session.run({ spect: new ort.Tensor('float32', buf, [1, T, N_MELS]) });
    preds.push({ start, b: r.beat.data, d: r.downbeat.data, T });
    if (onProgress) onProgress((c + 1) / starts.length);
  }
  // keep_first: se escribe del último al primero (los primeros mandan).
  for (let c = preds.length - 1; c >= 0; c--) {
    const { start, b, d, T } = preds[c];
    for (let i = BORDER; i < T - BORDER; i++) {
      const t = start + i;
      if (t < 0 || t >= frames) continue;
      beat[t] = b[i]; down[t] = d[i];
    }
  }
  return { beat, down };
}

function peaks(logits) {
  const n = logits.length, out = [];
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (!(v > 0)) continue;
    let isMax = true;
    for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) if (logits[k] > v) { isMax = false; break; }
    if (isMax) out.push(i);
  }
  // deduplicate_peaks(width=1): grupos contiguos → su media
  const res = [];
  let p = null, c = 0;
  for (const q of out) {
    if (p != null && q - p <= 1) { c++; p += (q - p) / c; }
    else { if (p != null) res.push(p); p = q; c = 1; }
  }
  if (p != null) res.push(p);
  return res.map((f) => f / FPS);
}

/** Tiempos de pulsos y de compases (s) a partir de los logits. */
function postprocess(beatL, downL) {
  const beats = peaks(beatL);
  let downs = peaks(downL);
  if (beats.length) {
    downs = downs.map((d) => { let best = beats[0]; for (const b of beats) if (Math.abs(b - d) < Math.abs(best - d)) best = b; return best; });
  }
  downs = [...new Set(downs.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  return { beats, downbeats: downs };
}

let cached = null;   // { path, ep, session }
async function getSession(modelPath, preferred) {
  const ort = require('onnxruntime-node');
  if (cached && cached.path === modelPath) return { ort, session: cached.session, ep: cached.ep };
  const order = preferred === 'cpu' ? ['cpu'] : ['dml', 'cpu'];
  let lastErr;
  for (const ep of order) {
    try {
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });
      cached = { path: modelPath, ep, session };
      return { ort, session, ep };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No se pudo cargar el modelo de pulsos');
}

/**
 * @param {Float32Array} mono  audio mono a 22 050 Hz
 * @returns {Promise<{beats:number[], downbeats:number[], bpm:number, beatsPerBar:number, ep:string}>}
 */
async function trackBeats(mono, modelPath, { ep: preferred, onProgress } = {}) {
  const { ort, session, ep } = await getSession(modelPath, preferred);
  const { data, frames } = logMel(mono);
  const { beat, down } = await predictLogits(session, ort, data, frames, onProgress);
  const { beats, downbeats } = postprocess(beat, down);
  // Tempo y compás. El tempo sale de un ajuste por mínimos cuadrados de TODOS
  // los pulsos (t = fase + n·P): con fotogramas de 20 ms la mediana de las
  // distancias da un valor «redondo» (0,48 s) y un click a tempo fijo se iría
  // corriendo a lo largo de la canción.
  const med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  const ibi = med(beats.slice(1).map((b, i) => b - beats[i]));
  const bpb = [];
  for (let i = 1; i < downbeats.length; i++) bpb.push(beats.filter((b) => b >= downbeats[i - 1] - 1e-6 && b < downbeats[i] - 1e-6).length);
  let P = ibi, phase = beats.length ? beats[0] : 0;
  if (ibi > 0 && beats.length > 8) {
    const fit = (pts) => {
      let sn = 0, st = 0, snn = 0, snt = 0;
      for (const [n, t] of pts) { sn += n; st += t; snn += n * n; snt += n * t; }
      const k = pts.length, den = k * snn - sn * sn;
      if (!den) return null;
      const p = (k * snt - sn * st) / den;
      return { p, a: (st - p * sn) / k };
    };
    // Intervalo medio de los pulsos «normales» (±12 % de la mediana): con
    // fotogramas de 20 ms los intervalos alternan (0,48 / 0,50) y la mediana
    // sola daría un tempo redondo equivocado.
    const ok = beats.slice(1).map((t, i) => t - beats[i]).filter((d) => Math.abs(d - ibi) < ibi * 0.12);
    const P0 = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : ibi;
    // Tempo PRINCIPAL = el tramo seguido más largo con ese tempo (una canción
    // puede cambiar de tempo al final, o tener un pasaje que el modelo cuenta
    // distinto). Se numera cada pulso desde el anterior (1 o 2 pulsos de
    // distancia, por si falta uno) y el tramo se corta donde deja de cuadrar.
    let best = [], run = [];
    let n = 0;
    beats.forEach((t, i) => {
      if (i) {
        const q = (t - beats[i - 1]) / P0, k = Math.round(q);
        if (k < 1 || k > 2 || Math.abs(q - k) > 0.15) { if (run.length > best.length) best = run; run = []; n = 0; }
        else n += k;
      }
      run.push([n, t]);
    });
    if (run.length > best.length) best = run;
    let f = best.length > 8 ? fit(best) : null;
    if (f) {
      const pts = best.filter(([k, t]) => Math.abs(t - (f.a + k * f.p)) < f.p * 0.12);
      const f2 = pts.length > 8 ? fit(pts) : null;
      if (f2 && f2.p > 0) f = f2;
      P = f.p; phase = ((f.a % P) + P) % P;
    }
  }
  return { beats, downbeats, bpm: P ? 60 / P : 0, phase, beatsPerBar: med(bpb) || 4, ep };
}

module.exports = { logMel, postprocess, trackBeats, _internals: { melBank, peaks } };
