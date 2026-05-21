// 4-stem POC using the kuielab_a MDX models (vocals/drums/bass/other).
// Each model predicts one source directly; params per the official
// kuielab mdx-net-submission: dim_f=2048, dim_t=256, hop=1024,
// n_fft = vocals 6144 / drums 4096 / other 8192 / bass 16384.
//
//   node separate4.js <input.mp3|wav> [--seconds N] [--ep cpu|dml] [--stems v,d,b,o]

import * as ort from 'onnxruntime-node';
import wav from 'node-wav';
import { FFTR } from 'kissfft-js';
import { MPEGDecoder } from 'mpg123-decoder';
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100, HOP = 1024, DIM_F = 2048, DIM_T = 512;
const MODELS = {
  v: { file: 'kuielab_a_vocals.onnx', nfft: 6144,  label: 'vocals' },
  d: { file: 'kuielab_a_drums.onnx',  nfft: 4096,  label: 'drums'  },
  b: { file: 'kuielab_a_bass.onnx',   nfft: 16384, label: 'bass'   },
  o: { file: 'kuielab_a_other.onnx',  nfft: 8192,  label: 'other'  },
};

const args = process.argv.slice(2);
const inPath = args[0];
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const maxSeconds = Number(flag('--seconds', 0)) || 0;
const ep = String(flag('--ep', 'cpu'));
const which = String(flag('--stems', 'v,d,b,o')).split(',');

function hann(N) { const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); return w; }

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

async function decode(file) {
  if (path.extname(file).toLowerCase() === '.mp3') {
    const dec = new MPEGDecoder(); await dec.ready;
    const { channelData, sampleRate } = dec.decode(new Uint8Array(fs.readFileSync(file))); dec.free();
    return { channelData, sampleRate };
  }
  const d = wav.decode(fs.readFileSync(file)); return { channelData: d.channelData, sampleRate: d.sampleRate };
}

async function separateStem(L, R, model) {
  const { nfft } = model;
  const sL = stft(L, nfft), sR = stft(R, nfft);
  const nF = sL.nF, NB = sL.NB;
  const session = await ort.InferenceSession.create(path.join('models', model.file), { executionProviders: [ep] });
  const oReL = new Float32Array(NB * nF), oImL = new Float32Array(NB * nF), oReR = new Float32Array(NB * nF), oImR = new Float32Array(NB * nF);
  const wsum = new Float32Array(nF);
  const fw = hann(DIM_T);
  const step = Math.round(DIM_T * 0.75);
  const inBuf = new Float32Array(4 * DIM_F * DIM_T);
  const starts = []; for (let s = 0; s < nF; s += step) { starts.push(s); if (s + DIM_T >= nF) break; }
  for (const s of starts) {
    inBuf.fill(0);
    for (let bf = 0; bf < DIM_F; bf++) for (let t = 0; t < DIM_T; t++) {
      const f = s + t; if (f >= nF) continue; const si = bf * nF + f;
      inBuf[(0 * DIM_F + bf) * DIM_T + t] = sL.re[si];
      inBuf[(1 * DIM_F + bf) * DIM_T + t] = sL.im[si];
      inBuf[(2 * DIM_F + bf) * DIM_T + t] = sR.re[si];
      inBuf[(3 * DIM_F + bf) * DIM_T + t] = sR.im[si];
    }
    const res = await session.run({ input: new ort.Tensor('float32', inBuf, [1, 4, DIM_F, DIM_T]) });
    const out = res.output.data;
    for (let t = 0; t < DIM_T; t++) {
      const f = s + t; if (f >= nF) break; const w = fw[t]; wsum[f] += w;
      for (let bf = 0; bf < DIM_F; bf++) {
        const si = bf * nF + f;
        oReL[si] += out[(0 * DIM_F + bf) * DIM_T + t] * w;
        oImL[si] += out[(1 * DIM_F + bf) * DIM_T + t] * w;
        oReR[si] += out[(2 * DIM_F + bf) * DIM_T + t] * w;
        oImR[si] += out[(3 * DIM_F + bf) * DIM_T + t] * w;
      }
    }
  }
  await session.release?.();
  for (let f = 0; f < nF; f++) { const w = wsum[f] || 1; for (let b = 0; b < DIM_F; b++) { const i = b * nF + f; oReL[i] /= w; oImL[i] /= w; oReR[i] /= w; oImR[i] /= w; } }
  return [istft(oReL, oImL, nF, NB, nfft, L.length), istft(oReR, oImR, nF, NB, nfft, R.length)];
}

async function main() {
  const dec = await decode(inPath);
  let L = Float32Array.from(dec.channelData[0]);
  let R = dec.channelData[1] ? Float32Array.from(dec.channelData[1]) : L.slice();
  if (dec.sampleRate !== SR) { const r = (s) => { const o = new Float32Array(Math.floor(s.length * SR / dec.sampleRate)); for (let i = 0; i < o.length; i++) { const x = i * dec.sampleRate / SR, i0 = Math.floor(x), fr = x - i0; o[i] = (s[i0] || 0) * (1 - fr) + (s[i0 + 1] || 0) * fr; } return o; }; L = r(L); R = r(R); }
  if (maxSeconds > 0) { L = L.subarray(0, maxSeconds * SR); R = R.subarray(0, maxSeconds * SR); }
  console.log(`audio ${(L.length / SR).toFixed(1)}s, ep=${ep}, stems=${which.join(',')}`);
  const base = inPath.replace(/\.[^.]+$/, '');
  for (const key of which) {
    const m = MODELS[key]; if (!m) continue;
    const t0 = Date.now();
    const [sl, sr] = await separateStem(L, R, m);
    fs.writeFileSync(`${base}_${m.label}.wav`, wav.encode([sl, sr], { sampleRate: SR, float: false, bitDepth: 16 }));
    console.log(`  ${m.label}: ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${base}_${m.label}.wav`);
  }
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
