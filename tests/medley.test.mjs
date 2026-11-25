import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medleyExitAt } from '../src/js/live/medleyCore.js';

test('punto de salida del medley: sección marcada o final de la pista', () => {
  assert.equal(medleyExitAt({ out: 182.5 }, 300), 182.5);
  assert.ok(Math.abs(medleyExitAt({ out: null }, 300) - 299.85) < 1e-9);
  assert.ok(Number.isNaN(medleyExitAt({ out: null }, NaN)));
  assert.ok(Number.isNaN(medleyExitAt(null, 300)));
});
