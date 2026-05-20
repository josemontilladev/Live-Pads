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

function ensureCtx() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.85;
  masterGain.connect(ctx.destination);
  return ctx;
}

export function init({ onPlayingChange: pc, onTimeUpdate: tu } = {}) {
  onPlayingChange = pc || null;
  onTimeUpdate = tu || null;
  ensureCtx();
}

export function getMasterVolume() { return masterGain ? masterGain.gain.value : 0.85; }
export function setMasterVolume(v) {
  ensureCtx();
  masterGain.gain.value = Math.max(0, Math.min(1, v));
}

// Decode + register a stem from an ArrayBuffer (FileReader result).
// Returns the new track id so the UI can wire its strip immediately.
export async function addTrack({ id, name, arrayBuffer }) {
  ensureCtx();
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0)); // slice → keep ArrayBuffer intact for persistence later
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.85;
  const panNode = ctx.createStereoPanner();
  panNode.pan.value = 0;
  gainNode.connect(panNode);
  panNode.connect(masterGain);

  tracks.set(id, {
    id,
    name: name || 'Pista',
    buffer,
    gainNode,
    panNode,
    sourceNode: null,
    volume: gainNode.gain.value,
    pan: 0,
    muted: false,
    soloed: false
  });
  return id;
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
    id: t.id, name: t.name, volume: t.volume, pan: t.pan,
    muted: t.muted, soloed: t.soloed, durationSec: t.buffer.duration
  }));
}

// Raw view including the live AudioBuffer — only used by the exporter
// when it needs to rebuild the mix graph inside an OfflineAudioContext.
export function getRawTracks() {
  return Array.from(tracks.values()).map(t => ({
    id: t.id, name: t.name, buffer: t.buffer,
    volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed
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

export function stop() {
  if (!isPlaying) return;
  for (const t of tracks.values()) {
    if (t.sourceNode) {
      try { t.sourceNode.stop(); } catch (e) {}
      try { t.sourceNode.disconnect(); } catch (e) {}
      t.sourceNode = null;
    }
  }
  isPlaying = false;
  pauseOffsetSec = 0;
  if (onPlayingChange) onPlayingChange(false);
  stopTimeUpdates();
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
    onTimeUpdate(getCurrentSec());
    timeUpdateRAF = requestAnimationFrame(tick);
  };
  timeUpdateRAF = requestAnimationFrame(tick);
}
function stopTimeUpdates() {
  if (timeUpdateRAF) { cancelAnimationFrame(timeUpdateRAF); timeUpdateRAF = null; }
}

export function isCurrentlyPlaying() { return isPlaying; }
