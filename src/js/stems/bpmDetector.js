// Tempo + meter estimation from a spectral-flux onset envelope.
//
// Why spectral flux (not broadband energy): on a full mix the energy
// derivative is a weak, noisy onset signal and the tempo autocorrelation
// ends up nearly flat (the true beat loses to spurious neighbours, e.g.
// 144 read as 154). Spectral flux — the sum of positive magnitude changes
// across frequency bins between adjacent STFT frames — gives crisp onset
// spikes and a far cleaner tempo peak.
//
// Pipeline:
//   1. Downsample to ~22 kHz (tempo lives in the low/mid band; fewer FFTs).
//   2. STFT (frame 1024, hop 256, Hann) → per-frame magnitude.
//   3. Spectral flux = Σ max(0, |X_t| − |X_{t-1}|) → onset envelope.
//   4. Autocorrelation, scored by a HARMONIC COMB (lag, 2·lag, 3·lag, 4·lag)
//      times a perceptual tempo preference (log-Gaussian ~120 BPM) so the
//      fundamental wins over half/double tempo and spurious neighbours.
//   5. Parabolic interpolation around the winning lag → sub-BPM precision.
//   6. Fold the onset over one beat; compare triple (1/3,2/3) vs duple
//      (1/4,1/2,3/4) energy to guess 6/8 vs 4/4.
//
// Returns { bpm, signature } or null.

const TARGET_SR = 22050;
const FFT_SIZE = 1024;
const HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
const NICE_BPM_MIN = 70;
const NICE_BPM_MAX = 185;
const PREF_CENTER = 124;   // perceptual tempo center (BPM)
const PREF_SIGMA = 0.95;   // in octaves

export function detectBPM(audioBuffer) {
  const r = analyze(audioBuffer);
  return r ? r.bpm : null;
}
export function detectTempoMeter(audioBuffer) {
  return analyze(audioBuffer);
}

// ── tiny iterative radix-2 FFT (real input) ───────────────────────
function makeFFT(n) {
  const rev = new Uint32Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    rev[i] = j;
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / n);
    sin[i] = Math.sin(-2 * Math.PI * i / n);
  }
  return function fftMag(re, im, outMag) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0, idx = 0; k < half; k++, idx += step) {
          const c = cos[idx], s = sin[idx];
          const a = i + k, b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) outMag[i] = Math.hypot(re[i], im[i]);
  };
}

// Spectral-flux onset envelope: downmix + downsample, STFT magnitude, sum of
// positive bin-to-bin changes per frame, mean-subtracted. Shared by tempo
// detection and beat-alignment.
function computeOnsetEnvelope(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) return null;
  const srIn = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0);
  const right = ch > 1 ? audioBuffer.getChannelData(1) : null;

  const ratio = srIn / TARGET_SR;
  const sr = ratio > 1 ? TARGET_SR : srIn;
  const outLen = ratio > 1 ? Math.floor(left.length / ratio) : left.length;
  const mono = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = ratio > 1 ? i * ratio : i;
    const i0 = Math.floor(x), frac = x - i0;
    const s0 = (left[i0] + (right ? right[i0] : left[i0])) * (right ? 0.5 : 1);
    const i1 = i0 + 1;
    const s1 = (left[i1] !== undefined) ? (left[i1] + (right ? right[i1] : left[i1])) * (right ? 0.5 : 1) : s0;
    mono[i] = s0 * (1 - frac) + s1 * frac;
  }

  const nFrames = Math.floor((mono.length - FFT_SIZE) / HOP);
  if (nFrames < 200) return null;

  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1));

  const fftMag = makeFFT(FFT_SIZE);
  const re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
  const nBins = FFT_SIZE / 2;
  let prev = new Float32Array(nBins), cur = new Float32Array(nBins);

  const onset = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const base = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[base + i] * win[i]; im[i] = 0; }
    fftMag(re, im, cur);
    if (f > 0) {
      let flux = 0;
      for (let b = 0; b < nBins; b++) { const d = cur[b] - prev[b]; if (d > 0) flux += d; }
      onset[f] = flux;
    }
    const t = prev; prev = cur; cur = t;
  }

  let mean = 0;
  for (let i = 0; i < nFrames; i++) mean += onset[i];
  mean /= nFrames;
  for (let i = 0; i < nFrames; i++) onset[i] = Math.max(0, onset[i] - mean);

  return { onset, nFrames, envRate: sr / HOP };
}

