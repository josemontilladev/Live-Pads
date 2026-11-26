// ─────────────────────────────────────────────────────────────────────────
// Mapa de la canción en vivo: con un arreglo guardado activo, la pista sigue ese
// orden de secciones sola (lógica en songMapCore.js). Al terminar una sección,
// si la siguiente del arreglo no es la que viene en la pista, salta a su inicio
// justo en el límite, sin cortar. Si el arreglo termina antes que la pista, la
// canción acaba con «Terminar suave».
// Convive con el arreglo en vivo (arrange.js): si alguien prepara un salto a mano,
// manda ese; después el mapa se vuelve a situar.
// ─────────────────────────────────────────────────────────────────────────

import { markersFor } from '../data/markers.js';
import { sectionsOf, locate, nextStep, cleanArrangements } from './songMapCore.js';
import { registerMapJumpProvider, getLivePendingJump } from './arrange.js';

let audio = null, song = null, type = '', ai = -1, timer = 0, ended = false;

export function activeMap(s = song) {
  const a = cleanArrangements(s && s.arrangements);
  return a.active ? a.list.find((x) => x.id === a.active) || null : null;
}

let secCache = { key: '', list: [] };
function sections() {
  if (!song) return [];
  const ms = markersFor(song, type);
  const key = `${song.id}|${type}|${Math.round((audio && audio.duration) || 0)}|${ms.length}|${ms.map((m) => m.t).join(',')}`;
  if (secCache.key !== key) secCache = { key, list: sectionsOf(ms, audio && audio.duration) };
  return secCache.list;
}

/** El próximo salto del mapa { at, to, label } (para la onda, la letra y la guía hablada). */
export function plannedMapJump() {
  const m = activeMap();
  if (!m || !audio || ended) return null;
  const S = sections();
  const t = audio.currentTime || 0;
  ai = locate(S, m.order, t, ai);
  if (ai < 0) return null;
  const st = nextStep(S, m.order, ai);
  if (!st || st.end) return st && st.end ? { at: st.at, to: st.at, label: 'Final del arreglo', end: true } : null;
  return { at: st.at, to: st.to, label: st.label, map: true };
}

function tick() {
  if (!audio || audio.paused || !song || !(song.arrangements && song.arrangements.active)) return;
  if (getLivePendingJump()) return;          // un salto a mano manda
  const m = activeMap();
  if (!m) return;
  const S = sections();
  const t = audio.currentTime || 0;
  ai = locate(S, m.order, t, ai);
  if (ai < 0) return;
  const st = nextStep(S, m.order, ai);
  if (!st) return;
  if (st.end) {
    // Fin del arreglo: terminar suave unos segundos antes del límite.
    if (!ended && t >= st.at - 2.5) { ended = true; document.getElementById('tp-softend-btn')?.click(); }
    return;
  }
  if (t < st.at - 0.006) return;
  const over = Math.max(0, Math.min(0.15, t - st.at));
  try { audio.currentTime = st.to + over; } catch (_) {}
  ai = st.ai;
}

export function initSongMap() {
  registerMapJumpProvider(plannedMapJump);
  window.addEventListener('livepads:track-loaded', (e) => {
    audio = e.detail && e.detail.audio; song = e.detail && e.detail.song; type = (e.detail && e.detail.type) || '';
    ai = -1; ended = false;
  });
  window.addEventListener('livepads:track-cleared', () => { audio = null; song = null; ai = -1; });
  window.addEventListener('livepads:song-map', () => { ai = -1; ended = false; });
  clearInterval(timer);
  timer = setInterval(() => {
    if (audio && !audio.paused && (audio.currentTime || 0) < 1) ended = false;   // vuelta a empezar
    tick();
  }, 5);
}

export const currentMapSong = () => song;

/** Para las pruebas automáticas: estado interno (sin tocarlo). */
export function _mapDebug() {
  const m = activeMap();
  const S = sections();
  return { song: song && song.id, sameAsLib: !!song, audio: !!audio, paused: audio ? audio.paused : null, t: audio ? audio.currentTime : null, active: m && m.name, order: m && m.order, ai, ended, sections: S.map((x) => `${x.label}#${x.n}@${x.s}-${x.e}`) };
}
