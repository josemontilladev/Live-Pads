import { test } from 'node:test';
import assert from 'node:assert/strict';
const C = await import('../src/js/live/clickSectionsCore.js');

test('click por sección: sección actual, regla general y ajustes del metrónomo', () => {
  const ms = [{ label: 'Intro', t: 0 }, { label: 'Verso 1', t: 10 }, { label: 'Coro', t: 40 }, { label: 'Verso 2', t: 70 }];
  assert.equal(C.sectionAt(ms, 5).label, 'Intro');
  assert.equal(C.sectionAt(ms, 75).label, 'Verso 2');
  const rules = { Verso: 'x2', Coro: 'mute' };
  assert.equal(C.ruleFor(rules, 'Verso 2'), 'x2');
  assert.equal(C.ruleFor(rules, 'Puente'), '');
  assert.deepEqual(C.modeToClick('x4'), { mute: false, mult: 4 });
  assert.deepEqual(C.modeToClick('mute'), { mute: true, mult: null });
  assert.equal(C.modeToClick(''), null);
});
