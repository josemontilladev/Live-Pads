import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSectionCounter } from '../src/js/live/sectionCountCore.js';

const M = [
  { t: 0, label: 'Intro' }, { t: 10, label: 'Verso 1' }, { t: 30, label: 'Coro' },
  { t: 50, label: 'Verso 2' }, { t: 70, label: 'Coro' }, { t: 90, label: 'Puente' }, { t: 110, label: 'Coro' }, { t: 130, label: 'Final' },
];
const run = (c, times) => times.map((t) => { const r = c.update(M, t, 'x'); return r && r.show ? `${r.label} ${r.n}/${r.total}` : (r ? r.label : null); });

test('pasada normal: Coro 1/3, 2/3, 3/3; verso numerado y puente sin contador', () => {
  const c = createSectionCounter();
  assert.deepEqual(run(c, [5, 15, 35, 55, 75, 95, 115]), ['Intro', 'Verso 1', 'Coro 1/3', 'Verso 2', 'Coro 2/3', 'Puente', 'Coro 3/3']);
});

test('repetir el coro con «Arreglo» suma una vez y el total crece', () => {
  const c = createSectionCounter();
  run(c, [5, 35, 55, 75, 85]);
  // Salto atrás al principio del 2.º coro (repetición).
  assert.deepEqual(run(c, [70.2, 80]), ['Coro 3/4', 'Coro 3/4']);
  assert.deepEqual(run(c, [95, 115]), ['Puente', 'Coro 4/4']);
});

test('saltar adelante a mano no baja la cuenta', () => {
  const c = createSectionCounter();
  assert.deepEqual(run(c, [5, 112]), ['Intro', 'Coro 3/3']);
});

test('volver al principio empieza de nuevo; otra canción también', () => {
  const c = createSectionCounter();
  run(c, [35, 75]);
  assert.deepEqual(run(c, [0.5, 35]), ['Intro', 'Coro 1/3']);
  const r = c.update(M, 35, 'otra');
  assert.equal(`${r.n}/${r.total}`, '1/3');
});
