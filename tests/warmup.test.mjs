import { test } from 'node:test';
import assert from 'node:assert/strict';
const W = await import('../src/js/live/warmupCore.js');

test('calentamiento: empieza en la tónica del tono, dentro de la tesitura', () => {
  assert.equal(W.tonicPc('G'), 7); assert.equal(W.tonicPc('Bbm'), 10); assert.equal(W.tonicPc('F#'), 6);
  const m = W.startMidi(7, 'mid');
  assert.equal(m % 12, 7); assert.ok(m >= 50 && m < 62);
  assert.equal(W.noteName(60), 'Do4');
});

test('calentamiento: cada vuelta sube medio tono y luego baja; acorde antes de cada frase', () => {
  const p = W.buildPlan('five', 0, 'mid', { steps: 3 });
  const chords = p.filter((e) => e.chord);
  assert.equal(chords.length, 7);                                    // 4 subiendo + 3 bajando
  const roots = chords.map((c) => c.notes[0] + 12);
  assert.deepEqual(roots.map((r) => r - roots[0]), [0, 1, 2, 3, 2, 1, 0]);
  const first = p.filter((e) => e.rep === 0 && !e.chord).map((e) => e.notes[0] - roots[0]);
  assert.deepEqual(first, [0, 2, 4, 5, 7, 5, 4, 2, 0]);
  for (let i = 1; i < p.length; i++) assert.ok(p[i].t >= p[i - 1].t);
  assert.deepEqual(W.buildPlan('breath', 0, 'mid'), []);
});
