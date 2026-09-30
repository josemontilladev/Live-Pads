// Escritor ZIP mínimo (método STORE, sin compresión) sin dependencias.
// Para audio ya comprimido (MP3/M4A) comprimir de nuevo no aporta nada.
//
//   const zip = createZip();
//   zip.add('Carpeta/archivo.mp3', arrayBufferOUint8Array);
//   const bytes = zip.finish();     // Uint8Array listo para guardar

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

export function createZip() {
  const enc = new TextEncoder();
  const parts = [];       // [local header, data] …
  const central = [];     // registros del directorio central
  let offset = 0;
  const used = new Set();
  const { time, date } = dosDateTime();

  function uniqueName(name) {
    let out = name, i = 2;
    while (used.has(out.toLowerCase())) {
      out = name.replace(/(\.[^./]+)?$/, ` (${i++})$1`);
    }
    used.add(out.toLowerCase());
    return out;
  }

  return {
    add(name, data) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const nameBytes = enc.encode(uniqueName(String(name).replace(/\\/g, '/').replace(/^\/+/, '')));
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);            // nombres UTF-8
      local.setUint16(8, 0, true);                 // STORE
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, time, true);
      cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, bytes.length, true);
      cen.setUint32(24, bytes.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
    },
    finish() {
      let cenSize = 0;
      for (const c of central) cenSize += c.length;
      const end = new DataView(new ArrayBuffer(22));
      const count = central.length / 2;
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, cenSize, true);
      end.setUint32(16, offset, true);
      const all = [...parts, ...central, new Uint8Array(end.buffer)];
      let total = 0;
      for (const p of all) total += p.length;
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of all) { out.set(p, o); o += p.length; }
      return out;
    },
    get count() { return central.length / 2; },
  };
}
