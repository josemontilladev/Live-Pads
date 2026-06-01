// Audio structure segmentation — find where a song's sections change
// (intro → verse → chorus → bridge …) so the app can drop guide markers
// automatically. Generic by design: it returns boundary TIMES (+ a best-guess
// label); the manual marker workflow is unaffected — this only adds.
//
// Precision-tuned pipeline (slower but accurate — accuracy > speed here):
//   1. Downmix + downsample to ~11 kHz.
//   2. STFT with a fine 0.25 s hop → 4 feature frames/sec.
//   3. Per frame, build a 36-D feature = 24 log-mel bands (TIMBRE) ⊕ 12 chroma
//      bins (HARMONY), each part L2-normalised. Verse↔chorus changes are often
//      harmonic, so chroma matters as much as timbre.
//   4. Self-similarity matrix (cosine) + checkerboard-kernel novelty curve.
//   5. Adaptive peak-pick → coarse boundaries.
//   6. SNAP each boundary to the nearest bar line (from the project BPM + beat
//      alignment) so markers land musically exact — the key to a usable guide.
//
// Returns [{ atSec, cueId, label }] (ascending), or [] if too short/silent.

import { makeFFT, detectBeatAlignment } from './bpmDetector.js';

const SR = 11025;
const FFT_SIZE = 2048;
const HOP_SEC = 0.25;         // 4 feature frames/sec (fine localisation)
const N_MEL = 24;             // log-spaced timbre bands
const N_CHROMA = 12;          // pitch-class harmony bins
const DIM = N_MEL + N_CHROMA;
const KERNEL_HALF = 24;       // checkerboard half-size in frames (±6 s)
const MIN_GAP_SEC = 5;        // minimum spacing between boundaries
const MIN_FRAMES = 48;        // need ~12 s of audio to bother
const CHROMA_W = 0.9;         // relative weight of harmony vs timbre

function downmixDownsample(audioBuffer) {
  const srIn = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0);
  const right = ch > 1 ? audioBuffer.getChannelData(1) : null;
  const ratio = srIn / SR;
  const sr = ratio > 1 ? SR : srIn;
  const outLen = ratio > 1 ? Math.floor(left.length / ratio) : left.length;
  const mono = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = ratio > 1 ? i * ratio : i;
    const i0 = Math.floor(x), frac = x - i0;
    const a = (left[i0] + (right ? right[i0] : left[i0])) * (right ? 0.5 : 1);
    const b1 = left[i0 + 1];
    const b = (b1 !== undefined) ? (b1 + (right ? right[i0 + 1] : b1)) * (right ? 0.5 : 1) : a;
    mono[i] = a * (1 - frac) + b * frac;
  }
  return { mono, sr };
}

function bandEdges(nBins) {
  const edges = new Int32Array(N_MEL + 1);
  const lo = 1, hi = nBins - 1;
  for (let i = 0; i <= N_MEL; i++) {
    const f = i / N_MEL;
    edges[i] = Math.min(hi, Math.max(lo, Math.round(lo * Math.pow(hi / lo, f))));
  }
  return edges;
}

function normalizeInPlace(v, start, len) {
  let n = 0; for (let i = 0; i < len; i++) n += v[start + i] * v[start + i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < len; i++) v[start + i] /= n;
}

function extractFeatures(mono, sr) {
  const hop = Math.max(1, Math.round(sr * HOP_SEC));
  const nFrames = Math.floor((mono.length - FFT_SIZE) / hop);
  if (nFrames < MIN_FRAMES) return null;

  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1));

  const fftMag = makeFFT(FFT_SIZE);
  const re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
  const nBins = FFT_SIZE / 2;
  const mag = new Float32Array(nBins);
  const edges = bandEdges(nBins);

  // Pre-compute the pitch class of each FFT bin for chroma (skip very low/high).
  const pc = new Int8Array(nBins).fill(-1);
  for (let k = 1; k < nBins; k++) {
    const f = k * sr / FFT_SIZE;
    if (f < 65 || f > 5000) continue;
    pc[k] = (((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12);
  }

  const feats = [];
  for (let fI = 0; fI < nFrames; fI++) {
    const base = fI * hop;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[base + i] * win[i]; im[i] = 0; }
    fftMag(re, im, mag);

    const v = new Float32Array(DIM);
    // Mel/timbre bands (log-compressed).
    for (let b = 0; b < N_MEL; b++) {
      let sum = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) sum += mag[k];
      v[b] = Math.log1p(sum);
    }
    // Chroma/harmony bins.
    for (let k = 1; k < nBins; k++) {
      const c = pc[k];
      if (c >= 0) v[N_MEL + c] += mag[k];
    }
    // Normalise the two halves independently, then weight harmony.
    normalizeInPlace(v, 0, N_MEL);
    normalizeInPlace(v, N_MEL, N_CHROMA);
    for (let c = 0; c < N_CHROMA; c++) v[N_MEL + c] *= CHROMA_W;
    // Re-normalise the full vector so cosine = dot product.
    normalizeInPlace(v, 0, DIM);
    feats.push(v);
  }
  return feats;
}

