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
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.85;
  masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = 1024;
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

export function getMasterVolume() { return masterGain ? masterGain.gain.value : 0.85; }
export function setMasterVolume(v) {
  ensureCtx();
  masterGain.gain.value = Math.max(0, Math.min(1, v));
}

// Decode + register a stem from an ArrayBuffer (FileReader result).
// Returns the new track id so the UI can wire its strip immediately.
// `kind` is metadata: 'stem' (default), 'click', or 'guide'. The engine
// treats them identically — kind only affects how the UI styles + saves
// the track. Pass a pre-decoded AudioBuffer instead of arrayBuffer to
// register synthesised tracks (click, guide) without re-decoding.
export async function addTrack({ id, name, arrayBuffer, audioBuffer, kind }) {
  ensureCtx();
  const buffer = audioBuffer
    ? audioBuffer
    : await ctx.decodeAudioData(arrayBuffer.slice(0));
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.85;
  const panNode = ctx.createStereoPanner();
  panNode.pan.value = 0;
  gainNode.connect(panNode);
  panNode.connect(masterGain);

  tracks.set(id, {
    id,
    kind: kind || 'stem',
    name: name || 'Pista',
    buffer,
    gainNode,
    panNode,
    sourceNode: null,
    volume: gainNode.gain.value,
    pan: 0,
    muted: false,
    soloed: false,
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
    muted: t.muted, soloed: t.soloed, color: t.color, durationSec: t.buffer.duration
  }));
}

// Raw view including the live AudioBuffer — only used by the exporter
// when it needs to rebuild the mix graph inside an OfflineAudioContext.
export function getRawTracks() {
  return Array.from(tracks.values()).map(t => ({
    id: t.id, kind: t.kind, name: t.name, buffer: t.buffer,
    volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed, color: t.color
  }));
}

// Longest stem dictates project length (others naturally stop earlier).
export function getDurationSec() {
  let max = 0;
  for (const t of tracks.values()) if (t.buffer.duration > max) max = t.buffer.duration;
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
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gainNode);
    src.start(when, pauseOffsetSec);
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
