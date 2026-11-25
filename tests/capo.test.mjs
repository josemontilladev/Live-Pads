import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bestCapo, capoLabel, capoShape } from '../src/js/utils/capo.js';

const require = createRequire(import.meta.url);
const inst = require('../companion/client/instrument.js');

test('tonos que ya van en formas abiertas: sin cejilla', () => {
  for (const k of ['G', 'C', 'D', 'A', 'E', 'Em', 'Am']) assert.equal(bestCapo(k).capo, 0, k);
});

test('cejilla sugerida en los tonos habituales de alabanza', () => {
  assert.deepEqual(bestCapo('Bb'), { capo: 1, shape: 'A' });
  assert.deepEqual(bestCapo('Eb'), { capo: 1, shape: 'D' });
  assert.deepEqual(bestCapo('Ab'), { capo: 1, shape: 'G' });
  assert.deepEqual(bestCapo('Db'), { capo: 1, shape: 'C' });
  assert.deepEqual(bestCapo('F#'), { capo: 2, shape: 'E' });
  assert.deepEqual(bestCapo('F#m'), { capo: 2, shape: 'Em' });
  assert.deepEqual(bestCapo('Bm'), { capo: 2, shape: 'Am' });
  assert.equal(bestCapo('Sol').capo, 0);
  assert.equal(bestCapo('xyz'), null);
});

test('nunca pasa del traste 7 y siempre propone algo en los 24 tonos', () => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (const r of names) for (const k of [r, r + 'm']) {
    const c = bestCapo(k);
    assert.ok(c && c.capo >= 0 && c.capo <= 7, k);
  }
});

test('la app y el Companion sugieren lo mismo en los 24 tonos', () => {
  const names = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (const r of names) for (const k of [r, r + 'm']) assert.deepEqual(inst.bestCapo(k), bestCapo(k), k);
});

test('formas con cejilla y etiqueta', () => {
  assert.equal(capoShape('Bb', 1, 'A'), 'A');
  assert.equal(capoShape('Gm7', 1, 'A'), 'F#m7');
  assert.equal(capoShape('Eb/G', 1, 'D'), 'D/F#');
  assert.equal(capoShape('F', 3, 'D'), 'D');
  assert.equal(capoLabel({ capo: 3, shape: 'G' }), 'Cejilla 3 · formas de G');
  assert.equal(capoLabel({ capo: 0, shape: 'G' }), 'Sin cejilla');
});
