// ─────────────────────────────────────────────────────────────────────────
// Secciones desde la pista GUÍA: la guía de un multitrack dice en voz alta
// «Verse one», «Chorus», «Puente»… un compás antes de cada sección. Aquí se
// buscan los tramos con voz (energía) y cada uno se transcribe con Whisper base
// (OpenAI, licencia MIT; exportación ONNX de onnx-community) en onnxruntime-node,
// el mismo motor que la separación de stems. Sin binarios extra ni internet
// (salvo bajar el modelo la primera vez: ~75 MB).
//
//   speechRegions(pcm16k)          → [{ start, end }] (s) tramos con voz
//   logMel(pcm16k)                 → Float32Array [80 × 3000] (entrada de Whisper)
//   transcribeRegions(pcm, dir)    → [{ t, end, text, lang }]
// La interpretación del texto («coro dos» → Coro 2) y el ajuste al compás están
// en src/js/stems/guideCuesCore.js. Probado en tests/whisper.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const SR = 16000, N_FFT = 400, HOP = 160, N_MELS = 80, N_SAMPLES = 480000, N_FRAMES = 3000;
const T = { EOT: 50257, SOT: 50258, EN: 50259, ES: 50262, TRANSCRIBE: 50359, NO_TS: 50363 };
const LANGS = { en: T.EN, es: T.ES };

// Lo que dicen las guías: [frase, sección (id de src/js/stems/sectionCatalog.js) o null si no es
// una sección (cuentas «one, two, three, four», etc.), tokens de Whisper]. Se generan con el
// tokenizador de Whisper (scripts aparte); cada frase empieza con espacio, como tras el prompt.
const PHRASES = [
  ["Intro","intro",[47406]],
  ["Introducción","intro",[27193,14735]],
  ["Verso","verso",[12226,78]],
  ["Verso uno","verso-1",[12226,78,8526]],
  ["Verso 1","verso-1",[12226,78,502]],
  ["Primer verso","verso-1",[2114,9713,49786]],
  ["Verso dos","verso-2",[12226,78,4491]],
  ["Verso 2","verso-2",[12226,78,568]],
  ["Segundo verso","verso-2",[21595,6043,49786]],
  ["Verso tres","verso-3",[12226,78,15890]],
  ["Verso 3","verso-3",[12226,78,805]],
  ["Verso cuatro","verso-4",[12226,78,28795]],
  ["Estrofa","verso",[4410,340,11771]],
  ["Pre coro","pre-coro",[6001,1181,78]],
  ["Precoro","pre-coro",[6001,66,10780]],
  ["Coro","coro",[3925,78]],
  ["Coro dos","coro-2",[3925,78,4491]],
  ["Coro tres","coro-3",[3925,78,15890]],
  ["Estribillo","coro",[4410,2024,15831]],
  ["Post coro","post-coro",[10223,1181,78]],
  ["Puente","puente",[13605,1576]],
  ["Puente dos","puente-2",[13605,1576,4491]],
  ["Solo","solo",[26452]],
  ["Interludio","interludio",[5751,1471,1004]],
  ["Instrumental","interludio",[39785,43311]],
  ["Vamp","vamp",[38796]],
  ["Tag","tag",[11204]],
  ["Repetimos","tag",[3696,302,8372]],
  ["Otra vez","tag",[12936,424,5715]],
  ["Final","ending",[13443]],
  ["Outro","outro",[5925,340]],
  ["Entra batería","drums-in",[3951,424,25735,2686]],
  ["Todos","all-in",[35447]],
  ["Toda la banda","all-in",[2465,64,635,38727]],
  ["Pausa","break",[3426,20318]],
  ["Sube","build",[318,1977]],
  ["Subimos","build",[8511,8372]],
  ["Bajamos","breakdown",[363,1805,2151]],
  ["Suave","softly",[2746,946]],
  ["Última vez","last-time",[690,248,2282,4775,5715]],
  ["Modulación","key-up",[6583,425,3482]],
  ["Cambio de tono","key-up",[29287,1004,368,2952,78]],
  ["A capella","a-capella",[316,30414,3505]],
  ["Verse","verso",[31640]],
  ["Verse one","verso-1",[31640,472]],
  ["Verse 1","verso-1",[31640,502]],
  ["Verse two","verso-2",[31640,732]],
  ["Verse 2","verso-2",[31640,568]],
  ["Verse three","verso-3",[31640,1045]],
  ["Verse 3","verso-3",[31640,805]],
  ["Verse four","verso-4",[31640,1451]],
  ["Pre chorus","pre-coro",[6001,22632]],
  ["Pre-chorus","pre-coro",[6001,12,339,26867]],
  ["Chorus","coro",[761,26867]],
  ["Chorus two","coro-2",[761,26867,732]],
  ["Chorus three","coro-3",[761,26867,1045]],
  ["Refrain","coro",[16957,7146]],
  ["Post chorus","post-coro",[10223,22632]],
  ["Bridge","puente",[18917]],
  ["Bridge two","puente-2",[18917,732]],
  ["Interlude","interludio",[5751,32334]],
  ["Turnaround","interludio",[7956,25762]],
  ["Breakdown","breakdown",[16925,5093]],
  ["Down","breakdown",[9506]],
  ["Ending","ending",[6967,278]],
  ["End","ending",[6967]],
  ["Drums in","drums-in",[2491,8099,294]],
  ["All in","all-in",[1057,294]],
  ["Everybody","all-in",[7646]],
  ["Break","break",[16925]],
  ["Hits","break",[389,1208]],
  ["Build","build",[11875]],
  ["Last time","last-time",[5264,565]],
  ["Key change","key-up",[12759,1319]],
  ["Acapella","a-capella",[316,4747,3505]],
  ["Softly","softly",[16985,356]],
  ["One, two, three, four",null,[1485,11,732,11,1045,11,1451]],
  ["One",null,[1485]],
  ["Two",null,[4453]],
  ["Three",null,[6244]],
  ["Four",null,[7451]],
  ["Uno, dos, tres, cuatro",null,[37468,11,4491,11,15890,11,28795]],
  ["Uno",null,[37468]],
  ["Dos",null,[33474]],
  ["Tres",null,[314,495]],
  ["Cuatro",null,[13205,14629]],
  ["Thank you",null,[1044,291]],
  ["Gracias",null,[26909]],
  ["Aleluya",null,[9366,2781,3016]],
  ["Hallelujah",null,[32359]],
  ["Amén",null,[2012,3516]],
  ["Amen",null,[14092]],
  ["Gloria",null,[34288]],
  ["Glory",null,[28524]],
  ["Santo",null,[49639]],
  ["Holy",null,[6295]],
  ["Jesús",null,[47710]],
  ["Jesus",null,[2705]],
  ["Yeah",null,[865]],
  ["Oh",null,[876]],
  ["Vamos",null,[10894]],
  ["Come on",null,[2492,322]],
];

