import test from 'node:test';
import assert from 'node:assert/strict';

import { keepLocalAudio } from '../src/js/cloud/songMerge.js';

const voz = [{ id: 'v1', label: '2.ª voz', path: 'livepads://app/Voces/x.m4a' }];

test('conserva las rutas locales y toma las voces de la nube', () => {
  const r = keepLocalAudio({ sequence: 'L-seq', original: 'L-ori' }, { sequence: 'N-seq', original: 'N-ori', voices: voz });
  assert.equal(r.sequence, 'L-seq');
  assert.equal(r.original, 'L-ori');
  assert.deepEqual(r.voices, voz);
});

test('si la nube ya no trae voces, se quitan las locales (las borró alguien en el móvil)', () => {
  const r = keepLocalAudio({ sequence: 'L-seq', voices: voz }, { sequence: 'N-seq' });
  assert.equal(r.sequence, 'L-seq');
  assert.equal('voices' in r, false);
});

test('sin audio local se usa el de la nube entero', () => {
  const inc = { sequence: 'N-seq', original: null, voices: voz };
  assert.deepEqual(keepLocalAudio({ sequence: null, original: null }, inc), inc);
  assert.deepEqual(keepLocalAudio(null, inc), inc);
});

test('no modifica el objeto local original', () => {
  const local = { sequence: 'L-seq' };
  keepLocalAudio(local, { voices: voz });
  assert.equal('voices' in local, false);
});

// ── Pistas separadas (audio.stems) ──
const stA = { id: 'a', name: 'Bajo', url: 'livepads://app/Stems/bajo.mp3' };
const stB = { id: 'b', name: 'Batería', url: 'livepads://app/Stems/bateria.mp3' };

test('llegan las pistas que otro equipo subió aunque yo tenga secuencia local', () => {
  const r = keepLocalAudio({ sequence: 'L-seq' }, { sequence: 'N-seq', stems: [stA, stB] });
  assert.equal(r.sequence, 'L-seq');
  assert.deepEqual(r.stems, [stA, stB]);
});

test('una fila de la nube que no menciona pistas no borra las locales', () => {
  const r = keepLocalAudio({ sequence: 'L-seq', stems: [stA] }, { sequence: 'N-seq' });
  assert.deepEqual(r.stems, [stA]);
  const sinSecuencia = keepLocalAudio({ sequence: null, original: null, stems: [stA] }, { sequence: 'N-seq' });
  assert.equal(sinSecuencia.sequence, 'N-seq');
  assert.deepEqual(sinSecuencia.stems, [stA]);
});

test('si estoy al día y la nube trae la lista vacía, se quitan (alguien las borró)', () => {
  const r = keepLocalAudio({ sequence: 'L-seq', stems: [stA] }, { sequence: 'N-seq', stems: [] });
  assert.equal('stems' in r, false);
});

test('con cambios míos sin subir se juntan mis pistas y las de la nube', () => {
  const r = keepLocalAudio({ sequence: 'L-seq', stems: [stA] }, { sequence: 'N-seq', stems: [stB] }, true);
  assert.deepEqual(r.stems, [stA, stB]);
  const sinDuplicar = keepLocalAudio({ sequence: 'L-seq', stems: [stA] }, { stems: [stA, stB] }, true);
  assert.deepEqual(sinDuplicar.stems, [stA, stB]);
});
