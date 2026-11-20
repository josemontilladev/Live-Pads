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