// ── Banco de filtros mel (como librosa: escala de Slaney, normalización «slaney») ──
function hzToMel(f) {
  const fMin = 0, fSp = 200 / 3, minLogHz = 1000, minLogMel = (minLogHz - fMin) / fSp, logStep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logStep : (f - fMin) / fSp;
}
function melToHz(m) {
  const fMin = 0, fSp = 200 / 3, minLogHz = 1000, minLogMel = (minLogHz - fMin) / fSp, logStep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logStep * (m - minLogMel)) : fMin + fSp * m;
}
let FILTERS = null;
function melFilters() {
  if (FILTERS) return FILTERS;
  const nBins = N_FFT / 2 + 1;
  const fftFreqs = Array.from({ length: nBins }, (_, i) => (i * SR) / N_FFT);
  const mMin = hzToMel(0), mMax = hzToMel(SR / 2);
  const melPts = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  const out = new Float32Array(N_MELS * nBins);
  for (let m = 0; m < N_MELS; m++) {
    const lo = melPts[m], ce = melPts[m + 1], hi = melPts[m + 2];
    const enorm = 2 / (hi - lo);
    for (let k = 0; k < nBins; k++) {
      const f = fftFreqs[k];
      const w = Math.max(0, Math.min((f - lo) / (ce - lo), (hi - f) / (hi - ce)));
      out[m * nBins + k] = w * enorm;
    }
  }
  FILTERS = out;
  return out;
}

