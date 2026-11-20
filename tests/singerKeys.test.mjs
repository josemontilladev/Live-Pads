import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSingerKeys, formatSingerKeys, cleanSingerKeys, upsertSingerKey, shiftLabel, shiftShort, noteForKey } from '../src/js/utils/singerKeys.js';

test('lee el texto guardado y lo vuelve a escribir igual', () => {
  const t = 'G · María; E · Pedro';
  assert.deepEqual(parseSingerKeys(t), [{ key: 'G', note: 'María' }, { key: 'E', note: 'Pedro' }]);
  assert.equal(formatSingerKeys(parseSingerKeys(t)), t);
});

test('acepta lo que se escribe a mano de varias formas', () => {
  assert.equal(cleanSingerKeys('g - maría'), 'G · maría');
  assert.equal(cleanSingerKeys('Bb: Coro de jóvenes'), 'Bb · Coro de jóvenes');
  assert.equal(cleanSingerKeys('F#m (Ana)'), 'F#m · Ana');
  assert.equal(cleanSingerKeys('E'), 'E');
  assert.equal(cleanSingerKeys('A María'), 'A · María');
});

test('descarta lo que no es un tono y los repetidos', () => {
  assert.equal(cleanSingerKeys('hola; ; H · X'), '');
  assert.equal(cleanSingerKeys('G · María; G · maría'), 'G · María');
  assert.equal(cleanSingerKeys(null), '');
});

test('guardar otra vez a la misma persona le cambia el tono, no la duplica', () => {
  assert.equal(upsertSingerKey('G · María; E · Pedro', 'F', 'maría'), 'F · maría; E · Pedro');
  assert.equal(upsertSingerKey('G · María', 'E', 'Pedro'), 'G · María; E · Pedro');
  assert.equal(upsertSingerKey('', 'G', ''), 'G');
  assert.equal(upsertSingerKey('G', 'G', ''), 'G');
});

test('dice cuánto sube o baja', () => {
  assert.equal(shiftLabel('A', 'G'), 'baja 1 tono');
  assert.equal(shiftLabel('G', 'A'), 'sube 1 tono');
  assert.equal(shiftLabel('C', 'B'), 'baja ½ tono');
  assert.equal(shiftLabel('C', 'Eb'), 'sube 1½ tonos');
  assert.equal(shiftLabel('C', 'E'), 'sube 2 tonos');
  assert.equal(shiftLabel('G', 'G'), '');
  assert.equal(shiftLabel('G', 'zz'), '');
  assert.equal(shiftShort('A', 'G'), '↓1');
  assert.equal(shiftShort('C', 'Db'), '↑½');
  assert.equal(shiftShort('C', 'Eb'), '↑1½');
});

test('encuentra la nota de un tono', () => {
  assert.equal(noteForKey('G · María; E · Pedro', 'E'), 'Pedro');
  assert.equal(noteForKey('G · María', 'A'), '');
});
