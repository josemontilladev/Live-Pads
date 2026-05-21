// Main-process stem separation (MDX-Net via onnxruntime-node, no Python).
// Ported from the validated POC in scripts/stem-poc. Operates on decoded
// Float32 PCM passed from the renderer, so no audio decoding lives here.
// STFT(n_fft=6144, hop=1024, hann, center) -> [1,4,3072,256] -> ONNX model
// -> instrumental spectrogram -> iSTFT. vocals = original - instrumental.

const ort = require('onnxruntime-node');
const { FFTR } = require('kissfft-js');

const SR = 44100;
const N_FFT = 6144;
const HOP = 1024;
const N_BINS = N_FFT / 2 + 1;   // 3073
const DIM_F = 3072;             // bins the model sees (Inst_HQ_3)
const DIM_T = 256;              // time frames per inference window

// hann window (periodic)
const WIN = new Float32Array(N_FFT);
for (let n = 0; n < N_FFT; n++) WIN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);

function resampleLinear(src, fromRate, toRate) {
  if (fromRate === toRate) return src;
  const ratio = toRate / fromRate;
  const out = new Float32Array(Math.floor(src.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i / ratio, i0 = Math.floor(x), frac = x - i0;
    out[i] = (src[i0] || 0) * (1 - frac) + (src[i0 + 1] || 0) * frac;
  }
  return out;
}

function stft(signal) {
  const pad = N_FFT / 2;
  const L = signal.length;
  const padded = new Float32Array(L + N_FFT);
  for (let i = 0; i < pad; i++) padded[i] = signal[pad - i] || 0;
  padded.set(signal, pad);
  for (let i = 0; i < pad; i++) padded[pad + L + i] = signal[L - 2 - i] || 0;

  const nFrames = Math.floor(L / HOP) + 1;
  const re = new Float32Array(N_BINS * nFrames);
  const im = new Float32Array(N_BINS * nFrames);
  const fftr = new FFTR(N_FFT);
  const frame = new Float32Array(N_FFT);
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[off + n] * WIN[n];
    const spec = fftr.forward(frame);
    for (let b = 0; b < N_BINS; b++) {
      re[b * nFrames + f] = spec[b * 2];
      im[b * nFrames + f] = spec[b * 2 + 1];
    }
  }
  fftr.dispose();
  return { re, im, nFrames, length: L };
}

function istft(re, im, nFrames, length) {
  const pad = N_FFT / 2;
  const outLen = length + N_FFT;
  const acc = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);
  const fftr = new FFTR(N_FFT);
  const spec = new Float32Array(N_BINS * 2);
  for (let f = 0; f < nFrames; f++) {
    for (let b = 0; b < N_BINS; b++) {
      spec[b * 2] = re[b * nFrames + f];
      spec[b * 2 + 1] = im[b * nFrames + f];
    }
    const time = fftr.inverse(spec);
    const off = f * HOP;
    for (let n = 0; n < N_FFT; n++) {
      const w = WIN[n];
      acc[off + n] += (time[n] / N_FFT) * w;
      wsum[off + n] += w * w;
    }
  }
  fftr.dispose();
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const w = wsum[pad + i];
    out[i] = w > 1e-8 ? acc[pad + i] / w : 0;
  }
  return out;
}

// Separate one stereo source into instrumental + vocals.
// channels: [Float32Array L, Float32Array R] (R optional → duplicated).
// onProgress(fraction 0..1, stageLabel).
async function separate({ channels, sampleRate = SR, modelPath, ep = 'cpu', overlap = 0.25, onProgress } = {}) {
  const report = (frac, stage) => { try { onProgress && onProgress(Math.max(0, Math.min(1, frac)), stage); } catch (_) {} };

  let L = Float32Array.from(channels[0]);
  let R = channels[1] ? Float32Array.from(channels[1]) : Float32Array.from(channels[0]);
  if (sampleRate !== SR) {
    L = resampleLinear(L, sampleRate, SR);
    R = resampleLinear(R, sampleRate, SR);
  }

  report(0.02, 'Analizando audio');
  const specL = stft(L);
  const specR = stft(R);
  const nFrames = specL.nFrames;

  report(0.06, 'Cargando modelo');
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });

  const outReL = new Float32Array(N_BINS * nFrames);
  const outImL = new Float32Array(N_BINS * nFrames);
  const outReR = new Float32Array(N_BINS * nFrames);
  const outImR = new Float32Array(N_BINS * nFrames);
  const weightSum = new Float32Array(nFrames);

  const fw = new Float32Array(DIM_T);
  for (let i = 0; i < DIM_T; i++) fw[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (DIM_T - 1));

  const step = Math.max(1, Math.round(DIM_T * (1 - overlap)));
  const starts = [];
  for (let s = 0; s < nFrames; s += step) { starts.push(s); if (s + DIM_T >= nFrames) break; }

  const inBuf = new Float32Array(4 * DIM_F * DIM_T);
  for (let wi = 0; wi < starts.length; wi++) {
    const s = starts[wi];
    inBuf.fill(0);
    for (let bf = 0; bf < DIM_F; bf++) {
      for (let t = 0; t < DIM_T; t++) {
        const f = s + t;
        if (f >= nFrames) continue;
        const sIdx = bf * nFrames + f;
        inBuf[(0 * DIM_F + bf) * DIM_T + t] = specL.re[sIdx];
        inBuf[(1 * DIM_F + bf) * DIM_T + t] = specL.im[sIdx];
        inBuf[(2 * DIM_F + bf) * DIM_T + t] = specR.re[sIdx];
        inBuf[(3 * DIM_F + bf) * DIM_T + t] = specR.im[sIdx];
      }
    }
    const tensor = new ort.Tensor('float32', inBuf, [1, 4, DIM_F, DIM_T]);
    const res = await session.run({ input: tensor });
    const out = res.output.data;

    for (let t = 0; t < DIM_T; t++) {
      const f = s + t;
      if (f >= nFrames) break;
      const w = fw[t];
      weightSum[f] += w;
      for (let bf = 0; bf < DIM_F; bf++) {
        const sIdx = bf * nFrames + f;
        outReL[sIdx] += out[(0 * DIM_F + bf) * DIM_T + t] * w;
        outImL[sIdx] += out[(1 * DIM_F + bf) * DIM_T + t] * w;
        outReR[sIdx] += out[(2 * DIM_F + bf) * DIM_T + t] * w;
        outImR[sIdx] += out[(3 * DIM_F + bf) * DIM_T + t] * w;
      }
    }
    report(0.06 + 0.84 * ((wi + 1) / starts.length), 'Separando');
  }
  await session.release?.();

  for (let f = 0; f < nFrames; f++) {
    const w = weightSum[f] || 1;
    for (let b = 0; b < DIM_F; b++) {
      const i = b * nFrames + f;
      outReL[i] /= w; outImL[i] /= w; outReR[i] /= w; outImR[i] /= w;
    }
  }

  report(0.92, 'Reconstruyendo');
  const instL = istft(outReL, outImL, nFrames, L.length);
  const instR = istft(outReR, outImR, nFrames, R.length);
  const vocL = new Float32Array(L.length), vocR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) { vocL[i] = L[i] - instL[i]; vocR[i] = R[i] - instR[i]; }

  report(1, 'Listo');
  return {
    sampleRate: SR,
    instrumental: [instL, instR],
    vocals: [vocL, vocR],
  };
}

module.exports = { separate, SR };
