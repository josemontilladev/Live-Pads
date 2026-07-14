// ─────────────────────────────────────────────────────────────────────────
// Pads de notas (colchones de adoración): 12 loops mp3 —uno por tono— con
// crossfade de 2 s al cambiar. Assets locales de la PWA (los cachea el SW).
// ─────────────────────────────────────────────────────────────────────────

import { audioCtx } from './audio.js';

export const PAD_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FADE_S = 2;

const buffers = new Map();  // tono → AudioBuffer (decode perezoso)
let current = null;         // { key, source, gain }
let masterGain = null;
let masterVolume = 0.8;

function ensureMaster() {
  const c = audioCtx();
  if (!masterGain) {
    masterGain = c.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(c.destination);
  }
  return masterGain;
}

async function bufferFor(key) {
  if (buffers.has(key)) return buffers.get(key);
  const res = await fetch(`assets/pads/${key}.mp3`);
  if (!res.ok) throw new Error(`No se pudo cargar el pad de ${key}`);
  const buf = await audioCtx().decodeAudioData(await res.arrayBuffer());
  buffers.set(key, buf);
  return buf;
}

export function activePadKey() { return current ? current.key : null; }

export function setPadsVolume(v) {
  masterVolume = v;
  if (masterGain) masterGain.gain.value = v;
}

// Enciende (o cambia a) el pad de un tono. Si es el activo, lo apaga.
export async function togglePad(key) {
  const c = audioCtx();
  if (current && current.key === key) { stopPads(); return null; }

  const buf = await bufferFor(key);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(1, c.currentTime + FADE_S);
  gain.connect(ensureMaster());

  const source = c.createBufferSource();
  source.buffer = buf;
  source.loop = true;
  source.connect(gain);
  source.start();

  // El anterior se va en fade mientras el nuevo entra (crossfade real).
  if (current) fadeOutAndStop(current);
  current = { key, source, gain };
  return key;
}

function fadeOutAndStop({ source, gain }) {
  const c = audioCtx();
  try {
    gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + FADE_S);
    source.stop(c.currentTime + FADE_S + 0.1);
  } catch (_) {}
}

export function stopPads() {
  if (current) { fadeOutAndStop(current); current = null; }
}
