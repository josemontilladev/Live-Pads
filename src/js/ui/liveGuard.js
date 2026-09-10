// "¿Hay algo sonando ahora mismo?" y la confirmación extra que piden las
// acciones destructivas mientras suena: un clic mal dado en pleno servicio no
// debería costar nada.

import { confirmDialogAsync } from './dialog.js';
import { getActiveKey, getMetroRunning } from '../state/store.js';
import { isTrackPlaying } from '../audio/trackPlayer.js';

export function isLiveAudio() {
  return isTrackPlaying() || getMetroRunning() || !!getActiveKey();
}

// Texto para anteponer al mensaje de un diálogo de confirmación ya existente.
export function livePrefix() {
  return isLiveAudio() ? 'Hay audio sonando ahora mismo. ' : '';
}

// Para acciones que hoy no confirman: resuelve true si se puede seguir.
export function guardLiveAction(actionLabel) {
  if (!isLiveAudio()) return Promise.resolve(true);
  return confirmDialogAsync({
    title: 'Estás en vivo',
    message: `Hay audio sonando ahora mismo. ¿${actionLabel} de todas formas?`,
    confirmLabel: 'Sí, continuar',
    cancelLabel: 'Cancelar',
    danger: true,
  });
}
