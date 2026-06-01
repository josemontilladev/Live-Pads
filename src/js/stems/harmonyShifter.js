// Pitch-shift offline de un AudioBuffer para crear pistas de referencia
// armónica (3ra, 5ta, 4ta abajo, etc.) sin alterar la duración.
//
// Usa OfflineAudioContext + PitchShifter (SoundTouchJS) — el mismo motor
// del track player en tiempo real, pero renderizando al disco para añadir
// la pista resultante como un track más del proyecto.
//
// API:
//   await pitchShiftBuffer(sourceBuffer, semitones, { onProgress }) → AudioBuffer
//
// Notas:
//   · El render offline corre lo más rápido posible (no atado a wall-clock).
//   · PitchShifter procesa en bloques de 4096; usamos ScriptProcessorNode
//     para alimentar el destino del OfflineAudioContext.
//   · Para canciones largas (5 min) el render típico es 5-15 s en un PC
//     modesto. El callback onProgress(0..1) permite mostrar barra.

import { PitchShifter } from '../../vendor/soundtouchjs.js';

/**
 * @param {AudioBuffer} buffer
 * @param {number} semitones  -12..+12 (típicamente)
 * @param {object} [opts]
 *   onProgress?: (fraction:number) => void
 * @returns {Promise<AudioBuffer>}
 */
export async function pitchShiftBuffer(buffer, semitones, opts = {}) {
  if (!buffer) throw new Error('Falta el AudioBuffer fuente.');
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const channels = Math.min(2, buffer.numberOfChannels);

  const offline = new OfflineAudioContext(channels, len, sr);
  const shifter = new PitchShifter(offline, buffer, 4096);
  try { shifter.tempo = 1; } catch (_) {}
  try { shifter.pitchSemitones = semitones; } catch (_) {}
  shifter.connect(offline.destination);

  // El callback 'play' del PitchShifter nos da `timePlayed`, que dividimos
  // entre la duración total para reportar progreso. El render offline no
  // emite eventos de scheduling propios, así que el shifter es la única
  // fuente de avance fiable.
  const dur = buffer.duration || (len / sr);
  if (typeof opts.onProgress === 'function') {
    try {
      shifter.on('play', (data) => {
        if (data && typeof data.timePlayed === 'number' && dur > 0) {
          opts.onProgress(Math.min(1, data.timePlayed / dur));
        }
      });
    } catch (_) {}
  }

  const rendered = await offline.startRendering();
  try { shifter.disconnect(); } catch (_) {}
  return rendered;
}

// Intervalos comunes para referencia vocal (música popular / culto).
// El "label" es lo que se mostrará en el menú; "name" se usa como sufijo
// del nombre de la pista resultante para que el usuario identifique cuál
// es cuál de un vistazo en la consola.
export const HARMONY_PRESETS = [
  { semitones: +12, label: '+12 (octava alta)',       name: 'Octava ↑' },
  { semitones: +7,  label: '+7  (5ta justa arriba)',  name: '5ta ↑' },
  { semitones: +5,  label: '+5  (4ta justa arriba)',  name: '4ta ↑' },
  { semitones: +4,  label: '+4  (3ra mayor arriba)',  name: '3ra mayor ↑' },
  { semitones: +3,  label: '+3  (3ra menor arriba)',  name: '3ra menor ↑' },
  { semitones: -3,  label: '-3  (3ra menor abajo)',   name: '3ra menor ↓' },
  { semitones: -4,  label: '-4  (3ra mayor abajo)',   name: '3ra mayor ↓' },
  { semitones: -5,  label: '-5  (4ta justa abajo)',   name: '4ta ↓' },
  { semitones: -7,  label: '-7  (5ta justa abajo)',   name: '5ta ↓' },
  { semitones: -12, label: '-12 (octava baja)',       name: 'Octava ↓' },
];
