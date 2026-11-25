// ─────────────────────────────────────────────────────────────────────────
// Mezcla guardada por canción. Cada canción recuerda volumen y paneo de Pads,
// Batería, Click y Pista (el Maestro no: es el volumen general de la sala).
//  · Si mueves el mezclador con una canción preparada o sonando, la mezcla queda
//    guardada para esa canción.
//  · Al preparar una canción con mezcla guardada, el mezclador se pone solo.
//  · Las canciones sin mezcla propia usan la mezcla general (la última sin canción).
// Indicador en la cabecera del Mezclador: «Mezcla general» / «Mezcla de esta canción»
// (clic = volver a la general). Guardado en este equipo: «livepads.songMix».
// ─────────────────────────────────────────────────────────────────────────

import { getSongs, getActiveSongId } from '../state/store.js';
import { pickMix, mixKeyOf } from './songMixCore.js';

const KEY = 'livepads.songMix';
export const MIX_IDS = ['mx-pads-vol', 'mx-pads-pan', 'mx-drums-vol', 'mx-drums-pan', 'mx-click-vol', 'mx-click-pan', 'mx-track-vol', 'mx-track-pan'];

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} };
const activeSong = () => { try { const id = getActiveSongId(); return id == null ? null : getSongs().find((s) => s.id === id) || null; } catch (_) { return null; } };

let applying = false, current = null, saveTimer = 0, hinted = false;

function snapshot() {
  const o = {};
  for (const id of MIX_IDS) { const el = document.getElementById(id); if (el) o[id] = Number(el.value); }
  return o;
}
function apply(mix) {
  if (!mix) return;
  applying = true;
  try {
    for (const id of MIX_IDS) {
      const el = document.getElementById(id);
      if (!el || mix[id] == null || Number(el.value) === mix[id]) continue;
      el.value = mix[id];
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } finally { applying = false; }
}

function paint() {
  const b = document.getElementById('mx-songmix');
  if (!b) return;
  const s = activeSong(), all = load(), own = s && all.songs && all.songs[mixKeyOf(s)];
  b.innerHTML = own ? '<span class="mx-sm-l">Mezcla de esta canción</span><span class="mx-sm-s">Propia</span>' : '<span class="mx-sm-l">Mezcla general</span><span class="mx-sm-s">General</span>';
  b.classList.toggle('is-on', !!own);
  b.title = own ? `«${s.title}» tiene su propia mezcla (se guarda sola al mover el mezclador). Clic: volver a la mezcla general.`
    : s ? `Mueve el mezclador y esta mezcla quedará guardada para «${s.title}».` : 'Sin canción preparada: los cambios son la mezcla general.';
}

function onSongChange() {
  const s = activeSong();
  const k = s ? mixKeyOf(s) : null;
  if (k === current) return;
  // Al salir de una canción sin mezcla propia, lo que había es la mezcla general.
  const all = load();
  if (!current || !(all.songs && all.songs[current])) { all.general = snapshot(); save(all); }
  current = k;
  apply(pickMix(all, k));
  paint();
}

function onInput(e) {
  if (applying || !e.target || !MIX_IDS.includes(e.target.id)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = load(), s = activeSong();
    if (s) {
      (all.songs ||= {})[mixKeyOf(s)] = snapshot();
      if (!hinted) { hinted = true; window.showToast?.(`Mezcla guardada para «${s.title}»: se pondrá sola al prepararla.`, 'success'); }
    } else all.general = snapshot();
    save(all); paint();
  }, 400);
}

export function initSongMix() {
  const bar = document.getElementById('mixer-bar');
  if (!bar) return;
  const title = bar.querySelector('.mx-title > span');
  if (title && !document.getElementById('mx-songmix')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'mx-songmix'; b.className = 'mx-songmix';
    title.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => {
      const s = activeSong(), all = load(), k = s && mixKeyOf(s);
      if (!k || !(all.songs && all.songs[k])) return;
      delete all.songs[k]; save(all);
      apply(all.general); paint();
      window.showToast?.(`«${s.title}» vuelve a la mezcla general.`, 'info');
    });
  }
  bar.addEventListener('input', onInput);
  window.addEventListener('livepads:song-state', onSongChange);
  current = (() => { const s = activeSong(); return s ? mixKeyOf(s) : null; })();
  paint();
}
