// Compresión de audio a MP3 (lamejs, 100 % local, sin ffmpeg).
//
// · audioBufferToMp3(buffer)  → ArrayBuffer MP3 (estéreo o mono según el origen).
// · shouldCompress(name)      → true para formatos sin compresión/pesados (WAV, AIFF, FLAC).
// · compressToMp3(arrayBuffer)→ decodifica cualquier audio del navegador y lo reduce a MP3.
//
// Un WAV estéreo de 4 min pesa ~40 MB; a MP3 192 kbps ronda 5,5 MB (~86 % menos).

import { Mp3Encoder } from '../../vendor/lamejs.js';
import * as engine from '../stems/engine.js';

const LOSSLESS_EXT = /\.(wav|wave|aif|aiff|flac)$/i;

export function shouldCompress(name) {
  return LOSSLESS_EXT.test(String(name || ''));
}

/** Nombre sin extensión. */
export function baseName(name) {
  return String(name || 'audio').replace(/\.[^.]+$/, '');
}

const toI16 = (f) => Math.max(-32768, Math.min(32767, f < 0 ? f * 32768 : f * 32767));

export function audioBufferToMp3(buffer, kbps = 192) {
  const sr = buffer.sampleRate;
  const channels = buffer.numberOfChannels > 1 ? 2 : 1;
  const BLOCK = 1152;
  const left = buffer.getChannelData(0);
  const right = channels === 2 ? buffer.getChannelData(1) : null;
  // Mono: 128 kbps sobra (mismo resultado audible, la mitad de peso).
  const enc = new Mp3Encoder(channels, sr, channels === 1 ? Math.min(kbps, 128) : kbps);
  const lp = new Int16Array(BLOCK);
  const rp = channels === 2 ? new Int16Array(BLOCK) : null;
  const chunks = [];
  for (let i = 0; i < left.length; i += BLOCK) {
    const n = Math.min(BLOCK, left.length - i);
    for (let s = 0; s < n; s++) {
      lp[s] = toI16(left[i + s]);
      if (rp) rp[s] = toI16(right[i + s]);
    }
    const out = channels === 2 ? enc.encodeBuffer(lp.subarray(0, n), rp.subarray(0, n)) : enc.encodeBuffer(lp.subarray(0, n));
    if (out.length) chunks.push(out);
  }
  const end = enc.flush();
  if (end.length) chunks.push(end);
  let total = 0;
  for (const c of chunks) total += c.length;
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return bytes.buffer;
}

/** Decodifica y comprime. Devuelve { buffer, before, after }. */
export async function compressToMp3(arrayBuffer, kbps = 192) {
  const decoded = await engine.decodeAudio(arrayBuffer);
  const mp3 = audioBufferToMp3(decoded, kbps);
  return { buffer: mp3, before: arrayBuffer.byteLength, after: mp3.byteLength };
}

export function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1) + ' MB';
}
