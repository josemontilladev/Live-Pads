// ─────────────────────────────────────────────────────────────────────────
// Batería y corriente del portátil. Un cable que se suelta a mitad del servicio
// no se nota… hasta que el portátil se apaga o baja el rendimiento y el audio se
// corta. Aquí se vigila:
//   · Se desenchufa → aviso al momento (más fuerte si está sonando algo).
//   · Con batería: chip en la barra superior con el % (en rojo por debajo del 20 %),
//     y avisos al bajar del 20 % y del 10 %.
//   · Se vuelve a enchufar → el chip desaparece.
// Un equipo de sobremesa (siempre «cargando», 100 %) no muestra nada.
// ─────────────────────────────────────────────────────────────────────────

import { isSounding } from '../state/performing.js';

let battery = null, chip = null, warned20 = false, warned10 = false;

/** Estado para la revisión antes del servicio: null si el equipo no informa. */
export function powerState() {
  if (!battery) return null;
  return { charging: !!battery.charging, level: Math.round((battery.level || 0) * 100) };
}

function paintChip() {
  const s = powerState();
  const show = s && !s.charging;
  if (!show) { if (chip) chip.hidden = true; return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'power-chip';
    chip.className = 'power-chip';
    chip.addEventListener('click', () => window.showToast?.(`El portátil funciona con batería (${powerState().level} %). Conecta el cargador antes del servicio: con batería Windows puede bajar el rendimiento y cortar el audio.`, 'warning', { ttl: 8000 }));
    const clock = document.getElementById('topbar-clock');
    if (clock && clock.parentNode) clock.parentNode.insertBefore(chip, clock); else document.body.appendChild(chip);
  }
  chip.hidden = false;
  chip.classList.toggle('is-low', s.level <= 20);
  chip.title = `Sin cargador: funciona con batería (${s.level} %)`;
  chip.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><rect x="4" y="9" width="${Math.max(1, Math.round(13 * s.level / 100))}" height="6" rx="1" fill="currentColor" stroke="none"/></svg><span>${s.level} %</span>`;
}

function onCharging() {
  const s = powerState();
  if (!s) return;
  if (!s.charging) {
    const live = isSounding();
    window.showToast?.(`${live ? '¡Atención! ' : ''}El portátil se desenchufó: funciona con batería (${s.level} %). Revisa el cable del cargador.`, live ? 'error' : 'warning', { ttl: 10000 });
  } else { warned20 = false; warned10 = false; }
  paintChip();
}

function onLevel() {
  const s = powerState();
  if (!s) return;
  paintChip();
  if (s.charging) return;
  if (s.level <= 10 && !warned10) { warned10 = true; warned20 = true; window.showToast?.(`Batería al ${s.level} %: conecta el cargador ya, el portátil puede apagarse.`, 'error', { ttl: 12000 }); }
  else if (s.level <= 20 && !warned20) { warned20 = true; window.showToast?.(`Batería al ${s.level} %: conecta el cargador.`, 'warning', { ttl: 9000 }); }
}

export async function initPowerWatch(fake = null) {
  if (!fake && !navigator.getBattery) return;
  try { battery = fake || await navigator.getBattery(); } catch (_) { battery = null; }
  if (!battery) return;
  battery.addEventListener('chargingchange', onCharging);
  battery.addEventListener('levelchange', onLevel);
  paintChip();
  onLevel();
}
