// Transición entre tonos, en vivo: el pad recorre el puente (live/transitionCore.js) — dos compases por
// acorde al BPM actual — y la banda ve los acordes en sus móviles y en la pantalla.
import { planTransition } from './transitionCore.js';
import { sendText } from './directorCues.js';

let deps = { playPadKey: () => {}, bpm: () => 0, keys: () => ({ from: '', to: '' }) };
let running = null;

export function initKeyTransition(d) { deps = { ...deps, ...d }; }

export function transitionPlan() {
  const { from, to } = deps.keys();
  return { from, to, steps: planTransition(from, to) };
}

/** Toca la transición al tono de la siguiente canción. Devuelve false si no hace falta. */
export function playTransition() {
  const { steps } = transitionPlan();
  if (steps.length < 2) { window.showToast?.('La siguiente canción está en el mismo tono (o no tiene tono): no hace falta transición.', 'info'); return false; }
  clearTimeout(running);
  const bpm = Number(deps.bpm()) || 90;
  const stepS = Math.max(3, Math.min(8, (8 * 60) / bpm));   // dos compases de 4/4
  sendText('Transición: ' + steps.map((s) => s.name).join(' → '), 'Pad');
  let i = 1;   // el primero es el tono que ya suena
  const next = () => {
    const s = steps[i++];
    if (!s) { running = null; return; }
    try { deps.playPadKey(s.pc, s.minor); } catch (_) {}
    running = setTimeout(next, stepS * 1000);
  };
  next();
  return true;
}
export function stopTransition() { clearTimeout(running); running = null; }
