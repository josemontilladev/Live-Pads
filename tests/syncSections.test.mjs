import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsFromSync, sectionBar, barStarts } from '../src/js/ui/syncSections.js';

// 120 BPM, 4/4: compás de 2 s, tiempo de 0,5 s, compases en 0, 2, 4…
const grid = { barSec: 2, beatSec: 0.5, beatsPerBar: 4, downbeats: Array.from({ length: 150 }, (_, k) => k * 2) };
const L = (label, sec, n) => Array.from({ length: n }, (_, k) => ({ text: `${label} línea ${k + 1}`, sec, label }));
// Verso 1 (líneas 0-3), Coro (4-7), Verso 2 (8-11)
const lines = [...L('Verso 1', 0, 4), ...L('Coro', 1, 4), ...L('Verso 2', 2, 4)];
const run = (start, first) => Array.from({ length: 4 }, (_, k) => [start + k * 4, first + k]);

test('compás de cada sección: en la 1, anacrusa y entrada tardía', () => {
  const bars = barStarts(grid, 100);
  assert.equal(sectionBar(16.1, bars, { beatSec: 0.5 }), 16);      // en la 1
  assert.equal(sectionBar(15.4, bars, { beatSec: 0.5 }), 16);      // anacrusa (último tiempo) → compás siguiente
  assert.equal(sectionBar(16.6, bars, { beatSec: 0.5 }), 16);      // entra en la 2 → ese compás
  assert.equal(sectionBar(14.95, bars, { beatSec: 0.5 }), 14);     // entra en la 4 del compás… pero muy pronto: 1,05 s antes = 2 tiempos y algo → ese compás
});

test('secciones de la letra sincronizada, con intro, interludio y final', () => {
  const ev = [...run(16.05, 0), ...run(32.1, 4), ...run(60, 8), ...run(75.6, 4)];
  const r = sectionsFromSync(lines, ev, { grid, dur: 120 });
  assert.deepEqual(r.map((m) => m.label), ['Intro', 'Verso 1', 'Coro', 'Instrumental', 'Verso 2', 'Coro', 'Final']);
  assert.deepEqual(r.map((m) => m.t), [0, 16, 32, 48, 60, 76, 92]);   // el interludio, al acabar la última línea (44,1 + 4 s)
});

test('coro repetido seguido = dos secciones; una línea dudosa suelta no crea sección', () => {
  const ev = [...run(0.2, 0), ...run(16, 4), ...run(32, 4), [44.5, 9, 0], ...run(48, 4)];
  const r = sectionsFromSync(lines, ev, { grid, dur: 66 });
  assert.deepEqual(r.map((m) => [m.label, m.t]), [['Verso 1', 0], ['Coro', 16], ['Coro', 32], ['Coro', 48]]);
});

test('si la IA no oyó la primera línea de una sección, se estima con la otra vez que sonó', () => {
  // El segundo coro: falta la línea 4 (la primera); las otras llegan a 72, 76, 80.
  const ev = [...run(16, 0), ...run(32, 4), ...run(48, 8), [72, 5], [76, 6], [80, 7]];
  const r = sectionsFromSync(lines, ev, { grid, dur: 90 });
  const coros = r.filter((m) => m.label === 'Coro').map((m) => m.t);
  assert.deepEqual(coros, [32, 68]);
});

test('sin rejilla usa los tiempos de la letra; con poco no inventa', () => {
  const r = sectionsFromSync(lines, [...run(10, 0), ...run(30, 4)], { dur: 50 });
  assert.equal(r[1].label, 'Verso 1'); assert.ok(Math.abs(r[1].t - 9.9) < 0.01);
  assert.deepEqual(sectionsFromSync(lines, [[3, 0]], { grid, dur: 50 }), []);
});
