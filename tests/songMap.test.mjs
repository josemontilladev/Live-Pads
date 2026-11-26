import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsOf, resolve, naturalOrder, mapDuration, locate, nextStep, cleanArrangements } from '../src/js/live/songMapCore.js';

const M = [{ t: 2, label: 'Intro' }, { t: 10, label: 'Verso' }, { t: 30, label: 'Coro' }, { t: 50, label: 'Verso' }, { t: 70, label: 'Coro' }, { t: 90, label: 'Puente' }, { t: 110, label: 'Coro' }, { t: 130, label: 'Final' }];
const S = sectionsOf(M, 145);

test('secciones con su vez en la pista', () => {
  assert.deepEqual(S.map((x) => `${x.label}${x.n}`), ['Intro1', 'Verso1', 'Coro1', 'Verso2', 'Coro2', 'Puente1', 'Coro3', 'Final1']);
  assert.equal(S[7].e, 145);
  assert.equal(resolve(S, { label: 'coro', n: 2 }).s, 70);
});

test('el arreglo natural no salta nunca', () => {
  const o = naturalOrder(S);
  for (let i = 0; i < o.length; i++) assert.equal(nextStep(S, o, i), null);
  assert.equal(Math.round(mapDuration(S, o, 145)), 145);
});

test('versión corta: sin el 2.º verso ni el puente', () => {
  const o = [{ label: 'Intro', n: 1 }, { label: 'Verso', n: 1 }, { label: 'Coro', n: 1 }, { label: 'Coro', n: 3 }, { label: 'Final', n: 1 }];
  assert.equal(nextStep(S, o, 1), null);                                   // verso → coro: viene solo
  assert.deepEqual(nextStep(S, o, 2), { at: 50, to: 110, label: 'Coro', ai: 3 });   // fin del 1.er coro → 3.er coro
  assert.equal(nextStep(S, o, 3), null);                                   // 3.er coro → final: viene solo
  assert.equal(Math.round(mapDuration(S, o, 145)), 2 + 8 + 20 + 20 + 20 + 15);
});

test('repetir el coro y terminar antes de tiempo', () => {
  const o = [{ label: 'Coro', n: 3 }, { label: 'Coro', n: 3 }];
  assert.deepEqual(nextStep(S, o, 0), { at: 130, to: 110, label: 'Coro', ai: 1 });
  assert.deepEqual(nextStep(S, o, 1), { at: 130, end: true });
});

test('localizar la entrada del arreglo (repeticiones: sigue el orden)', () => {
  const o = [{ label: 'Coro', n: 1 }, { label: 'Coro', n: 1 }, { label: 'Final', n: 1 }];
  assert.equal(locate(S, o, 35), 0);
  assert.equal(locate(S, o, 35, 0), 0);
  assert.equal(locate(S, o, 31, 0), 0);
  assert.equal(locate(S, o, 31, 1), 1);    // tras el salto, el mismo coro es la 2.ª entrada
  assert.equal(locate(S, o, 135, 1), 2);
  assert.equal(locate(S, o, 95), -1);      // el puente no está en este arreglo
  // Justo al pasar el final de la entrada (cuando toca saltar), sigue siendo esa entrada.
  assert.equal(locate(S, o, 50.05, 0), 0);
  assert.equal(locate(S, o, 50.05), -1);
});

test('lo guardado se limpia', () => {
  const a = cleanArrangements({ active: 'x', list: [{ id: 'x', name: '', order: [{ label: 'Coro', n: '2' }, null, { n: 1 }] }, { nope: 1 }] });
  assert.deepEqual(a, { active: 'x', list: [{ id: 'x', name: 'Arreglo 1', order: [{ label: 'Coro', n: 2 }] }] });
  assert.equal(cleanArrangements({ active: 'zz', list: [] }).active, null);
});
