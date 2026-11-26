// ─────────────────────────────────────────────────────────────────────────
// Arreglo en vivo (botón «Arreglo» del espectro, o pedal/MIDI/tecla):
// «Repetir esta sección», «Saltar a la siguiente», «Ir al coro», «Ir al puente»,
// «Ir al final». La pista salta justo al terminar el compás (o la sección, al
// repetir), con los compases reales del modelo de pulsos. Con la guía hablada
// activa, la voz anuncia adónde se va. La lógica vive en arrangeCore.js.
// ─────────────────────────────────────────────────────────────────────────

import { markersFor } from '../data/markers.js';
import { ACTIONS, planJump, JUMP_MODES } from './arrangeCore.js';

// Cuándo entra el salto: «Ya», «Al compás» (por defecto) o «Al final de la sección». Se recuerda.
const MODE_KEY = 'livepads.jumpMode';
export const jumpMode = () => { try { const m = localStorage.getItem(MODE_KEY); return m in JUMP_MODES ? m : 'bar'; } catch (_) { return 'bar'; } };
export function setJumpMode(m) { if (!(m in JUMP_MODES)) return; try { localStorage.setItem(MODE_KEY, m); } catch (_) {} paint(); }
const WHEN = { now: 'ya', bar: 'al terminar el compás', section: 'al terminar la sección' };
import { placePop, claimPop } from '../utils/placePop.js';

let audio = null, song = null, type = '', downs = null, pending = null, fast = 0, gridFor = null;
function ensureGrid() { if (audio && audio.buffer && gridFor !== audio) { gridFor = audio; loadGrid(audio, song, type); } }

const pop = () => document.getElementById('arr-pop');
const btn = () => document.getElementById('sw-arrange');

