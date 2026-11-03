// Worker de detección de SECCIONES (Intro, Verso, Coro…) para la onda de Pads.
// Corre el análisis fuera del hilo de UI: la app no se congela aunque la pista
// esté sonando. Recibe los canales como Float32Array transferidos y arma el
// mismo shim de AudioBuffer que usa bpmWorker. Si la canción no trae BPM, lo
// detecta aquí para poder ajustar cada sección a la línea de compás.
import { detectSections } from './sectionDetector.js';
import { detectTempoMeter, detectBeatAlignment } from './bpmDetector.js';

self.onmessage = (e) => {
  const { left, right, sampleRate, bpm, beatsPerBar } = e.data;
  const shim = {
    sampleRate,
    length: left.length,
    duration: left.length / sampleRate,
    numberOfChannels: right ? 2 : 1,
    getChannelData: (i) => (i === 1 && right) ? right : left,
  };
  let tempo = bpm > 0 ? bpm : 0, bar = beatsPerBar || 4;
  if (!tempo) {
    try {
      const r = detectTempoMeter(shim);
      if (r && r.bpm > 0) {
        tempo = r.bpmFloat || r.bpm;
        const top = parseInt(String(r.signature || '').split('/')[0], 10);
        if (top > 0) bar = top;
      }
    } catch (_) {}
  }
  // Solo la rejilla de compases (para pegar las etiquetas al compás al soltarlas).
  if (e.data.mode === 'grid') {
    let offsetSec = 0;
    try { const al = detectBeatAlignment(shim, tempo, bar); if (al && isFinite(al.offsetSec)) offsetSec = al.offsetSec; } catch (_) {}
    self.postMessage({ bpm: tempo, beatsPerBar: bar, offsetSec });
    return;
  }
  let sections = [];
  try { sections = detectSections(shim, { bpm: tempo, beatsPerBar: bar }); } catch (_) {}
  self.postMessage({ sections, bpm: tempo, beatsPerBar: bar });
};