function makeCheckerboard() {
  const N = 2 * KERNEL_HALF;
  const K = new Float32Array(N * N);
  const sigma = KERNEL_HALF / 2;
  for (let a = -KERNEL_HALF; a < KERNEL_HALF; a++) {
    for (let b = -KERNEL_HALF; b < KERNEL_HALF; b++) {
      const g = Math.exp(-(a * a + b * b) / (2 * sigma * sigma));
      const sign = (a * b >= 0) ? 1 : -1;
      K[(a + KERNEL_HALF) * N + (b + KERNEL_HALF)] = sign * g;
    }
  }
  return K;
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {object} [opts]
 *   bpm, beatsPerBar — when given, boundaries snap to the nearest bar line.
 * @returns {{atSec:number, cueId:string, label:string}[]}
 */
export function detectSections(audioBuffer, opts = {}) {
  if (!audioBuffer || audioBuffer.length === 0) return [];
  const { mono, sr } = downmixDownsample(audioBuffer);
  const feats = extractFeatures(mono, sr);
  if (!feats) return [];
  const n = feats.length;

  // Novelty curve along the SSM diagonal (computed on the fly, no full SSM).
  const K = makeCheckerboard();
  const N = 2 * KERNEL_HALF;
  const novelty = new Float32Array(n);
  for (let i = KERNEL_HALF; i < n - KERNEL_HALF; i++) {
    let acc = 0;
    for (let a = 0; a < N; a++) {
      const fa = feats[i - KERNEL_HALF + a];
      const krow = a * N;
      for (let b = 0; b < N; b++) {
        const fb = feats[i - KERNEL_HALF + b];
        let dot = 0;
        for (let d = 0; d < DIM; d++) dot += fa[d] * fb[d];
        acc += K[krow + b] * dot;
      }
    }
    novelty[i] = acc;
  }

  // ── Suavizado de la curva de novedad ──
  // Kernel gaussiano de 5 taps (~1.25 s a 4 frames/s) para apagar spikes de
  // un solo frame, que solían meter marcadores donde no había transición
  // real. Mantiene los picos anchos (cambios de sección genuinos).
  const smoothed = new Float32Array(n);
  const SMOOTH_K = [0.1, 0.2, 0.4, 0.2, 0.1];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) {
      const j = Math.max(0, Math.min(n - 1, i + k));
      s += novelty[j] * SMOOTH_K[k + 2];
    }
    smoothed[i] = s;
  }
  for (let i = 0; i < n; i++) novelty[i] = smoothed[i];

  // ── Threshold robusto (mediana + MAD) ──
  // Antes usábamos mean + 0.55·std. El problema: una sola transición muy
  // marcada (silencio→entra la banda) infla std y eleva el umbral, dejando
  // fuera transiciones genuinas pero más sutiles (verso→coro). Mediana y
  // MAD son insensibles a un puñado de outliers.
  const sorted = Array.from(novelty).sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const devs = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(n / 2)] || 1;
  // 1.4826 escala MAD a std-equivalente; 1.6 es el "k" empírico (más alto
  // que el 0.55·std anterior porque mediana+MAD comprime el rango).
  const thresh = median + 1.6 * 1.4826 * mad;

  // ── Pico válido sobre ventana ±3 frames (0.75 s) ──
  // Antes pedía solo > vecino inmediato (±1). Eso dejaba pasar ondulaciones
  // ruidosas. Pedir local-max sobre ±3 elimina picos espurios y deja solo
  // los que destacan claramente sobre su entorno.
  const minGapFrames = Math.max(1, Math.round(MIN_GAP_SEC / HOP_SEC));
  const PEAK_HALF = 3;
  const peaks = [];
  for (let i = KERNEL_HALF + PEAK_HALF; i < n - KERNEL_HALF - PEAK_HALF; i++) {
    const v = novelty[i];
    if (v < thresh) continue;
    let isLocalMax = true;
    for (let k = -PEAK_HALF; k <= PEAK_HALF; k++) {
      if (k === 0) continue;
      if (novelty[i + k] > v) { isLocalMax = false; break; }
    }
    if (!isLocalMax) continue;
    if (peaks.length && (i - peaks[peaks.length - 1].frame) < minGapFrames) {
      if (v > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { frame: i, v };
      continue;
    }
    peaks.push({ frame: i, v });
  }

  let times = peaks.map(p => p.frame * HOP_SEC).filter(t => t > 1.5);
  if (!times.length) return [];

  // Snap each boundary to the nearest bar line so markers are musically exact.
  // Mejora: probamos snap a barra entera Y media barra (para anacrusis: una
  // sección que entra 2 beats antes del compás formal). Elegimos el snap que
  // caiga más cerca del pico de novedad detectado — el "alineamiento real"
  // de la transición, no una abstracción rítmica forzada.
  if (opts.bpm > 0) {
    const beatsPerBar = opts.beatsPerBar || 4;
    const barSec = (60 / opts.bpm) * beatsPerBar;
    const halfBarSec = barSec / 2;
    let offsetSec = 0;
    try {
      const a = detectBeatAlignment(audioBuffer, opts.bpm, beatsPerBar);
      if (a && isFinite(a.offsetSec)) offsetSec = a.offsetSec;
    } catch (e) { /* keep 0 */ }
    times = times.map(t => {
      const tFromOffset = t - offsetSec;
      const snapBar = offsetSec + Math.round(tFromOffset / barSec) * barSec;
      const snapHalf = offsetSec + Math.round(tFromOffset / halfBarSec) * halfBarSec;
      // Si la distancia al snap-medio es la mitad o menos que al snap-entero,
      // preferimos el medio. Si están parejos, gana el entero (musicalmente
      // dominante). Esto evita atraer cualquier transición al medio porque sí.
      const dBar  = Math.abs(t - snapBar);
      const dHalf = Math.abs(t - snapHalf);
      return (dHalf < dBar * 0.55) ? snapHalf : snapBar;
    });
    // De-dupe boundaries that snapped onto the same bar, keep ascending order.
    times = [...new Set(times.map(t => +t.toFixed(3)))].sort((x, y) => x - y).filter(t => t > 1);
  }

  // Segment + label by texture similarity.
  const boundaryFrames = [0, ...times.map(t => Math.round(t / HOP_SEC))].sort((a, b) => a - b);
  const segMeans = boundaryFrames.map((a, i) => {
    const b = (i + 1 < boundaryFrames.length) ? boundaryFrames[i + 1] : n;
    const m = new Float32Array(DIM);
    let cnt = 0;
    for (let f = a; f < b && f < n; f++) { const v = feats[f]; for (let d = 0; d < DIM; d++) m[d] += v[d]; cnt++; }
    if (cnt) for (let d = 0; d < DIM; d++) m[d] /= cnt;
    normalizeInPlace(m, 0, DIM);
    return m;
  });

  // Para labelSegments necesitamos también las longitudes de cada segmento
  // (en frames) — el pre-coro es típicamente CORTO (1-2 compases), así que
  // contar duración relativa al promedio nos ayuda a distinguirlo de un verso.
  const segLengths = boundaryFrames.map((a, i) => {
    const b = (i + 1 < boundaryFrames.length) ? boundaryFrames[i + 1] : n;
    return b - a;
  });

  const labels = labelSegments(segMeans, segLengths);
  const CUE = {
    intro:    { cueId: 'intro',    label: 'Intro' },
    verso:    { cueId: 'verso',    label: 'Verso' },
    precoro:  { cueId: 'pre-coro', label: 'Pre-Coro' },
    coro:     { cueId: 'coro',     label: 'Coro' },
    puente:   { cueId: 'puente',   label: 'Puente' },
    outro:    { cueId: 'outro',    label: 'Outro' },
  };
  return boundaryFrames.map((f, i) => {
    const c = CUE[labels[i]] || CUE.verso;
    return { atSec: +(f * HOP_SEC).toFixed(3), cueId: c.cueId, label: c.label };
  });
}

