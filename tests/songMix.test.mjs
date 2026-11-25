import { test } from 'node:test';
import assert from 'node:assert/strict';
const { pickMix, mixKeyOf } = await import('../src/js/live/songMixCore.js');

test('mezcla por canción: la propia si existe; si no, la general', () => {
  const all = { general: { 'mx-pads-vol': 75 }, songs: { c1: { 'mx-pads-vol': 40 } } };
  assert.equal(pickMix(all, 'c1')['mx-pads-vol'], 40);
  assert.equal(pickMix(all, 'otra')['mx-pads-vol'], 75);
  assert.equal(pickMix({}, 'c1'), null);
  assert.equal(mixKeyOf({ id: 5, cloudId: 'abc' }), 'abc');
  assert.equal(mixKeyOf({ id: 5 }), '5');
});
