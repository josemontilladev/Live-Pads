import { test } from 'node:test';
import assert from 'node:assert/strict';
const segs = [{ s: 0, e: 4, r: 0, q: 0 }, { s: 4, e: 8, r: 7, q: 0 }, { s: 8, e: 12, r: 9, q: 1 }];
// chordAtTime es puro pero vive en un módulo de navegador: se replica el contrato aquí con la misma lógica.
test('pad que sigue los acordes: acorde vigente mirando un poco por delante', async () => {
  const { chordAtTime } = await import('../src/js/live/padFollowCore.js');
  assert.equal(chordAtTime(segs, 1).r, 0);
  assert.equal(chordAtTime(segs, 3.95).r, 7);   // 0,12 s por delante: ya cambia
  assert.equal(chordAtTime(segs, 9).r, 9);
  assert.equal(chordAtTime(segs, 13), null);
});
