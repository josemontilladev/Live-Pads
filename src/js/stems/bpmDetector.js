// Lightweight BPM detector based on autocorrelation of the audio's
// short-time energy envelope. Pragmatic, not perfect — works well on
// percussive material (drums, click-heavy stems) and gives a sensible
// ballpark on melodic-only tracks.
//
// The algorithm:
//   1. Reduce the audio to mono and compute RMS energy in ~12 ms frames.
//   2. Take the half-wave-rectified first derivative as the onset
//      function (peaks where the energy ramps up = drum hits).
//   3. Autocorrelate that onset function across the lag range that
//      corresponds to BPM 60..200 and pick the peak lag.
//   4. Fold the candidate into the 70..160 BPM window by halving or
//      doubling — most worship songs live there and the detector loves
//      to land on the second harmonic.
//
// Returns a Number (rounded BPM) or null if no reliable peak found.

const HOP = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;
const NICE_BPM_MIN = 70;
const NICE_BPM_MAX = 160;

export function detectBPM(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) return null;

  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
  const left  = audioBuffer.getChannelData(0);
  const right = ch > 1 ? audioBuffer.getChannelData(1) : null;
  const total = left.length;

  // 1. Onset envelope at envSampleRate ≈ sr / HOP (~86 Hz at 44.1 kHz)
  const frames = Math.floor(total / HOP);
  if (frames < 200) return null; // need at least a few seconds
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sumSq = 0;
    const base = f * HOP;
    for (let j = 0; j < HOP; j++) {
      const a = left[base + j];
      const v = right ? (a + right[base + j]) * 0.5 : a;
      sumSq += v * v;
    }
    energy[f] = Math.sqrt(sumSq / HOP);
  }
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) {
    const d = energy[i] - energy[i - 1];
    onset[i] = d > 0 ? d : 0;
  }

  // 2. Mean-normalise so loud songs don't bias the autocorrelation peak.
  let mean = 0;
  for (let i = 0; i < frames; i++) mean += onset[i];
  mean /= frames;
  for (let i = 0; i < frames; i++) onset[i] = Math.max(0, onset[i] - mean);

  // 3. Autocorrelation across BPM lag range.
  const envRate = sr / HOP;
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * envRate));
  const maxLag = Math.min(frames - 1, Math.ceil((60 / MIN_BPM) * envRate));
  let bestLag = minLag;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const limit = frames - lag;
    for (let i = 0; i < limit; i++) corr += onset[i] * onset[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestCorr === 0) return null;

  // 4. Convert lag to BPM, then fold into the comfortable range. The
  // autocorrelation peaks at every multiple of the true tempo lag, so
  // doubling/halving moves us between octaves of the same beat.
  let bpm = 60 * envRate / bestLag;
  while (bpm < NICE_BPM_MIN && bpm * 2 < MAX_BPM) bpm *= 2;
  while (bpm > NICE_BPM_MAX && bpm / 2 > MIN_BPM) bpm /= 2;
  return Math.round(bpm);
}