// Heurística de estructura:
//   1. Cluster por textura (greedy con umbral de similitud).
//   2. El cluster más repetido = CORO.
//   3. PRECORO: segmento corto (<= 60% de la longitud promedio) que aparece
//      INMEDIATAMENTE ANTES de un coro de forma consistente (más de una vez
//      o, si solo aparece una vez, justo antes del primer coro).
//   4. PUENTE: segmento único (counts === 1) que NO es el coro y aparece en
//      la segunda mitad del tema. Si hay varios candidatos, el más distinto
//      al coro (menor similitud) gana.
//   5. INTRO siempre va en la primera posición; OUTRO en la última si es
//      única y el tema tiene ≥4 secciones.
//
// Best-effort — el usuario afina con el menú de marcadores.
function labelSegments(segMeans, segLengths) {
  const N = segMeans.length;
  const sim = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

  const cluster = new Array(N).fill(-1);
  const reps = [];
  for (let i = 0; i < N; i++) {
    let best = -1, bestS = 0.85;
    for (let c = 0; c < reps.length; c++) {
      const s = sim(segMeans[i], reps[c]);
      if (s > bestS) { bestS = s; best = c; }
    }
    if (best >= 0) cluster[i] = best;
    else { cluster[i] = reps.length; reps.push(segMeans[i]); }
  }

  const counts = {};
  for (const c of cluster) counts[c] = (counts[c] || 0) + 1;
  let chorusCluster = -1, bestCount = 1;
  for (const c in counts) { if (counts[c] > bestCount) { bestCount = counts[c]; chorusCluster = +c; } }

  // Longitud promedio de los segmentos "no únicos" (para detectar el corto).
  const reasonableLens = segLengths.filter((_, i) => (counts[cluster[i]] || 0) > 1);
  const avgLen = reasonableLens.length
    ? reasonableLens.reduce((s, x) => s + x, 0) / reasonableLens.length
    : (segLengths.reduce((s, x) => s + x, 0) / Math.max(1, N));

  // ── Pre-coro: marca clústers que sean cortos Y aparezcan justo antes
  // de un coro consistentemente. Si el mismo clúster aparece varias veces
  // y todas sus apariciones (o ≥2) preceden a un coro, lo etiquetamos.
  const precorusClusters = new Set();
  const clusterToIndices = new Map();
  cluster.forEach((c, i) => {
    if (c === chorusCluster) return;
    if (!clusterToIndices.has(c)) clusterToIndices.set(c, []);
    clusterToIndices.get(c).push(i);
  });
  for (const [c, indices] of clusterToIndices) {
    if (chorusCluster < 0) break;
    // Longitud típica de este clúster: media de sus segmentos.
    const lens = indices.map(i => segLengths[i]);
    const meanLen = lens.reduce((s, x) => s + x, 0) / lens.length;
    if (meanLen > avgLen * 0.6) continue; // demasiado largo, no es pre-coro
    // ¿Cuántas veces este clúster va seguido de un coro?
    let beforeChorus = 0;
    for (const i of indices) {
      if (i + 1 < N && cluster[i + 1] === chorusCluster) beforeChorus++;
    }
    // Reglas:
    //   - Si aparece ≥2 veces y mitad o más son ante-coro → es pre-coro.
    //   - Si aparece solo 1 vez Y es ante-coro Y está antes del segundo
    //     coro → también lo aceptamos (canciones que solo tienen pre-coro
    //     antes del bridge-coro final son válidas).
    if (indices.length >= 2 && beforeChorus >= Math.ceil(indices.length / 2)) {
      precorusClusters.add(c);
    } else if (indices.length === 1 && beforeChorus === 1) {
      precorusClusters.add(c);
    }
  }

  return cluster.map((c, i) => {
    if (i === 0) return 'intro';
    if (i === N - 1 && counts[c] === 1 && N >= 4) return 'outro';
    if (c === chorusCluster) return 'coro';
    if (precorusClusters.has(c)) return 'precoro';
    // Puente: segmento único en la segunda mitad, no coro, no pre-coro.
    if (counts[c] === 1 && chorusCluster >= 0 && i >= Math.floor(N * 0.5)) return 'puente';
    return 'verso';
  });
}
