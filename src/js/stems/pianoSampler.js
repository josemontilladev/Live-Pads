// Sampler de piano para el panel virtual de Stems.
//
// Usa samples reales de Salamander Grand Piano (CC-BY 3.0, Alexander Holm),
// grabados cada ~3 semitonos. Las notas intermedias se obtienen reproduciendo
// el sample más cercano con playbackRate = 2^(semitonos/12). Suena a piano real
// y pesa pocos MB; todo offline.
//
// Suena por el AudioContext y el master del engine de Stems, así que el piano
// pasa por la misma mezcla/VU y un mismo Esc/pánico lo corta.

import * as engine from './engine.js';

// Bancos de samples por instrumento. name → midi ('s' = sostenido, 'b' = bemol).
// Piano = Salamander (Tone.js); strings = cello y bass = bajo eléctrico (VCSL/CC0,
// tonejs-instruments); rhodes = Electric Piano 1 de FluidR3_GM (MIT, Frank Wen).
// Las notas intermedias se interpolan con playbackRate.
const SAMPLE_BANKS = {
  piano: {
    folder: 'Piano',
    map: [
      ['A0', 21], ['C1', 24], ['Ds1', 27], ['Fs1', 30],
      ['A1', 33], ['C2', 36], ['Ds2', 39], ['Fs2', 42],
      ['A2', 45], ['C3', 48], ['Ds3', 51], ['Fs3', 54],
      ['A3', 57], ['C4', 60], ['Ds4', 63], ['Fs4', 66],
      ['A4', 69], ['C5', 72], ['Ds5', 75], ['Fs5', 78],
      ['A5', 81], ['C6', 84], ['Ds6', 87], ['Fs6', 90],
      ['A6', 93], ['C7', 96], ['Ds7', 99], ['Fs7', 102],
      ['A7', 105], ['C8', 108],
    ],
  },
  rhodes: {
    folder: 'Rhodes',
    map: [
      ['C2', 36], ['Eb2', 39], ['Gb2', 42], ['A2', 45],
      ['C3', 48], ['Eb3', 51], ['Gb3', 54], ['A3', 57],
      ['C4', 60], ['Eb4', 63], ['Gb4', 66], ['A4', 69],
      ['C5', 72], ['Eb5', 75], ['Gb5', 78], ['A5', 81],
      ['C6', 84],
    ],
  },
  strings: {
    folder: 'Strings',
    map: [['C2', 36], ['D2', 38], ['F2', 41], ['A2', 45], ['C3', 48], ['D3', 50], ['F3', 53], ['A3', 57], ['C4', 60], ['D4', 62], ['F4', 65], ['A4', 69], ['C5', 72]],
  },
  bass: {
    folder: 'Bass',
    map: [['As1', 34], ['Cs2', 37], ['E2', 40], ['G2', 43], ['As2', 46], ['Cs3', 49], ['E3', 52], ['G3', 55], ['As3', 58], ['Cs4', 61]],
  },
};

const RELEASE_SEC = 0.32;     // cola al soltar la tecla (curva de piano)
const SAMPLE_RATE = 44100;    // para el render offline
const REVERB_WET = 0.34;      // mezcla del reverb (profundidad)
const REVERB_SEC = 2.6;       // largo de la cola del reverb

const banks = new Map();      // id → { samples: [{midi,buffer}], promise }
let outputGain = null;        // bus del piano (pre-reverb) → master del engine
let pianoVolume = 0.9;        // 0..1, ajustable por el usuario
let reverbWet = REVERB_WET;   // mezcla de reverb actual (toggle = más profundidad)
let liveWet = null;           // nodo wet del reverb en vivo (para ajustarlo)
const activeVoices = new Map(); // midi → { source, gain }
const irCache = new Map();      // sampleRate → AudioBuffer (impulso del reverb)