let TRIG = null;
function trig() {
  if (TRIG) return TRIG;
  const nBins = N_FFT / 2 + 1;
  const cos = new Float32Array(nBins * N_FFT), sin = new Float32Array(nBins * N_FFT);
  for (let k = 0; k < nBins; k++) for (let n = 0; n < N_FFT; n++) { const a = (2 * Math.PI * k * n) / N_FFT; cos[k * N_FFT + n] = Math.cos(a); sin[k * N_FFT + n] = Math.sin(a); }
  const win = new Float32Array(N_FFT);
  for (let n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);   // Hann periódica
  TRIG = { cos, sin, win };
  return TRIG;
}

/** Espectrograma log-mel de Whisper para (hasta) 30 s de audio a 16 kHz → Float32Array [80 × 3000]. */
function logMel(pcm) {
  const x = new Float32Array(N_SAMPLES);
  x.set(pcm.subarray(0, Math.min(pcm.length, N_SAMPLES)));
  const used = Math.min(N_FRAMES, Math.ceil(Math.min(pcm.length, N_SAMPLES) / HOP) + 3);
  const { cos, sin, win } = trig();
  const F = melFilters();
  const nBins = N_FFT / 2 + 1;
  const mel = new Float32Array(N_MELS * N_FRAMES).fill(-10);   // log10(1e-10): lo que es silencio de relleno
  const frame = new Float32Array(N_FFT), power = new Float32Array(nBins);
  const pad = N_FFT / 2;
  const at = (i) => { let j = i - pad; if (j < 0) j = -j; if (j >= N_SAMPLES) j = 2 * (N_SAMPLES - 1) - j; return x[j]; };   // relleno «reflect»
  for (let f = 0; f < used; f++) {
    const o = f * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = at(o + n) * win[n];
    for (let k = 0; k < nBins; k++) {
      let re = 0, im = 0;
      const b = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) { re += frame[n] * cos[b + n]; im -= frame[n] * sin[b + n]; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      const b = m * nBins;
      for (let k = 0; k < nBins; k++) s += F[b + k] * power[k];
      mel[m * N_FRAMES + f] = Math.log10(Math.max(s, 1e-10));
    }
  }
  let max = -Infinity;
  for (let i = 0; i < mel.length; i++) if (mel[i] > max) max = mel[i];
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], max - 8) + 4) / 4;
  return mel;
}

/**
 * Log-mel (sin normalizar) de TODA la pista, una vez: { data: [80 × n], n }. Para probar
 * muchas ventanas que empiezan en sitios distintos sin recalcularlo (melWindow).
 */
function melFull(pcm) {
  const n = Math.ceil(pcm.length / HOP) + 1;
  const { cos, sin, win } = trig();
  const F = melFilters();
  const nBins = N_FFT / 2 + 1;
  const data = new Float32Array(N_MELS * n);
  const frame = new Float32Array(N_FFT), power = new Float32Array(nBins);
  const pad = N_FFT / 2, L = pcm.length;
  const at = (i) => { let j = i - pad; if (j < 0) j = -j; if (j >= L) j = Math.max(0, 2 * (L - 1) - j); return pcm[j] || 0; };
  for (let f = 0; f < n; f++) {
    const o = f * HOP;
    for (let k = 0; k < N_FFT; k++) frame[k] = at(o + k) * win[k];
    for (let k = 0; k < nBins; k++) {
      let re = 0, im = 0;
      const b = k * N_FFT;
      for (let q = 0; q < N_FFT; q++) { re += frame[q] * cos[b + q]; im -= frame[q] * sin[b + q]; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      const b = m * nBins;
      for (let k = 0; k < nBins; k++) s += F[b + k] * power[k];
      data[m * n + f] = Math.log10(Math.max(s, 1e-10));
    }
  }
  return { data, n };
}
/** Ventana de 30 s de melFull que empieza en el bloque f0 (10 ms), normalizada como logMel. */
function melWindow(full, f0) {
  const mel = new Float32Array(N_MELS * N_FRAMES).fill(-10);
  const cnt = Math.max(0, Math.min(N_FRAMES, full.n - f0));
  for (let m = 0; m < N_MELS; m++) mel.set(full.data.subarray(m * full.n + f0, m * full.n + f0 + cnt), m * N_FRAMES);
  let max = -Infinity;
  for (let i = 0; i < mel.length; i++) if (mel[i] > max) max = mel[i];
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], max - 8) + 4) / 4;
  return mel;
}

