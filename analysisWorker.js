// ─────────────────────────────────────────────────────────────────────────
// Hilo aparte (worker_threads) del proceso principal para los análisis
// pesados, así la app sigue fluida mientras se calculan.
//
// workerData: { task: 'chords', mono (Float32Array 22 050 Hz), modelPath }
// Responde { type: 'done', seg, ep } o { type: 'error', error }.
// ─────────────────────────────────────────────────────────────────────────
const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { task, mono, modelPath } = workerData;
    if (task !== 'chords') throw new Error('Tarea desconocida: ' + task);
    const { detectChords } = require('./chordModel');
    const r = await detectChords(mono, modelPath);
    parentPort.postMessage({ type: 'done', seg: r.seg, ep: r.ep });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e) });
  }
})();
