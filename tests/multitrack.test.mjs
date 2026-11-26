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
