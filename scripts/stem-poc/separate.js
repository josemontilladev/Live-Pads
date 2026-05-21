// MDX-Net stem separation POC (no Python). Pipeline ported from the
// reference seanghay/uvr-mdx-infer ConvTDFNet:
//   STFT(n_fft=6144, hop=1024, hann, center) -> [1,4,2048,256] tensor
//   -> ONNX model -> instrumental spectrogram -> iSTFT -> waveform.
// vocals = original - instrumental.
//
// Usage:
//   node separate.js <input.wav> [--seconds N] [--overlap F] [--ep cpu|dml]
//   node separate.js <input.wav> --identity        (DSP round-trip check)
//
// Outputs <input>_instrumental.wav and <input>_vocals.wav next to input.

import * as ort from 'onnxruntime-node';
import wav from 'node-wav';
import { FFTR } from 'kissfft-js';
import { MPEGDecoder } from 'mpg123-decoder';
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const N_FFT = 6144;
const HOP = 1024;
const N_BINS = N_FFT / 2 + 1;   // 3073
const DIM_F = 3072;             // bins the model sees (Inst_HQ_3 = 3072)
const DIM_T = 256;              // time frames per inference window
const MODEL = path.join('models', 'UVR-MDX-NET-Inst_HQ_3.onnx');

// ── arg parsing ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const inPath = args[0];
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const identity = args.includes('--identity');
const maxSeconds = Number(getFlag('--seconds', 0)) || 0;
const overlapFrac = Number(getFlag('--overlap', 0.25));
const ep = String(getFlag('--ep', 'cpu'));

if (!inPath) { console.error('Usage: node separate.js <input.wav> [--seconds N] [--overlap F] [--ep cpu|dml] [--identity]'); process.exit(1); }

// ── hann window (periodic) + cached squared sum ──────────────────
const win = new Float32Array(N_FFT);
for (let n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);

// ── WAV/MP3 load + (linear) resample to 44.1k stereo ─────────────
async function decodeFile(file) {
  if (path.extname(file).toLowerCase() === '.mp3') {
    const dec = new MPEGDecoder();
    await dec.ready;
    const { channelData, sampleRate } = dec.decode(new Uint8Array(fs.readFileSync(file)));
    dec.free();
    return { channelData, sampleRate };
  }
  const d = wav.decode(fs.readFileSync(file));
  return { channelData: d.channelData, sampleRate: d.sampleRate };
}

async function loadAudio(file) {
  const decoded = await decodeFile(file);
  let chs = decoded.channelData.map(c => Float32Array.from(c));
  if (chs.length === 1) chs = [chs[0], Float32Array.from(chs[0])];
  if (chs.length > 2) chs = [chs[0], chs[1]];
  if (decoded.sampleRate !== SR) {
    const ratio = SR / decoded.sampleRate;
    chs = chs.map(src => {
      const out = new Float32Array(Math.floor(src.length * ratio));
      for (let i = 0; i < out.length; i++) {
        const x = i / ratio, i0 = Math.floor(x), frac = x - i0;
        out[i] = (src[i0] ?? 0) * (1 - frac) + (src[i0 + 1] ?? 0) * frac;
      }
      return out;
    });
    console.log(`resampled ${decoded.sampleRate} -> ${SR}`);
  }
  if (maxSeconds > 0) chs = chs.map(c => c.subarray(0, maxSeconds * SR));
  return chs;
}

// ── STFT of one channel -> {re,im}: Float32Array[N_BINS*nFrames] ─
function stft(signal) {
  const pad = N_FFT / 2;
  const L = signal.length;
  const padded = new Float32Array(L + N_FFT);
  // reflect padding to match torch.stft(center=True, pad_mode='reflect')
  for (let i = 0; i < pad; i++) padded[i] = signal[pad - i] ?? 0;
  padded.set(signal, pad);
  for (let i = 0; i < pad; i++) padded[pad + L + i] = signal[L - 2 - i] ?? 0;

  const nFrames = Math.floor(L / HOP) + 1;
  const re = new Float32Array(N_BINS * nFrames);
  const im = new Float32Array(N_BINS * nFrames);
  const fftr = new FFTR(N_FFT);
  const frame = new Float32Array(N_FFT);
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[off + n] * win[n];
    const spec = fftr.forward(frame); // [(N_BINS)*2] interleaved
    for (let b = 0; b < N_BINS; b++) {
      re[b * nFrames + f] = spec[b * 2];
      im[b * nFrames + f] = spec[b * 2 + 1];
    }
  }
  fftr.dispose();
  return { re, im, nFrames, length: L };
}

