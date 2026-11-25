import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scalesFor } from '../src/js/ui/scaleHelper.js';

const names = (sc, pcs) => pcs.map((p) => sc.names[p]);

test('tono mayor: escala, pentatónica y notas seguras', () => {
  const sc = scalesFor('G');
  assert.equal(sc.name, 'Sol mayor');
  assert.deepEqual(names(sc, sc.scale), ['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
  assert.deepEqual(names(sc, sc.penta), ['G', 'A', 'B', 'D', 'E']);
  assert.deepEqual(names(sc, sc.safe), ['G', 'B', 'D']);
});

test('tono menor y nombres con bemoles', () => {
  const sc = scalesFor('Dm');
  assert.equal(sc.name, 'Re menor');
  assert.deepEqual(names(sc, sc.scale), ['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
  assert.deepEqual(names(sc, sc.penta), ['D', 'F', 'G', 'A', 'C']);
  assert.equal(scalesFor('Bb').name, 'Sib mayor');
  assert.equal(scalesFor(''), null);
});