// Impulso sintético (ruido con decaimiento exponencial) para el ConvolverNode.
// Independiente del contexto salvo por el sample rate, así que se cachea por rate.
function getImpulse(ctx) {
  const rate = ctx.sampleRate;
  if (irCache.has(rate)) return irCache.get(rate);
  const len = Math.floor(REVERB_SEC * rate);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
  }
  irCache.set(rate, ir);
  return ir;
}

// Conecta una fuente de mezcla `bus` a `destination` con dry + wet (reverb).
// Devuelve el nodo wet para poder ajustar la profundidad después.
function wireReverb(ctx, bus, destination) {
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = reverbWet;
  const conv = ctx.createConvolver(); conv.buffer = getImpulse(ctx);
  bus.connect(dry); dry.connect(destination);
  bus.connect(conv); conv.connect(wet); wet.connect(destination);
  return wet;
}
// Toggle de profundidad de reverb (afecta el sonido en vivo y los bounces nuevos).
export function setReverbDeep(on) {
  reverbWet = on ? 0.62 : REVERB_WET;
  if (liveWet) liveWet.gain.value = reverbWet;
}
export function isReverbDeep() { return reverbWet > REVERB_WET + 0.001; }

// ¿El instrumento usa samples (vs sintetizado)?
export function isSampled(id) { return !!SAMPLE_BANKS[id]; }

// Carga + decodifica el banco de un instrumento (idempotente). Para sintéticos
// resuelve de inmediato. `loadSamples()` sin args carga el instrumento actual.
export function loadSamples(id = currentInstrument) {
  const def = SAMPLE_BANKS[id];
  if (!def) return Promise.resolve();
  let bank = banks.get(id);
  if (bank && bank.promise) return bank.promise;
  const ctx = engine.getAudioContext();
  bank = bank || {};
  banks.set(id, bank);
  bank.promise = (async () => {
    const loaded = await Promise.all(def.map.map(async ([name, midi]) => {
      const resp = await fetch(`assets/${def.folder}/${name}.mp3`);
      const ab = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      return { midi, buffer };
    }));
    bank.samples = loaded.sort((a, b) => a.midi - b.midi);
    return bank.samples;
  })();
  return bank.promise;
}

// ¿Listo para sonar? Los sintéticos siempre lo están.
export function isLoaded(id = currentInstrument) {
  if (!SAMPLE_BANKS[id]) return true;
  return !!banks.get(id)?.samples;
}

function ensureOutput() {
  const ctx = engine.getAudioContext();
  if (!outputGain) {
    outputGain = ctx.createGain();
    outputGain.gain.value = pianoVolume;
    // Dry + reverb hacia el master del engine, para un sonido más profundo.
    liveWet = wireReverb(ctx, outputGain, engine.getMasterGain());
  }
  return outputGain;
}

