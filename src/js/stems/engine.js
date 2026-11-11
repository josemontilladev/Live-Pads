// Web Audio engine for the Stem Editor workspace.
//
// One AudioBuffer per imported stem (decoded once on import). When the user
// hits Play we create fresh AudioBufferSourceNodes for each track — Web
// Audio sources are one-shot, so play/stop recycles them.
//
// Graph per track:   source → trackGain → trackPan → masterGain → destination
//
// Phase 1: import / play / stop / per-track volume / master volume.
// Phases 2 & 3 will layer in pan, mute/solo, seek/pause, MP3 export.

import { SoundTouchNode } from '../../vendor/soundtouch-worklet/SoundTouchNode.js';
import { forceStereoOutput } from '../audio/stereoOut.js';

let ctx = null;
let masterGain = null;
let isPlaying = false;
let startedAt = 0;          // ctx.currentTime when the current playback started
let pauseOffsetSec = 0;     // seek position when stopped/paused (Phase 1 always 0)

const tracks = new Map();   // id → { id, name, buffer, gainNode, panNode, sourceNodes, volume, clips }

// ── Clips (fragmentos) ──────────────────────────────────────────────────────
// Una pista puede tener VARIOS clips sobre el MISMO buffer (no destructivo):
// cortar una pista en el cursor la parte en dos clips que se arrastran por
// separado, sin crear otra pista. Cada clip:
//   { id, shift, trimStartSec, trimEndSec, fadeInSec, fadeOutSec }
// El instante del timeline donde suena el segundo `x` del buffer es
// offsetSec (de la pista) + shift (del clip) + x. Así mover la pista entera
// (offsetSec) arrastra todos sus clips, y mover un clip solo cambia su shift.
// Lo que suena del clip es [trimStartSec, trimEndSec] del buffer.
let nextClipId = 1;
function makeClip(buffer, p = {}) {
  return {
    id: p.id || `c${nextClipId++}`,
    shift: p.shift || 0,
    trimStartSec: Math.max(0, p.trimStartSec || 0),
    trimEndSec: p.trimEndSec != null ? Math.min(p.trimEndSec, buffer.duration) : buffer.duration,
    fadeInSec: p.fadeInSec || 0,
    fadeOutSec: p.fadeOutSec || 0,
  };
}
const clipEndOf = (t, c) => (c.trimEndSec != null ? c.trimEndSec : t.buffer.duration);
const clipStartTl = (t, c) => (t.offsetSec || 0) + c.shift + c.trimStartSec;
const clipEndTl = (t, c) => (t.offsetSec || 0) + c.shift + clipEndOf(t, c);
function stopSources(t) {
  for (const src of t.sourceNodes || []) {
    try { src.stop(); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  }
  t.sourceNodes = [];
}
let onPlayingChange = null;
let onTimeUpdate = null;
let timeUpdateRAF = null;

// Optional loop region — when both endpoints are set, playback bounces
// back to loopStart whenever the playhead reaches loopEnd.
let loopStart = null;  // seconds, null = disabled
let loopEnd   = null;
let onLoop = null;     // workspace-supplied callback when the loop wraps

// ── Velocidad de reproducción (estudio lento) ────────────────────────────────
// Bajar la velocidad se hace con `playbackRate` en cada AudioBufferSourceNode:
// es sample-exacto y mantiene TODAS las pistas en fase (nada de deriva entre
// stems). El pero es que resamplear también baja el tono, y para sacar un solo
// eso no sirve: las notas quedarían en otra tonalidad. Por eso metemos un
// SoundTouchNode al final del master que sube el tono exactamente lo que el
// resampleo lo bajó (-12·log2(rate) semitonos) → tempo lento, afinación intacta.
// A rate = 1 el nodo se puentea (cero coste y cero latencia extra).
let playbackRate = 1;
let rateComp = null;          // SoundTouchNode de compensación (null = puenteado)
let rateWorkletReg = null;    // { promise } — registro perezoso del worklet

// Master analyser exposes a tiny live-level reading so the UI can paint a
// VU meter without leaking audio internals. Float time-domain data fits
// every codec we read; we squeeze it into a peak/RMS pair on demand.
let masterAnalyser = null;
let analyserBuf = null;

function ensureCtx() {
  if (ctx) return ctx;
  // Si la app ya tiene un AudioContext vivo (el del SynthEngine, que comparten
  // los pads y el reproductor de pistas), lo ADOPTAMOS en vez de abrir uno
  // nuevo. Con dos contextos, el piano —que suena por aquí— quedaba en un
  // contexto aparte del audio de la canción, y no se podían escuchar juntos.
  // Uno solo = mismo reloj, misma política de autoplay, todo suena a la vez.
  const shared = window.__livepadsSharedCtx;
  if (shared && shared.state !== 'closed') {
    ctx = shared;
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.85;
    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 512;
    masterAnalyser.smoothingTimeConstant = 0.3;
    analyserBuf = new Float32Array(masterAnalyser.fftSize);
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  // Tope de 48 kHz. Con interfaces a 96 kHz, cada buffer decodificado ocupa el
  // DOBLE de RAM; proyectos con muchas pistas largas se quedaban sin memoria al
  // transponer/exportar ("startRendering failed to create AudioBuffer"). 48 kHz
  // es indistinguible para reproducir/exportar y reduce la memoria a la mitad.
  // NOTA: el close() de abajo es seguro — el contexto recién nació y no tiene
  // ningún nodo ni playback; solo se usó para sondear el sampleRate del hardware.
  if (ctx.sampleRate > 48000) {
    try { ctx.close(); } catch (_) {}
    try { ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); } catch (_) { ctx = new AC({ latencyHint: 'interactive' }); }
  }
  forceStereoOutput(ctx);
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.85;
  masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = 512;
  masterAnalyser.smoothingTimeConstant = 0.3;
  analyserBuf = new Float32Array(masterAnalyser.fftSize);
  masterGain.connect(masterAnalyser);
  masterAnalyser.connect(ctx.destination);
  return ctx;
}

// Returns the most recent master level as { peak, rms } in 0..1 range.
// peak is the absolute max sample in the window; rms is the root-mean-
// square. Use peak for visual transients, rms for sustained loudness.
export function getMasterLevel() {
  if (!masterAnalyser || !analyserBuf) return { peak: 0, rms: 0 };
  masterAnalyser.getFloatTimeDomainData(analyserBuf);
  let peak = 0, sumSq = 0;
  for (let i = 0; i < analyserBuf.length; i++) {
    const v = analyserBuf[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / analyserBuf.length);
  return { peak, rms };
}

export function init({ onPlayingChange: pc, onTimeUpdate: tu, onLoop: ol } = {}) {
  onPlayingChange = pc || null;
  onTimeUpdate = tu || null;
  onLoop = ol || null;
  ensureCtx();
}

export function setLoopRegion(startSec, endSec) {
  if (startSec == null || endSec == null) { loopStart = loopEnd = null; return; }
  const a = Math.max(0, Math.min(startSec, endSec));
  const b = Math.max(startSec, endSec);
  loopStart = a; loopEnd = b;
}
export function clearLoopRegion() { loopStart = loopEnd = null; }
export function getLoopRegion() { return { start: loopStart, end: loopEnd }; }

// Nivel de pico (0..1) de UNA pista, leído de su analyser post-fader. Para los
// VU por canal de la consola.
let trackMeterBuf = null;
export function getTrackLevel(id) {
  const t = tracks.get(id);
  if (!t || !t.meterAnalyser) return 0;
  const n = t.meterAnalyser.fftSize;
  if (!trackMeterBuf || trackMeterBuf.length !== n) trackMeterBuf = new Float32Array(n);
  t.meterAnalyser.getFloatTimeDomainData(trackMeterBuf);
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = trackMeterBuf[i] < 0 ? -trackMeterBuf[i] : trackMeterBuf[i]; if (a > peak) peak = a; }
  return peak;
}

export function getMasterVolume() { return masterGain ? masterGain.gain.value : 0.85; }

// ── Click y guía por las salidas 3-4 (in-ears) ───────────────────────────
// Con una interfaz de 4+ salidas, las pistas de click y de guía dejan el máster
// (1-2, la sala) y salen por 3-4. La forma de la salida la pone audioOutput.js.
let altOn = false, altBus = null;
const isGuideKind = (k) => k === 'click' || k === 'guide';
function ensureAltBus() {
  if (altBus) return altBus;
  altBus = ctx.createGain();
  const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(4);
  altBus.connect(sp);
  sp.connect(mg, 0, 2); sp.connect(mg, 1, 3);
  mg.connect(ctx.destination);
  return altBus;
}
export function setGuideToAltOutput(on) {
  ensureCtx();
  altOn = !!on && ctx.destination.channelCount >= 4;
  for (const t of tracks.values()) {
    if (!isGuideKind(t.kind)) continue;
    try { t.panNode.disconnect(masterGain); } catch (_) {}
    if (altBus) { try { t.panNode.disconnect(altBus); } catch (_) {} }
    t.panNode.connect(altOn ? ensureAltBus() : masterGain);
  }
  return altOn;
}
export function setMasterVolume(v) {
  ensureCtx();
  masterGain.gain.value = Math.max(0, Math.min(1, v));
}

// Decode + register a stem from an ArrayBuffer (FileReader result).
// Returns the new track id so the UI can wire its strip immediately.
// `kind` is metadata: 'stem' (default), 'click', or 'guide'. The engine
// treats them identically — kind only affects how the UI styles + saves
// Decodifica audio con tolerancia: primero el decoder nativo (rápido, cubre
// MP3/AAC/OGG y la mayoría de WAV); si falla y el archivo es WAV/RIFF, lo
// parsea a mano. Chromium rechaza algunos WAV perfectamente válidos (24-bit,
// 32-bit float, o con chunks extra antes de `data`), muy comunes en stems
// exportados por separadores y DAWs.
export async function decodeAudio(arrayBuffer) {
  ensureCtx();
  return decodeFlexible(arrayBuffer);
}
async function decodeFlexible(arrayBuffer) {
  try {
    // decodeAudioData ya resamplea al rate del contexto (≤48 kHz).
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (nativeErr) {
    const wav = decodeWav(arrayBuffer);
    // El parser crea el buffer al rate NATIVO del WAV (p. ej. 96 kHz); lo
    // bajamos al rate del contexto para no duplicar memoria como en el camino
    // nativo.
    if (wav) return await resampleToCtxRate(wav);
    throw nativeErr; // no es WAV o no lo pudimos parsear: error original
  }
}

// Resamplea un AudioBuffer al rate del contexto si lo supera (vía render
// offline). Devuelve el mismo buffer si ya está en (o por debajo de) ese rate.
async function resampleToCtxRate(buffer) {
  if (!buffer || buffer.sampleRate <= ctx.sampleRate) return buffer;
  const channels = buffer.numberOfChannels;
  const outLen = Math.max(1, Math.ceil(buffer.duration * ctx.sampleRate));
  const off = new OfflineAudioContext(channels, outLen, ctx.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return await off.startRendering();
}

// Parser mínimo de RIFF/WAVE. Soporta PCM entero 8/16/24/32-bit y float 32-bit,
// incluido el formato WAVE_FORMAT_EXTENSIBLE (0xFFFE). Devuelve un AudioBuffer
// o null si no es un WAV reconocible.
function decodeWav(arrayBuffer) {
  try {
    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 44) return null;
    const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

    let fmt = null, dataOffset = -1, dataLen = 0;
    let off = 12;
    while (off + 8 <= dv.byteLength) {
      const id = tag(off);
      const size = dv.getUint32(off + 4, true);
      const body = off + 8;
      if (id === 'fmt ') {
        let format = dv.getUint16(body, true);
        const channels = dv.getUint16(body + 2, true);
        const sampleRate = dv.getUint32(body + 4, true);
        const bits = dv.getUint16(body + 14, true);
        // WAVE_FORMAT_EXTENSIBLE: el formato real está en el sub-GUID (primeros 2 bytes).
        if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
        fmt = { format, channels, sampleRate, bits };
      } else if (id === 'data') {
        dataOffset = body;
        // Algunos encoders ponen size=0 o 0xFFFFFFFF: usa lo que reste del archivo.
        dataLen = (size > 0 && body + size <= dv.byteLength) ? size : dv.byteLength - body;
      }
      off = body + size + (size & 1); // los chunks se alinean a 2 bytes
      if (fmt && dataOffset >= 0 && off >= dv.byteLength) break;
    }
    if (!fmt || dataOffset < 0 || !fmt.channels || !fmt.sampleRate) return null;

    const { format, channels, sampleRate, bits } = fmt;
    const bytesPerSample = bits >> 3;
    const frameSize = bytesPerSample * channels;
    if (!frameSize) return null;
    const frames = Math.floor(dataLen / frameSize);
    if (frames <= 0) return null;

    const out = ctx.createBuffer(channels, frames, sampleRate);
    const isFloat = format === 3;
    for (let ch = 0; ch < channels; ch++) {
      const chData = out.getChannelData(ch);
      let p = dataOffset + ch * bytesPerSample;
      for (let i = 0; i < frames; i++, p += frameSize) {
        let s;
        if (isFloat) {
          s = bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
        } else if (bits === 8) {
          s = (dv.getUint8(p) - 128) / 128;               // 8-bit es unsigned
        } else if (bits === 16) {
          s = dv.getInt16(p, true) / 32768;
        } else if (bits === 24) {
          const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getUint8(p + 2);
          let v = (b2 << 16) | (b1 << 8) | b0;
          if (v & 0x800000) v -= 0x1000000;               // sign-extend 24→32
          s = v / 8388608;
        } else if (bits === 32) {
          s = dv.getInt32(p, true) / 2147483648;
        } else {
          return null;                                    // bit-depth no soportado
        }
        chData[i] = s < -1 ? -1 : s > 1 ? 1 : s;
      }
    }
    return out;
  } catch (_) {
    return null;
  }
}

// the track. Pass a pre-decoded AudioBuffer instead of arrayBuffer to
// register synthesised tracks (click, guide) without re-decoding.
export async function addTrack({ id, name, arrayBuffer, audioBuffer, kind, offsetSec }) {
  ensureCtx();
  const buffer = audioBuffer
    ? audioBuffer
    : await decodeFlexible(arrayBuffer);
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.85;
  const panNode = ctx.createStereoPanner();
  panNode.pan.value = 0;
  gainNode.connect(panNode);
  panNode.connect(altOn && isGuideKind(kind) ? ensureAltBus() : masterGain);
  // Tap post-fader/pan para el VU por pista (no altera el audio: el analyser es
  // solo una derivación de lectura). fftSize chico = barato con muchas pistas.
  const meterAnalyser = ctx.createAnalyser();
  meterAnalyser.fftSize = 256;
  meterAnalyser.smoothingTimeConstant = 0.4;
  panNode.connect(meterAnalyser);

  tracks.set(id, {
    id,
    kind: kind || 'stem',
    name: name || 'Pista',
    buffer,
    gainNode,
    panNode,
    meterAnalyser,
    sourceNodes: [],
    volume: gainNode.gain.value,
    pan: 0,
    muted: false,
    soloed: false,
    offsetSec: offsetSec || 0,  // timeline shift: where this track begins
    color: null,  // null → use theme accent; else CSS colour string
    // Recorte (no destructivo) por clip — qué región del buffer se reproduce/
    // exporta, y rampas de fade en sus bordes. El buffer NUNCA se altera.
    clips: [makeClip(buffer)],
    _prevDur: buffer.duration,  // para detectar "estaba sin recortar" en replaceTrackBuffer
  });
  return id;
}

// Replace the AudioBuffer of an existing track in place — used when the
// click track regenerates after BPM/duration changes, or the guide track
// is rebuilt after markers shift. Knobs + position in the list are kept.
export function replaceTrackBuffer(id, audioBuffer) {
  const t = tracks.get(id);
  if (!t) return;
  // If currently playing, stop the source so the next play uses the new buffer.
  stopSources(t);
  t.buffer = audioBuffer;
  // El buffer cambió de duración (re-bounce de click/MIDI, edición destructiva):
  // un buffer nuevo vuelve a ser UN solo clip; si estaba sin recortar sigue
  // completo, si no se re-encuadra el recorte dentro del nuevo buffer.
  // Misma duración (normalizar, transponer, silenciar un tramo…): los
  // fragmentos siguen siendo válidos y se conservan tal cual.
  if (Math.abs(audioBuffer.duration - (t._prevDur || 0)) < 0.001) { t._prevDur = audioBuffer.duration; return; }
  const c = t.clips[0];
  const untrimmed = t.clips.length === 1 && c.shift === 0 && c.trimStartSec === 0 && clipEndOf(t, c) >= (t._prevDur || 0) - 0.001;
  if (untrimmed || t.clips.length > 1) {
    t.clips = [makeClip(audioBuffer, untrimmed ? {} : { trimStartSec: 0 })];
  } else {
    c.trimStartSec = Math.min(c.trimStartSec || 0, audioBuffer.duration);
    c.trimEndSec = Math.min(c.trimEndSec || audioBuffer.duration, audioBuffer.duration);
  }
  t._prevDur = audioBuffer.duration;
}

export function getAudioContext() { ensureCtx(); return ctx; }
// Nodo de entrada del bus master — para que módulos externos (p.ej. el piano
// virtual) suenen por la misma mezcla y pasen por el VU/medidor.
export function getMasterGain() { ensureCtx(); return masterGain; }
export function getTrackBuffer(id) { return tracks.get(id)?.buffer || null; }
export function findTrackByKind(kind) {
  for (const t of tracks.values()) if (t.kind === kind) return t.id;
  return null;
}

// Rebuild the Map preserving everything but in the order specified by
// `idsInOrder`. Tracks not in the list are appended at the end.
export function reorderTracks(idsInOrder) {
  const next = new Map();
  for (const id of idsInOrder) {
    if (tracks.has(id)) next.set(id, tracks.get(id));
  }
  for (const [id, t] of tracks) if (!next.has(id)) next.set(id, t);
  tracks.clear();
  for (const [id, t] of next) tracks.set(id, t);
}

export function removeTrack(id) {
  const t = tracks.get(id);
  if (!t) return;
  stopSources(t);
  try { t.gainNode.disconnect(); } catch (e) {}
  try { t.panNode.disconnect(); } catch (e) {}
  tracks.delete(id);
}

export function setTrackVolume(id, v) {
  const t = tracks.get(id);
  if (!t) return;
  t.volume = Math.max(0, Math.min(1, v));
  applyEffectiveGain(t);
}

export function setTrackPan(id, p) {
  const t = tracks.get(id);
  if (!t) return;
  t.pan = Math.max(-1, Math.min(1, p));
  t.panNode.pan.value = t.pan;
}

export function setTrackMuted(id, muted) {
  const t = tracks.get(id);
  if (!t) return;
  t.muted = !!muted;
  recomputeAllGains();
}

export function setTrackSoloed(id, soloed) {
  const t = tracks.get(id);
  if (!t) return;
  t.soloed = !!soloed;
  recomputeAllGains();
}

export function renameTrack(id, name) {
  const t = tracks.get(id);
  if (!t) return;
  t.name = String(name || '').trim() || 'Pista';
}

export function setTrackColor(id, color) {
  const t = tracks.get(id);
  if (!t) return;
  t.color = color || null;
}

export function getTrackOffset(id) { return tracks.get(id)?.offsetSec || 0; }
export function setTrackOffset(id, sec) {
  const t = tracks.get(id);
  if (!t) return;
  t.offsetSec = sec || 0;
  // Reschedule on the fly so the shift is audible immediately while playing.
  if (isPlaying) seek(getCurrentSec());
}

// ── Recorte (trim) + fades (no destructivo) ────────────────────────────────
// API heredada de "un clip por pista": actúa sobre el PRIMER clip. Las pistas
// con varios clips se editan con la API de clips de más abajo.
const firstClip = (t) => t.clips[0];
export function getTrackTrimStart(id) { const t = tracks.get(id); return t ? firstClip(t).trimStartSec : 0; }
export function getTrackTrimEnd(id) { const t = tracks.get(id); return t ? clipEndOf(t, firstClip(t)) : 0; }
export function getTrackFadeIn(id)  { const t = tracks.get(id); return t ? firstClip(t).fadeInSec : 0; }
export function getTrackFadeOut(id) { const t = tracks.get(id); return t ? firstClip(t).fadeOutSec : 0; }
function _clipDur(t, c) { return clipEndOf(t, c) - (c.trimStartSec || 0); }
function _setTrimStart(t, c, sec) {
  const end = clipEndOf(t, c);
  c.trimStartSec = Math.max(0, Math.min(sec || 0, end - 0.02));
  const d = _clipDur(t, c);
  c.fadeInSec = Math.min(c.fadeInSec || 0, d); c.fadeOutSec = Math.min(c.fadeOutSec || 0, d);
}
function _setTrimEnd(t, c, sec) {
  const start = c.trimStartSec || 0;
  c.trimEndSec = Math.max(start + 0.02, Math.min(sec, t.buffer.duration));
  const d = _clipDur(t, c);
  c.fadeInSec = Math.min(c.fadeInSec || 0, d); c.fadeOutSec = Math.min(c.fadeOutSec || 0, d);
}
const _resched = () => { if (isPlaying) seek(getCurrentSec()); };
export function setTrackTrimStart(id, sec) { const t = tracks.get(id); if (!t) return; _setTrimStart(t, firstClip(t), sec); _resched(); }
export function setTrackTrimEnd(id, sec)   { const t = tracks.get(id); if (!t) return; _setTrimEnd(t, firstClip(t), sec); _resched(); }
export function setTrackFadeIn(id, sec) {
  const t = tracks.get(id); if (!t) return; const c = firstClip(t);
  c.fadeInSec = Math.max(0, Math.min(sec || 0, _clipDur(t, c))); _resched();
}
export function setTrackFadeOut(id, sec) {
  const t = tracks.get(id); if (!t) return; const c = firstClip(t);
  c.fadeOutSec = Math.max(0, Math.min(sec || 0, _clipDur(t, c))); _resched();
}

// ── API de clips ────────────────────────────────────────────────────────────
const clipView = (t, c) => ({
  id: c.id, shift: c.shift, trimStartSec: c.trimStartSec, trimEndSec: clipEndOf(t, c),
  fadeInSec: c.fadeInSec, fadeOutSec: c.fadeOutSec,
  startSec: clipStartTl(t, c), endSec: clipEndTl(t, c),
});
/** Clips de la pista ordenados por posición en el timeline. */
export function getClips(id) {
  const t = tracks.get(id);
  if (!t) return [];
  return t.clips.map((c) => clipView(t, c)).sort((a, b) => a.startSec - b.startSec);
}
export function getClipCount(id) { return tracks.get(id)?.clips.length || 0; }
/** Reemplaza todos los clips (deshacer/rehacer, cargar proyecto). */
export function setClips(id, list) {
  const t = tracks.get(id);
  if (!t || !Array.isArray(list) || !list.length) return;
  t.clips = list.map((c) => makeClip(t.buffer, c));
  for (const c of t.clips) { const n = Number(String(c.id).slice(1)); if (n >= nextClipId) nextClipId = n + 1; }
  _resched();
}
/** Clip que suena en el instante `sec` del timeline (o null). */
export function clipAt(id, sec) {
  const t = tracks.get(id);
  if (!t) return null;
  const c = t.clips.find((k) => sec >= clipStartTl(t, k) && sec < clipEndTl(t, k));
  return c ? c.id : null;
}
/**
 * Corta la pista en `sec` (timeline): el clip que suena ahí se parte en dos
 * (mismo buffer). Micro-fades de 5 ms en el corte para que no haga "clic".
 * Devuelve el id del clip nuevo (la parte derecha) o null si no había clip.
 */
export function splitClipAt(id, sec) {
  const t = tracks.get(id);
  if (!t) return null;
  const c = t.clips.find((k) => sec > clipStartTl(t, k) + 0.02 && sec < clipEndTl(t, k) - 0.02);
  if (!c) return null;
  const local = sec - (t.offsetSec || 0) - c.shift;   // segundo del buffer en el corte
  const right = makeClip(t.buffer, {
    shift: c.shift, trimStartSec: local, trimEndSec: clipEndOf(t, c),
    fadeInSec: 0.005, fadeOutSec: c.fadeOutSec,
  });
  c.trimEndSec = local;
  c.fadeOutSec = 0.005;                      // el fade-out original pasa a la parte derecha
  c.fadeInSec = Math.min(c.fadeInSec || 0, _clipDur(t, c));
  t.clips.splice(t.clips.indexOf(c) + 1, 0, right);
  _resched();
  return right.id;
}
/** Coloca el clip para que empiece en `startSec` del timeline (≥ 0). */
export function moveClip(id, clipId, startSec) {
  const t = tracks.get(id);
  const c = t?.clips.find((k) => k.id === clipId);
  if (!c) return;
  const start = Math.max(0, startSec);
  c.shift = start - (t.offsetSec || 0) - c.trimStartSec;
  _resched();
}
export function setClipTrimStart(id, clipId, sec) {
  const t = tracks.get(id); const c = t?.clips.find((k) => k.id === clipId); if (!c) return;
  _setTrimStart(t, c, sec); _resched();
}
export function setClipTrimEnd(id, clipId, sec) {
  const t = tracks.get(id); const c = t?.clips.find((k) => k.id === clipId); if (!c) return;
  _setTrimEnd(t, c, sec); _resched();
}
export function setClipFadeIn(id, clipId, sec) {
  const t = tracks.get(id); const c = t?.clips.find((k) => k.id === clipId); if (!c) return;
  c.fadeInSec = Math.max(0, Math.min(sec || 0, _clipDur(t, c))); _resched();
}
export function setClipFadeOut(id, clipId, sec) {
  const t = tracks.get(id); const c = t?.clips.find((k) => k.id === clipId); if (!c) return;
  c.fadeOutSec = Math.max(0, Math.min(sec || 0, _clipDur(t, c))); _resched();
}
/** Quita un clip (si la pista tiene más de uno). */
export function removeClip(id, clipId) {
  const t = tracks.get(id);
  if (!t || t.clips.length < 2) return false;
  const i = t.clips.findIndex((k) => k.id === clipId);
  if (i < 0) return false;
  t.clips.splice(i, 1);
  _resched();
  return true;
}

// Mute + solo interact: if ANY track is soloed, only soloed tracks are
// audible (others are forced silent). Manual mute overrides solo for that
// track. This matches every DAW's standard solo behaviour.
function recomputeAllGains() {
  const anySoloed = Array.from(tracks.values()).some(t => t.soloed);
  for (const t of tracks.values()) applyEffectiveGain(t, anySoloed);
}
function applyEffectiveGain(t, anySoloedPrecomputed) {
  const anySoloed = anySoloedPrecomputed !== undefined
    ? anySoloedPrecomputed
    : Array.from(tracks.values()).some(tr => tr.soloed);
  let effective = t.volume;
  if (t.muted) effective = 0;
  else if (anySoloed && !t.soloed) effective = 0;
  t.gainNode.gain.value = effective;
}

export function getTracks() {
  return Array.from(tracks.values()).map(t => ({
    id: t.id, kind: t.kind, name: t.name, volume: t.volume, pan: t.pan,
    muted: t.muted, soloed: t.soloed, color: t.color, offsetSec: t.offsetSec || 0,
    durationSec: t.buffer.duration,
    trimStartSec: firstClip(t).trimStartSec,
    trimEndSec: clipEndOf(t, firstClip(t)),
    fadeInSec: firstClip(t).fadeInSec, fadeOutSec: firstClip(t).fadeOutSec,
    clips: t.clips.map((c) => clipView(t, c)),
  }));
}

// Raw view including the live AudioBuffer — only used by the exporter
// when it needs to rebuild the mix graph inside an OfflineAudioContext.
export function getRawTracks() {
  return Array.from(tracks.values()).map(t => ({
    id: t.id, kind: t.kind, name: t.name, buffer: t.buffer,
    volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed, color: t.color,
    offsetSec: t.offsetSec || 0,
    trimStartSec: firstClip(t).trimStartSec,
    trimEndSec: clipEndOf(t, firstClip(t)),
    fadeInSec: firstClip(t).fadeInSec, fadeOutSec: firstClip(t).fadeOutSec,
    clips: t.clips.map((c) => clipView(t, c)),
  }));
}

// Longest stem (including its offset) dictates project length.
export function getDurationSec() {
  let max = 0;
  for (const t of tracks.values()) {
    for (const c of t.clips) { const end = clipEndTl(t, c); if (end > max) max = end; }
  }
  return max;
}

export function getCurrentSec() {
  if (!isPlaying) return pauseOffsetSec;
  // A media velocidad, 1 s de reloj = 0.5 s de proyecto: el playhead avanza
  // en tiempo de PROYECTO, así que escalamos el delta por el rate.
  return Math.min(pauseOffsetSec + (ctx.currentTime - startedAt) * playbackRate, getDurationSec());
}

export function getPlaybackRate() { return playbackRate; }

// Registra el worklet de SoundTouch una sola vez por contexto. En Electron el
// código llega por IPC (funciona dentro del asar); en dev cae a la ruta suelta.
function ensureRateWorklet() {
  if (rateWorkletReg) return rateWorkletReg.promise;
  const promise = (async () => {
    let url = null;
    try {
      const code = await window.electronAPI?.getSoundtouchWorklet?.();
      if (code) url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    } catch (_) {}
    if (!url) url = 'vendor/soundtouch-worklet/soundtouch-processor.js';
    await SoundTouchNode.register(ctx, url);
  })();
  promise.catch(e => console.warn('[Stems] worklet de velocidad no disponible:', e && e.message || e));
  rateWorkletReg = { promise };
  return promise;
}

// Rutea el master: masterGain → analyser → [compensación de tono] → destino.
async function routeRateCompensation() {
  ensureCtx();
  const needed = Math.abs(playbackRate - 1) > 0.001;
  try { masterAnalyser.disconnect(); } catch (_) {}
  if (rateComp) { try { rateComp.disconnect(); } catch (_) {} }
  if (!needed) {
    rateComp = null;
    masterAnalyser.connect(ctx.destination);
    return;
  }
  if (!rateComp) {
    try {
      await ensureRateWorklet();
      rateComp = new SoundTouchNode({ context: ctx });
    } catch (_) { rateComp = null; }
  }
  if (!rateComp) {                      // sin worklet: velocidad sí, tono no
    masterAnalyser.connect(ctx.destination);
    return;
  }
  try { rateComp.pitchSemitones.value = -12 * Math.log2(playbackRate); } catch (_) {}
  masterAnalyser.connect(rateComp);
  rateComp.connect(ctx.destination);
}

// Cambia la velocidad (0.25×–2×) preservando la posición del playhead. Si
// estaba sonando, reprograma las fuentes desde el mismo punto.
export async function setPlaybackRate(r) {
  ensureCtx();
  const v = Math.max(0.25, Math.min(2, Number(r) || 1));
  if (Math.abs(v - playbackRate) < 0.001) return;
  const wasPlaying = isPlaying;
  const at = getCurrentSec();
  if (wasPlaying) pause();
  playbackRate = v;
  await routeRateCompensation();
  pauseOffsetSec = at;
  if (wasPlaying) play();
  else if (onTimeUpdate) onTimeUpdate(pauseOffsetSec);
}

// Programa la rampa de fade-in/out de un clip sobre el AudioParam `g`, en
// tiempo del contexto. `clipStartCtx`/`clipEndCtx` = instantes (ctx time) en
// que el buffer pasa por trimStart/trimEnd; `when` = ahora (o el inicio del
// render offline). Maneja arrancar a mitad de un fade (valor parcial en `when`)
// y sirve igual para playback en vivo y para el render del export.
export function scheduleFade(g, fadeInSec, fadeOutSec, clipStartCtx, clipEndCtx, when) {
  const fadeIn = fadeInSec || 0;
  const fadeOut = fadeOutSec || 0;
  try {
    g.cancelScheduledValues(when);
    if (fadeIn > 0) {
      const fiEnd = clipStartCtx + fadeIn;
      if (when <= clipStartCtx) { g.setValueAtTime(0, clipStartCtx); g.linearRampToValueAtTime(1, fiEnd); }
      else if (when < fiEnd)    { g.setValueAtTime((when - clipStartCtx) / fadeIn, when); g.linearRampToValueAtTime(1, fiEnd); }
      else                      { g.setValueAtTime(1, when); }
    } else {
      g.setValueAtTime(1, Math.max(when, clipStartCtx));
    }
    if (fadeOut > 0) {
      // El fade-out arranca, como muy temprano, cuando termina el fade-in (sin solaparse).
      const foStart = Math.max(clipEndCtx - fadeOut, clipStartCtx + fadeIn);
      if (when <= foStart)        { g.setValueAtTime(1, foStart); g.linearRampToValueAtTime(0.0001, clipEndCtx); }
      else if (when < clipEndCtx) { g.setValueAtTime(Math.max(0, 1 - (when - foStart) / Math.max(0.001, clipEndCtx - foStart)), when); g.linearRampToValueAtTime(0.0001, clipEndCtx); }
    }
  } catch (_) {}
}

export function play() {
  ensureCtx();
  if (isPlaying) return;
  if (tracks.size === 0) return;
  if (ctx.state === 'suspended') ctx.resume();

  // 50 ms lookahead so all sources start sample-accurate together.
  const when = ctx.currentTime + 0.05;
  let started = 0;
  for (const t of tracks.values()) {
    t.sourceNodes = [];
    for (const c of t.clips) {
      // `local` = posición dentro del buffer que corresponde al playhead global.
      const local = pauseOffsetSec - (t.offsetSec || 0) - c.shift;
      const trimStart = c.trimStartSec || 0;
      const trimEnd = clipEndOf(t, c);
      if (local >= trimEnd) continue;  // el clip ya terminó aquí
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      // Ganancia de fade POR FUENTE (no toca el volumen de la pista): src → fadeGain → gainNode.
      const fadeGain = ctx.createGain();
      src.connect(fadeGain);
      fadeGain.connect(t.gainNode);
      src.fadeGain = fadeGain;
      // Arranque: si el playhead está dentro del clip, desde `local`; si está antes,
      // se agenda para el futuro (cuando el clip entra). Duración acotada a trimEnd.
      // `offset`/`duration` de start() van en tiempo de BUFFER (no los toca el
      // rate); las esperas y las rampas van en tiempo de RELOJ, así que se
      // dividen por el rate: a 0.5× el clip tarda el doble en entrar.
      src.playbackRate.value = playbackRate;
      let startWhen, startOffset, dur;
      if (local >= trimStart) { startWhen = when; startOffset = local; dur = trimEnd - local; }
      else { startWhen = when + (trimStart - local) / playbackRate; startOffset = trimStart; dur = trimEnd - trimStart; }
      // Envolvente de fade (en tiempo del contexto). clipStart/End = cuándo el buffer
      // pasa por trimStart/trimEnd respecto al playhead actual.
      scheduleFade(fadeGain.gain, c.fadeInSec, c.fadeOutSec,
                   when + (trimStart - local) / playbackRate,
                   when + (trimEnd - local) / playbackRate, when);
      src.start(startWhen, startOffset, Math.max(0, dur));
      t.sourceNodes.push(src);
      started++;
      src.onended = () => {
        try { src.fadeGain && src.fadeGain.disconnect(); } catch (_) {}  // limpia la ganancia de fade
        const arr = t.sourceNodes; const k = arr.indexOf(src); if (k >= 0) arr.splice(k, 1);
        // Si ya no queda ninguna fuente en ninguna pista, se acabó la canción.
        if (!isPlaying) return;
        const stillRunning = Array.from(tracks.values()).some(tr => tr.sourceNodes && tr.sourceNodes.length);
        if (!stillRunning) handleAutoStop();
      };
    }
  }
  startedAt = when;
  isPlaying = true;
  if (onPlayingChange) onPlayingChange(true);
  startTimeUpdates();
}

// Seek to an arbitrary timeline position. If playback was running it
// restarts at the new offset; if stopped, the position is queued for the
// next `play()` call and the UI playhead updates immediately.
export function seek(sec) {
  const target = Math.max(0, Math.min(sec, getDurationSec()));
  const wasPlaying = isPlaying;
  // Tear down any active sources without resetting pauseOffsetSec (which
  // `stop()` would).
  for (const t of tracks.values()) stopSources(t);
  isPlaying = false;
  stopTimeUpdates();
  pauseOffsetSec = target;
  if (wasPlaying) {
    play();
  } else {
    if (onPlayingChange) onPlayingChange(false);
    if (onTimeUpdate) onTimeUpdate(pauseOffsetSec);
  }
}

// Pause: stop active sources but PRESERVE pauseOffsetSec so the next
// play() resumes from the same spot. Different from stop() which resets
// the playhead to 0.
export function pause() {
  if (!isPlaying) return;
  const currentSec = getCurrentSec();
  for (const t of tracks.values()) stopSources(t);
  isPlaying = false;
  pauseOffsetSec = currentSec;
  if (onPlayingChange) onPlayingChange(false);
  stopTimeUpdates();
  if (onTimeUpdate) onTimeUpdate(pauseOffsetSec);
}

export function stop() {
  // Always reset, even if currently paused — the user pressed Stop and
  // expects the playhead to return to 0. Returning early when !isPlaying
  // (the old behaviour) silently kept the playhead at the pause offset.
  for (const t of tracks.values()) stopSources(t);
  const wasPlaying = isPlaying;
  isPlaying = false;
  pauseOffsetSec = 0;
  stopTimeUpdates();
  if (onPlayingChange && wasPlaying) onPlayingChange(false);
  if (onTimeUpdate) onTimeUpdate(0);
}

function handleAutoStop() {
  for (const t of tracks.values()) t.sourceNodes = [];
  isPlaying = false;
  pauseOffsetSec = 0;
  if (onPlayingChange) onPlayingChange(false);
  stopTimeUpdates();
  if (onTimeUpdate) onTimeUpdate(0);
}

function startTimeUpdates() {
  if (!onTimeUpdate) return;
  const tick = () => {
    if (!isPlaying) return;
    const sec = getCurrentSec();
    // Loop region check: if playhead crossed loopEnd, restart at loopStart.
    if (loopStart != null && loopEnd != null && sec >= loopEnd) {
      seek(loopStart);
      if (onLoop) onLoop({ from: loopEnd, to: loopStart });
      return;
    }
    onTimeUpdate(sec);
    timeUpdateRAF = requestAnimationFrame(tick);
  };
  timeUpdateRAF = requestAnimationFrame(tick);
}
function stopTimeUpdates() {
  if (timeUpdateRAF) { cancelAnimationFrame(timeUpdateRAF); timeUpdateRAF = null; }
}

export function isCurrentlyPlaying() { return isPlaying; }
