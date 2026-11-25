import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransition } from '../src/js/live/transitionCore.js';

const names = (a, b) => planTransition(a, b).map((s) => s.name).join(' → ');

test('de C a G: ii–V–I (Am existe en los dos tonos)', () => {
  assert.equal(names('C', 'G'), 'C → Am → D7 → G');
});

test('de G a A: D (IV de A, también en G) → E7 → A', () => {
  assert.equal(names('G', 'A'), 'G → D → E7 → A');
});

test('sin acorde común se va directo por la dominante', () => {
  assert.equal(names('C', 'F#'), 'C → C#7 → F#');
});

test('a tono menor y con bemoles', () => {
  assert.equal(names('F', 'Dm'), 'F → Gm → A7 → Dm');
  assert.deepEqual(planTransition('G', 'G'), []);
  assert.deepEqual(planTransition('', 'G'), []);
});
