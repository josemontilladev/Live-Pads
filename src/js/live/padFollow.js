// ─────────────────────────────────────────────────────────────────────────
// Pad que sigue los acordes: con el pad sonando y la pista en marcha, el pad
// cambia al acorde que suena en cada momento (del análisis de acordes de la
// pista, en el tono que suena), con un fundido corto. Suena mucho más musical
// que un pad fijo en la tónica. Sin análisis de la pista, el pad no cambia.
// Interruptor «Sigue acordes» junto a Mayor/Menor.
// ─────────────────────────────────────────────────────────────────────────

import { getTrackAudio, getCurrentSong, getCurrentType, getTrackPitch } from '../audio/trackPlayer.js';
import { cacheGet, trackChordId } from '../chords/trackChords.js';
import { chordAtTime } from './padFollowCore.js';

const PREF = 'livepads.padFollow';
export const padFollowOn = () => { try { return localStorage.getItem(PREF) === '1'; } catch (_) { return false; } };

let deps = { playPadChord: () => {}, padActive: () => false, prefetchChord: () => {} };
let lastSig = '', timer = null, segsFor = null, segs = null;

export { chordAtTime };

function tick() {
  if (!padFollowOn() || !deps.padActive()) return;
  const audio = getTrackAudio(), song = getCurrentSong();
  if (!audio || audio.paused || !song || !audio.buffer) return;
  const id = trackChordId(song, getCurrentType(), audio.buffer);
  if (segsFor !== id) {
    const a = cacheGet(id);
    segs = a && Array.isArray(a.seg) ? a.seg.filter((s) => s.r >= 0) : null;
    segsFor = id;
    // Precarga los pads de los acordes de la canción (los que más duran primero).
    if (segs) {
      const shift = getTrackPitch() || 0, dur = new Map();
      for (const s of segs) { const pc = (((s.r + shift) % 12) + 12) % 12, m = s.q === 1 || s.q === 4, k = pc + (m ? 'm' : ''); dur.set(k, (dur.get(k) || 0) + (s.e - s.s)); }
      [...dur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k]) => { try { deps.prefetchChord(parseInt(k, 10), k.endsWith('m')); } catch (_) {} });
    }
  }
  if (!segs || !segs.length) return;
  const c = chordAtTime(segs, audio.currentTime || 0);
  if (!c) return;
  const shift = getTrackPitch() || 0;
  const pc = (((c.r + shift) % 12) + 12) % 12, minor = c.q === 1 || c.q === 4;
  const sig = pc + (minor ? 'm' : '');
  if (sig === lastSig) return;
  lastSig = sig;
  deps.playPadChord(pc, minor);
}

export function setPadFollow(on) {
  try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (_) {}
  lastSig = '';
  paintBtn();
  window.showToast?.(on ? 'El pad seguirá los acordes de la pista (cuando esté analizada).' : 'El pad vuelve a quedarse en el tono de la canción.', 'info');
}
function paintBtn() {
  const b = document.getElementById('pad-follow');
  if (b) { b.classList.toggle('is-on', padFollowOn()); b.setAttribute('aria-pressed', padFollowOn() ? 'true' : 'false'); }
}

export function initPadFollow(d) {
  deps = { ...deps, ...d };
  document.getElementById('pad-follow')?.addEventListener('click', () => setPadFollow(!padFollowOn()));
  window.addEventListener('livepads:track-loaded', () => { segsFor = null; lastSig = ''; });
  window.addEventListener('livepads:chords-ready', () => { segsFor = null; });
  paintBtn();
  clearInterval(timer);
  timer = setInterval(tick, 100);
}
