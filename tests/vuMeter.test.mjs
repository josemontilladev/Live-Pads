import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterStep, meterPct } from '../src/js/ui/vuMeterCore.js';

test('la barra sube al instante y cae despacio; el pico se mantiene un momento', () => {
  let s = meterStep(null, { peak: -6, rms: -12, reduction: 0 }, 0);
  assert.equal(s.level, -6);
  s = meterStep(s, { peak: -40, rms: -50, reduction: 0 }, 100);
  assert.ok(s.level < -6 && s.level > -9, 'cae 24 dB/s: ' + s.level);
  assert.equal(s.hold, -6, 'el pico se queda');
  s = meterStep(s, { peak: -40, rms: -50, reduction: 0 }, 2000);
  assert.equal(s.hold, -40, 'y se suelta pasado 1,5 s');
  assert.equal(meterPct(-60), 0); assert.equal(meterPct(0), 100); assert.equal(meterPct(-30), 50); assert.equal(meterPct(-200), 0);
});

test('saturación: recorte fuerte sostenido o pico a 0 dB; un golpe suelto no avisa', () => {
  let s = meterStep(null, { peak: -2, rms: -8, reduction: -8 }, 0);
  assert.equal(s.sat, false, 'un instante no basta');
  s = meterStep(s, { peak: -2, rms: -8, reduction: -8 }, 300);
  assert.equal(s.sat, false);
  s = meterStep(s, { peak: -2, rms: -8, reduction: -8 }, 600);
  assert.equal(s.sat, true, 'medio segundo recortando 8 dB = satura');
  s = meterStep(s, { peak: -20, rms: -30, reduction: 0 }, 1000);
  assert.equal(s.sat, true, 'el aviso se queda 2 s');
  s = meterStep(s, { peak: -20, rms: -30, reduction: 0 }, 2700);
  assert.equal(s.sat, false);
  // Recorte leve (−3 dB) aunque dure: normal.
  let t = null; for (let i = 0; i < 20; i++) t = meterStep(t, { peak: -1, rms: -6, reduction: -3 }, i * 100);
  assert.equal(t.sat, false);
  // Pico a 0 dB: al momento.
  assert.equal(meterStep(null, { peak: 0, rms: -3, reduction: -1 }, 0).sat, true);
});
