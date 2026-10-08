// ─────────────────────────────────────────────────────────────────────────
// Análisis de acordes en un Web Worker (hilo aparte): la interfaz, los pads y
// la pista siguen fluidos mientras se analiza. El worker se crea desde un Blob
// con el código de chordEngineFactory (funciona igual con file://, livepads://
// o en el navegador; la CSP ya permite `worker-src blob:`), solo cuando se
// abre el detector, y se destruye al cerrarlo (no queda memoria ocupada).
// ─────────────────────────────────────────────────────────────────────────

import { chordEngineFactory } from './chordEngine.js';

let worker = null, workerUrl = null, seq = 0;
const pending = new Map(); // id → { resolve, reject, onProgress }

function ensureWorker() {
  if (worker) return worker;
  const src = `const E = (${chordEngineFactory.toString()})();
self.onmessage = (ev) => {
  const { id, samples } = ev.data;
  try {
    const result = E.analyzeChords(samples, (p, l) => self.postMessage({ id, type: 'progress', p, l }));
    self.postMessage({ id, type: 'done', result });
  } catch (e) {
    self.postMessage({ id, type: 'error', error: String((e && e.message) || e) });
  }
};`;
  workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  worker = new Worker(workerUrl);
  worker.onmessage = (ev) => {
    const { id, type } = ev.data || {};
    const job = pending.get(id);
    if (!job) return;
    if (type === 'progress') { if (job.onProgress) job.onProgress(ev.data.p, ev.data.l); return; }
    pending.delete(id);
    if (type === 'done') job.resolve(ev.data.result);
    else job.reject(new Error(ev.data.error || 'Error al analizar'));
  };
  worker.onerror = (e) => {
    const err = new Error((e && e.message) || 'El analizador falló');
    for (const j of pending.values()) j.reject(err);
    pending.clear();
    stopChordWorker();
  };
  return worker;
}

/** Analiza samples (Float32Array mono 11 025 Hz). El buffer se TRANSFIERE (queda vacío aquí). */
export function analyzeInWorker(samples, onProgress) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, samples }, [samples.buffer]);
  });
}

export function stopChordWorker() {
  if (worker) { try { worker.terminate(); } catch (_) {} }
  worker = null;
  if (workerUrl) { try { URL.revokeObjectURL(workerUrl); } catch (_) {} }
  workerUrl = null;
  const err = new Error('cancelado');
  for (const j of pending.values()) j.reject(err);
  pending.clear();
}
