// WAV mínimo para los scripts del catálogo: leer (PCM 16/24 bits o float 32),
// escribir PCM 16 bits y sacar la escucha previa.
//
// Los loops del catálogo se suben en WAV a propósito: MP3/AAC meten silencio
// del codificador al principio y al final, y un loop con ese hueco ya no cuadra
// con la rejilla. La escucha previa sí puede ser ligera: mono a ~24 kHz.

export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('No es un WAV válido');
  }
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(p + 8),
        channels: buf.readUInt16LE(p + 10),
        sampleRate: buf.readUInt32LE(p + 12),
        bits: buf.readUInt16LE(p + 22),
      };
      // WAVE_FORMAT_EXTENSIBLE: el formato real está en el subformato.
      if (fmt.format === 0xfffe) fmt.format = buf.readUInt16LE(p + 32);
    } else if (id === 'data') {
      data = buf.subarray(p + 8, p + 8 + size);
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV sin bloque fmt/data');
  const { format, channels, sampleRate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) v = data.readFloatLE(o);
      else if (format === 1 && bits === 16) v = data.readInt16LE(o) / 32768;
      else if (format === 1 && bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else if (format === 1 && bits === 32) v = data.readInt32LE(o) / 2147483648;
      else throw new Error(`WAV no soportado (formato ${format}, ${bits} bits)`);
      out[c][i] = v;
    }
  }
  return { sampleRate, channels: out, duration: frames / sampleRate };
}

export function writeWav(channels, sampleRate) {
  const n = channels.length, frames = channels[0].length;
  const buf = Buffer.alloc(44 + frames * n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + frames * n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(n, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * n * 2, 28);
  buf.writeUInt16LE(n * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(frames * n * 2, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

/** Escucha previa: mono y diezmada a ~22–24 kHz (media de cada bloque). */
export function previewWav({ channels, sampleRate }) {
  const factor = Math.max(1, Math.floor(sampleRate / 22050));
  const frames = Math.floor(channels[0].length / factor);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) for (const ch of channels) s += ch[i * factor + k];
    mono[i] = s / (factor * channels.length);
  }
  return writeWav([mono], Math.round(sampleRate / factor));
}
