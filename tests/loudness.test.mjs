import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, gainFor, TARGET_DB } from '../src/js/audio/loudness.js';

const sr = 8000;
const sine = (amp, secs = 4) => { const x = new Float32Array(sr * secs); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * 220 * i / sr); return x; };

test('un seno a escala completa mide unos −3 dB', () => {
  assert.ok(Math.abs(measure([sine(1)], sr) - (-3)) < 0.3);
});

test('la mitad de amplitud mide 6 dB menos', () => {
  const a = measure([sine(1)], sr), b = measure([sine(0.5)], sr);
  assert.ok(Math.abs((a - b) - 6.02) < 0.3);
});

test('el silencio del principio no baja la medida (puerta)', () => {
  const x = new Float32Array(sr * 8); x.set(sine(0.5, 4), sr * 4);
  assert.ok(Math.abs(measure([x], sr) - measure([sine(0.5)], sr)) < 0.5);
});

test('ganancia: lleva al nivel común y se limita', () => {
  assert.ok(Math.abs(20 * Math.log10(gainFor(TARGET_DB + 4)) + 4) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(gainFor(-60)) - 6) < 1e-9);    // como mucho +6 dB
  assert.ok(Math.abs(20 * Math.log10(gainFor(0)) + 9) < 1e-9);      // como mucho −9 dB
  assert.equal(gainFor(-Infinity), 1);
});

test('cada tipo tiene su nivel: secuencias -24, originales -11', async () => {
  const { gainFor: g, TARGETS } = await import('../src/js/audio/loudness.js');
  assert.ok(Math.abs(20 * Math.log10(g(-27, 'sequence')) - 3) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(g(-8, 'original')) + 3) < 1e-9);
  assert.deepEqual(TARGETS, { sequence: -24, original: -11 });
});
