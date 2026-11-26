// ─────────────────────────────────────────────────────────────────────────
// Click distinto por sección. Por canción: en cada sección marcada en el espectro
// (Verso, Coro, Puente…) el click puede ir en negras, corcheas, tresillos,
// semicorcheas o callarse. Al salir de la sección vuelve a lo que esté puesto (1x/2x).
// Una regla para «Coro» vale para «Coro 2»… Guardado en este equipo: «livepads.clickSections».
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { esc } from '../utils/dom.js';
import { markersFor } from '../data/markers.js';
import { CLICK_MODES, sectionAt, ruleFor, modeToClick, baseLabel } from './clickSectionsCore.js';

const KEY = 'livepads.clickSections';
const keyOf = (s) => String((s && (s.cloudId || s.id)) ?? '');
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
export const songClickRules = (s) => load()[keyOf(s)] || null;
function setSongClickRules(s, rules) {
  const all = load(), k = keyOf(s);
  const clean = Object.fromEntries(Object.entries(rules || {}).filter(([, v]) => v));
  if (Object.keys(clean).length) all[k] = clean; else delete all[k];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) {}
}

let deps = { getMetro: () => null };
let audio = null, song = null, type = '', timer = 0, applied = null;

function clear() {
  const m = deps.getMetro();
  if (m && applied) { m.sectionMult = null; m.sectionMute = false; }
  applied = null;
}
function tick() {
  const m = deps.getMetro();
  if (!m || !audio || audio.paused || !song) { clear(); return; }
  const rules = songClickRules(song);
  if (!rules) { clear(); return; }
  const sec = sectionAt(markersFor(song, type), audio.currentTime || 0);
  const c = modeToClick(ruleFor(rules, sec && sec.label));
  const sig = c ? `${c.mult}|${c.mute}` : '';
  if (sig === applied) return;
  if (!c) { clear(); return; }
  m.sectionMult = c.mult; m.sectionMute = c.mute; applied = sig;
}

export function initClickSections(d) {
  deps = { ...deps, ...d };
  window.addEventListener('livepads:track-loaded', (e) => { audio = e.detail && e.detail.audio; song = e.detail && e.detail.song; type = (e.detail && e.detail.type) || ''; clear(); });
  window.addEventListener('livepads:track-cleared', () => { audio = null; song = null; clear(); });
  if (typeof timer === 'function') timer();
  timer = whilePlaying(tick, 120);
}

// ── Ventana ──────────────────────────────────────────────────────────────
export function openClickSectionsDialog(s) {
  if (!s) return;
  const labels = [...new Set((Array.isArray(s.markers) ? s.markers : []).slice().sort((a, b) => a.t - b.t).map((m) => m && baseLabel(m.label)).filter(Boolean))];
  const rules = songClickRules(s) || {};
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box mo-box" role="dialog" aria-modal="true" aria-label="Click por sección">
      <div class="vn-head"><b>Click por sección</b><span>${esc(s.title || '')}</span></div>
      <p class="vn-why">Cómo suena el click del metrónomo en cada parte de la canción mientras suena la pista. «Como esté» = lo que tengas puesto (1x/2x). Se guarda en este equipo.</p>
      ${labels.length ? `<div class="mo-secs">${labels.map((l) => `<label class="mo-sec"><span>${esc(l)}</span><select data-sec="${esc(l)}">${CLICK_MODES.map((o) => `<option value="${o.id}" ${(rules[l] || '') === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`).join('')}</div>`
        : '<p class="vn-why">Primero marca las secciones en el espectro de la canción (o «Detectar automáticamente»).</p>'}
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save" ${labels.length ? '' : 'disabled'}>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="cancel"]')) { close(); return; }
    if (!e.target.closest('[data-act="save"]')) return;
    const next = {};
    ov.querySelectorAll('[data-sec]').forEach((el) => { next[el.dataset.sec] = el.value; });
    setSongClickRules(s, next);
    close();
    window.showToast?.('Click por sección guardado.', 'success');
  });
}
