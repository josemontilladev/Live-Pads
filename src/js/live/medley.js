// ─────────────────────────────────────────────────────────────────────────
// Medleys: unir una canción del servicio con la siguiente, sin silencio.
//   · Salida: el final de la pista o una sección marcada (p. ej. después del coro).
//   · Entrada de la siguiente: su inicio o una sección.
//   · Fundido: la actual baja poco a poco y la siguiente arranca sola en su punto.
// El pad cambia de tono solo (como al cambiar de canción). Se guarda en este
// equipo, por canción del servicio (serviceId).
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { getTrackAudio, getCurrentSong } from '../audio/trackPlayer.js';
import { getServiceSongs, getActiveServiceIndex } from '../data/service.js';
import { medleyExitAt } from './medleyCore.js';

import { markersFor } from '../data/markers.js';
import { getCurrentType as gctMedley } from '../audio/trackPlayer.js';
const KEY = 'livepads.medleys';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
export function medleyOf(serviceId) { return serviceId == null ? null : (read()[serviceId] || null); }
export function setMedley(serviceId, m) {
  const all = read();
  if (m) all[serviceId] = m; else delete all[serviceId];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) {}
}

let deps = { playCurrent: () => {} };
let fading = null, timer = null;

function tick() {
  if (fading) return;
  const audio = getTrackAudio(), cur = getCurrentSong();
  if (!audio || audio.paused || !cur) return;
  const songs = getServiceSongs(), idx = getActiveServiceIndex();
  const active = songs[idx];
  if (!active || idx >= songs.length - 1) return;
  if (cur.serviceId !== active.serviceId && cur.id !== active.id) return;
  const link = medleyOf(active.serviceId);
  if (!link) return;
  const exit = medleyExitAt(link, audio.duration);
  if (!Number.isFinite(exit)) return;
  if (audio.currentTime >= exit - (link.fade || 0)) start(audio, link);
}

function start(audio, link) {
  const fadeS = Math.max(0, Number(link.fade) || 0);
  const v0 = audio.volume;
  const t0 = performance.now();
  fading = setInterval(() => {
    const k = fadeS ? Math.min(1, (performance.now() - t0) / (fadeS * 1000)) : 1;
    try { audio.volume = v0 * (1 - k); } catch (_) {}
    if (k >= 1) { clearInterval(fading); jump(link, v0); }
  }, 50);
}

async function jump(link, vol) {
  document.querySelector('#btn-service-next')?.click();
  // Espera a que se cargue la pista de la siguiente; arranca en su punto de entrada.
  const old = getTrackAudio();
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const a = getTrackAudio();
    if (a && a !== old && (a.buffer || a.readyState > 0)) {
      try { a.volume = vol; } catch (_) {}
      if (link.in > 0) { try { a.currentTime = link.in; } catch (_) {} }
      if (a.paused) deps.playCurrent();
      break;
    }
  }
  fading = null;
}

export function initMedley(d) {
  deps = { ...deps, ...d };
  clearInterval(timer);
  timer = setInterval(tick, 100);
}

/** Ventana: unir esta canción del servicio con la siguiente. */
export function openMedleyDialog(song) {
  const songs = getServiceSongs();
  const i = songs.findIndex((s) => s.serviceId === song.serviceId);
  const next = i >= 0 ? songs[i + 1] : null;
  if (!next) { window.showToast?.('Esta es la última canción del servicio: no hay siguiente con la que unirla.', 'info'); return; }
  const cur = medleyOf(song.serviceId);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const marks = (s) => markersFor(s, gctMedley()).filter((m) => m && Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box" role="dialog" aria-modal="true" aria-label="Medley">
      <div class="vn-head"><b>Medley: unir con la siguiente</b><span>${esc(song.title || '')} → ${esc(next.title || '')}</span></div>
      <p class="vn-why">Al llegar al punto de salida, esta canción baja poco a poco y «${esc(next.title || '')}» arranca sola, sin silencio. El pad cambia de tono solo.</p>
      <label class="vn-field">Salir de «${esc(song.title || '')}»
        <select data-ref="out"><option value="">Al final de la pista</option>${marks(song).map((m) => `<option value="${m.t}" ${cur && cur.out === m.t ? 'selected' : ''}>Al empezar «${esc(m.label)}» · ${fmt(m.t)}</option>`).join('')}</select></label>
      <label class="vn-field">Entrar en «${esc(next.title || '')}»
        <select data-ref="in"><option value="0">Desde el inicio</option>${marks(next).map((m) => `<option value="${m.t}" ${cur && cur.in === m.t ? 'selected' : ''}>En «${esc(m.label)}» · ${fmt(m.t)}</option>`).join('')}</select></label>
      <label class="vn-field">Fundido
        <select data-ref="fade">${[[0, 'Sin fundido (corte)'], [1, '1 s'], [2, '2 s'], [3, '3 s'], [5, '5 s'], [8, '8 s']].map(([v, l]) => `<option value="${v}" ${(cur ? cur.fade === v : v === 3) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="vn-actions">
        ${cur ? '<button type="button" class="vn-btn" data-act="clear">Quitar</button>' : ''}
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const val = (r) => ov.querySelector(`[data-ref="${r}"]`).value;
    if (act === 'cancel') close();
    else if (act === 'clear') { setMedley(song.serviceId, null); close(); window.showToast?.('Medley quitado.', 'info'); }
    else if (act === 'save') {
      setMedley(song.serviceId, { out: val('out') === '' ? null : Number(val('out')), in: Number(val('in')) || 0, fade: Number(val('fade')) || 0 });
      close();
      window.showToast?.(`Medley guardado: «${song.title}» enlaza sola con «${next.title}».`, 'success');
    }
  });
}