// ── iSTFT back to a waveform of `length` samples ─────────────────
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
    const time = fftr.inverse(spec); // scaled by N_FFT
    const off = f * HOP;
    for (let n = 0; n < N_FFT; n++) {
      const w = win[n];
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

async function main() {
  console.log(`loading ${inPath} ...`);
  const [L, R] = await loadAudio(inPath);
  const dur = (L.length / SR).toFixed(1);
  console.log(`audio: ${dur}s stereo @ ${SR}Hz (${L.length} samples/ch)`);

  const t0 = Date.now();
  const specL = stft(L);
  const specR = stft(R);
  const nFrames = specL.nFrames;
  console.log(`STFT done: ${nFrames} frames in ${Date.now() - t0}ms`);

  if (identity) {
    const recL = istft(specL.re, specL.im, nFrames, L.length);
    let maxErr = 0;
    for (let i = 0; i < L.length; i++) maxErr = Math.max(maxErr, Math.abs(recL[i] - L[i]));
    console.log(`IDENTITY round-trip max abs error (ch L): ${maxErr.toExponential(3)}`);
    writeWav(outName('roundtrip'), [recL, istft(specR.re, specR.im, nFrames, R.length)]);
    return;
  }

  console.log(`creating session (ep=${ep}) ...`);
  const session = await ort.InferenceSession.create(MODEL, {
    executionProviders: [ep],
  });

  // output instrumental spectrogram accumulators (full N_BINS, zero above DIM_F)
  const outReL = new Float32Array(N_BINS * nFrames);
  const outImL = new Float32Array(N_BINS * nFrames);
  const outReR = new Float32Array(N_BINS * nFrames);
  const outImR = new Float32Array(N_BINS * nFrames);
  const weightSum = new Float32Array(nFrames);

  // frame-domain crossfade weight (hann over DIM_T)
  const fw = new Float32Array(DIM_T);
  for (let i = 0; i < DIM_T; i++) fw[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (DIM_T - 1));

  const step = Math.max(1, Math.round(DIM_T * (1 - overlapFrac)));
  const starts = [];
  for (let s = 0; s < nFrames; s += step) { starts.push(s); if (s + DIM_T >= nFrames) break; }

  const inBuf = new Float32Array(1 * 4 * DIM_F * DIM_T);
  let infMs = 0;
  for (let wi = 0; wi < starts.length; wi++) {
    const s = starts[wi];
    inBuf.fill(0);
    // pack [1,4,DIM_F,DIM_T]: ch0re,ch0im,ch1re,ch1im
    for (let bf = 0; bf < DIM_F; bf++) {
      for (let t = 0; t < DIM_T; t++) {
        const f = s + t;
        if (f >= nFrames) continue;
        const sIdx = bf * nFrames + f;
        const d = bf * DIM_T + t;
        inBuf[(0 * DIM_F + bf) * DIM_T + t] = specL.re[sIdx];
        inBuf[(1 * DIM_F + bf) * DIM_T + t] = specL.im[sIdx];
        inBuf[(2 * DIM_F + bf) * DIM_T + t] = specR.re[sIdx];
        inBuf[(3 * DIM_F + bf) * DIM_T + t] = specR.im[sIdx];
      }
    }
    const tensor = new ort.Tensor('float32', inBuf, [1, 4, DIM_F, DIM_T]);
    const ti = Date.now();
    const res = await session.run({ input: tensor });
    infMs += Date.now() - ti;
    const out = res.output.data; // Float32Array [1,4,DIM_F,DIM_T]

    for (let t = 0; t < DIM_T; t++) {
      const f = s + t;
      if (f >= nFrames) break;
      const w = fw[t];
      weightSum[f] += w;
      for (let bf = 0; bf < DIM_F; bf++) {
        const o = bf * DIM_T + t;
        const sIdx = bf * nFrames + f;
        outReL[sIdx] += out[(0 * DIM_F + bf) * DIM_T + t] * w;
        outImL[sIdx] += out[(1 * DIM_F + bf) * DIM_T + t] * w;
        outReR[sIdx] += out[(2 * DIM_F + bf) * DIM_T + t] * w;
        outImR[sIdx] += out[(3 * DIM_F + bf) * DIM_T + t] * w;
      }
    }
    process.stdout.write(`\r  inference ${wi + 1}/${starts.length}`);
  }
  console.log(`\n  total inference: ${infMs}ms over ${starts.length} windows`);

  // normalize overlapped frames
  for (let f = 0; f < nFrames; f++) {
    const w = weightSum[f] || 1;
    for (let b = 0; b < DIM_F; b++) {
      const i = b * nFrames + f;
      outReL[i] /= w; outImL[i] /= w; outReR[i] /= w; outImR[i] /= w;
    }
  }

  const instL = istft(outReL, outImL, nFrames, L.length);
  const instR = istft(outReR, outImR, nFrames, R.length);
  const vocL = new Float32Array(L.length), vocR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) { vocL[i] = L[i] - instL[i]; vocR[i] = R[i] - instR[i]; }

  writeWav(outName('instrumental'), [instL, instR]);
  writeWav(outName('vocals'), [vocL, vocR]);

  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  const rt = (Number(dur) / Number(wall)).toFixed(2);
  console.log(`DONE in ${wall}s wall  (${rt}x realtime)  — ep=${ep}`);
}

function outName(suffix) {
  const ext = path.extname(inPath);
  return inPath.slice(0, -ext.length) + `_${suffix}.wav`;
}
function writeWav(file, chs) {
  const buf = wav.encode(chs, { sampleRate: SR, float: false, bitDepth: 16 });
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file}`);
}

main().catch(e => { console.error(e); process.exit(1); });
