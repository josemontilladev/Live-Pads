// Lee la cabecera de un MP3: frecuencia, canales, kbps medios y el desfase del
// codificador (etiqueta Xing/Info + LAME). Con eso se decide si el MP3 se sube
// tal cual (ya pesa poco) y si hace falta recortar el silencio que mete el
// codificador al principio para que la pista quede alineada con las demás.

const BITRATES = {
  // [versión MPEG1][capa III] y [MPEG2/2.5][capa III]
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

export const isMp3Name = (name) => /\.mp3$/i.test(String(name || ''));

/** → { sampleRate, channels, kbps, frames, spf, delay, padding, lame } o null si no es MP3. */
export function mp3Info(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  let o = 0;
  // ID3v2 al principio: se salta.
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    o = 10 + size + ((b[5] & 0x10) ? 10 : 0);
  }
  const limit = Math.min(b.length - 4, o + 65536);
  for (; o < limit; o++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[o + 1] >> 3) & 3;           // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[o + 1] >> 1) & 3;         // 1 = capa III
    const bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) continue;
    const v1 = ver === 3;
    const sampleRate = RATES[v1 ? 1 : ver === 2 ? 2 : 25][si];
    const kbpsFrame = BITRATES[v1 ? 1 : 2][bi];
    const channels = ((b[o + 3] >> 6) & 3) === 3 ? 1 : 2;
    const spf = v1 ? 1152 : 576;
    const info = { sampleRate, channels, kbps: kbpsFrame, frames: 0, spf, delay: 0, padding: 0, lame: false, start: o };
    // Etiqueta Xing / Info justo después de la información lateral.
    const side = v1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
    const x = o + 4 + side;
    const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
    if (tag === 'Xing' || tag === 'Info') {
      const flags = (b[x + 4] << 24) | (b[x + 5] << 16) | (b[x + 6] << 8) | b[x + 7];
      let p = x + 8, bytes = 0;
      if (flags & 1) { info.frames = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; }
      if (flags & 2) { bytes = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; }
      if (flags & 4) p += 100;
      if (flags & 8) p += 4;
      // Extensión LAME (o compatibles: Lavf/Lavc también la escriben).
      const enc = String.fromCharCode(...b.subarray(p, p + 4));
      if (/^(LAME|Lavf|Lavc|GOGO|L3\.9)/.test(enc) || /^[A-Za-z]{4}$/.test(enc)) {
        const d = p + 21;
        info.delay = (b[d] << 4) | (b[d + 1] >> 4);
        info.padding = ((b[d + 1] & 0x0f) << 8) | b[d + 2];
        info.lame = info.delay > 0 && info.delay < 3000;
      }
      if (info.frames && bytes) info.kbps = Math.round((bytes * 8 * sampleRate) / (info.frames * spf) / 1000);
      else if (info.frames) info.kbps = Math.round(((b.length - o) * 8 * sampleRate) / (info.frames * spf) / 1000);
    }
    return info;
  }
  return null;
}

/**
 * Quita el silencio del codificador si el decodificador no lo quitó.
 * Chromium suele respetar la etiqueta LAME (sale ya recortado); si no, se recorta aquí.
 * @returns {{ buffer: AudioBuffer, fixed: boolean }}
 */
export function fixMp3Gapless(info, buffer) {
  if (!info?.lame || !info.frames) return { buffer, fixed: false };
  const ratio = buffer.sampleRate / info.sampleRate;
  const total = info.frames * info.spf;
  const gapless = total - info.delay - info.padding;
  const got = buffer.length / ratio;
  // Ya recortado (± un frame, por si el contador incluye o no el frame Info).
  if (Math.abs(got - gapless) <= info.spf + 64) return { buffer, fixed: false };
  if (got < gapless + info.delay * 0.5) return { buffer, fixed: false };
  const from = Math.round((info.delay + 529) * ratio);
  const len = Math.max(1, Math.min(buffer.length - from, Math.round(gapless * ratio)));
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: len, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.getChannelData(c).set(buffer.getChannelData(c).subarray(from, from + len));
  return { buffer: out, fixed: true };
}
