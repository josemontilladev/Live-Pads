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

// Mapa sample → nota MIDI (set por defecto de Salamander que hostea Tone.js).
// Nombres de archivo: 's' = sostenido (Ds = D#, Fs = F#).
const SAMPLE_MAP = [
  ['A0', 21], ['C1', 24], ['Ds1', 27], ['Fs1', 30],
  ['A1', 33], ['C2', 36], ['Ds2', 39], ['Fs2', 42],
  ['A2', 45], ['C3', 48], ['Ds3', 51], ['Fs3', 54],
  ['A3', 57], ['C4', 60], ['Ds4', 63], ['Fs4', 66],
  ['A4', 69], ['C5', 72], ['Ds5', 75], ['Fs5', 78],
  ['A5', 81], ['C6', 84], ['Ds6', 87], ['Fs6', 90],
  ['A6', 93], ['C7', 96], ['Ds7', 99], ['Fs7', 102],
  ['A7', 105], ['C8', 108],
];

const RELEASE_SEC = 0.32;     // cola al soltar la tecla (curva de piano)
const SAMPLE_RATE = 44100;    // para el render offline
const REVERB_WET = 0.34;      // mezcla del reverb (profundidad)
const REVERB_SEC = 2.6;       // largo de la cola del reverb

let samples = null;           // [{ midi, buffer }] ordenado por midi
let loadPromise = null;
let outputGain = null;        // bus del piano (pre-reverb) → master del engine
let pianoVolume = 0.9;        // 0..1, ajustable por el usuario
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
function wireReverb(ctx, bus, destination) {
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = REVERB_WET;
  const conv = ctx.createConvolver(); conv.buffer = getImpulse(ctx);
  bus.connect(dry); dry.connect(destination);
  bus.connect(conv); conv.connect(wet); wet.connect(destination);
}

// Carga + decodifica todos los samples una sola vez (idempotente).
export function loadSamples() {
  if (loadPromise) return loadPromise;
  const ctx = engine.getAudioContext();
  loadPromise = (async () => {
    const loaded = await Promise.all(SAMPLE_MAP.map(async ([name, midi]) => {
      const resp = await fetch(`assets/Piano/${name}.mp3`);
      const ab = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      return { midi, buffer };
    }));
    samples = loaded.sort((a, b) => a.midi - b.midi);
    return samples;
  })();
  return loadPromise;
}

export function isLoaded() { return !!samples; }

function ensureOutput() {
  const ctx = engine.getAudioContext();
  if (!outputGain) {
    outputGain = ctx.createGain();
    outputGain.gain.value = pianoVolume;
    // Dry + reverb hacia el master del engine, para un sonido más profundo.
    wireReverb(ctx, outputGain, engine.getMasterGain());
  }
  return outputGain;
}

// Sample más cercano a la nota pedida (menor distancia en semitonos).
function nearestSample(midi) {
  let best = samples[0], bestDist = Infinity;
  for (const s of samples) {
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

export function setVolume(v) {
  pianoVolume = Math.max(0, Math.min(1, v));
  if (outputGain) outputGain.gain.value = pianoVolume;
}

// Toca una nota. Si la misma nota ya sonaba, la suelta antes (sin notas pegadas).
export function noteOn(midi, velocity = 100) {
  if (!samples) return;
  const ctx = engine.getAudioContext();
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
  if (activeVoices.has(midi)) reallyOff(midi, 0.04);   // retrigger: corta la anterior
  sustained.delete(midi);

  const out = ensureOutput();
  const s = nearestSample(midi);
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);

  const gain = ctx.createGain();
  gain.gain.value = velToGain(velocity);
  src.connect(gain);
  gain.connect(out);
  src.start();

  activeVoices.set(midi, { source: src, gain });
}

// Pedal de sustain (CC64): mientras está abajo, las notas no se sueltan.
let sustainOn = false;
const sustained = new Set();   // midis a soltar cuando se levante el pedal
export function setSustain(on) {
  sustainOn = !!on;
  if (!sustainOn) { for (const m of sustained) reallyOff(m); sustained.clear(); }
}

function reallyOff(midi, release = RELEASE_SEC) {
  const voice = activeVoices.get(midi);
  if (!voice) return;
  activeVoices.delete(midi);
  const ctx = engine.getAudioContext();
  const now = ctx.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + release);
    voice.source.stop(now + release + 0.02);
  } catch (_) {}
}

// Suelta una nota (o la difiere si el pedal de sustain está abajo).
export function noteOff(midi, release = RELEASE_SEC) {
  if (sustainOn) { sustained.add(midi); return; }
  reallyOff(midi, release);
}

// Corta TODO el piano de inmediato (pánico / cierre del panel).
export function panic() {
  const ctx = engine.getAudioContext();
  const now = ctx.currentTime;
  for (const voice of activeVoices.values()) {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0.0001, now);
      voice.source.stop(now + 0.03);
    } catch (_) {}
  }
  activeVoices.clear();
  sustained.clear();
  sustainOn = false;
}

// Renderiza una lista de eventos a un AudioBuffer (bounce offline para volcar la
// grabación como pista). events: [{ midi, velocity, startSec, endSec }].
export async function renderEventsToBuffer(events, durationSec) {
  if (!events.length) return null;
  if (!samples) { try { await loadSamples(); } catch (_) {} }   // robustez: editar tras recargar
  if (!samples) return null;
  // Cola extra al final para que el reverb no quede recortado.
  const length = Math.max(1, Math.ceil((durationSec + REVERB_SEC) * SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, length, SAMPLE_RATE);

  // Bus con dry + reverb (mismo sonido que en vivo). pianoVolume va en el bus.
  const bus = offline.createGain();
  bus.gain.value = pianoVolume;
  wireReverb(offline, bus, offline.destination);

  for (const ev of events) {
    const s = nearestSample(ev.midi);
    const src = offline.createBufferSource();
    src.buffer = s.buffer;                 // los AudioBuffer son independientes del contexto
    src.playbackRate.value = Math.pow(2, (ev.midi - s.midi) / 12);
    const gain = offline.createGain();
    const g = velToGain(ev.velocity);
    const start = Math.max(0, ev.startSec);
    const evEnd = (ev.endSec != null) ? ev.endSec : start + (ev.durationSec || 0);
    const end = Math.max(start + 0.02, evEnd);
    gain.gain.setValueAtTime(g, start);
    gain.gain.setValueAtTime(g, end);
    gain.gain.linearRampToValueAtTime(0.0001, end + RELEASE_SEC);
    src.connect(gain);
    gain.connect(bus);
    src.start(start);
    try { src.stop(end + RELEASE_SEC + 0.05); } catch (_) {}
  }
  return await offline.startRendering();
}
