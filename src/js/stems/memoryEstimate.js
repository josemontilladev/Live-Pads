// Cuánta memoria ocupará un audio una vez decodificado, ANTES de decodificarlo.
// Un MP3 de 6 MB son ~100 MB en memoria (estéreo, 32 bits, 48 kHz): un multitrack
// de 12 pistas puede pasar de 1 GB y tumbar un equipo modesto. Con esta cuenta se
// avisa antes de cargar, en vez de quedarse sin memoria a mitad.
//
// Módulo puro (sin DOM) para poder probarlo.

const BYTES_PER_SEC = 48000 * 2 * 4;          // como queda en el motor: 48 kHz, estéreo, float32
// Bitrate típico por formato cuando no se puede leer la cabecera (bits/s).
const TYPICAL_BPS = { mp3: 160000, aac: 128000, m4a: 128000, ogg: 128000, opus: 96000, flac: 800000, webm: 128000 };

/** Segundos de un WAV leyendo su cabecera (primeros bytes). null si no es un WAV válido. */
export function wavSeconds(header, fileSize) {
  try {
    const dv = header instanceof DataView ? header : new DataView(header);
    if (dv.byteLength < 44 || dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) return null;
    const byteRate = dv.getUint32(28, true);
    return byteRate > 0 ? Math.max(0, fileSize - 44) / byteRate : null;
  } catch (_) { return null; }
}

/** Duración aproximada (s) por nombre + tamaño (+ cabecera, si es WAV). */
export function estimateSeconds(name, size, header = null) {
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  if (ext === 'wav' || ext === 'wave') {
    const s = header ? wavSeconds(header, size) : null;
    return s != null ? s : size / (44100 * 2 * 2);      // sin cabecera: 16 bits estéreo
  }
  if (ext === 'aif' || ext === 'aiff') return size / (44100 * 2 * 2);
  return (size * 8) / (TYPICAL_BPS[ext] || 160000);
}

/** Bytes en memoria una vez decodificado. */
export function estimateDecodedBytes(name, size, header = null) {
  return Math.round(estimateSeconds(name, size, header) * BYTES_PER_SEC);
}

export const decodedBytesOfSeconds = (sec) => Math.round(Math.max(0, sec) * BYTES_PER_SEC);

/**
 * ¿Conviene avisar? totalBytes = lo ya cargado + lo nuevo. deviceGb = memoria del
 * equipo (navigator.deviceMemory: 0,25–8; el navegador no informa de más de 8).
 * Se avisa al pasar del 30 % de la memoria del equipo.
 */
export function memoryRisk(totalBytes, deviceGb = 4) {
  const gb = Math.max(0.5, Number(deviceGb) || 4);
  const limit = gb * 0.30 * 1024 ** 3;
  return { risky: totalBytes > limit, totalGb: totalBytes / 1024 ** 3, limitGb: limit / 1024 ** 3, deviceGb: gb };
}
