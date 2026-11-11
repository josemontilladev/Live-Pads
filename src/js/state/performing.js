// ¿Se está tocando ahora mismo? (Modo en vivo activo o algo sonando.)
// Lo consultan las tareas de fondo —sincronización, actualización obligatoria,
// descarga de actualizaciones— para NO interrumpir ni competir por el hilo que
// atiende el MIDI y el audio en pleno servicio.
//
//   registerPlayingProbe(fn)  cada motor aporta su «¿estoy sonando?»
//   isPerforming()            true si hay Modo en vivo o algún motor suena
const probes = [];

export function registerPlayingProbe(fn) {
  if (typeof fn === 'function') probes.push(fn);
}

export function isPerforming() {
  try { if (document.body.classList.contains('live-mode')) return true; } catch (_) {}
  for (const fn of probes) {
    try { if (fn()) return true; } catch (_) {}
  }
  return false;
}

// El proceso principal lo consulta antes de bajar una actualización en segundo plano.
try { window.__lpPerforming = isPerforming; } catch (_) {}
