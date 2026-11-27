// «En espera»: el PC de respaldo sigue al principal en silencio. Mientras tanto no
// debe mandar nada hacia fuera (MIDI, reloj MIDI, proyección, Companion), porque el
// principal ya lo está mandando. Lo consultan esos módulos antes de enviar.
let on = false;
export const isStandby = () => on;
export function setStandbyFlag(v) {
  const n = !!v;
  if (n === on) return;
  on = n;
  try { window.dispatchEvent(new CustomEvent('livepads:standby', { detail: { on } })); } catch (_) {}
}
