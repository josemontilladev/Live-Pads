import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordNumber, keyTonic } from '../src/js/utils/chordNumbers.js';

test('tono mayor: C G Am F en C → 1 5 6m 4', () => {
  assert.deepEqual(['C', 'G', 'Am', 'F'].map((c) => chordNumber(c, 'C')), ['1', '5', '6m', '4']);
});

test('los números no cambian al transponer', () => {
  assert.deepEqual(['D', 'A', 'Bm', 'G'].map((c) => chordNumber(c, 'D')), ['1', '5', '6m', '4']);
  assert.deepEqual(['Bb', 'F', 'Gm', 'Eb'].map((c) => chordNumber(c, 'Bb')), ['1', '5', '6m', '4']);
});

test('tono menor: se cuenta desde la tónica menor', () => {
  assert.deepEqual(['Dm', 'C', 'Gm', 'F', 'Bb', 'A'].map((c) => chordNumber(c, 'Dm')), ['1m', 'b7', '4m', 'b3', 'b6', '5']);
});

test('sufijos, bajos y acordes prestados', () => {
  assert.equal(chordNumber('G/B', 'C'), '5/7');
  assert.equal(chordNumber('Am7', 'C'), '6m7');
  assert.equal(chordNumber('Fmaj7', 'C'), '4maj7');
  assert.equal(chordNumber('Dsus4', 'G'), '5sus4');
  assert.equal(chordNumber('Bb', 'C'), 'b7');
  assert.equal(chordNumber('F#m', 'D'), '3m');
  assert.equal(chordNumber('C#', 'C'), 'b2');
});

test('tonos escritos de varias formas y entradas inválidas', () => {
  assert.deepEqual(keyTonic('F#m'), { pc: 6, minor: true });
  assert.deepEqual(keyTonic('Sol'), { pc: 7, minor: false });
  assert.deepEqual(keyTonic('Lam'), { pc: 9, minor: true });
  assert.equal(chordNumber('Am', ''), null);
  assert.equal(chordNumber('Coro', 'C'), null);
});
