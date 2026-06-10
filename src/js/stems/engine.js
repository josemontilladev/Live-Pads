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

let ctx = null;
let masterGain = null;
let isPlaying = false;
let startedAt = 0;          // ctx.currentTime when the current playback started
let pauseOffsetSec = 0;     // seek position when stopped/paused (Phase 1 always 0)

const tracks = new Map();   // id → { id, name, buffer, gainNode, panNode, sourceNode, volume }
let onPlayingChange = null;
let onTimeUpdate = null;
let timeUpdateRAF = null;

// Optional loop region — when both endpoints are set, playback bounces
// back to loopStart whenever the playhead reaches loopEnd.
let loopStart = null;  // seconds, null = disabled
let loopEnd   = null;
let onLoop = null;     // workspace-supplied callback when the loop wraps

// Master analyser exposes a tiny live-level reading so the UI can paint a
// VU meter without leaking audio internals. Float time-domain data fits
// every codec we read; we squeeze it into a peak/RMS pair on demand.
let masterAnalyser = null;
let analyserBuf = null;

function ensureCtx() {
  if (ctx) return ctx;
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
  panNode.connect(masterGain);
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
    sourceNode: null,
    volume: gainNode.gain.value,
    pan: 0,
    muted: false,
    soloed: false,
    offsetSec: offsetSec || 0,  // timeline shift: where this track begins
    color: null   // null → use theme accent; else CSS colour string
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
  if (t.sourceNode) {
    try { t.sourceNode.stop(); } catch (e) {}
    try { t.sourceNode.disconnect(); } catch (e) {}
    t.sourceNode = null;
  }
  t.buffer = audioBuffer;
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
  try { if (t.sourceNode) { t.sourceNode.stop(); t.sourceNode.disconnect(); } } catch (e) {}
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
    durationSec: t.buffer.duration
  }));
}

// Raw view including the live AudioBuffer — only used by the exporter
// when it needs to rebuild the mix graph inside an OfflineAudioContext.
export function getRawTracks() {
  return Array.from(tracks.values()).map(t => ({
    id: t.id, kind: t.kind, name: t.name, buffer: t.buffer,
    volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed, color: t.color,
    offsetSec: t.offsetSec || 0
  }));
}

// Longest stem (including its offset) dictates project length.
export function getDurationSec() {
  let max = 0;
  for (const t of tracks.values()) {
    const end = (t.offsetSec || 0) + t.buffer.duration;
    if (end > max) max = end;
  }
  return max;
}

export function getCurrentSec() {
  if (!isPlaying) return pauseOffsetSec;
  return Math.min(pauseOffsetSec + (ctx.currentTime - startedAt), getDurationSec());
}

export function play() {
  ensureCtx();
  if (isPlaying) return;
  if (tracks.size === 0) return;
  if (ctx.state === 'suspended') ctx.resume();

  // 50 ms lookahead so all sources start sample-accurate together.
  const when = ctx.currentTime + 0.05;
  for (const t of tracks.values()) {
    // Apply the per-track timeline offset: `local` is the position inside
    // this track's buffer that corresponds to the global playhead.
    const off = t.offsetSec || 0;
    const local = pauseOffsetSec - off;
    if (local >= t.buffer.duration) { t.sourceNode = null; continue; } // already ended here
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gainNode);
    if (local >= 0) src.start(when, local);
    else src.start(when - local, 0); // -local > 0 → starts in the future
    t.sourceNode = src;
    src.onended = () => {
      // If every track has reached the end (or was stopped), flip the
      // playing flag off so the UI updates.
      if (!isPlaying) return;
      const stillRunning = Array.from(tracks.values()).some(tr => tr.sourceNode && tr.sourceNode !== src);
      if (!stillRunning) handleAutoStop();
    };
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
  for (const t of tracks.values()) {
    if (t.sourceNode) {
      try { t.sourceNode.stop(); } catch (e) {}
      try { t.sourceNode.disconnect(); } catch (e) {}
      t.sourceNode = null;
    }
  }
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
  for (const t of tracks.values()) {
    if (t.sourceNode) {
      try { t.sourceNode.stop(); } catch (e) {}
      try { t.sourceNode.disconnect(); } catch (e) {}
      t.sourceNode = null;
    }
  }
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
  for (const t of tracks.values()) {
    if (t.sourceNode) {
      try { t.sourceNode.stop(); } catch (e) {}
      try { t.sourceNode.disconnect(); } catch (e) {}
      t.sourceNode = null;
    }
  }
  const wasPlaying = isPlaying;
  isPlaying = false;
  pauseOffsetSec = 0;
  stopTimeUpdates();
  if (onPlayingChange && wasPlaying) onPlayingChange(false);
  if (onTimeUpdate) onTimeUpdate(0);
}

function handleAutoStop() {
  for (const t of tracks.values()) t.sourceNode = null;
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
