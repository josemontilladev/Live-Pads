// Modo en vivo: la misma pantalla de Pads con solo lo esencial. Es CSS sobre
// body.live-mode (se ocultan selectores, mezclador, pestañas) más una tira
// arriba a la derecha con la canción actual, la siguiente y la hora.

import { q } from '../utils/dom.js';
import { getServiceSongs, getActiveServiceIndex, getEffectiveKey } from '../data/service.js';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtClock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export function isLiveMode() {
  return document.body.classList.contains('live-mode');
}

export function setLiveMode(on) {
  document.body.classList.toggle('live-mode', on);
  const btn = q('#btn-live-mode');
  if (btn) btn.setAttribute('aria-pressed', String(on));
  if (on) {
    q('#sidebar')?.classList.remove('open');
    const svcTab = q('.s-toggle[data-target="service-setlist-list"]');
    if (svcTab && !svcTab.classList.contains('active')) svcTab.click();
  }
  refreshLiveStrip();
  window.showToast?.(on ? 'Modo en vivo: solo lo esencial. Ctrl+L para salir.' : 'Modo en vivo desactivado.', 'info');
}

export function toggleLiveMode() {
  setLiveMode(!isLiveMode());
}

export function refreshLiveStrip() {
  if (!isLiveMode()) return;
  const songs = getServiceSongs();
  const idx = getActiveServiceIndex();
  const now = idx >= 0 ? songs[idx] : null;
  const next = idx >= 0 ? songs[idx + 1] : songs[0];
  const set = (id, text) => { const el = q('#' + id); if (el) el.textContent = text; };
  set('ls-now-title', now ? (now.title || 'Sin título') : 'Nada preparado');
  set('ls-now-artist', now ? (now.artist || '') : (songs.length ? 'Elige una canción del servicio' : 'El servicio está vacío'));
  set('ls-now-key', now ? (getEffectiveKey(now) || '') : '');
  set('ls-next-title', next ? (next.title || 'Sin título') : (songs.length ? 'Fin del servicio' : '—'));
  set('ls-next-key', next ? (getEffectiveKey(next) || '') : '');
  const pos = q('#ls-pos');
  if (pos) pos.textContent = idx >= 0 ? `${idx + 1} / ${songs.length}` : (songs.length ? `${songs.length} canciones` : '');
}

function tickClock() {
  const t = fmtClock(new Date());
  const a = q('#topbar-clock'); if (a && a.textContent !== t) a.textContent = t;
  const b = q('#live-clock');   if (b && b.textContent !== t) b.textContent = t;
}

export function initLiveMode() {
  q('#btn-live-mode')?.addEventListener('click', toggleLiveMode);
  q('#btn-live-exit')?.addEventListener('click', () => setLiveMode(false));
  window.addEventListener('livepads:song-state', refreshLiveStrip);
  tickClock();
  setInterval(tickClock, 1000);
}
