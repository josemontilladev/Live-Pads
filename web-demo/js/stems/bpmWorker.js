// Worker de detección de BPM/compás — corre el análisis (STFT + autocorrelación)
// fuera del hilo de UI para que "Detectar" no congele la app ni un frame.
// Recibe los canales como Float32Array (copias transferidas) y reconstruye un
// shim con la mini-interfaz de AudioBuffer que bpmDetector necesita.
import { detectTempoMeter } from './bpmDetector.js';

self.onmessage = (e) => {
  const { left, right, sampleRate } = e.data;
  const shim = {
    sampleRate,
    length: left.length,
    numberOfChannels: right ? 2 : 1,
    getChannelData: (i) => (i === 1 && right) ? right : left,
  };
  let result = null;
  try { result = detectTempoMeter(shim); } catch (_) {}
  self.postMessage(result);
};
