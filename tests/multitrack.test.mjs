import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parsePackName, seqSide, normGain } from '../src/js/stems/multitrackCore.js';
import { detectStemRole } from '../src/js/stems/stemRole.js';

const require = createRequire(import.meta.url);
const mt = require('../multitrackImport.js');

test('nombre del paquete → título, artista, BPM y tono', () => {
  assert.deepEqual(parsePackName('Way Maker - Leeland - 68 BPM - E'), { title: 'Way Maker', artist: 'Leeland', bpm: '68', key: 'E' });
  assert.deepEqual(parsePackName('Goodness Of God_MultiTracks'), { title: 'Goodness Of God', artist: '', bpm: '', key: '' });
  const p = parsePackName('Tu Fidelidad (Key of G) 72bpm');
  assert.equal(p.title, 'Tu Fidelidad'); assert.equal(p.key, 'G'); assert.equal(p.bpm, '72');
  assert.equal(parsePackName('Song', ['Click 120 BPM.wav']).bpm, '120');
});

test('nombres reales de una carpeta de multitracks (guiones pegados, BPM con decimales, etiquetas)', () => {
  assert.deepEqual(parsePackName('ADIOS AL AYER-Algo Nuevo Viene-Ab-150.00bpm'), { title: 'ADIOS AL AYER', artist: 'Algo Nuevo Viene', bpm: '150', key: 'Ab' });
  assert.deepEqual(parsePackName('Agradecido Estoy-ASI SERA-E-72.00bpm'), { title: 'Agradecido Estoy', artist: 'ASI SERA', bpm: '72', key: 'E' });
  assert.deepEqual(parsePackName('Alaba-Alaba-G-127.00bpm'), { title: 'Alaba', artist: 'Alaba', bpm: '127', key: 'G' });
  assert.deepEqual(parsePackName('Agnus dei + Santo por siempre - Secuencia multitrack - [TPMCristiana]'), { title: 'Agnus dei + Santo por siempre', artist: '', bpm: '', key: '' });
  assert.deepEqual(parsePackName('Algo Nuevo Viene-Algo Nuevo Viene-Bb-91.00bpm'), { title: 'Algo Nuevo Viene', artist: 'Algo Nuevo Viene', bpm: '91', key: 'Bb' });
  assert.equal(parsePackName('Oceans-Hillsong United-F#m-66bpm').key, 'F#m');
});

test('más formatos reales: extensión, «pm», BPM suelto, tono entre paréntesis, Google Drive, [with …]', () => {
  assert.deepEqual(parsePackName('Él Que Resucitó - Elevation Worship.7z'), { title: 'Él Que Resucitó', artist: 'Elevation Worship', bpm: '', key: '' });
  assert.deepEqual(parsePackName('Que Ruja El Leon-ALIENTO-Ebm-69.50pm'), { title: 'Que Ruja El Leon', artist: 'ALIENTO', bpm: '70', key: 'Ebm' });
  assert.deepEqual(parsePackName('Phenomena (Da Da)-RecursosA&A (Da Da)-F#-132'), { title: 'Phenomena (Da Da)', artist: 'RecursosA&A (Da Da)', bpm: '132', key: 'F#' });
  assert.deepEqual(parsePackName('Gracias, Dios ( C) - Essential worship 130.00BPM'), { title: 'Gracias, Dios', artist: 'Essential worship', bpm: '130', key: 'C' });
  assert.deepEqual(parsePackName('Glorioso Día - Passion, Kristian Stanfill (Español)-20260604T145702Z-3-001'), { title: 'Glorioso Día', artist: 'Passion, Kristian Stanfill (Español)', bpm: '', key: '' });
  assert.deepEqual(parsePackName('Holy Forever (Español)[with Miel San Marcos]'), { title: 'Holy Forever (Español)', artist: 'Miel San Marcos', bpm: '', key: '' });
  assert.deepEqual(parsePackName('Hermoso Dios - Secuencia Multitrack (TPMCristiana)'), { title: 'Hermoso Dios', artist: '', bpm: '', key: '' });
  assert.deepEqual(parsePackName('Sana Nuestra Tierra- Multitrack -121bpm-4_4-G.rar'), { title: 'Sana Nuestra Tierra', artist: '', bpm: '121', key: 'G' });
  assert.deepEqual(parsePackName('Tumbas A Jardines - Elevation Worship - MT'), { title: 'Tumbas A Jardines', artist: 'Elevation Worship', bpm: '', key: '' });
});

test('roles de las pistas típicas de MultiTracks / Loop Community', () => {
  const r = (n) => detectStemRole(n).kind;
  assert.equal(r('Click.wav'), 'click'); assert.equal(r('Guide.wav'), 'guide'); assert.equal(r('Cues.wav'), 'guide');
  assert.equal(r('AG.wav'), 'guitar'); assert.equal(r('EG 1.wav'), 'guitar'); assert.equal(r('BGVs.wav'), 'vocals');
  assert.equal(r('Pad.wav'), 'keys'); assert.equal(r('Strings.wav'), 'keys'); assert.equal(r('Perc Loop.wav'), 'drums');
  assert.equal(r('Bass Synth.wav'), 'bass');
});

test('secuencia: click y guía a la izquierda, la banda a la derecha', () => {
  assert.equal(seqSide('click'), 'L'); assert.equal(seqSide('guide'), 'L');
  assert.equal(seqSide('drums'), 'R'); assert.equal(seqSide('vocals'), 'R');
  assert.ok(Math.abs(normGain(0.5) - 1.782) < 0.01); assert.equal(normGain(0.01), 4); assert.equal(normGain(0), 1);
});

test('ZIP con y sin compresión, y carpeta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-mt-'));
  const a = Buffer.from('RIFF....WAVEfmt datos de prueba '.repeat(50));
  const b = Buffer.from('otro audio mp3 '.repeat(80));
  // ZIP a mano: a.wav deflate, Sub/b.mp3 guardado, y un .txt que no cuenta.
  const entries = [{ name: 'Pack/Click.wav', data: a, method: 8 }, { name: 'Pack/Sub/Bass.mp3', data: b, method: 0 }, { name: 'Pack/leeme.txt', data: Buffer.from('x'), method: 0 }];
  const parts = [], cds = []; let off = 0;
  for (const e of entries) {
    const comp = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.method, 8); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(e.data.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(e.method, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cds.push(c, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(cds);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const zipFile = path.join(dir, 'Way Maker - Leeland.zip');
  fs.writeFileSync(zipFile, Buffer.concat([...parts, cd, end]));
  const pk = mt.listPack(zipFile);
  assert.equal(pk.source.name, 'Way Maker - Leeland');
  assert.deepEqual(pk.files.map((f) => f.name), ['Pack/Click.wav', 'Pack/Sub/Bass.mp3']);
  assert.deepEqual(mt.readPackFile(pk, 0), a);
  assert.deepEqual(mt.readPackFile(pk, 1), b);
  // Carpeta
  const folder = path.join(dir, 'Pack'); fs.mkdirSync(path.join(folder, 'Sub'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'Click.wav'), a); fs.writeFileSync(path.join(folder, 'Sub', 'Bass.mp3'), b);
  const pf = mt.listPack(folder);
  assert.equal(pf.files.length, 2);
  assert.deepEqual(mt.readPackFile(pf, pf.files.findIndex((f) => /Bass/.test(f.name))), b);
  assert.throws(() => mt.listPack(path.join(dir, 'leeme.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
});
