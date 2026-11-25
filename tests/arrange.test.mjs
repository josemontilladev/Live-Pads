import { test } from 'node:test';
import assert from 'node:assert/strict';
const A = await import('../src/js/live/arrangeCore.js');
const ms = [{ label: 'Intro', t: 0 }, { label: 'Verso 1', t: 8 }, { label: 'Coro', t: 24 }, { label: 'Verso 2', t: 40 }, { label: 'Coro', t: 56 }, { label: 'Puente', t: 72 }, { label: 'Final', t: 88 }];
const downs = Array.from({ length: 50 }, (_, i) => i * 2);

test('repetir: al terminar la sección vuelve a su inicio', () => {
  assert.deepEqual(A.planJump('repeat', ms, 30, downs), { at: 40, to: 24, label: 'Coro' });
});
test('siguiente: en el próximo compás salta a la siguiente sección', () => {
  assert.deepEqual(A.planJump('next', ms, 13.1, downs), { at: 14, to: 24, label: 'Coro' });
  // El próximo compás ya es la siguiente sección → la de después.
  assert.deepEqual(A.planJump('next', ms, 22.5, downs), { at: 24, to: 40, label: 'Verso 2' });
});
test('ir al coro, al puente o al final', () => {
  assert.deepEqual(A.planJump('chorus', ms, 41, downs), { at: 42, to: 56, label: 'Coro' });
  assert.deepEqual(A.planJump('bridge', ms, 10, downs), { at: 12, to: 72, label: 'Puente' });
  assert.deepEqual(A.planJump('end', ms, 30.5, downs), { at: 32, to: 88, label: 'Final' });
  assert.deepEqual(A.planJump('chorus', ms, 75, downs), { at: 76, to: 24, label: 'Coro' });   // no queda otro: el primero
  assert.equal(A.planJump('chorus', [], 3, downs), null);
});
