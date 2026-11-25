import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVariableTempo, clickTimes } from '../src/js/stems/tempoMapCore.js';

const steady = (bpm, n, t0 = 0.5, jitter = 0.01) => Array.from({ length: n }, (_, i) => t0 + i * 60 / bpm + (i % 2 ? jitter : -jitter));
// Acelera de 70 a 90 BPM a lo largo de la canción.
const accel = (n) => { const out = [1]; for (let i = 1; i < n; i++) out.push(out[i - 1] + 60 / (70 + 20 * i / n)); return out; };

test('tempo fijo (con temblor del detector): no es variable', () => {
  assert.equal(isVariableTempo(steady(120, 200)), false);
});
test('tempo fijo con pulsos perdidos (break, medio tiempo): no es variable', () => {
  const b = steady(128, 400).filter((_, i) => !(i > 100 && i < 140) && !(i > 200 && i < 260 && i % 2));
  assert.equal(isVariableTempo(b), false);
});
test('canción que acelera: es variable', () => {
  assert.equal(isVariableTempo(accel(300)), true);
});
test('pocos pulsos: no se decide nada', () => {
  assert.equal(isVariableTempo(accel(10)), false);
});
test('clickTimes cubre toda la pista y sigue los pulsos', () => {
  const b = accel(300);
  const { times, accents } = clickTimes(b, b.filter((_, i) => i % 4 === 0), 250);
  assert.ok(times[0] >= 0 && times[0] < 1);
  assert.ok(times[times.length - 1] < 250 && times[times.length - 1] > 249);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  const k = times.findIndex((t) => Math.abs(t - b[150]) < 0.05);
  assert.ok(k >= 0, 'el pulso 150 sigue en su sitio');
  // Acento cada 4, también en la parte extrapolada del principio.
  const idx = accents.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  for (let i = 1; i < idx.length; i++) assert.equal(idx[i] - idx[i - 1], 4);
});
test('clickTimes rellena un break sin pulsos detectados', () => {
  const full = accel(300);
  const b = full.filter((_, i) => !(i > 120 && i < 150));
  const { times } = clickTimes(b, [], 250);
  for (let i = 121; i < 150; i++) assert.ok(times.some((t) => Math.abs(t - full[i]) < 0.1), 'falta el pulso ' + i);
});
test('el detector pasa a corcheas (y a contratiempo) en una parte: sigue siendo tempo fijo', () => {
  const P = 0.6, b = [];
  for (let i = 0; i < 400; i++) {
    const t = 0.4 + i * P;
    if (i > 150 && i < 230) { b.push(t + P / 2); b.push(t + P); }   // corcheas que empiezan a contratiempo
    else b.push(t);
  }
  assert.equal(isVariableTempo([...new Set(b)].sort((x, y) => x - y)), false);
  const { times } = clickTimes(b, [], 400 * P);
  const near = times.filter((t) => t > 0.4 + 160 * P && t < 0.4 + 220 * P);
  assert.ok(near.length >= 55 && near.length <= 62, 'el click sigue en negras en esa parte: ' + near.length);
});
