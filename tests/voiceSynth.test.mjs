import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realSegments } from '../src/js/voices/voiceSynth.js';

const sr = 1000;
const lead = [{ s: 0, e: 1, m: 60 }, { s: 1, e: 2, m: 62 }, { s: 2, e: 3, m: 64 }, { s: 3, e: 4, m: 65 }];

test('voz real: notas seguidas con el mismo intervalo son un solo trozo', () => {
  const harm = [{ m: 64 }, { m: 66 }, { m: 67 }, { m: 69 }];   // +4, +4, +3, +4
  const segs = realSegments(lead, harm, sr, 5000, 15);
  assert.deepEqual(segs.map((g) => g.s), [4, 3, 4]);
  assert.equal(segs[0].a, 0); assert.equal(segs[0].b, 2050);
});

test('voz real: fundido cruzado que suma 1 (sin huecos ni subidas de volumen)', () => {
  const harm = [{ m: 64 }, { m: 65 }, { m: 67 }, { m: 69 }];
  const segs = realSegments(lead, harm, sr, 5000, 15);
  const sum = new Float32Array(5000);
  for (const g of segs) for (let k = g.a; k < g.b; k++) sum[k] += Math.min(1, (k - g.a + 0.5) / g.fi, (g.b - k - 0.5) / g.fo);
  for (let k = 100; k < 3900; k++) assert.ok(Math.abs(sum[k] - 1) < 0.02, `t=${k / sr}s suma ${sum[k].toFixed(3)}`);
});
