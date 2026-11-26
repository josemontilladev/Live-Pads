// ─────────────────────────────────────────────────────────────────────────
// Hilo de trabajo para Whisper (secciones desde la guía, letra con IA, letra
// sincronizada). Todo lo pesado (espectrogramas, modelos, casado) corre aquí: el
// proceso principal queda libre (guardar, leer audio, MIDI, ventanas) y los modelos
// usan solo parte de los núcleos (whisperGuide.threadCount) para que la app y el
// audio no lo noten.
//   workerData: { kind: 'sections' | 'transcribe' | 'align', pcm, dir, opts }
//   → mensajes { type: 'progress', frac, label } · { type: 'done', result } · { type: 'error', error }
//   ← { type: 'cancel' }
// ─────────────────────────────────────────────────────────────────────────
const { parentPort, workerData } = require('worker_threads');

let cancel = false;
parentPort.on('message', (m) => { if (m && m.type === 'cancel') cancel = true; });
const progress = (frac, label) => { try { parentPort.postMessage({ type: 'progress', frac, label }); } catch (_) {} };
const shouldCancel = () => cancel;

(async () => {
  try {
    const { kind, dir, opts = {} } = workerData;
    const pcm = workerData.pcm instanceof Float32Array ? workerData.pcm : new Float32Array(workerData.pcm || []);
    let result;
    if (kind === 'sections') {
      const W = require('./whisperGuide');
      result = await W.transcribeRegions(pcm, dir, { onProgress: (f) => progress(f), shouldCancel });
    } else if (kind === 'transcribe') {
      const W = require('./whisperGuide');
      result = await W.transcribeLong(pcm, dir, { size: opts.size, lang: opts.lang, onProgress: (f) => progress(f), shouldCancel });
    } else if (kind === 'align') {
      const A = require('./lyricsAlign');
      const r = await A.alignLyrics(pcm, dir, opts.lines || [], { size: opts.size, lang: opts.lang, onProgress: (f, label) => progress(f, label), shouldCancel });
      result = { lang: r.lang, events: r.events.map((x) => ({ line: x.line, t: x.t, end: x.end, conf: x.conf, score: x.score })) };
    } else throw new Error('Trabajo desconocido: ' + kind);
    parentPort.postMessage({ type: 'done', result, cancelled: cancel });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e), cancelled: cancel });
  }
})();
