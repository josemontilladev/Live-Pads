import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cdLeft, fmtLeft } from '../src/js/ui/tvCountdownCore.js';

test('lo que falta, redondeado hacia arriba y nunca negativo', () => {
  assert.equal(cdLeft({ until: 10500 }, 0), 11);
  assert.equal(cdLeft({ until: 1000 }, 5000), 0);
  assert.equal(cdLeft(null, 0), 0);
});

test('formato mm:ss y h:mm:ss', () => {
  assert.equal(fmtLeft(300), '05:00');
  assert.equal(fmtLeft(59), '00:59');
  assert.equal(fmtLeft(3725), '1:02:05');
});
