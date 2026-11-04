// Núcleo del codificador MP3 (lamejs), sin nada del DOM: lo usan la ventana
// (mp3Encode.js) y los workers que comprimen en paralelo (mp3Worker.js).
import { Mp3Encoder } from '../../vendor/lamejs.js';

const toI16 = (f) => Math.max(-32768, Math.min(32767, f < 0 ? f * 32768 : f * 32767));

/** Canales en Float32 → ArrayBuffer MP3. `right` null = mono. */
export function encodePcmToMp3(left, right, sampleRate, kbps = 192) {
  const channels = right ? 2 : 1;
  const BLOCK = 1152;
  // Mono: 128 kbps sobra (mismo resultado audible, la mitad de peso).
  const enc = new Mp3Encoder(channels, sampleRate, channels === 1 ? Math.min(kbps, 128) : kbps);
  const lp = new Int16Array(BLOCK);
  const rp = right ? new Int16Array(BLOCK) : null;
  const chunks = [];
  for (let i = 0; i < left.length; i += BLOCK) {
    const n = Math.min(BLOCK, left.length - i);
    for (let s = 0; s < n; s++) {
      lp[s] = toI16(left[i + s]);
      if (rp) rp[s] = toI16(right[i + s]);
    }
    const out = rp ? enc.encodeBuffer(lp.subarray(0, n), rp.subarray(0, n)) : enc.encodeBuffer(lp.subarray(0, n));
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
