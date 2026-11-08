import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { keyFromSegments } from '../src/js/chords/trackChords.js';

const require = createRequire(import.meta.url);
const { classToChord, smoothPath, pathToSegments, FPS } = require('../chordModel.js');

test('clases del modelo → acordes de la app', () => {
  assert.deepEqual(classToChord(1), { r: 0, q: 0, b: -1 });          // C (maj)
  assert.deepEqual(classToChord(14 * 9 + 0), { r: 9, q: 1, b: -1 }); // A:min → Am
  assert.deepEqual(classToChord(14 * 7 + 9), { r: 7, q: 2, b: -1 }); // G:7
  assert.deepEqual(classToChord(14 * 2 + 13), { r: 2, q: 5, b: -1 }); // D:sus4
  assert.equal(classToChord(168).r, -1);                              // X
  assert.equal(classToChord(169).r, -1);                              // N
});

test('el suavizado quita los saltos de un cuadro y respeta los cambios largos', () => {
  const C = 3, frames = 40, lg = new Float32Array(frames * C);
  for (let f = 0; f < frames; f++) {
    const want = f < 20 ? 0 : 1;
    const noisy = f === 7 ? 2 : want;   // un cuadro suelto que «parece» otra cosa
    lg[f * C + noisy] = 4;
  }
  const raw = smoothPath(lg, frames, C, 0);
  assert.equal(raw[7], 2);
  const p = smoothPath(lg, frames, C, 20);
  assert.equal(p[7], 0);
  assert.equal(p[5], 0);
  assert.equal(p[30], 1);
});

test('tramos con tiempos por cuadro', () => {
  const path = Int32Array.from([1, 1, 1, 15, 15]);   // C C C C# C# (15 = 14·1 + 1 → C# mayor)
  const seg = pathToSegments(path, 5 / FPS);
  assert.equal(seg.length, 2);
  assert.equal(seg[0].r, 0);
  assert.equal(seg[1].r, 1);
  assert.ok(Math.abs(seg[1].s - 3 / FPS) < 1e-3);
});

test('tonalidad a partir de los acordes', () => {
  // G – D – Em – C (Sol mayor)
  const seg = [];
  let t = 0;
  for (let i = 0; i < 8; i++) for (const [r, q] of [[7, 0], [2, 0], [4, 1], [0, 0]]) { seg.push({ s: t, e: t + 2, r, q }); t += 2; }
  assert.deepEqual(keyFromSegments(seg, t), { k: 7, m: false });
  // Am – F – C – G empezando y terminando en Am, mucho tiempo en Am → La menor
  const s2 = [];
  t = 0;
  for (let i = 0; i < 8; i++) for (const [r, q, d] of [[9, 1, 6], [5, 0, 2], [0, 0, 2], [7, 0, 2]]) { s2.push({ s: t, e: t + d, r, q }); t += d; }
  s2.push({ s: t, e: t + 8, r: 9, q: 1 }); t += 8;
  assert.deepEqual(keyFromSegments(s2, t), { k: 9, m: true });
});
