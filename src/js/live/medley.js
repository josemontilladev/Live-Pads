// ─────────────────────────────────────────────────────────────────────────
// Medleys: unir una canción del servicio con la siguiente, sin silencio.
//   · Salida: el final de la pista o una sección marcada (p. ej. después del coro).
//   · Entrada de la siguiente: su inicio o una sección.
//   · Fundido: la actual baja poco a poco y la siguiente arranca sola en su punto.
// El pad cambia de tono solo (como al cambiar de canción). Se guarda en este
// equipo, por canción del servicio (serviceId).
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { esc } from '../utils/dom.js';
import { getTrackAudio, getCurrentSong, preloadTrack, setPlayBtnIcon } from '../audio/trackPlayer.js';
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
let fading = null, timer = null, preloaded = null;

// Margen para pedir la siguiente ANTES del final del fundido: lo que tarda en abrirse
// (ya decodificada) + un tick. Así suena justo en el punto de salida, sin hueco.
const LEAD_S = 0.06;

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
  // La siguiente se lee y decodifica ya, mientras suena esta: al llegar la salida abre al instante.
  const next = songs[idx + 1];
  if (next && preloaded !== next.serviceId) { preloaded = next.serviceId; preloadTrack(next, 'sequence'); }
  if (audio.currentTime >= exit - (link.fade || 0) - 0.12) start(audio, link, exit);
}

// El fundido va por la POSICIÓN de la pista (no por el reloj): termina justo en la salida
// aunque el tick haya llegado tarde o la pista se haya movido.
function start(audio, link, exit) {
  const fadeS = Math.max(0, Number(link.fade) || 0);
  const v0 = audio.volume;
  fading = setInterval(() => {
    if (getTrackAudio() !== audio) { clearInterval(fading); fading = null; return; }   // cambió de canción a mano
    if (audio.paused) return;                                                         // en pausa: espera
    const left = exit - audio.currentTime;
    const k = fadeS ? Math.min(1, Math.max(0, 1 - left / fadeS)) : (left <= LEAD_S ? 1 : 0);
    try { audio.volume = v0 * (1 - k); } catch (_) {}
    if (left <= LEAD_S) { clearInterval(fading); jump(link, v0); }
  }, 5);
}

async function jump(link, vol) {
  const old = getTrackAudio();
  document.querySelector('#btn-service-next')?.click();
  // Espera la pista de la siguiente (abre al instante si ya estaba decodificada) y la
  // arranca DIRECTAMENTE en su punto de entrada: sin cuenta de entrada ni compás hablado
  // (meterían un compás de silencio en mitad del medley) y sin depender de la fuente
  // elegida abajo (con «Click» el Play maestro movería el metrónomo, no la pista).
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    const a = getTrackAudio();
    if (a && a !== old && a.buffer) {
      try { a.volume = vol; } catch (_) {}
      if (link.in > 0) { try { a.currentTime = link.in; } catch (_) {} }
      if (a.paused) { try { await a.play(); } catch (_) { deps.playCurrent(); } }
      setPlayBtnIcon(true);
      break;
    }
    if (a && a !== old && a.error) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  fading = null;
}

export function initMedley(d) {
  deps = { ...deps, ...d };
  if (typeof timer === 'function') timer();
  timer = whilePlaying(tick, 50);
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
