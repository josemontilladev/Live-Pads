// ─────────────────────────────────────────────────────────────────────────
// Vúmetro con aviso de saturación (junto al «Maestro» del mezclador y en la vista
// táctil). Lee la salida del bus principal (audio/mainBus.js: pista, pads, batería).
//   · Barra verde → amarilla (−12 dB) → roja (−3 dB) con marca del pico.
//   · «SAT»: el limitador está recortando más de 6 dB durante medio segundo, o el pico
//     toca 0 dB → la mezcla entra demasiado fuerte. Aviso (como mucho uno cada 45 s):
//     baja el Maestro o la pista.
// Solo trabaja mientras algo suena (state/performing.js): parado, no gasta nada.
// La lógica pura está en vuMeterCore.js (probada).
// ─────────────────────────────────────────────────────────────────────────

import { mainMeter } from '../audio/mainBus.js';
import { isSounding } from '../state/performing.js';
import { meterStep, meterPct } from './vuMeterCore.js';

const els = new Set();
let timer = 0, idle = 0, st = meterStep(null, { peak: -120, rms: -120, reduction: 0 }, 0), lastWarn = 0;

function paint() {
  for (const el of els) {
    if (!el.isConnected) { els.delete(el); continue; }
    el.style.setProperty('--vu', meterPct(st.level).toFixed(1) + '%');
    el.style.setProperty('--vu-peak', meterPct(st.hold).toFixed(1) + '%');
    el.dataset.zone = st.level > -3 ? 'red' : st.level > -12 ? 'yellow' : 'green';
    el.setAttribute('aria-valuenow', String(Math.round(Math.max(-60, st.level))));
    const sat = el.querySelector('.vu-sat');
    if (sat) sat.hidden = !st.sat;
    el.classList.toggle('is-sat', st.sat);
  }
}

function tick() {
  const now = performance.now();
  if (!isSounding()) {
    // Parado: la barra cae a cero y el bucle se duerme.
    st = meterStep(st, { peak: -120, rms: -120, reduction: 0 }, now);
    paint();
    if (++idle > 20) { clearInterval(timer); timer = 0; idle = 0; wake(1000); }
    return;
  }
  idle = 0;
  st = meterStep(st, mainMeter(), now);
  paint();
  if (st.sat && now - lastWarn > 45000) {
    lastWarn = now;
    window.showToast?.(`La mezcla está saturando (el limitador recorta ${Math.round(-st.reduction)} dB): baja un poco el Maestro o la Pista.`, 'warning', { ttl: 8000 });
  }
}

// Dormido: mira cada segundo si empezó a sonar algo.
let sleepTimer = 0;
function wake(ms) {
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => { if (isSounding()) start(); else wake(ms); }, ms);
}
function start() { if (!timer) timer = setInterval(tick, 60); }

/** Engancha un medidor (.vu con .vu-fill/.vu-peak/.vu-sat). */
export function attachVuMeter(el) {
  if (!el) return;
  els.add(el);
  paint();
  if (isSounding()) start(); else wake(500);
}

export function initVuMeter() {
  attachVuMeter(document.getElementById('mx-vu'));
  for (const ev of ['livepads:track-loaded', 'livepads:metro-state', 'play']) window.addEventListener(ev, () => start(), true);
}