// Sample más cercano (menor distancia en semitonos) dentro de un banco.
function nearestSample(bankSamples, midi) {
  let best = bankSamples[0], bestDist = Infinity;
  for (const s of bankSamples) {
    const d = Math.abs(s.midi - midi);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

// Velocity (0..127) → ganancia perceptual.
function velToGain(velocity) {
  const v = Math.max(0, Math.min(127, velocity)) / 127;
  return Math.pow(v, 1.5);
}
// Velocity → frecuencia de corte del pasa-bajos (capas de velocity emuladas):
// suave = más oscuro/apagado, fuerte = más brillante. 700 Hz → 16 kHz.
function velToCutoff(velocity) {
  const v = Math.max(0, Math.min(127, velocity)) / 127;
  return 700 * Math.pow(16000 / 700, v);
}

export function setVolume(v) {
  pianoVolume = Math.max(0, Math.min(1, v));
  if (outputGain) outputGain.gain.value = pianoVolume;
}

// ── Instrumentos ──────────────────────────────────────────────────
// Piano = samples (arriba). El resto son sintéticos (Web Audio) parametrizados.
const SYNTH = {
  rhodes: { gain: 0.55, osc: [{ type: 'sine', gain: 1 }, { type: 'sine', ratio: 2, gain: 0.3 }], fm: { ratio: 1, depth: 110, decay: 0.5 }, filter: { base: 2200, vel: 5200, q: 0.6 }, adsr: { a: 0.004, d: 1.6, s: 0.0, r: 0.5 } },
  pad:    { gain: 0.32, osc: [{ type: 'sawtooth', gain: 0.5, detune: -7 }, { type: 'sawtooth', gain: 0.5, detune: 7 }], filter: { base: 520, vel: 2600, q: 0.5 }, adsr: { a: 0.6, d: 1.0, s: 0.8, r: 1.4 } },
  lead:   { gain: 0.42, osc: [{ type: 'sawtooth', gain: 0.6 }, { type: 'square', gain: 0.2, detune: 5 }], filter: { base: 1300, vel: 5200, q: 1.1 }, adsr: { a: 0.008, d: 0.25, s: 0.7, r: 0.28 } },
  bass:   { gain: 0.55, osc: [{ type: 'square', gain: 0.7 }, { type: 'sawtooth', gain: 0.3, octave: -1 }], filter: { base: 450, vel: 2400, q: 0.8 }, adsr: { a: 0.004, d: 0.2, s: 0.55, r: 0.22 } },
};
export const INSTRUMENTS = [
  { id: 'piano', name: 'Piano' },          // samples (Salamander)
  { id: 'rhodes', name: 'Rhodes' },        // samples (Electric Piano 1, FluidR3_GM)
  { id: 'strings', name: 'Strings' },      // samples (cello)
  { id: 'pad', name: 'Pad' },              // sintético
  { id: 'lead', name: 'Synth lead' },      // sintético
  { id: 'bass', name: 'Bass' },            // samples (bajo eléctrico)
];
let currentInstrument = 'piano';
export function setInstrument(id) {
  if (!(SAMPLE_BANKS[id] || SYNTH[id])) return;
  currentInstrument = id;
  if (SAMPLE_BANKS[id]) loadSamples(id);   // precarga el banco de samples
}
export function getInstrument() { return currentInstrument; }
export function instrumentName(id) { return (INSTRUMENTS.find(i => i.id === id) || {}).name || 'Piano'; }

let sustainOn = false;
const sustained = new Set();   // midis a soltar cuando se levante el pedal

// Voz por SAMPLES (piano/strings/bass) con release(at, fast). Vivo y offline.
function buildSampleVoice(ctx, midi, velocity, dest, when, instrumentId) {
  const bank = banks.get(instrumentId);
  if (!bank || !bank.samples) return null;
  const s = nearestSample(bank.samples, midi);
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = velToCutoff(velocity); filter.Q.value = 0.7;
  const gain = ctx.createGain(); gain.gain.value = velToGain(velocity);
  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start(when);
  return {
    release(at, fast) {
      const rel = fast ? 0.03 : RELEASE_SEC;
      try {
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(velToGain(velocity), at);
        gain.gain.linearRampToValueAtTime(0.0001, at + rel);
        src.stop(at + rel + 0.05);
      } catch (_) {}
    },
  };
}

// Voz SINTÉTICA según `def` (osciladores + filtro por velocity + ADSR + FM opc).
function buildSynthVoice(ctx, midi, velocity, dest, def, when) {
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const peak = Math.max(0.0004, velToGain(velocity) * (def.gain || 0.4));
  const amp = ctx.createGain(); amp.gain.value = 0.0001;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = def.filter.base + def.filter.vel * (velocity / 127);
  filter.Q.value = def.filter.q || 0.7;
  filter.connect(amp); amp.connect(dest);
  const nodes = [];
  for (const o of def.osc) {
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.value = freq * (o.ratio || 1) * Math.pow(2, o.octave || 0);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain(); g.gain.value = o.gain;
    osc.connect(g); g.connect(filter);
    osc.start(when); nodes.push(osc);
  }
  if (def.fm) {
    const mod = ctx.createOscillator(); mod.frequency.value = freq * def.fm.ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(def.fm.depth, when);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, def.fm.depth * 0.05), when + (def.fm.decay || 0.4));
    mod.connect(mg); mg.connect(nodes[0].frequency);
    mod.start(when); nodes.push(mod);
  }
  const { a, d, s } = def.adsr;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(peak, when + Math.max(0.002, a));
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0004, peak * (s > 0 ? s : 0.0004)), when + a + Math.max(0.01, d));
  return {
    release(at, fast) {
      const r = fast ? 0.03 : (def.adsr.r || 0.3);
      try {
        amp.gain.cancelScheduledValues(at);
        amp.gain.setValueAtTime(Math.max(0.0004, peak * (s > 0 ? s : 0.02)), at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + r);
        for (const node of nodes) node.stop(at + r + 0.05);
      } catch (_) {}
    },
  };
}

