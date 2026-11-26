// Hilo aparte del Estudio de voces: escucha la voz (tono cada 10 ms) y la divide
// en notas. La pantalla sigue fluida mientras analiza (~10 s por canción).
import { trackPitch, segmentNotes } from './harmonyCore.js';

self.onmessage = (e) => {
  const { mono, sr } = e.data || {};
  try {
    const tr = trackPitch(mono, sr, { onProgress: (p) => self.postMessage({ type: 'progress', p }) });
    const notes = segmentNotes(tr);
    self.postMessage({ type: 'done', hop: tr.hop, f0: tr.f0, conf: tr.conf, notes }, [tr.f0.buffer, tr.conf.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err) });
  }
};
