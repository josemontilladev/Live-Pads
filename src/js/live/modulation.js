// ─────────────────────────────────────────────────────────────────────────
// «Subir el tono en el último coro»: se marca DESDE DÓNDE (una sección de la
// onda o un segundo) y CUÁNTO (+1, +2… semitonos). Al llegar ese punto, la
// pista y el pad suben juntos solos, sin tocar nada en vivo; 2 s antes la banda
// recibe la indicación «Sube tono» (móviles y voz en los auriculares). Al volver
// atrás (o empezar de nuevo) vuelve al tono normal. Se guarda en este equipo.
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { esc } from '../utils/dom.js';
import { setLiveKeyOffset, getLiveKeyOffset, getCurrentSong, getTrackAudio } from '../audio/trackPlayer.js';
import { sendCue } from './directorCues.js';
import { offsetAt } from './modulationCore.js';

import { markersFor } from '../data/markers.js';
import { getCurrentType as gctMod } from '../audio/trackPlayer.js';
const KEY = 'livepads.modulations';
let readCache = null;
const read = () => { if (!readCache) { try { readCache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { readCache = {}; } } return readCache; };
export function modulationOf(id) { return id == null ? null : (read()[id] || null); }
export function setModulation(id, m) {
  const all = read();
  if (m) all[id] = m; else delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) {}
  readCache = all;
}

export { offsetAt };


let announced = false, timer = null, lastId = null;
function tick() {
  const audio = getTrackAudio(), song = getCurrentSong();
  if (!audio || !song) return;
  if (song.id !== lastId) { lastId = song.id; announced = false; }
  const mod = modulationOf(song.id);
  const t = audio.currentTime || 0;
  const want = offsetAt(mod, t);
  if (want !== getLiveKeyOffset()) setLiveKeyOffset(want);
  if (!mod) return;
  // Aviso a la banda 2 s antes (una vez por pasada; se rearma al volver atrás)
  if (!audio.paused && !announced && t >= mod.at - 2 && t < mod.at) { announced = true; sendCue(mod.semis > 0 ? 'key-up' : 'key-down', 'Modulación'); }
  if (t < mod.at - 3) announced = false;
}
export function initModulation() {
  if (typeof timer === 'function') timer();
  timer = whilePlaying(tick, 120);
}

/** Ventana para marcar la modulación de una canción. */
export function openModulationDialog(song) {
  if (!song) return;
  const cur = modulationOf(song.id);
  const ms = markersFor(song, gctMod()).filter((m) => m && Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
  const lastChorus = [...ms].reverse().find((m) => /coro|chorus/i.test(m.label || ''));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const audio = getTrackAudio(), playingThis = audio && getCurrentSong() && getCurrentSong().id === song.id;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box" role="dialog" aria-modal="true" aria-label="Subir el tono">
      <div class="vn-head"><b>Subir el tono en el último coro</b><span>${esc(song.title || '')}</span></div>
      <p class="vn-why">Desde el punto que elijas, la pista y el pad suben juntos solos. 2 s antes la banda recibe «Sube tono» en los móviles y en los auriculares.</p>
      <label class="vn-field">Desde
        <select data-ref="at">
          ${ms.map((m) => `<option value="${m.t}" ${(cur ? Math.abs(cur.at - m.t) < 0.05 : m === lastChorus) ? 'selected' : ''}>${esc(m.label)} · ${fmt(m.t)}</option>`).join('')}
          ${playingThis ? `<option value="${Math.round((audio.currentTime || 0) * 10) / 10}">La posición actual de la pista · ${fmt(audio.currentTime || 0)}</option>` : ''}
          ${cur && !ms.some((m) => Math.abs(cur.at - m.t) < 0.05) ? `<option value="${cur.at}" selected>${fmt(cur.at)} (guardado)</option>` : ''}
        </select></label>
      ${!ms.length && !playingThis ? '<p class="vn-why">Marca las secciones en la onda de la canción (o carga su pista y vuelve aquí para usar la posición actual).</p>' : ''}
      <label class="vn-field">Cuánto
        <select data-ref="semis">${[[1, '+½ tono (1 semitono)'], [2, '+1 tono (2 semitonos)'], [3, '+1½ tono'], [-1, '−½ tono'], [-2, '−1 tono']].map(([v, l]) => `<option value="${v}" ${(cur ? cur.semis === v : v === 1) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="vn-actions">
        ${cur ? '<button type="button" class="vn-btn" data-act="clear">Quitar</button>' : ''}
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save" ${ms.length || playingThis || cur ? '' : 'disabled'}>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    else if (act === 'clear') { setModulation(song.id, null); close(); window.showToast?.('Modulación quitada.', 'info'); }
    else if (act === 'save') {
      const at = Number(ov.querySelector('[data-ref="at"]').value), semis = Number(ov.querySelector('[data-ref="semis"]').value);
      if (!Number.isFinite(at)) return;
      setModulation(song.id, { at, semis });
      close();
      window.showToast?.(`Guardado: desde ${fmt(at)} la canción sube ${semis > 0 ? '+' : ''}${semis} semitono${Math.abs(semis) === 1 ? '' : 's'} sola.`, 'success');
    }
  });
}