function makeVoice(ctx, midi, velocity, dest, when, instrumentId) {
  return SAMPLE_BANKS[instrumentId]
    ? buildSampleVoice(ctx, midi, velocity, dest, when, instrumentId)
    : buildSynthVoice(ctx, midi, velocity, dest, SYNTH[instrumentId] || SYNTH.rhodes, when);
}

// Toca una nota con el instrumento actual (o el indicado). Retrigger = corta la
// anterior; con el pedal abajo, el release se difiere.
export function noteOn(midi, velocity = 100, instrumentId = currentInstrument) {
  const ctx = engine.getAudioContext();
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
  const prev = activeVoices.get(midi);
  if (prev) { prev.release(ctx.currentTime, true); activeVoices.delete(midi); }
  sustained.delete(midi);
  const voice = makeVoice(ctx, midi, velocity, ensureOutput(), ctx.currentTime, instrumentId);
  if (voice) activeVoices.set(midi, voice);
}

export function setSustain(on) {
  sustainOn = !!on;
  if (!sustainOn) {
    const at = engine.getAudioContext().currentTime;
    for (const m of sustained) { const v = activeVoices.get(m); if (v) { v.release(at); activeVoices.delete(m); } }
    sustained.clear();
  }
}

// Suelta una nota (o la difiere si el pedal de sustain está abajo).
export function noteOff(midi) {
  if (sustainOn) { sustained.add(midi); return; }
  const voice = activeVoices.get(midi);
  if (!voice) return;
  activeVoices.delete(midi);
  voice.release(engine.getAudioContext().currentTime);
}

// Corta TODO de inmediato (pánico / cierre del panel).
export function panic() {
  const at = engine.getAudioContext().currentTime;
  for (const voice of activeVoices.values()) voice.release(at, true);
  activeVoices.clear();
  sustained.clear();
  sustainOn = false;
}

// Renderiza eventos a un AudioBuffer (bounce offline) con el instrumento dado.
// events: [{ midi, velocity, startSec, endSec | durationSec }].
export async function renderEventsToBuffer(events, durationSec, instrumentId = currentInstrument) {
  if (!events.length) return null;
  if (SAMPLE_BANKS[instrumentId]) { try { await loadSamples(instrumentId); } catch (_) {} if (!isLoaded(instrumentId)) return null; }
  const length = Math.max(1, Math.ceil((durationSec + REVERB_SEC) * SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const bus = offline.createGain();
  bus.gain.value = pianoVolume;
  wireReverb(offline, bus, offline.destination);
  for (const ev of events) {
    const start = Math.max(0, ev.startSec);
    const evEnd = (ev.endSec != null) ? ev.endSec : start + (ev.durationSec || 0);
    const end = Math.max(start + 0.02, evEnd);
    const voice = makeVoice(offline, ev.midi, ev.velocity, bus, start, instrumentId);
    if (voice) voice.release(end);
  }
  return await offline.startRendering();
}