function paint() {
  const b = btn();
  if (b) {
    b.classList.toggle('is-on', !!pending);
    b.querySelector('span').textContent = pending ? `${pending.action === 'repeat' ? '↺' : '→'} ${pending.label}` : 'Arreglo';
    b.title = pending ? `${pending.action === 'repeat' && jumpMode() !== 'now' ? 'Al terminar la sección' : WHEN[jumpMode()][0].toUpperCase() + WHEN[jumpMode()].slice(1)}: ${pending.action === 'repeat' ? 'repite' : 'va a'} «${pending.label}». Pulsa para cambiar o cancelar.` : 'Arreglo en vivo: repetir una sección o saltar a otra sin cortar el compás';
  }
  const st = document.querySelector('#arr-pop .arr-status');
  if (st) st.textContent = pending ? `Preparado: ${pending.action === 'repeat' ? 'repetir' : 'ir a'} «${pending.label}»` : (downs || jumpMode() !== 'bar' ? `Elige qué hacer: entra ${WHEN[jumpMode()]}.` : 'Analizando los compases de la pista…');
  document.querySelectorAll('#arr-pop [data-jm]').forEach((x) => { const on = x.dataset.jm === jumpMode(); x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
}

async function loadGrid(a, s, t) {
  downs = null; paint();
  if (!a || !a.buffer) return;
  try {
    const B = await import('../analysis/beatGrid.js');
    const r = await B.analyzeBeats(a.buffer, B.trackKey(s, t, a.buffer));
    if (audio !== a || !r) return;
    downs = r.downbeats && r.downbeats.length ? r.downbeats : (r.beats || []).filter((_, i) => i % (r.beatsPerBar || 4) === 0);
    paint();
  } catch (_) {}
}

function cancel(silent) {
  pending = null; clearInterval(fast); fast = 0; paint();
  if (!silent) window.showToast?.('Salto cancelado: la canción sigue normal.', 'info');
}

/** Salto preparado a mano { at, to, label, action } o null. */
export const getLivePendingJump = () => pending;
// El mapa de la canción (live/songMap.js) aporta su próximo salto: así la onda, la letra
// y la guía hablada anuncian también los saltos del arreglo guardado.
let mapProvider = null;
export function registerMapJumpProvider(fn) { mapProvider = typeof fn === 'function' ? fn : null; }
/** Salto que viene: el preparado a mano o, si no hay, el del mapa de la canción (o null). */
export const getPendingJump = () => pending || (mapProvider ? (() => { try { const j = mapProvider(); return j && !j.end ? j : null; } catch (_) { return null; } })() : null);

export function arrange(action) {
  if (action === 'cancel') { cancel(); return; }
  if (!audio || !song) { window.showToast?.('Carga una canción con su pista para cambiar el arreglo en vivo.', 'info'); return; }
  ensureGrid();
  const ms = markersFor(song, type);
  if (!ms.length) { window.showToast?.('Esta pista no tiene secciones: márcalas o usa «Detectar automáticamente» en el espectro.', 'info'); return; }
  const j = planJump(action, ms, audio.currentTime || 0, downs, jumpMode());
  if (!j) { window.showToast?.('No hay adónde saltar desde aquí.', 'info'); return; }
  pending = { ...j, action };
  paint();
  clearInterval(fast);
  fast = setInterval(watch, 5);
  document.getElementById('arr-pop')?.setAttribute('hidden', '');
}

function watch() {
  if (!pending || !audio) { cancel(true); return; }
  if (audio.paused) return;
  const t = audio.currentTime || 0;
  if (t < pending.at - 0.006) { if (pending.at - t > 0.4) { /* lejos: comprobar despacio */ } return; }
  const over = Math.max(0, Math.min(0.15, t - pending.at));
  try { audio.currentTime = pending.to + over; } catch (_) {}
  const done = pending;
  cancel(true);
  window.showToast?.(`${done.action === 'repeat' ? 'Repitiendo' : 'Ahora'}: «${done.label}»`, 'success');
}

export function initArrange() {
  window.addEventListener('livepads:track-loaded', (e) => {
    cancel(true);
    audio = e.detail && e.detail.audio; song = e.detail && e.detail.song; type = (e.detail && e.detail.type) || '';
    downs = null; gridFor = null;   // los compases se piden al usarlo (no al cargar: la carga va más fluida)
  });
  window.addEventListener('livepads:track-cleared', () => { cancel(true); audio = null; song = null; });
  // Panel (siempre en el DOM: así sus botones se pueden asignar a un pedal o MIDI aunque esté cerrado).
  const b = btn();
  if (!b) return;
  const p = document.createElement('div');
  p.id = 'arr-pop'; p.className = 'vg-pop arr-pop'; p.hidden = true; p.setAttribute('role', 'dialog');
  p.innerHTML = `<div class="vg-title">Arreglo en vivo</div><div class="arr-status"></div>
    <div class="ui-seg arr-mode" role="group" aria-label="Cuándo entra el salto">${Object.entries(JUMP_MODES).map(([k, l]) => `<button type="button" class="ui-seg-btn" data-jm="${k}" title="El salto entra ${WHEN[k]}">${l}</button>`).join('')}</div>
    <div class="arr-grid">${ACTIONS.map((a) => `<button type="button" data-arr="${a.id}">${a.label}</button>`).join('')}</div>
    <button type="button" class="vg-test" data-arr="cancel">Cancelar el salto</button>
    <button type="button" class="arr-map" data-arr-map="1">Mapa de la canción (arreglo guardado)…<small data-ref="mapname"></small></button>
    <small class="arr-tip">Cada acción se puede asignar a un pedal o botón MIDI (Ajustes → MIDI → Aprender).</small>`;
  document.body.appendChild(p);
  p.addEventListener('click', (e) => {
    if (e.target.closest('[data-arr-map]')) { hide(); if (song) import('../ui/songMapEditor.js').then((m) => m.openSongMap(song, { type, duration: audio && audio.duration })); else window.showToast?.('Carga una canción con su pista para armar su mapa.', 'info'); return; }
    const jm = e.target.closest('[data-jm]'); if (jm) { setJumpMode(jm.dataset.jm); return; }
    const a = e.target.closest('[data-arr]'); if (a) arrange(a.dataset.arr);
  });
  let release = null;
  const hide = () => { p.hidden = true; if (release) { release(); release = null; } };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!p.hidden) { hide(); return; }
    p.hidden = false; ensureGrid(); paint();
    import('./songMap.js').then((m) => { const a = m.activeMap(song); const el = p.querySelector('[data-ref="mapname"]'); if (el) el.textContent = a ? `En uso: ${a.name}` : 'Versión corta, coros de más… sin cortes'; });
    release = claimPop('arrange', hide);   // «Voz» u otro panel abierto: se cierra
    placePop(p, b);
  });
  document.addEventListener('pointerdown', (e) => { if (!p.hidden && !p.contains(e.target) && !e.target.closest('#sw-arrange')) hide(); }, true);
  paint();
}
