import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMerge, mergeChannel } from '../src/js/stems/loopMerge.js';

const SR = 10; // 10 muestras por segundo: los números se leen a ojo

function run(cur, curData, atSec, loopData) {
  const plan = planMerge(cur, atSec, loopData.length);
  const out = new Float32Array(plan.length);
  mergeChannel(out, curData, loopData, plan);
  return { plan, out: Array.from(out) };
}

test('un loop después de la pista la alarga con silencio en medio', () => {
  // Pista: 1 s de "1" desde t=0. Loop de 0.5 s de "2" en t=2.
  const { plan, out } = run({ offsetSec: 0, trimEndSec: 1, sampleRate: SR },
    new Float32Array(10).fill(1), 2, new Float32Array(5).fill(2));
  assert.equal(plan.offsetSec, 0);
  assert.deepEqual(out, [1,1,1,1,1,1,1,1,1,1, 0,0,0,0,0,0,0,0,0,0, 2,2,2,2,2]);
});

test('un loop encima reemplaza solo su tramo', () => {
  const { out } = run({ offsetSec: 0, trimEndSec: 1, sampleRate: SR },
    new Float32Array(10).fill(1), 0.3, new Float32Array(4).fill(2));
  assert.deepEqual(out, [1,1,1,2,2,2,2,1,1,1]);
});

test('un loop antes de la pista mueve el inicio hacia atrás', () => {
  const { plan, out } = run({ offsetSec: 2, trimEndSec: 0.5, sampleRate: SR },
    new Float32Array(5).fill(1), 1, new Float32Array(3).fill(2));
  assert.equal(plan.offsetSec, 1);
  assert.deepEqual(out, [2,2,2,0,0,0,0,0,0,0, 1,1,1,1,1]);
});

test('respeta el recorte de la pista (solo queda lo audible)', () => {
  // Buffer 0..9, recortado a [0.2 s, 0.6 s] → se oyen las muestras 2..5 en t=0.2.
  const data = Float32Array.from({ length: 10 }, (_, i) => i);
  const { plan, out } = run({ offsetSec: 0, trimStartSec: 0.2, trimEndSec: 0.6, sampleRate: SR }, data, 1, new Float32Array(2).fill(9));
  assert.equal(plan.offsetSec, 0.2);
  assert.deepEqual(out, [2,3,4,5, 0,0,0,0, 9,9]);
});
