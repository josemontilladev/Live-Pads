// ─────────────────────────────────────────────────────────────────────────
// Importar un multitrack comprado (MultiTracks.com, Loop Community / Prime…):
// una CARPETA o un ZIP con un WAV/MP3 por instrumento (Click, Guide, Drums, Bass,
// Keys, AG, EG, BGVs, Pad…). Aquí solo se listan y se leen los audios (también
// dentro del ZIP, con o sin compresión); la app crea la canción, sus pistas y la
// secuencia (src/js/stems/multitrackPack.js).
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AUDIO = /\.(wav|wave|mp3|aif|aiff|flac|m4a|ogg)$/i;
const MAX_FILES = 64;

/** Índice de un ZIP: [{ name, method, csize, size, dataOffset }] (método 0 = guardado, 8 = deflate). */
function zipIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 66000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff) throw new Error('ZIP de más de 4 GB: descomprímelo y elige la carpeta.');
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), loff = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nlen).toString(flags & 0x0800 ? 'utf8' : 'latin1');
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, loff);
      out.push({ name, method, csize, size: usize, dataOffset: loff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28) });
    }
    return out;
  } finally { fs.closeSync(fd); }
}

function zipRead(file, e) {
  if (e.method !== 0 && e.method !== 8) throw new Error(`«${e.name}» usa una compresión no admitida.`);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(e.csize);
    fs.readSync(fd, buf, 0, e.csize, e.dataOffset);
    return e.method === 8 ? zlib.inflateRawSync(buf) : buf;
  } finally { fs.closeSync(fd); }
}

/** Audios de una carpeta (y sus subcarpetas, hasta 2 niveles). */
function walk(dir, depth = 0, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of ents) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth < 2) walk(p, depth + 1, out);
    else if (d.isFile() && AUDIO.test(d.name)) { try { out.push({ name: path.relative(dir, p) === d.name ? d.name : path.relative(dir, p), abs: p, size: fs.statSync(p).size }); } catch (_) {} }
  }
  return out;
}

/** Abre una carpeta o un ZIP → { source: { kind, path, name }, files: [{ id, name, size }] }. */
function listPack(target) {
  const st = fs.statSync(target);
  let files;
  if (st.isDirectory()) files = walk(target).map((f, i) => ({ id: i, name: f.name, size: f.size, abs: f.abs }));
  else if (/\.zip$/i.test(target)) files = zipIndex(target).filter((e) => AUDIO.test(e.name)).map((e, i) => ({ id: i, name: e.name, size: e.size, entry: e }));
  else throw new Error('Elige una carpeta o un archivo ZIP.');
  if (!files.length) throw new Error('No hay audios (WAV, MP3, AIFF, FLAC) en lo que elegiste.');
  if (files.length > MAX_FILES) files = files.slice(0, MAX_FILES);
  return { source: { kind: st.isDirectory() ? 'folder' : 'zip', path: target, name: path.basename(target).replace(/\.zip$/i, '') }, files };
}

function readPackFile(pack, id) {
  const f = pack.files.find((x) => x.id === id);
  if (!f) throw new Error('Archivo no encontrado en el paquete.');
  return f.abs ? fs.readFileSync(f.abs) : zipRead(pack.source.path, f.entry);
}

/**
 * Biblioteca de multitracks: lo que hay dentro de una carpeta raíz. Cada subcarpeta con
 * audios (o cada ZIP) es una canción por importar. → [{ name, path, kind, files, size, mtime }]
 */
function scanLibrary(root) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  const own = [];
  for (const d of ents) {
    if (d.name.startsWith('.') || d.name === '__MACOSX') continue;
    const p = path.join(root, d.name);
    try {
      if (d.isDirectory()) {
        const files = walk(p);
        if (!files.length) continue;
        const st = fs.statSync(p);
        out.push({ name: d.name, path: p, kind: 'folder', files: Math.min(files.length, MAX_FILES), size: files.reduce((a, f) => a + f.size, 0), mtime: st.mtimeMs });
      } else if (d.isFile() && /\.zip$/i.test(d.name)) {
        const st = fs.statSync(p);
        out.push({ name: d.name.replace(/\.zip$/i, ''), path: p, kind: 'zip', files: 0, size: st.size, mtime: st.mtimeMs });
      } else if (d.isFile() && AUDIO.test(d.name)) own.push(d.name);
    } catch (_) {}
  }
  // La carpeta elegida ES un multitrack (audios sueltos dentro): se ofrece ella misma.
  if (own.length >= 2) {
    const files = walk(root);
    out.unshift({ name: path.basename(root), path: root, kind: 'folder', files: Math.min(files.length, MAX_FILES), size: files.reduce((a, f) => a + f.size, 0), mtime: fs.statSync(root).mtimeMs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

/** ¿«p» está dentro de alguna de las carpetas raíz? */
function isInside(p, roots) {
  const r = path.resolve(p);
  return (roots || []).some((root) => {
    const base = path.resolve(root);
    return r === base || r.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  });
}

module.exports = { listPack, readPackFile, zipIndex, zipRead, scanLibrary, isInside };
