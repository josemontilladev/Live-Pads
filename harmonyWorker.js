// ─────────────────────────────────────────────────────────────────────────
// Hilo aparte (worker_threads) del proceso principal: separa BAJO y OTROS
// (sin voz ni batería) para el análisis preciso de acordes y los devuelve en
// mono a 11 025 Hz (lo que usa el motor de acordes). Corre fuera del hilo
// principal para que la app siga fluida, y solo en GPU.
//
// workerData: { channels: [L, R], sampleRate, modelsDir }
// Mensajes: 'cancel' → aborta. Responde { type:'done', other, bass, ep } o
// { type:'error', error, noGpu, cancelled }.
// ─────────────────────────────────────────────────────────────────────────
const { parentPort, workerData } = require('worker_threads');
const { separate, SR } = require('./stemSeparator');

let cancel = false;
parentPort.on('message', (m) => { if (m === 'cancel') cancel = true; });

// FIR paso-bajo (sinc + ventana de Blackman) y diezmado entero, de estéreo a mono.
function toMonoDecimated(L, R, factor, taps = 127) {
  const fc = 0.45 / factor, h = new Float32Array(taps), M = taps - 1;
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const k = n - M / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / M) + 0.08 * Math.cos(4 * Math.PI * n / M);
    h[n] = sinc * w; sum += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] /= 2 * sum;   // ×½: promedio de L y R
  const out = new Float32Array(Math.floor(L.length / factor)), half = M >> 1;
  for (let i = 0; i < out.length; i++) {
    const c = i * factor;
    let acc = 0;
    for (let n = 0; n < taps; n++) {
      const j = c + n - half;
      if (j >= 0 && j < L.length) acc += (L[j] + R[j]) * h[n];
    }
    out[i] = acc;
  }
  return out;
}

(async () => {
  try {
    const { channels, sampleRate, modelsDir } = workerData;
    const r = await separate({
      channels, sampleRate, mode: 'armonia', modelsDir, ep: 'dml-only',
      shouldCancel: () => cancel,
      onProgress: (f) => parentPort.postMessage({ type: 'progress', f }),
    });
    const st = (k) => r.stems.find((s) => s.kind === k).channels;
    const factor = Math.round(SR / 11025);              // 44 100 → 11 025
    const other = toMonoDecimated(...st('other'), factor);
    const bass = toMonoDecimated(...st('bass'), factor);
    parentPort.postMessage({ type: 'done', other, bass, ep: r.ep }, [other.buffer, bass.buffer]);
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e), noGpu: !!(e && e.noGpu), cancelled: !!(e && e.cancelled) });
  }
})();
