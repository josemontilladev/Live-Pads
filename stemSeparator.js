// Main-process stem separation (MDX-Net via onnxruntime-node, no Python).
// Two modes:
//   '2stem' → voz / instrumental (UVR-MDX-NET-Inst_HQ_3, high quality)
//   '4stem' → voz / batería / bajo / otros (kuielab_a model set)
//
// Each model is an MDX ConvTDF net: STFT (per-model n_fft, hop 1024, Hann,
// center) → [1,4,dimF,dimT] tensor → ONNX → source spectrogram → iSTFT.
// STFT/iSTFT are pure JS (kissfft). Params verified against the kuielab
// mdx-net-submission and (for Inst_HQ_3) the model's own input shape.

const ort = require('onnxruntime-node');
const { FFTR } = require('kissfft-js');

const SR = 44100;
const HOP = 1024;

// Per-model config. nfft/dimF/dimT differ by model and MUST match training.
const MODELS = {
  inst_hq3: { file: 'UVR-MDX-NET-Inst_HQ_3.onnx', nfft: 6144,  dimF: 3072, dimT: 256 },
  k_vocals: { file: 'kuielab_a_vocals.onnx',      nfft: 6144,  dimF: 2048, dimT: 512 },
  k_drums:  { file: 'kuielab_a_drums.onnx',       nfft: 4096,  dimF: 2048, dimT: 512 },
  k_bass:   { file: 'kuielab_a_bass.onnx',        nfft: 16384, dimF: 2048, dimT: 512 },
  k_other:  { file: 'kuielab_a_other.onnx',       nfft: 8192,  dimF: 2048, dimT: 512 },
};

const winCache = new Map();
function hann(N) {
  let w = winCache.get(N);
  if (w) return w;
  w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  winCache.set(N, w);
  return w;
}

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

function stft(signal, NFFT) {
  const NB = NFFT / 2 + 1, pad = NFFT / 2, L = signal.length, win = hann(NFFT);
  const padded = new Float32Array(L + NFFT);
  for (let i = 0; i < pad; i++) padded[i] = signal[pad - i] || 0;
  padded.set(signal, pad);
  for (let i = 0; i < pad; i++) padded[pad + L + i] = signal[L - 2 - i] || 0;
  const nF = Math.floor(L / HOP) + 1;
  const re = new Float32Array(NB * nF), im = new Float32Array(NB * nF);
  const fftr = new FFTR(NFFT), frame = new Float32Array(NFFT);
  for (let f = 0; f < nF; f++) {
    const off = f * HOP;
    for (let n = 0; n < NFFT; n++) frame[n] = padded[off + n] * win[n];
    const spec = fftr.forward(frame);
    for (let b = 0; b < NB; b++) { re[b * nF + f] = spec[b * 2]; im[b * nF + f] = spec[b * 2 + 1]; }
  }
  fftr.dispose();
  return { re, im, nF, NB };
}

function istft(re, im, nF, NB, NFFT, length) {
  const pad = NFFT / 2, win = hann(NFFT), outLen = length + NFFT;
  const acc = new Float32Array(outLen), wsum = new Float32Array(outLen);
  const fftr = new FFTR(NFFT), spec = new Float32Array(NB * 2);
  for (let f = 0; f < nF; f++) {
    for (let b = 0; b < NB; b++) { spec[b * 2] = re[b * nF + f]; spec[b * 2 + 1] = im[b * nF + f]; }
    const time = fftr.inverse(spec), off = f * HOP;
    for (let n = 0; n < NFFT; n++) { const w = win[n]; acc[off + n] += (time[n] / NFFT) * w; wsum[off + n] += w * w; }
  }
  fftr.dispose();
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) { const w = wsum[pad + i]; out[i] = w > 1e-8 ? acc[pad + i] / w : 0; }
  return out;
}

// Create a session, preferring DirectML (GPU, ~10x faster) and falling
// back to CPU. Returns { session, ep }.
async function createSession(modelPath, preferred) {
  const order = preferred === 'cpu' ? ['cpu'] : ['dml', 'cpu'];
  let lastErr;
  for (const ep of order) {
    try {
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });
      return { session, ep };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No execution provider available');
}

