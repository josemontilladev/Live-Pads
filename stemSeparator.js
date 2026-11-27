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
  d6:       { file: 'htdemucs_6s_fp16weights.onnx' },   // HT-Demucs 6 pistas (STFT dentro del modelo)
  // UVR «karaoke» 2 (MDX-Net): devuelve todo MENOS la voz principal. Pasado por la pista de
  // voces, lo que devuelve son los coros (UVR: compensate 1.065, n_fft 5120, dim_f 2048, dim_t 2^8).
  kara2:    { file: 'UVR_MDXNET_KARA_2.onnx',     nfft: 5120,  dimF: 2048, dimT: 256, compensate: 1.065 },
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
      // En CPU deja 2 núcleos libres: separando, la app sigue sonando y respondiendo.
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep], enableCpuMemArena: false, ...(ep === 'cpu' ? { intraOpNumThreads: Math.max(1, (require('os').cpus().length || 4) - 2), interOpNumThreads: 1 } : {}) });
      return { session, ep };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No execution provider available');
}

function cancelledError() { const e = new Error('Separación cancelada'); e.cancelled = true; return e; }

// Run one MDX model over the whole signal, returning the source [L,R].
// `onEp` (opcional) se llama con el execution provider real (dml/cpu) APENAS se
// crea la sesión, para avisar al UI si está usando GPU o CPU desde el principio.
async function runModel(L, R, modelPath, cfg, ep, onLocal, shouldCancel, onEp) {
  const { nfft, dimF, dimT } = cfg;
  const sL = stft(L, nfft), sR = stft(R, nfft);
  const nF = sL.nF, NB = sL.NB;
  const { session, ep: usedEp } = await createSession(modelPath, ep);
  if (onEp) { try { onEp(usedEp); } catch (_) {} }

  const oReL = new Float32Array(NB * nF), oImL = new Float32Array(NB * nF);
  const oReR = new Float32Array(NB * nF), oImR = new Float32Array(NB * nF);
  const wsum = new Float32Array(nF);
  const fw = hann(dimT);
  const step = Math.max(1, Math.round(dimT * 0.75));
  const starts = [];
  for (let s = 0; s < nF; s += step) { starts.push(s); if (s + dimT >= nF) break; }
  const inBuf = new Float32Array(4 * dimF * dimT);

  for (let wi = 0; wi < starts.length; wi++) {
    if (shouldCancel && shouldCancel()) { await session.release?.(); throw cancelledError(); }
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

// ── HT-Demucs 6 pistas (voz, batería, bajo, guitarra, piano, otros) ──────────
// Modelo ONNX con la STFT dentro: entra la onda estéreo a 44,1 kHz en trozos de
// 7,8 s ('mix' [1, 2, 343980]) y salen las 6 fuentes ('stems' [1, 6, 2, 343980]) en
// el orden drums, bass, other, vocals, guitar, piano. Trozos solapados un 25 % con
// fundido lineal (como el infer.py de referencia), sin fundir el principio de la
// canción ni el final (si no, esas muestras quedarían en cero).
const D6_N = 343980;
const D6_SOURCES = [
  { name: 'Batería', kind: 'drums' }, { name: 'Bajo', kind: 'bass' }, { name: 'Otros', kind: 'other' },
  { name: 'Voces', kind: 'vocals' }, { name: 'Guitarra', kind: 'guitar' }, { name: 'Piano', kind: 'keys' },
];
async function runDemucs6(L, R, modelPath, ep, onLocal, shouldCancel, onEp) {
  const total = L.length;
  const overlap = Math.floor(D6_N / 4), stride = D6_N - overlap;
  const nChunks = Math.max(1, Math.ceil(total / stride));
  let { session, ep: usedEp } = await createSession(modelPath, ep);
  if (onEp) { try { onEp(usedEp); } catch (_) {} }
  // La GPU puede quedarse sin memoria con este modelo (≈1 GB): se sigue por CPU sin perder lo hecho.
  const run = async (feeds) => {
    try { return await session.run(feeds); }
    catch (e) {
      if (usedEp === 'cpu') throw e;
      try { await session.release?.(); } catch (_) {}
      ({ session, ep: usedEp } = await createSession(modelPath, 'cpu'));
      if (onEp) { try { onEp(usedEp); } catch (_) {} }
      return session.run(feeds);
    }
  };
  const out = D6_SOURCES.map(() => [new Float32Array(total), new Float32Array(total)]);
  const weight = new Float32Array(total);
  const input = new Float32Array(2 * D6_N);
  for (let c = 0; c < nChunks; c++) {
    if (shouldCancel && shouldCancel()) { await session.release?.(); throw cancelledError(); }
    const start = c * stride;
    if (start >= total) break;
    const len = Math.min(D6_N, total - start);
    input.fill(0);
    input.set(L.subarray(start, start + len), 0);
    input.set(R.subarray(start, start + len), D6_N);
    const res = await run({ mix: new ort.Tensor('float32', input, [1, 2, D6_N]) });
    const st = res.stems.data;   // [6][2][N]
    const first = c === 0, last = start + len >= total;
    for (let i = 0; i < len; i++) {
      let w = 1;
      if (!first && i < overlap) w = i / overlap;
      if (!last && i >= len - overlap && len === D6_N) w = Math.min(w, (len - 1 - i) / overlap);
      if (w <= 0) w = 1e-4;
      weight[start + i] += w;
      for (let s = 0; s < 6; s++) {
        out[s][0][start + i] += st[(s * 2 + 0) * D6_N + i] * w;
        out[s][1][start + i] += st[(s * 2 + 1) * D6_N + i] * w;
      }
    }
    if (onLocal) onLocal((c + 1) / nChunks);
  }
  await session.release?.();
  for (let i = 0; i < total; i++) {
    const w = weight[i] || 1;
    for (let s = 0; s < 6; s++) { out[s][0][i] /= w; out[s][1][i] /= w; }
  }
  return { stems: D6_SOURCES.map((x, s) => ({ name: x.name, kind: x.kind, channels: out[s] })), ep: usedEp };
}

const path = require('path');

// mode: '2stem' | '4stem' | '6stem' | 'otros'. modelsDir: absolute path to the models folder.
async function separate({ channels, sampleRate = SR, mode = '2stem', modelsDir, ep, onProgress, shouldCancel } = {}) {
  let curEp = ep || null;   // execution provider real (se completa al crear la 1ª sesión)
  const report = (frac, stage) => { try { onProgress && onProgress(Math.max(0, Math.min(1, frac)), stage, curEp); } catch (_) {} };
  // Apenas se sabe si es GPU (dml) o CPU, lo emitimos para que el toast lo muestre.
  const onEp = (used) => { curEp = used; report(0.02, used === 'dml' ? 'GPU detectada — separando…' : 'CPU — separando…'); };
  let L = Float32Array.from(channels[0]);
  let R = channels[1] ? Float32Array.from(channels[1]) : Float32Array.from(channels[0]);
  if (sampleRate !== SR) { L = resampleLinear(L, sampleRate, SR); R = resampleLinear(R, sampleRate, SR); }

  const mp = (key) => path.join(modelsDir, MODELS[key].file);
  let chosenEp = ep;

  if (mode === '6stem') {
    report(0.02, 'Cargando modelo');
    const { stems, ep: used } = await runDemucs6(L, R, path.join(modelsDir, MODELS.d6.file), chosenEp,
      (lf) => report(0.02 + 0.96 * lf, 'Separando 6 pistas…'), shouldCancel, onEp);
    chosenEp = used;
    report(1, 'Listo');
    // Voz primero (lo que más se busca), después la base rítmica y los instrumentos.
    const order = ['vocals', 'drums', 'bass', 'guitar', 'keys', 'other'];
    stems.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return { sampleRate: SR, ep: chosenEp, stems };
  }

  // Voz principal y coros (experimental): 1) las voces con el modelo de voces; 2) el modelo
  // karaoke sobre esas voces da los coros; 3) la voz principal = voces − coros.
  if (mode === 'coros') {
    report(0.02, 'Cargando modelo');
    const { channels: voc, ep: used } = await runModel(L, R, mp('k_vocals'), MODELS.k_vocals, chosenEp,
      (lf) => report(0.02 + 0.48 * lf, 'Separando las voces…'), shouldCancel, onEp);
    chosenEp = used;
    if (shouldCancel && shouldCancel()) throw cancelledError();
    const { channels: back } = await runModel(voc[0], voc[1], mp('kara2'), MODELS.kara2, chosenEp,
      (lf) => report(0.5 + 0.46 * lf, 'Separando los coros de la voz principal…'), shouldCancel, onEp);
    const k = MODELS.kara2.compensate || 1;
    const leadL = new Float32Array(voc[0].length), leadR = new Float32Array(voc[1].length);
    for (let i = 0; i < leadL.length; i++) { back[0][i] *= k; back[1][i] *= k; leadL[i] = voc[0][i] - back[0][i]; leadR[i] = voc[1][i] - back[1][i]; }
    report(1, 'Listo');
    return { sampleRate: SR, ep: chosenEp, stems: [
      { name: 'Voz principal', kind: 'vocals', channels: [leadL, leadR] },
      { name: 'Coros', kind: 'vocals', channels: back },
    ] };
  }

  // Solo la voz (modelo kuielab de voces): 2-3 veces más rápido que «Voz / Instrumental»;
  // lo usa el Estudio de voces, que solo necesita oír bien la voz principal.
  if (mode === 'voz') {
    report(0.02, 'Cargando modelo');
    const { channels: ch, ep: used } = await runModel(L, R, mp('k_vocals'), MODELS.k_vocals, chosenEp,
      (lf) => report(0.02 + 0.96 * lf, 'Separando la voz…'), shouldCancel, onEp);
    chosenEp = used;
    report(1, 'Listo');
    return { sampleRate: SR, ep: chosenEp, stems: [{ name: 'Voces', kind: 'vocals', channels: ch }] };
  }

  if (mode === '4stem') {
    const plan = [
      { key: 'k_vocals', name: 'Voces',     kind: 'vocals' },
      { key: 'k_drums',  name: 'Batería',   kind: 'drums'  },
      { key: 'k_bass',   name: 'Bajo',      kind: 'bass'   },
      { key: 'k_other',  name: 'Otros',     kind: 'other'  },
    ];
    const stems = [];
    for (let i = 0; i < plan.length; i++) {
      if (shouldCancel && shouldCancel()) throw cancelledError();
      const p = plan[i];
      report((i) / plan.length, `Separando ${p.name}…`);
      const { channels: ch, ep: used } = await runModel(L, R, mp(p.key), MODELS[p.key], chosenEp,
        (lf) => report((i + lf) / plan.length, `Separando ${p.name}…`), shouldCancel, onEp);
      chosenEp = used; // reuse the EP that worked for the rest
      stems.push({ name: p.name, kind: p.kind, channels: ch });
    }
    report(1, 'Listo');
    return { sampleRate: SR, ep: chosenEp, stems };
  }

  // "Otros": run ONLY the k_other model → a single stem with everything that
  // isn't voice/drums/bass (keyboards, guitars, synths, strings…). ~4× faster
  // than full 4-stem since it runs one model instead of four.
  if (mode === 'otros') {
    report(0.02, 'Cargando modelo');
    const { channels: ch, ep: used } = await runModel(L, R, mp('k_other'), MODELS.k_other, chosenEp,
      (lf) => report(0.02 + 0.95 * lf, 'Separando Otros…'), shouldCancel, onEp);
    chosenEp = used;
    report(1, 'Listo');
    return { sampleRate: SR, ep: chosenEp, stems: [{ name: 'Otros', kind: 'other', channels: ch }] };
  }

  // 2-stem: instrumental model predicts the instrumental; vocals = mix - inst.
  report(0.02, 'Cargando modelo');
  const { channels: inst, ep: used } = await runModel(L, R, mp('inst_hq3'), MODELS.inst_hq3, chosenEp,
    (lf) => report(0.02 + 0.9 * lf, 'Separando'), shouldCancel, onEp);
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

module.exports = { separate, SR, MODELS, runModel };
