// ─────────────────────────────────────────────────────────────────────────
// Paquete del servicio sin conexión (.lpservicio): todo lo que hace falta para
// tocar un servicio en OTRO portátil sin internet — las canciones (letra, tono,
// secciones, notas…) y sus audios (secuencia, original, voces, carátula) — en un
// solo archivo, para llevarlo en un USB o mandarlo por la red de la iglesia.
//
// Formato: ZIP sin compresión (método STORE: el audio ya va comprimido) con
//   servicio.json   { app, kind, version, name, date, exportedAt, songs, keys }
//   files/<ruta>    los audios, con su ruta dentro de la librería
//                   («Sequences/x.mp3», «Original Tracks/y.mp3»…)
// Se escribe por partes (no se junta todo en memoria) y al leerlo solo se aceptan
// rutas dentro de las carpetas de audio de la librería.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d = new Date()) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

const MAX_BYTES = 3.8 * 1024 * 1024 * 1024;   // sin ZIP64: el paquete no puede pasar de 4 GB

/** Escribe el ZIP en `outPath`. entries: [{ name, data: Buffer } | { name, file: rutaAbsoluta }]. */
function writePack(outPath, entries) {
  const fd = fs.openSync(outPath, 'w');
  const central = [];
  let offset = 0;
  const { time, date } = dosTime();
  try {
    for (const e of entries) {
      const data = e.data || fs.readFileSync(e.file);
      if (offset + data.length > MAX_BYTES) throw new Error('El paquete pasaría de 4 GB: quita alguna canción del servicio.');
      const name = Buffer.from(e.name, 'utf8');
      const crc = crc32(data);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
      h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
      h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
      fs.writeSync(fd, h); fs.writeSync(fd, name); fs.writeSync(fd, data);
      central.push({ name, crc, size: data.length, offset });
      offset += 30 + name.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10);
      h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24); h.writeUInt16LE(c.name.length, 28);
      h.writeUInt32LE(c.offset, 42);
      fs.writeSync(fd, h); fs.writeSync(fd, c.name);
      offset += 46 + c.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    fs.writeSync(fd, end);
    return offset + 22;
  } finally { fs.closeSync(fd); }
}

/** Lee el índice del ZIP: [{ name, size, crc, dataOffset }]. Solo ZIP sin compresión. */
function readIndex(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 66000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('No es un paquete de LivePads válido.');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Paquete dañado.');
      const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16), csize = cd.readUInt32LE(p + 20);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), loff = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nlen).toString('utf8');
      p += 46 + nlen + xlen + clen;
      if (method !== 0) throw new Error('Paquete con compresión no admitida.');
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, loff);
      const dataOffset = loff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      out.push({ name, size: csize, crc, dataOffset });
    }
    return out;
  } finally { fs.closeSync(fd); }
}

function readEntry(filePath, e) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(e.size);
    fs.readSync(fd, buf, 0, e.size, e.dataOffset);
    if (crc32(buf) !== e.crc) throw new Error(`Archivo dañado dentro del paquete: ${e.name}`);
    return buf;
  } finally { fs.closeSync(fd); }
}

/** Rutas livepads://app/… que usa una canción (sin las pistas separadas, que pesan mucho). */
function songUrls(song) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.startsWith('livepads://app/')) out.add(v); };
  const a = (song && song.audio) || {};
  add(a.sequence); add(a.original); add(song && song.cover);
  if (Array.isArray(a.voices)) for (const v of a.voices) add(v && (v.url || v.path));
  return [...out];
}

const relOf = (url) => decodeURIComponent(url.slice('livepads://app/'.length).replace(/^\/+/, ''));

module.exports = { writePack, readIndex, readEntry, songUrls, relOf, crc32 };
