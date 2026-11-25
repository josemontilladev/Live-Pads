// ─────────────────────────────────────────────────────────────────────────
// Arreglo en vivo (botón «Arreglo» del espectro, o pedal/MIDI/tecla):
// «Repetir esta sección», «Saltar a la siguiente», «Ir al coro», «Ir al puente»,
// «Ir al final». La pista salta justo al terminar el compás (o la sección, al
// repetir), con los compases reales del modelo de pulsos. Con la guía hablada
// activa, la voz anuncia adónde se va. La lógica vive en arrangeCore.js.
// ─────────────────────────────────────────────────────────────────────────

import { markersFor } from '../data/markers.js';
import { ACTIONS, planJump } from './arrangeCore.js';
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
    b.title = pending ? `Al terminar el ${pending.action === 'repeat' ? 'tramo' : 'compás'}: ${pending.action === 'repeat' ? 'repite' : 'va a'} «${pending.label}». Pulsa para cambiar o cancelar.` : 'Arreglo en vivo: repetir una sección o saltar a otra sin cortar el compás';
  }
  const st = document.querySelector('#arr-pop .arr-status');
  if (st) st.textContent = pending ? `Preparado: ${pending.action === 'repeat' ? 'repetir' : 'ir a'} «${pending.label}»` : (downs ? 'Elige qué hacer: entra al terminar el compás.' : 'Analizando los compases de la pista…');
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

/** Salto preparado { at, to, label, action } o null (lo usa la guía hablada). */
export const getPendingJump = () => pending;

export function arrange(action) {
  if (action === 'cancel') { cancel(); return; }
  if (!audio || !song) { window.showToast?.('Carga una canción con su pista para cambiar el arreglo en vivo.', 'info'); return; }
  ensureGrid();
  const ms = markersFor(song, type);
  if (!ms.length) { window.showToast?.('Esta pista no tiene secciones: márcalas o usa «Detectar automáticamente» en el espectro.', 'info'); return; }
  const j = planJump(action, ms, audio.currentTime || 0, downs);
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
    <div class="arr-grid">${ACTIONS.map((a) => `<button type="button" data-arr="${a.id}">${a.label}</button>`).join('')}</div>
    <button type="button" class="vg-test" data-arr="cancel">Cancelar el salto</button>
    <small class="arr-tip">Cada acción se puede asignar a un pedal o botón MIDI (Ajustes → MIDI → Aprender).</small>`;
  document.body.appendChild(p);
  p.addEventListener('click', (e) => { const a = e.target.closest('[data-arr]'); if (a) arrange(a.dataset.arr); });
  let release = null;
  const hide = () => { p.hidden = true; if (release) { release(); release = null; } };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!p.hidden) { hide(); return; }
    p.hidden = false; ensureGrid(); paint();
    release = claimPop('arrange', hide);   // «Voz» u otro panel abierto: se cierra
    placePop(p, b);
  });
  document.addEventListener('pointerdown', (e) => { if (!p.hidden && !p.contains(e.target) && !e.target.closest('#sw-arrange')) hide(); }, true);
  paint();
}