/**
 * Tramos con voz: energía cada 20 ms por encima de un umbral relativo. Se ignoran
 * los golpes cortos (un click que se cuele) y se juntan los tramos cercanos.
 */
function speechRegions(pcm, { minDur = 0.18, gap = 0.45, maxDur = 9 } = {}) {
  const hop = Math.round(0.02 * SR), n = Math.floor(pcm.length / hop);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(e / hop);
    if (rms[f] > peak) peak = rms[f];
  }
  if (!(peak > 1e-4)) return [];
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.2)] || 0;
  const thr = Math.max(peak * 0.08, floor * 4, 0.003);
  const raw = [];
  let s = -1;
  for (let f = 0; f <= n; f++) {
    const on = f < n && rms[f] >= thr;
    if (on && s < 0) s = f;
    if (!on && s >= 0) { raw.push({ start: s * 0.02, end: f * 0.02 }); s = -1; }
  }
  const merged = [];
  // Fuera los golpes sueltos (un click dura ~12 ms; una sílaba bastante más).
  for (const r of raw.filter((x) => x.end - x.start >= 0.06)) {
    const p = merged[merged.length - 1];
    if (p && r.start - p.end < gap && r.end - p.start <= maxDur) p.end = r.end; else merged.push({ ...r });
  }
  return merged.filter((r) => r.end - r.start >= minDur);
}

// ── Texto: tokens → cadena (BPE a nivel de bytes, como GPT-2) ──
let BYTE_DEC = null;
function byteDecoder() {
  if (BYTE_DEC) return BYTE_DEC;
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  BYTE_DEC = new Map(cs.map((c, i) => [String.fromCharCode(c), bs[i]]));
  return BYTE_DEC;
}
function decodeTokens(ids, vocabInv) {
  const dec = byteDecoder();
  const bytes = [];
  for (const id of ids) {
    const tok = vocabInv[id];
    if (tok == null) continue;
    for (const ch of tok) { const b = dec.get(ch); if (b != null) bytes.push(b); }
  }
  return Buffer.from(bytes).toString('utf8').trim();
}

// ── Modelo ──
// Un juego de sesiones por tamaño (base y small pueden usarse en el mismo trabajo).
// Hilos: se dejan núcleos libres para que la app y el audio no lo noten (LP_WHISPER_THREADS
// lo fija; el hilo de trabajo lo pone según el equipo).
const cacheBy = new Map();
function threadCount() {
  const env = Number(process.env.LP_WHISPER_THREADS);
  if (env > 0) return env;
  const n = require('os').cpus().length || 4;
  return Math.max(2, Math.min(8, n - 2));
}
async function load(dir, size = 'base') {
  const key = dir + '|' + size;
  if (cacheBy.has(key)) return cacheBy.get(key);
  const ort = require('onnxruntime-node');
  const opts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: threadCount(), interOpNumThreads: 1 };
  const enc = await ort.InferenceSession.create(path.join(dir, `whisper_${size}_encoder_q8.onnx`), opts);
  const dec = await ort.InferenceSession.create(path.join(dir, `whisper_${size}_decoder_q8.onnx`), opts);
  // Decodificador con caché (opcional): para transcribir, cada ficha nueva cuesta ~17 ms en
  // vez de volver a pasar toda la frase.
  const pastFile = path.join(dir, `whisper_${size}_decoder_past_q8.onnx`);
  const decPast = fs.existsSync(pastFile) ? await ort.InferenceSession.create(pastFile, opts) : null;
  const vocab = JSON.parse(fs.readFileSync(path.join(dir, 'whisper_vocab.json'), 'utf8'));
  const vocabInv = [];
  for (const [k, v] of Object.entries(vocab)) vocabInv[v] = k;
  const m = { dir, size, ort, enc, dec, decPast, vocabInv };
  cacheBy.set(key, m);
  return m;
}

/**
 * Decodificación paso a paso con caché: start(ids) pasa el comienzo; step(tok) añade una
 * ficha. Ambos devuelven la fila de logits de la última posición. Sin decPast, vuelve a
 * pasar la secuencia entera (como antes).
 */
