// ─────────────────────────────────────────────────────────────────────────
// Reproductor flotante: al minimizar LivePads mientras suena algo aparece una
// ventanita siempre encima (main.js · mini.html) con la canción, la sección, el
// tiempo y play/pausa, siguiente y volver. Aquí se le manda el estado y se hacen sus
// órdenes. Ajustes → Audio → «Reproductor flotante al minimizar» (encendido de serie).
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { getCurrentSong, getTrackAudio, getCurrentType } from '../audio/trackPlayer.js';
import { getServiceSongs, peekNextServiceSong, serviceNextSong, getEffectiveKey } from '../data/service.js';
import { markersFor } from '../data/markers.js';
import { isSounding } from '../state/performing.js';

const KEY = 'livepads.miniPlayer';
export const miniPlayerOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (_) { return true; } };
export function setMiniPlayer(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {} publish(); }

function colors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { '--bg': v('--bg-surface') || v('--bg'), '--text': v('--text'), '--muted': v('--text-muted'), '--accent': v('--accent'), '--on-accent': v('--on-accent') };
}

let last = '';
function publish() {
  const api = window.electronAPI;
  if (!api?.miniState) return;
  const song = getCurrentSong();
  const a = getTrackAudio();
  const t = a ? a.currentTime || 0 : 0;
  let section = '';
  if (song) { for (const m of (markersFor(song, getCurrentType()) || []).slice().sort((x, y) => x.t - y.t)) if (m.t <= t + 0.05) section = m.label; }
  const next = getServiceSongs().length > 1 ? peekNextServiceSong() : null;
  const st = {
    enabled: miniPlayerOn(),
    title: song ? song.title : (isSounding() ? 'Pads' : 'LivePads'),
    key: song ? (getEffectiveKey(song) || song.key || '') : '',
    section, next: next && (!song || String(next.id) !== String(song.id)) ? next.title : '', hasNext: !!next,
    t, dur: a && Number.isFinite(a.duration) ? a.duration : 0,
    playing: !!(a && !a.paused) || isSounding(),
    colors: colors(),
  };
  // Sin cambios (salvo el tiempo) no se manda nada.
  const sig = JSON.stringify({ ...st, t: Math.round(st.t) });
  if (sig === last) return;
  last = sig;
  api.miniState(st);
}

export function initMiniPlayer() {
  const api = window.electronAPI;
  if (!api?.miniState) return;
  whilePlaying(publish, 1000, { idleMs: 4000 });
  window.addEventListener('livepads:track-loaded', () => setTimeout(publish, 300));
  window.addEventListener('livepads:track-cleared', () => setTimeout(publish, 100));
  api.onMiniCmd?.((cmd) => {
    if (cmd === 'toggle') document.getElementById('tp-play-btn')?.click();
    else if (cmd === 'next') serviceNextSong();
    setTimeout(publish, 150);
  });
  publish();
}