// Estimate the time (seconds) of the first beat and which beat in the bar is
// the downbeat, given a known BPM — so a generated click can be phase-locked
// to where the music actually plays (handles songs that start after silence).
// Returns { offsetSec, accentBeatOffset } or null.
export function detectBeatAlignment(audioBuffer, bpm, beatsPerBar = 4) {
  const env = computeOnsetEnvelope(audioBuffer);
  if (!env || !bpm) return null;
  const { onset, nFrames, envRate } = env;
  const P = (60 / bpm) * envRate; // beat period in frames
  if (!isFinite(P) || P < 2) return null;

  // Beat phase: sweep p in [0, P) and sum onset energy at p, p+P, p+2P, …
  const steps = Math.max(16, Math.round(P));
  let bestPhase = 0, bestScore = -1;
  for (let i = 0; i < steps; i++) {
    const p = (i / steps) * P;
    let score = 0;
    for (let f = p; f < nFrames; f += P) score += onset[Math.round(f)] || 0;
    if (score > bestScore) { bestScore = score; bestPhase = p; }
  }

  // Downbeat: of the beatsPerBar beat positions, the one whose onsets are
  // strongest (summed every bar) is beat 1.
  let bestDb = 0, bestDbScore = -1;
  for (let d = 0; d < beatsPerBar; d++) {
    let score = 0;
    for (let f = bestPhase + d * P; f < nFrames; f += beatsPerBar * P) score += onset[Math.round(f)] || 0;
    if (score > bestDbScore) { bestDbScore = score; bestDb = d; }
  }

  return {
    offsetSec: bestPhase / envRate,
    accentBeatOffset: (beatsPerBar - bestDb) % beatsPerBar,
  };
}

function analyze(audioBuffer) {
  const env = computeOnsetEnvelope(audioBuffer);
  if (!env) return null;
  const { onset, nFrames, envRate } = env;

  // 4. autocorrelation + comb + tempo preference
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * envRate));
  const maxLag = Math.min(nFrames - 1, Math.ceil((60 / MIN_BPM) * envRate));
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0; const lim = nFrames - lag;
    for (let i = 0; i < lim; i++) corr += onset[i] * onset[i + lag];
    ac[lag] = corr / lim;
  }

  const combW = [1, 0.6, 0.4, 0.25];
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let k = 0; k < combW.length; k++) {
      const l = lag * (k + 1);
      if (l <= maxLag) score += combW[k] * ac[l];
    }
    const bpm = (60 * envRate) / lag;
    const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / PREF_CENTER) / PREF_SIGMA, 2));
    score *= pref;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (bestScore <= 0) return null;

  // 5. parabolic interpolation
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) { const d = 0.5 * (a - c) / denom; if (d > -1 && d < 1) refined = bestLag + d; }
  }

  let bpm = (60 * envRate) / refined;
  while (bpm < NICE_BPM_MIN && bpm * 2 <= MAX_BPM) bpm *= 2;
  while (bpm > NICE_BPM_MAX && bpm / 2 >= MIN_BPM) bpm /= 2;

  const signature = guessMeter(onset, nFrames, (60 * envRate) / bpm);
  return { bpm: Math.round(bpm), signature };
}

function guessMeter(onset, nFrames, beatLag) {
  if (!isFinite(beatLag) || beatLag < 4) return '4/4';
  const L = Math.round(beatLag);
  const prof = new Float32Array(L);
  for (let i = 0; i < nFrames; i++) prof[i % L] += onset[i];
  let max = 0; for (let i = 0; i < L; i++) max = Math.max(max, prof[i]);
  if (max <= 0) return '4/4';
  for (let i = 0; i < L; i++) prof[i] /= max;
  const at = (frac) => {
    const idx = Math.round(frac * L) % L;
    let v = 0; for (let d = -1; d <= 1; d++) v = Math.max(v, prof[(idx + d + L) % L]);
    return v;
  };
  const triple = at(1 / 3) + at(2 / 3);
  const duple = at(1 / 2) + 0.5 * (at(1 / 4) + at(3 / 4));
  return triple > duple * 1.25 ? '6/8' : '4/4';
}
