import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickMs, scheduleTicks, bpmFromTicks } from '../src/js/midi/midiClockCore.js';

test('24 pulsos por negra', () => {
  assert.ok(Math.abs(tickMs(120) - 20.8333) < 0.001);
  assert.ok(Math.abs(tickMs(60) - 41.6667) < 0.001);
});

test('programación por adelantado, sin huecos ni ráfagas', () => {
  const r = scheduleTicks(1000, 1000, 1100, 120);
  assert.equal(r.times.length, 5);                       // 1000, 1020.8, 1041.7, 1062.5, 1083.3
  assert.ok(Math.abs(r.next - 1104.1667) < 0.001);
  const r2 = scheduleTicks(r.next, 1100, 1200, 120);      // continúa justo donde quedó
  assert.ok(Math.abs(r2.times[0] - r.next) < 1e-9);
  // Ventana congelada 2 s: no se manda una ráfaga de pulsos atrasados.
  const r3 = scheduleTicks(1000, 3000, 3100, 120);
  assert.equal(r3.times[0], 3000);
  assert.equal(r3.times.length, 5);
});

test('tempo recibido: mediana de intervalos (aguanta el temblor)', () => {
  const st = [];
  let t = 0;
  for (let i = 0; i < 48; i++) { st.push(t); t += tickMs(96) + (i % 2 ? 0.8 : -0.8) + (i % 11 === 0 ? 6 : 0); }
  assert.ok(Math.abs(bpmFromTicks(st) - 96) < 1.5, String(bpmFromTicks(st)));
  assert.equal(bpmFromTicks([0, 20, 40]), null);
});
