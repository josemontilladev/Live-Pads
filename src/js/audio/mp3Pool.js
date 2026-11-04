// Reparte la compresión MP3 entre varios workers (uno por núcleo, máx. 4).
// Si los workers no arrancan, comprime en la ventana como antes.
import { encodePcmToMp3 } from './mp3Core.js';

const SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
let workers = null, broken = false, seq = 0;
const pending = new Map();
const queue = [];
const idle = [];

function start() {
  if (workers || broken) return;
  try {
    workers = [];
    for (let i = 0; i < SIZE; i++) {
      const w = new Worker(new URL('./mp3Worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const job = pending.get(e.data.id);
        pending.delete(e.data.id);
        if (job) e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.mp3);
        idle.push(w); pump();
      };
      w.onerror = (ev) => {
        ev.preventDefault?.();
        // Un worker que no carga: se pasa todo a la ventana.
        broken = true;
        for (const [id, job] of pending) { pending.delete(id); job.fallback(); }
        while (queue.length) queue.shift().fallback();
      };
      workers.push(w); idle.push(w);
    }
  } catch (_) { broken = true; workers = null; }
}

function pump() {
  while (idle.length && queue.length) {
    const w = idle.shift(), job = queue.shift();
    pending.set(job.id, job);
    w.postMessage(job.msg, job.transfer);
  }
}

/**
 * Comprime canales Float32 a MP3. Los arrays se TRANSFIEREN (quedan vacíos en
 * quien llama): pasa copias si los vas a seguir usando.
 */
export function encodeMp3Async(left, right, sampleRate, kbps) {
  start();
  const direct = () => encodePcmToMp3(left, right, sampleRate, kbps);
  if (broken) return Promise.resolve().then(direct);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const job = {
      id, resolve, reject,
      msg: { id, left, right, sampleRate, kbps },
      transfer: right ? [left.buffer, right.buffer] : [left.buffer],
      fallback: () => { try { resolve(direct()); } catch (e) { reject(e); } },
    };
    queue.push(job); pump();
  });
}

/** Cuántas compresiones conviene tener en marcha a la vez. */
export const poolSize = () => (broken ? 1 : SIZE);
