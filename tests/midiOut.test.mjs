import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programMessages, sectionAt } from '../src/js/midi/midiOut.js';

test('cambio de programa: 1-128 → 0-127, canal 1-16, banco opcional', () => {
  assert.deepEqual(programMessages({ pc: 1 }, 1), [[0xC0, 0]]);
  assert.deepEqual(programMessages({ pc: 128 }, 16), [[0xCF, 127]]);
  assert.deepEqual(programMessages({ pc: 5, msb: 121, lsb: 2 }, 3), [[0xB2, 0, 121], [0xB2, 32, 2], [0xC2, 4]]);
});

test('sección vigente según las marcas', () => {
  const ms = [{ label: 'Coro', t: 60 }, { label: 'Verso 1', t: 10 }, { label: 'Puente', t: 120 }];
  assert.equal(sectionAt(ms, 5), null);
  assert.equal(sectionAt(ms, 10).label, 'Verso 1');
  assert.equal(sectionAt(ms, 75).label, 'Coro');
  assert.equal(sectionAt(ms, 500).label, 'Puente');
});
