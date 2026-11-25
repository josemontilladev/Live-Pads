import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chordFor, viewKey } = require('../companion/client/instrument.js');

test('guitarra con cejilla: formas a tocar', () => {
  assert.equal(chordFor('G', { mode: 'capo', capo: 2, key: 'G' }), 'F');
  assert.equal(chordFor('Em7', { mode: 'capo', capo: 2, key: 'G' }), 'Dm7');
  assert.equal(chordFor('D/F#', { mode: 'capo', capo: 2, key: 'G' }), 'C/E');
  assert.equal(viewKey('G', 'capo', 2), 'F');
});

test('bajo: solo la nota base (el bajo de los acordes con barra)', () => {
  assert.equal(chordFor('Am7', { mode: 'bass', key: 'C' }), 'A');
  assert.equal(chordFor('G/B', { mode: 'bass', key: 'C' }), 'B');
});

test('vientos: Si♭ (+2) y Mi♭ (+9)', () => {
  assert.equal(chordFor('C', { mode: 'bb', key: 'C' }), 'D');
  assert.equal(chordFor('F', { mode: 'bb', key: 'F' }), 'G');
  assert.equal(chordFor('C', { mode: 'eb', key: 'C' }), 'A');
  assert.equal(viewKey('Bb', 'bb', 0), 'C');
  assert.equal(viewKey('Eb', 'eb', 0), 'C');
});

test('grados respecto al tono, y lo que no es acorde se deja igual', () => {
  assert.equal(chordFor('Am', { nums: true, key: 'C' }), '6m');
  assert.equal(chordFor('C', { nums: true, key: 'Dm' }), 'b7');
  assert.equal(chordFor('G/B', { nums: true, mode: 'bass', key: 'C' }), '7');
  assert.equal(chordFor('Coro', { key: 'C' }), null);
  assert.equal(chordFor('x2', { key: 'C' }), null);
});
