import { test } from 'node:test';
import assert from 'node:assert/strict';
const S = await import('../src/js/utils/singerKeys.js');

test('quién dirige: tono de cada cantante y lista de cantantes', () => {
  const a = 'G · María; D · Juan', b = 'A · maría; E · Pedro';
  assert.equal(S.keyForSinger(a, 'Maria'), 'G');
  assert.equal(S.keyForSinger(b, 'MARÍA'), 'A');
  assert.equal(S.keyForSinger(a, 'Pedro'), null);
  assert.deepEqual(S.singersIn([a, b]), ['Juan', 'María', 'Pedro']);
});
