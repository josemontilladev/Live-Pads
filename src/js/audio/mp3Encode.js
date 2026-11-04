// Compresión de audio a MP3 (lamejs, 100 % local, sin ffmpeg).
//
// · audioBufferToMp3(buffer)  → ArrayBuffer MP3 (estéreo o mono según el origen).
// · shouldCompress(name)      → true para WAV/AIFF/FLAC (pesados) y .m4a/.aac/.webm (sin cambio de tono en móvil).
// · compressToMp3(arrayBuffer)→ decodifica cualquier audio del navegador y lo reduce a MP3.
//
// Un WAV estéreo de 4 min pesa ~40 MB; a MP3 192 kbps ronda 5,5 MB (~86 % menos).

import { encodePcmToMp3 } from './mp3Core.js';
import * as engine from '../stems/engine.js';

const LOSSLESS_EXT = /\.(wav|wave|aif|aiff|flac)$/i;
// Formatos que el motor de los móviles no transpone (.m4a de YouTube, .aac…).
const NEEDS_MP3_EXT = /\.(m4a|aac|mp4|webm|opus|wma)(?:[?#]|$)/i;

/** ¿Este audio hay que pasarlo a MP3 al subirlo? (pesado sin pérdida, o formato sin cambio de tono en móvil). */
export function shouldCompress(name) {
  const n = String(name || '');
  return LOSSLESS_EXT.test(n) || NEEDS_MP3_EXT.test(n);
}

/** ¿Es un formato que conviene convertir a MP3 para poder cambiar de tono en el móvil? */
export function needsMp3(nameOrUrl) {
  return NEEDS_MP3_EXT.test(String(nameOrUrl || ''));
}

/** Nombre sin extensión. */
export function baseName(name) {
  return String(name || 'audio').replace(/\.[^.]+$/, '');
}

export function audioBufferToMp3(buffer, kbps = 192) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  return encodePcmToMp3(left, right, buffer.sampleRate, kbps);
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
