// Audio structure segmentation — find where a song's sections change
// (intro → verse → chorus → bridge …) so the app can drop guide markers
// automatically. Generic by design: it returns boundary TIMES; the caller
// labels them. The manual marker workflow is unaffected — this only adds.
//
// Method (classic MIR, all in pure JS):
//   1. Downmix + downsample to ~11 kHz.
//   2. STFT with a ~0.5 s hop → ~2 feature frames/sec.
//   3. Reduce each frame's magnitude spectrum to log-spaced bands +
//      log-compression, then L2-normalise → timbre/texture feature vectors.
//   4. Self-similarity matrix S (cosine sim, = dot of normalised features).
//   5. Slide a checkerboard kernel down S's diagonal → a novelty curve that
//      peaks where the texture changes (= section boundaries).
//   6. Peak-pick the novelty (above an adaptive threshold, min spacing).
//
// Returns an array of boundary times in seconds (ascending), or [] if the
// clip is too short / silent.

import { makeFFT } from './bpmDetector.js';

const SR = 11025;
const FFT_SIZE = 2048;
const HOP_SEC = 0.5;          // ~2 feature frames per second
const N_BANDS = 24;           // log-spaced spectral bands per feature
const KERNEL_HALF = 16;       // checkerboard half-size in frames (±8 s)
const MIN_GAP_SEC = 6;        // minimum spacing between detected boundaries
const MIN_FRAMES = 24;        // need at least ~12 s of audio to bother

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

// Build log-spaced band edges over the FFT bins (skip DC, cap at Nyquist).
function bandEdges(nBins) {
  const edges = new Int32Array(N_BANDS + 1);
  const lo = 1, hi = nBins - 1;
  for (let i = 0; i <= N_BANDS; i++) {
    const f = i / N_BANDS;
    edges[i] = Math.min(hi, Math.max(lo, Math.round(lo * Math.pow(hi / lo, f))));
  }
  return edges;
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

  const feats = []; // array of Float32Array(N_BANDS), L2-normalised
  for (let f = 0; f < nFrames; f++) {
    const base = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[base + i] * win[i]; im[i] = 0; }
    fftMag(re, im, mag);
    const v = new Float32Array(N_BANDS);
    for (let b = 0; b < N_BANDS; b++) {
      let sum = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) sum += mag[k];
      v[b] = Math.log1p(sum); // log-compress so loud bands don't dominate
    }
    // L2 normalise → cosine similarity becomes a plain dot product.
    let norm = 0; for (let b = 0; b < N_BANDS; b++) norm += v[b] * v[b];
    norm = Math.sqrt(norm) || 1;
    for (let b = 0; b < N_BANDS; b++) v[b] /= norm;
    feats.push(v);
  }
  return feats;
}

// Precompute a checkerboard kernel: + in the two diagonal quadrants, − in the
// off-diagonal ones, tapered by a Gaussian so near-diagonal cells dominate.
function makeCheckerboard() {
  const N = 2 * KERNEL_HALF;
  const K = new Float32Array(N * N);
  const sigma = KERNEL_HALF / 2;
  for (let a = -KERNEL_HALF; a < KERNEL_HALF; a++) {
    for (let b = -KERNEL_HALF; b < KERNEL_HALF; b++) {
      const g = Math.exp(-(a * a + b * b) / (2 * sigma * sigma));
      const sign = (a * b >= 0) ? 1 : -1; // +diag quadrants, −off-diag
      K[(a + KERNEL_HALF) * N + (b + KERNEL_HALF)] = sign * g;
    }
  }
  return K;
}

/**
 * @param {AudioBuffer} audioBuffer
 * @returns {number[]} boundary times in seconds (ascending), excluding 0.
 */
export function detectSections(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) return [];
  const { mono, sr } = downmixDownsample(audioBuffer);
  const feats = extractFeatures(mono, sr);
  if (!feats) return [];
  const n = feats.length;

  // Novelty curve: correlate the checkerboard kernel with S along the
  // diagonal. We never materialise the full SSM — for each centre frame i we
  // only touch the (2K)² cells around (i,i), computing similarities on the fly.
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
        for (let d = 0; d < N_BANDS; d++) dot += fa[d] * fb[d];
        acc += K[krow + b] * dot;
      }
    }
    novelty[i] = acc;
  }

  // Normalise novelty to mean 0 and pick peaks above an adaptive threshold.
  let mean = 0; for (let i = 0; i < n; i++) mean += novelty[i];
  mean /= n;
  let varc = 0; for (let i = 0; i < n; i++) { const d = novelty[i] - mean; varc += d * d; }
  const std = Math.sqrt(varc / n) || 1;
  const thresh = mean + 0.6 * std;

  const minGapFrames = Math.max(1, Math.round(MIN_GAP_SEC / HOP_SEC));
  const peaks = [];
  for (let i = KERNEL_HALF + 1; i < n - KERNEL_HALF - 1; i++) {
    const v = novelty[i];
    if (v < thresh) continue;
    if (v < novelty[i - 1] || v < novelty[i + 1]) continue; // local max
    if (peaks.length && (i - peaks[peaks.length - 1].frame) < minGapFrames) {
      // Too close — keep the stronger of the two.
      if (v > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { frame: i, v };
      continue;
    }
    peaks.push({ frame: i, v });
  }

  return peaks
    .map(p => +(p.frame * HOP_SEC).toFixed(3))
    .filter(t => t > 1.5); // ignore boundaries right at the very start
}