function stepper(m, hidden) {
  let ids = [], encKV = null, decKV = null;
  const row = (logits, pos) => { const V = logits.dims[2]; return logits.data.subarray(pos * V, (pos + 1) * V); };
  const keep = (out, which) => { const o = {}; for (const k of Object.keys(out)) if (k.startsWith('present.') && k.includes(which)) o['past_key_values.' + k.slice(8)] = out[k]; return o; };
  return {
    async start(first) {
      ids = first.slice();
      const out = await m.dec.run({ input_ids: new m.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]), encoder_hidden_states: hidden });
      if (m.decPast) { encKV = keep(out, '.encoder.'); decKV = keep(out, '.decoder.'); }
      return row(out.logits, ids.length - 1);
    },
    async step(tok) {
      ids.push(tok);
      if (!m.decPast) { const lg = await runDecoder(m, ids, hidden); return row(lg, ids.length - 1); }
      const out = await m.decPast.run({ input_ids: new m.ort.Tensor('int64', BigInt64Array.from([BigInt(tok)]), [1, 1]), ...encKV, ...decKV });
      decKV = keep(out, '.decoder.');
      return row(out.logits, 0);
    },
  };
}

async function runDecoder(m, ids, hidden) {
  const input = new m.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const out = await m.dec.run({ input_ids: input, encoder_hidden_states: hidden });
  return out.logits;   // [1, ids.length, V]
}
/** log-softmax de una fila (posición) de los logits → función id → log-probabilidad. */
function logProbsAt(logits, pos) {
  const V = logits.dims[2];
  const row = logits.data.subarray(pos * V, (pos + 1) * V);
  let max = -Infinity;
  for (let i = 0; i < V; i++) if (row[i] > max) max = row[i];
  let sum = 0;
  for (let i = 0; i < V; i++) sum += Math.exp(row[i] - max);
  const lse = max + Math.log(sum);
  return (id) => row[id] - lse;
}

async function encodeClip(m, clip) {
  const feats = new m.ort.Tensor('float32', logMel(clip), [1, N_MELS, N_FRAMES]);
  return (await m.enc.run({ input_features: feats })).last_hidden_state;
}

/**
 * Qué frase de la lista dice el tramo: se puntúa cada candidata (log-probabilidad media de
 * sus tokens + el fin) y gana la mejor. Para ir rápido, solo se puntúan entera las 10 cuya
 * primera palabra es más probable. → { phrase, key, score }
 */
