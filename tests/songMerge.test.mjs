import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSong, snapshot } from '../src/js/cloud/songMerge.js';

const song = (o = {}) => ({ title: 'Grande es tu fidelidad', artist: 'Himno', lyrics: 'Verso 1', bpm: '72', key: 'D', genre: 'adoracion', tags: ['himno'], favorite: false, showChords: true, timeSig: '4/4', youtubeUrl: '', markers: [], ...o });

test('campos distintos: se juntan los dos cambios sin conflicto', () => {
  const base = snapshot(song());
  const r = mergeSong(base, song({ key: 'E' }), song({ lyrics: 'Verso 1 corregido' }));
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.fields.key, 'E');
  assert.equal(r.fields.lyrics, 'Verso 1 corregido');
});

test('mismo campo a valores distintos: conflicto', () => {
  const base = snapshot(song());
  const r = mergeSong(base, song({ key: 'E' }), song({ key: 'C' }));
  assert.deepEqual(r.conflicts, ['key']);
});

test('mismo cambio en ambos lados no es conflicto', () => {
  const base = snapshot(song());
  const r = mergeSong(base, song({ bpm: '80' }), song({ bpm: 80 }));
  assert.deepEqual(r.conflicts, []);
});

test('tags y marcadores se comparan por contenido', () => {
  const base = snapshot(song({ tags: 'himno, clasico' }));
  const r = mergeSong(base, song({ tags: ['himno', 'clasico'] }), song({ markers: [{ t: 1, label: 'Coro' }] }));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.fields.markers, [{ t: 1, label: 'Coro' }]);
});

test('snapshot copia los arreglos (no comparte referencias)', () => {
  const s = song({ markers: [{ t: 1 }] });
  const snap = snapshot(s);
  s.markers[0].t = 9;
  assert.equal(snap.markers[0].t, 1);
});

import { adoptCloudKeyPitch } from '../src/js/cloud/songMerge.js';
test('tono ligado del audio: llega del equipo si no tengo cambios sin subir', () => {
  const local = { sequence: 'a.mp3', pitch: 0, keyPitch: 0 };
  assert.deepEqual(adoptCloudKeyPitch(local, { keyPitch: -2, pitch: -2 }), { sequence: 'a.mp3', pitch: -2, keyPitch: -2 });
  // Con cambios míos sin subir, se queda lo mío.
  assert.equal(adoptCloudKeyPitch(local, { keyPitch: -2 }, true), local);
  // Fila de una versión anterior (sin keyPitch): no toca lo local.
  assert.equal(adoptCloudKeyPitch(local, { pitch: 5 }), local);
});
