// ─────────────────────────────────────────────────────────────────────────
// Separación de stems en un hilo aparte (worker_threads). Antes corría en el
// proceso principal: la STFT/iSTFT en JavaScript lo ocupaba durante minutos y
// todo lo que pasa por él (guardar, leer audio, MIDI por IPC) iba a tirones.
//
// workerData: { channels: Float32Array[], sampleRate, mode, modelsDir, ep }
// Mensajes al padre:  { type: 'progress', fraction, stage, ep }
//                     { type: 'done', result }   (los Float32Array van transferidos, sin copia)
//                     { type: 'error', error, cancelled }
// Del padre:          { type: 'cancel' }         → se corta entre ventanas de inferencia
// ─────────────────────────────────────────────────────────────────────────
const { parentPort, workerData } = require('worker_threads');

let cancel = false;
parentPort.on('message', (m) => { if (m && m.type === 'cancel') cancel = true; });

(async () => {
  try {
    const { separate } = require('./stemSeparator');
    const result = await separate({
      channels: workerData.channels,
      sampleRate: workerData.sampleRate,
      mode: workerData.mode,
      modelsDir: workerData.modelsDir,
      ep: workerData.ep || undefined,
      onProgress: (fraction, stage, ep) => parentPort.postMessage({ type: 'progress', fraction, stage, ep }),
      shouldCancel: () => cancel,
    });
    const transfer = [];
    for (const s of result.stems) for (const c of s.channels) if (c && c.buffer && !transfer.includes(c.buffer)) transfer.push(c.buffer);
    parentPort.postMessage({ type: 'done', result }, transfer);
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e), cancelled: !!(e && e.cancelled) });
  }
})();
