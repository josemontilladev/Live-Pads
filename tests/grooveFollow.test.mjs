import { test } from 'node:test';
import assert from 'node:assert/strict';
const F = await import('../src/js/live/grooveFollowCore.js');

test('sección → parte del ritmo', () => {
  assert.equal(F.partForLabel('Intro'), 'intro');
  assert.equal(F.partForLabel('Verso 2'), 'A');
  assert.equal(F.partForLabel('Pre Coro'), 'A');
  assert.equal(F.partForLabel('Coro'), 'B');
  assert.equal(F.partForLabel('Puente 1'), 'C');
  assert.equal(F.partForLabel('Instrumental'), 'B');
  assert.equal(F.partForLabel('Final'), 'A');
});

test('pulsos: el más cercano y el próximo primer tiempo', () => {
  const b = [0, 0.5, 1, 1.5, 2];
  assert.equal(F.nearestIdx(b, 1.2), 2);
  assert.equal(F.nearestIdx(b, 1.3), 3);
  assert.equal(F.firstAtOrAfter([0, 2, 4], 2.1), 4);
});

test('seguir la canción: parte de la sección actual y redoble antes del cambio', () => {
  const ms = [{ id: 'i', label: 'Intro', t: 0 }, { id: 'v', label: 'Verso 1', t: 8 }, { id: 'c', label: 'Coro', t: 24 }];
  const done = new Set();
  assert.deepEqual(F.followStep(ms, 1, 2, { current: null, done }), { part: 'intro' });
  assert.deepEqual(F.followStep(ms, 5, 2, { current: 'intro', done }), { fillThen: 'A' });   // faltan 3 s (1,5 compases)
  assert.equal(F.followStep(ms, 5.5, 2, { current: 'A', done }), null);                      // ya pedido (el ritmo va hacia A)
  // Durante el redoble (el ritmo ya va hacia el verso), no se vuelve a pedir la intro.
  assert.equal(F.followStep(ms, 6.5, 2, { current: 'A', done }), null);
  assert.equal(F.followStep(ms, 12, 2, { current: 'A', done }), null);
  // Sin redobles: se pide un compás antes.
  const d2 = new Set();
  assert.deepEqual(F.followStep(ms, 22.5, 2, { current: 'A', fills: false, done: d2 }), { part: 'B' });
});