async function classifyClip(m, hidden, langTok, { top = 10 } = {}) {
  const prompt = [T.SOT, langTok, T.TRANSCRIBE, T.NO_TS];
  const first = logProbsAt(await runDecoder(m, prompt, hidden), prompt.length - 1);
  const ranked = PHRASES.map((p, i) => [i, first(p[2][0])]).sort((a, b) => b[1] - a[1]).slice(0, top);
  const scored = [];
  for (const [i] of ranked) {
    const [phrase, key, toks] = PHRASES[i];
    const logits = await runDecoder(m, prompt.concat(toks), hidden);
    let s = 0;
    for (let j = 0; j < toks.length; j++) s += logProbsAt(logits, prompt.length - 1 + j)(toks[j]);
    s += logProbsAt(logits, prompt.length - 1 + toks.length)(T.EOT);
    scored.push({ phrase, key, score: s / (toks.length + 1) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Un número suelto («Cuatro», «Two») solo es una cuenta si hay más números pegados; un aviso
// aislado que «suena a número» suele ser una sección corta mal oída («Coro» ↔ «Cuatro»).
const COUNT_WORD = /^(one|two|three|four|uno|dos|tres|cuatro)$/i;
function pickBest(cands, isolated, minScore) {
  const best = cands[0];
  if (!best) return null;
  if (isolated && best.key == null && COUNT_WORD.test(best.phrase)) {
    const sec = cands.find((c) => c.key);
    if (sec && sec.score >= minScore - 0.5 && best.score - sec.score < 0.4) return sec;
  }
  return best;
}

/**
 * pcm: Float32Array mono a 16 kHz de la pista guía. dir: carpeta con los modelos.
 * → [{ t, end, phrase, key, score, lang }] un elemento por frase reconocida con confianza.
 * El idioma se decide con TODAS las frases (una palabra suelta como «Coro» engaña sola).
 */
async function transcribeRegions(pcm, dir, { onProgress = null, shouldCancel = null, minScore = -3.1 } = {}) {
  const m = await load(dir);
  const regions = speechRegions(pcm).slice(0, 120);
  const hiddens = [];
  let es = 0, en = 0;
  for (let i = 0; i < regions.length; i++) {
    if (shouldCancel && shouldCancel()) return [];
    const r = regions[i];
    const a = Math.max(0, Math.floor((r.start - 0.12) * SR)), b = Math.min(pcm.length, Math.ceil((r.end + 0.25) * SR));
    const h = await encodeClip(m, pcm.subarray(a, b));
    hiddens.push(h);
    const lp = logProbsAt(await runDecoder(m, [T.SOT], h), 0);
    es += lp(T.ES); en += lp(T.EN);
    if (onProgress) onProgress(0.4 * (i + 1) / regions.length);
  }
  const langTok = es > en ? T.ES : T.EN;
  const out = [];
  for (let i = 0; i < regions.length; i++) {
    if (shouldCancel && shouldCancel()) break;
    const cands = await classifyClip(m, hiddens[i], langTok);
    hiddens[i] = null;
    const isolated = !regions.some((o, j) => j !== i && (Math.abs(o.start - regions[i].end) < 1.0 || Math.abs(regions[i].start - o.end) < 1.0));
    const best = pickBest(cands, isolated, minScore);
    if (process.env.LP_WHISPER_DEBUG) console.log("  [guía]", regions[i].start.toFixed(2), best && best.phrase, best && best.score.toFixed(2), isolated ? "aislado" : "", cands.slice(0, 3).map((c) => c.phrase + " " + c.score.toFixed(2)).join(" | "));
    if (best && best.score >= minScore - (best === cands[0] ? 0 : 0.5)) out.push({ t: regions[i].start, end: regions[i].end, phrase: best.phrase, key: best.key, score: Math.round(best.score * 100) / 100, lang: langTok === T.ES ? 'es' : 'en' });
    if (onProgress) onProgress(0.4 + 0.6 * (i + 1) / regions.length);
  }
  return out;
}

const WHISPER_FILES = ['whisper_base_encoder_q8.onnx', 'whisper_base_decoder_q8.onnx', 'whisper_vocab.json'];

// ── Transcribir una voz cantada (letra automática) ─────────────────────────
// Ventanas de 30 s con marcas de tiempo (las reglas de Whisper: las marcas van en pares y
// no retroceden; si la probabilidad de «marca» supera a la del mejor texto, va marca).
// Con el decodificador con caché (si está) cada ficha nueva es barata.
const TS_BEGIN = 50364, TS_STEP = 0.02;
async function transcribeWindow(m, clip, langTok, { maxTokens = 110, mel = null } = {}) {
  const feats = new m.ort.Tensor('float32', mel || logMel(clip), [1, N_MELS, N_FRAMES]);
  const hidden = (await m.enc.run({ input_features: feats })).last_hidden_state;
  const dec = stepper(m, hidden);
  const out = [];
  let lastTs = -1;
  let row = await dec.start([T.SOT, langTok, T.TRANSCRIBE]);
  for (let i = 0; i < maxTokens; i++) {
    const V = row.length;
    const prev = out[out.length - 1], prev2 = out[out.length - 2];
    const lastWasTs = prev != null && prev >= TS_BEGIN, penultWasTs = prev2 == null || prev2 >= TS_BEGIN;
    // Reglas de marcas de Whisper: empieza con marca; tras «marca marca» (par cerrado) va texto;
    // tras «texto marca» va otra marca (cierra) o el fin; las marcas no retroceden.
    const mustTs = out.length === 0;
    const allowText = !mustTs && !(lastWasTs && !penultWasTs);
    const allowTs = mustTs || !(lastWasTs && penultWasTs);
    const allowEot = !mustTs;
    const minTs = lastTs < 0 ? TS_BEGIN : TS_BEGIN + lastTs;
    let bestText = -1, btv = -Infinity, bestTs = -1, bts = -Infinity, lseTs = -Infinity;
    for (let k = 0; k < V; k++) {
      const v = row[k];
      if (k < T.EOT) { if (allowText && v > btv) { btv = v; bestText = k; } }
      else if (k === T.EOT) { if (allowEot && v > btv) { btv = v; bestText = k; } }
      else if (k >= TS_BEGIN && allowTs && k >= minTs) {
        if (v > bts) { bts = v; bestTs = k; }
        lseTs = lseTs === -Infinity ? v : Math.max(lseTs, v) + Math.log1p(Math.exp(-Math.abs(lseTs - v)));
      }
    }
    let tok;
    if (mustTs) tok = bestTs;
    else if (bestTs >= 0 && (bestText < 0 || lseTs > btv)) tok = bestTs;
    else tok = bestText;
    if (tok < 0 || tok === T.EOT) break;
    if (tok >= TS_BEGIN) lastTs = tok - TS_BEGIN;
    out.push(tok);
    if (out.length >= 12) {   // bucles («aleluya aleluya aleluya…» sin fin)
      const a = out.slice(-6).join(), b = out.slice(-12, -6).join();
      if (a === b) break;
    }
    row = await dec.step(tok);
  }
  // Pares [marca, texto…, marca] → segmentos
  const segs = [];
  let start = null, text = [];
  for (const t of out) {
    if (t >= TS_BEGIN) {
      const sec = (t - TS_BEGIN) * TS_STEP;
      if (start == null) { start = sec; text = []; }
      else { if (text.length) segs.push({ t0: start, t1: sec, ids: text }); start = null; text = []; }
    } else if (start != null) text.push(t);
  }
  const complete = out.length > 0 && out[out.length - 1] >= TS_BEGIN && start == null;
  return { segs, lastEnd: segs.length ? segs[segs.length - 1].t1 : 0, complete };
}

/**
 * Transcribe una voz (16 kHz mono): → [{ t0, t1, text }] por frase. lang: 'es' | 'en' | null (detecta).
 * Avanza de ventana en ventana empezando donde terminó la última frase completa.
 */
async function transcribeLong(pcm, dir, { lang = null, size = 'base', onProgress = null, shouldCancel = null } = {}) {
  const m = await load(dir, size);
  const total = pcm.length / SR;
  let langTok = lang ? LANGS[lang] : null;
  if (!langTok) {
    // El idioma, con el primer tramo con voz.
    const r = speechRegions(pcm)[0];
    const a = r ? Math.floor(r.start * SR) : 0;
    const feats = new m.ort.Tensor('float32', logMel(pcm.subarray(a, a + N_SAMPLES)), [1, N_MELS, N_FRAMES]);
    const h = (await m.enc.run({ input_features: feats })).last_hidden_state;
    const lp = logProbsAt(await runDecoder(m, [T.SOT], h), 0);
    langTok = lp(T.ES) > lp(T.EN) ? T.ES : T.EN;
  }
  const out = [];
  let seek = 0;
  const regions = speechRegions(pcm, { gap: 1.2, maxDur: 28 });
  while (seek < total - 0.5) {
    if (shouldCancel && shouldCancel()) break;
    // Saltar silencios largos: empezar en el siguiente tramo con voz.
    const nextVoice = regions.find((r) => r.end > seek + 0.2);
    if (!nextVoice) break;
    if (nextVoice.start > seek + 1) seek = Math.max(seek, nextVoice.start - 0.3);
    const a = Math.floor(seek * SR);
    const w = await transcribeWindow(m, pcm.subarray(a, a + N_SAMPLES), langTok);
    for (const s of w.segs) {
      const text = decodeTokens(s.ids, m.vocabInv);
      if (text && !/^[\s.,¡!¿?♪-]*$/.test(text)) out.push({ t0: Math.round((seek + s.t0) * 100) / 100, t1: Math.round((seek + s.t1) * 100) / 100, text });
    }
    const adv = w.complete && w.lastEnd > 1 ? w.lastEnd : 30;
    seek += Math.min(30, Math.max(1, adv));
    if (onProgress) onProgress(Math.min(1, seek / total));
  }
  return { lang: langTok === T.ES ? 'es' : 'en', segments: out };
}

module.exports = { SR, N_SAMPLES, N_MELS, N_FRAMES, T, LANGS, TS_BEGIN, TS_STEP, logMel, melFull, melWindow, melFilters, speechRegions, decodeTokens, byteDecoder, load, runDecoder, logProbsAt, transcribeRegions, transcribeLong, WHISPER_FILES, PHRASES };
