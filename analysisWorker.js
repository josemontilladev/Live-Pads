// ─────────────────────────────────────────────────────────────────────────
// Hilo aparte (worker_threads) del proceso principal para los análisis
// pesados, así la app sigue fluida mientras se calculan.
//
// workerData: { task, mono (Float32Array), modelPath }
//   'chords' → mono a 22 050 Hz → { seg, ep }        (chordModel.js, BTC)
//   'beats'  → mono a 22 050 Hz → { beats, downbeats, bpm, … } (beatTracker.js, Beat This!)
// Responde { type: 'done', result } o { type: 'error', error }.
// ─────────────────────────────────────────────────────────────────────────
const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { task, mono, modelPath } = workerData;
    let result;
    if (task === 'chords') result = await require('./chordModel').detectChords(mono, modelPath);
    else if (task === 'beats') result = await require('./beatTracker').trackBeats(mono, modelPath, {});
    else throw new Error('Tarea desconocida: ' + task);
    parentPort.postMessage({ type: 'done', result });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e) });
  }
})();
