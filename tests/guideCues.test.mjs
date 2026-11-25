import { test } from 'node:test';
import assert from 'node:assert/strict';
const G = await import('../src/js/live/guideCues.js');
const A = await import('../src/js/ui/sectionAlign.js');
const S = await import('../src/js/ui/songStructure.js');

function seq(sr, secs) {
  const n = sr * secs, L = new Float32Array(n), R = new Float32Array(n);
  let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < n; i++) R[i] = rnd() * 0.3;                       // música
  for (let t = 0; t < secs; t += 0.5) {                                  // click cada pulso (golpe de 30 ms)
    const a = Math.floor(t * sr);
    for (let i = 0; i < sr * 0.03 && a + i < n; i++) L[a + i] += 0.5 * Math.exp(-i / (sr * 0.006)) * Math.sin(i * 0.9);
  }
  for (const w of [3.0, 11.0]) {                                         // dos palabras de 0,5 s
    const a = Math.floor(w * sr);
    for (let i = 0; i < sr * 0.5; i++) L[a + i] += 0.2 * Math.sin(2 * Math.PI * 180 * i / sr) * (1 + 0.3 * Math.sin(i / 300));
  }
  return { L, R };
}

test('guía: reconoce el canal de guía y separa las palabras del click', () => {
  const sr = 8000, { L, R } = seq(sr, 16);
  assert.equal(G.guideStats(L, R, sr).guide, true);
  assert.equal(G.guideStats(R, R.map((x) => x * 0.9), sr).guide, false);     // estéreo normal: no
  const w = G.guideWords(L, sr);
  assert.equal(w.length, 2, JSON.stringify(w));
  assert.ok(Math.abs(w[0].s - 3) < 0.05 && Math.abs(w[1].s - 11) < 0.05);
});

test('guía: el aviso marca el compás siguiente; aviso + cuenta = un aviso', () => {
  const grid = { downbeats: [0, 2, 4, 6, 8, 10, 12, 14], barSec: 2 };
  const ev = G.guideEvents([{ s: 3.0, e: 3.5 }, { s: 3.55, e: 3.9 }, { s: 10.1, e: 10.6 }], 2);
  assert.equal(ev.length, 2);
  assert.deepEqual(G.guideBoundaries(ev, grid, 16), [4, 12]);
});

test('alineador: verso y coro por sus acordes, en compás', () => {
  const lyr = S.parseLyricStructure('[Verso]\n[G] [D] [Em] [C]\n\n[Coro]\n[C] [G] [Am] [D]');
  const bar = 2, prog = { V: [[7, 0], [2, 0], [4, 1], [0, 0]], C: [[0, 0], [7, 0], [9, 1], [2, 0]] };
  const form = ['V', 'V', 'C', 'C', 'V', 'V', 'C', 'C'];               // cada letra = 4 compases
  const det = []; let t = 0;
  for (const p of form) for (const [r, q] of prog[p]) { det.push({ s: t, e: t + bar, r, q, b: -1 }); t += bar; }
  const grid = { downbeats: Array.from({ length: t / bar }, (_, i) => i * bar), barSec: bar };
  const out = A.alignSections(lyr, det, grid, 0, { duration: t });
  assert.deepEqual(out.map((m) => m.label), ['Verso', 'Coro', 'Verso', 'Coro'], JSON.stringify(out));
  assert.deepEqual(out.map((m) => m.t), [0, 16, 32, 48]);
});

test('guía: la versión por trozos da las mismas palabras', async () => {
  const sr = 8000, { L, R } = seq(sr, 16);
  assert.equal(G.guideStatsFast(L, R, sr).guide, true);
  assert.deepEqual(await G.guideWordsAsync(L, sr), G.guideWords(L, sr));
});