// Run one MDX model over the whole signal, returning the source [L,R].
async function runModel(L, R, modelPath, cfg, ep, onLocal) {
  const { nfft, dimF, dimT } = cfg;
  const sL = stft(L, nfft), sR = stft(R, nfft);
  const nF = sL.nF, NB = sL.NB;
  const { session, ep: usedEp } = await createSession(modelPath, ep);

  const oReL = new Float32Array(NB * nF), oImL = new Float32Array(NB * nF);
  const oReR = new Float32Array(NB * nF), oImR = new Float32Array(NB * nF);
  const wsum = new Float32Array(nF);
  const fw = hann(dimT);
  const step = Math.max(1, Math.round(dimT * 0.75));
  const starts = [];
  for (let s = 0; s < nF; s += step) { starts.push(s); if (s + dimT >= nF) break; }
  const inBuf = new Float32Array(4 * dimF * dimT);

  for (let wi = 0; wi < starts.length; wi++) {
    const s = starts[wi];
    inBuf.fill(0);
    for (let bf = 0; bf < dimF; bf++) {
      for (let t = 0; t < dimT; t++) {
        const f = s + t; if (f >= nF) continue;
        const si = bf * nF + f;
        inBuf[(0 * dimF + bf) * dimT + t] = sL.re[si];
        inBuf[(1 * dimF + bf) * dimT + t] = sL.im[si];
        inBuf[(2 * dimF + bf) * dimT + t] = sR.re[si];
        inBuf[(3 * dimF + bf) * dimT + t] = sR.im[si];
      }
    }
    const res = await session.run({ input: new ort.Tensor('float32', inBuf, [1, 4, dimF, dimT]) });
    const out = res.output.data;
    for (let t = 0; t < dimT; t++) {
      const f = s + t; if (f >= nF) break;
      const w = fw[t]; wsum[f] += w;
      for (let bf = 0; bf < dimF; bf++) {
        const si = bf * nF + f;
        oReL[si] += out[(0 * dimF + bf) * dimT + t] * w;
        oImL[si] += out[(1 * dimF + bf) * dimT + t] * w;
        oReR[si] += out[(2 * dimF + bf) * dimT + t] * w;
        oImR[si] += out[(3 * dimF + bf) * dimT + t] * w;
      }
    }
    if (onLocal) onLocal((wi + 1) / starts.length);
  }
  await session.release?.();
  for (let f = 0; f < nF; f++) {
    const w = wsum[f] || 1;
    for (let b = 0; b < dimF; b++) { const i = b * nF + f; oReL[i] /= w; oImL[i] /= w; oReR[i] /= w; oImR[i] /= w; }
  }
  return { channels: [istft(oReL, oImL, nF, NB, nfft, L.length), istft(oReR, oImR, nF, NB, nfft, R.length)], ep: usedEp };
}

const path = require('path');

// mode: '2stem' | '4stem'. modelsDir: absolute path to the models folder.
async function separate({ channels, sampleRate = SR, mode = '2stem', modelsDir, ep, onProgress } = {}) {
  const report = (frac, stage) => { try { onProgress && onProgress(Math.max(0, Math.min(1, frac)), stage); } catch (_) {} };
  let L = Float32Array.from(channels[0]);
  let R = channels[1] ? Float32Array.from(channels[1]) : Float32Array.from(channels[0]);
  if (sampleRate !== SR) { L = resampleLinear(L, sampleRate, SR); R = resampleLinear(R, sampleRate, SR); }

  const mp = (key) => path.join(modelsDir, MODELS[key].file);
  let chosenEp = ep;

  if (mode === '4stem') {
    const plan = [
      { key: 'k_vocals', name: 'Voces',     kind: 'vocals' },
      { key: 'k_drums',  name: 'Batería',   kind: 'drums'  },
      { key: 'k_bass',   name: 'Bajo',      kind: 'bass'   },
      { key: 'k_other',  name: 'Otros',     kind: 'other'  },
    ];
    const stems = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      report((i) / plan.length, `Separando ${p.name}…`);
      const { channels: ch, ep: used } = await runModel(L, R, mp(p.key), MODELS[p.key], chosenEp,
        (lf) => report((i + lf) / plan.length, `Separando ${p.name}…`));
      chosenEp = used; // reuse the EP that worked for the rest
      stems.push({ name: p.name, kind: p.kind, channels: ch });
    }
    report(1, 'Listo');
    return { sampleRate: SR, ep: chosenEp, stems };
  }

  // 2-stem: instrumental model predicts the instrumental; vocals = mix - inst.
  report(0.02, 'Cargando modelo');
  const { channels: inst, ep: used } = await runModel(L, R, mp('inst_hq3'), MODELS.inst_hq3, chosenEp,
    (lf) => report(0.02 + 0.9 * lf, 'Separando'));
  chosenEp = used;
  report(0.94, 'Reconstruyendo');
  const vocL = new Float32Array(L.length), vocR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) { vocL[i] = L[i] - inst[0][i]; vocR[i] = R[i] - inst[1][i]; }
  report(1, 'Listo');
  return {
    sampleRate: SR, ep: chosenEp,
    stems: [
      { name: 'Instrumental', kind: 'instrumental', channels: inst },
      { name: 'Voces',        kind: 'vocals',       channels: [vocL, vocR] },
    ],
  };
}

module.exports = { separate, SR, MODELS };
