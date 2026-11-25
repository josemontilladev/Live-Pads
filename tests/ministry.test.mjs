import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressionChords } from '../src/js/live/ministryCore.js';
const n = (k, id) => progressionChords(k, id).map((c) => c.name).join(' ');

test('progresiones en tono mayor', () => {
  assert.equal(n('G', 'pop'), 'G D Em C');
  assert.equal(n('D', 'worship'), 'D G');
  assert.equal(n('C', 'vi'), 'Am F C G');
  assert.equal(n('Bb', 'fifties'), 'Bb Gm Eb F');
});

test('en tono menor usa sus grados', () => {
  assert.equal(n('Am', 'pop'), 'Am G F C');
  assert.equal(n('Dm', 'drone'), 'Dm');
  assert.equal(n('', 'pop'), '');
});
