import { test } from 'node:test';
import assert from 'node:assert/strict';

import { offsetAt } from '../src/js/live/modulationCore.js';

test('la modulación empieza en el punto marcado y se deshace al volver atrás', () => {
  const mod = { at: 180, semis: 1 };
  assert.equal(offsetAt(mod, 0), 0);
  assert.equal(offsetAt(mod, 179.9), 0);
  assert.equal(offsetAt(mod, 180), 1);
  assert.equal(offsetAt(mod, 240), 1);
  assert.equal(offsetAt(null, 240), 0);
  assert.equal(offsetAt({ at: 10, semis: -2 }, 20), -2);
});
