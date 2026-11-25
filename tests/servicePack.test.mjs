import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packSong, mergePack, findInLibrary } from '../src/js/data/servicePackCore.js';

const require = createRequire(import.meta.url);
const pack = require('../servicePack.js');

test('el paquete no lleva datos internos ni pistas separadas', () => {
  const s = packSong({ id: 1, title: 'A', serviceId: 9, syncHash: 'x', syncBase: {}, audio: { sequence: 'livepads://app/Sequences/a.mp3', stems: [{ url: 'x' }] } });
  assert.equal(s.serviceId, undefined); assert.equal(s.syncHash, undefined); assert.equal(s.audio.stems, undefined);
  assert.equal(s.audio.sequence, 'livepads://app/Sequences/a.mp3');
});

test('fusión: la librería manda; solo se rellena lo que le falta; las nuevas se añaden', () => {
  const lib = [{ id: 's1', title: 'Grande es tu fidelidad', artist: 'Himno', key: 'D', lyrics: 'mía', audio: { sequence: null } }];
  const pk = [
    { id: 'zz', title: 'Grande es Tu Fidelidad', artist: 'himno', key: 'E', lyrics: 'suya', audio: { sequence: 'livepads://app/Sequences/g.mp3' } },
    { id: 's1', title: 'Otra canción', artist: 'X', key: 'G', audio: {} },
  ];
  const r = mergePack(lib, pk, 1000);
  assert.equal(r.songs[0], lib[0]);
  assert.equal(lib[0].lyrics, 'mía'); assert.equal(lib[0].key, 'D');
  assert.equal(lib[0].audio.sequence, 'livepads://app/Sequences/g.mp3');
  assert.equal(r.filled, 1);
  assert.equal(r.added.length, 1);
  assert.notEqual(r.added[0].id, 's1');   // el id ya lo usa otra canción de esta librería
  assert.equal(findInLibrary(lib.concat(r.added), packSong(pk[1])), r.added[0]);
});

test('el mismo archivo se escribe y se lee igual (y detecta daños)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pack-'));
  const a = path.join(dir, 'a.mp3'); fs.writeFileSync(a, Buffer.from([1, 2, 3, 4, 5, 250]));
  const out = path.join(dir, 'x.lpservicio');
  pack.writePack(out, [{ name: 'servicio.json', data: Buffer.from('{"kind":"servicio","ñ":1}') }, { name: 'files/Sequences/Canción ñ.mp3', file: a }]);
  const idx = pack.readIndex(out);
  assert.deepEqual(idx.map((e) => e.name), ['servicio.json', 'files/Sequences/Canción ñ.mp3']);
  assert.equal(JSON.parse(pack.readEntry(out, idx[0]).toString()).ñ, 1);
  assert.deepEqual([...pack.readEntry(out, idx[1])], [1, 2, 3, 4, 5, 250]);
  const bytes = fs.readFileSync(out); bytes[idx[1].dataOffset] ^= 0xff; fs.writeFileSync(out, bytes);
  assert.throws(() => pack.readEntry(out, pack.readIndex(out)[1]), /dañado/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rutas de audio de una canción (sin repetir ni pistas separadas)', () => {
  const urls = pack.songUrls({ cover: 'livepads://app/Covers/c.jpg', audio: { sequence: 'livepads://app/Sequences/s%20x.mp3', original: 'https://x', voices: [{ url: 'livepads://app/Voces/v.m4a' }], stems: [{ url: 'livepads://app/Stems/st.mp3' }] } });
  assert.deepEqual(urls.sort(), ['livepads://app/Covers/c.jpg', 'livepads://app/Sequences/s%20x.mp3', 'livepads://app/Voces/v.m4a']);
  assert.equal(pack.relOf('livepads://app/Sequences/s%20x.mp3'), 'Sequences/s x.mp3');
});
