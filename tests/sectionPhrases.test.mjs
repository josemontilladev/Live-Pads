import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regularizePhrases, unifyRepeats, barTimes } from '../src/js/ui/sectionPhrases.js';

// 120 BPM, 4/4 → compás de 2 s, empezando en 0,5 s.
const grid = { barSec: 2, off: 0.5, downbeats: null };
const dur = 100;

test('rejilla de compases', () => {
  const b = barTimes(grid, 10);
  assert.deepEqual(b, [0.5, 2.5, 4.5, 6.5, 8.5]);
});

test('un límite un compás corto (7 compases) pasa a la frase de 8', () => {
  // Intro 0 → Verso en el compás 4 (8,5 s) → Coro al compás 11 (7 compases: un compás corto).
  const m = [{ label: 'Intro', t: 0 }, { label: 'Verso 1', t: 8.4 }, { label: 'Coro', t: 22.6 }, { label: 'Verso 2', t: 40.5 }];
  const out = regularizePhrases(m, grid, dur);
  // Verso: compás 4 → Coro en el compás 12 (8 compases) → Verso 2 en el 20 (8 compases).
  assert.deepEqual(out.map((x) => x.t), [0, 8.5, 24.5, 40.5]);
});

test('los límites caen en compás aunque no haga falta mover frases', () => {
  const m = [{ label: 'Intro', t: 0 }, { label: 'Verso 1', t: 8.7 }, { label: 'Coro', t: 24.3 }];
  assert.deepEqual(regularizePhrases(m, grid, dur).map((x) => x.t), [0, 8.5, 24.5]);
});

test('sin rejilla no se toca nada', () => {
  const m = [{ label: 'Intro', t: 0 }, { label: 'Coro', t: 13.3 }];
  assert.deepEqual(regularizePhrases(m, null, dur), m);
});

test('el mismo coro (misma progresión) recibe el mismo nombre', () => {
  // Progresiones por compás: verso C G Am F ×2, coro F G C Am ×2.
  const verse = [0, 7, 9, 5], chorus = [5, 7, 0, 9];
  const det = [];
  const put = (t0, roots) => roots.forEach((r, k) => det.push({ s: t0 + k * 2, e: t0 + k * 2 + 2, r, q: r === 9 ? 1 : 0 }));
  put(0.5, [...verse, ...verse]);      // 0,5–16,5 verso
  put(16.5, [...chorus, ...chorus]);   // 16,5–32,5 coro
  put(32.5, [...verse, ...verse]);     // 32,5–48,5 verso
  put(48.5, [...chorus, ...chorus]);   // 48,5–64,5 coro (mal etiquetado como «Puente»)
  const markers = [{ label: 'Verso 1', t: 0.5 }, { label: 'Coro', t: 16.5 }, { label: 'Verso 2', t: 32.5 }, { label: 'Puente', t: 48.5 }];
  const out = unifyRepeats(markers, det, grid, 64.5);
  assert.deepEqual(out.map((x) => x.label), ['Verso 1', 'Coro', 'Verso 2', 'Coro']);
});
