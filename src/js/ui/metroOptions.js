// Opciones del metrónomo de Pads en un popover (botón «Opciones»): acento del
// tiempo 1, click con secuencia, cuenta de entrada y notación de los tonos.
// Antes eran casillas sueltas en la barra que, en pantallas bajas, se ocultaban;
// aquí siempre se alcanzan. Los controles mantienen sus ids, así que el resto de
// la app (app.js, metronomeControls.js) los sigue enlazando igual.
import { q } from '../utils/dom.js';
import { isBeatAccented, setBeatAccent } from './metroBeatDots.js';

let pop = null, btn = null;

function syncDot() {
  // Un puntito en el botón cuando hay algo activado que cambia lo que se oye.
  const on = ['#click-with-seq', '#countin-toggle'].some((s) => q(s)?.checked);
  btn?.classList.toggle('has-on', on);
}
function place() {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h + 8 > window.innerHeight) top = Math.max(8, r.top - h - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
function onDown(e) { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } }
function open() {
  const acc = q('#metro-accent-one');
  if (acc) acc.checked = isBeatAccented(0);
  pop.hidden = false;
  place();
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('is-open');
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
}
function close() {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  btn.classList.remove('is-open');
  window.removeEventListener('mousedown', onDown, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', close);
}

export function initMetroOptions() {
  pop = q('#metro-opts');
  btn = q('#metro-opts-btn');
  if (!pop || !btn) return;
  document.body.appendChild(pop);   // fuera de la barra: ni la recortan ni la ocultan sus reglas
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  q('#metro-accent-one')?.addEventListener('change', (e) => setBeatAccent(0, e.target.checked));
  pop.addEventListener('change', syncDot);
  syncDot();
}
