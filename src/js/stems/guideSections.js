// ─────────────────────────────────────────────────────────────────────────
// Secciones desde la pista guía (lado de la ventana): pasa la guía a mono
// 16 kHz, la manda a reconocer (whisperGuide.js en el proceso principal) y
// convierte lo que dice en marcadores con guideCuesCore.js.
//   const cues = await sectionsFromGuide(audioBuffer, { bpm, beatsPerBar, durationSec, onProgress })
//   → [{ atSec, key, label }] (key = id de sectionCatalog.js)
// ─────────────────────────────────────────────────────────────────────────

import { placeCues, labelCues } from './guideCuesCore.js';
import { findCueById } from './sectionCatalog.js';

export const canListenGuide = () => !!window.electronAPI?.guideSections;

async function toMono16k(buf) {
  const len = Math.max(1, Math.ceil(buf.duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

export async function sectionsFromGuide(buffer, { bpm = 0, beatsPerBar = 4, gridOffset = 0, timeOffset = 0, durationSec = Infinity, onProgress = null } = {}) {
  const api = window.electronAPI;
  if (!api?.guideSections || !buffer) return [];
  const off = api.onGuideProgress ? api.onGuideProgress((d) => { try { onProgress && onProgress(d.frac, d.label); } catch (_) {} }) : null;
  try {
    onProgress && onProgress(0, 'Preparando la guía…');
    const pcm = await toMono16k(buffer);
    const hits = await api.guideSections({ pcm });
    const shifted = (hits || []).map((h) => ({ ...h, t: h.t + timeOffset }));
    const cues = placeCues(shifted, { bpm, beatsPerBar, gridOffset, durationSec, onlySections: true });
    return labelCues(cues, (k) => findCueById(k)?.label);
  } finally { if (off) off(); }
}
