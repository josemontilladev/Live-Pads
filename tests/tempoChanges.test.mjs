import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempoSegments, beatGrid, nearestBeat, hasTempoChanges } from '../src/js/stems/tempoChangesCore.js';

test('tramos: el del proyecto y los cambios de los marcadores', () => {
  const segs = tempoSegments([{ atSec: 0, label: 'Intro' }, { atSec: 16, bpm: 90, meter: '6/8' }, { atSec: 30, meter: '4/4' }], 120, 4);
  assert.deepEqual(segs, [{ at: 0, bpm: 120, beats: 4 }, { at: 16, bpm: 90, beats: 6 }, { at: 30, bpm: 90, beats: 4 }]);
  assert.ok(hasTempoChanges(segs));
  assert.ok(!hasTempoChanges(tempoSegments([{ atSec: 4, label: 'Coro' }], 120)));
});

test('rejilla: pulsos, acentos y compases numerados de seguido', () => {
  // 120 BPM 4/4 hasta 4 s (2 compases), luego 60 BPM 3/4.
  const g = beatGrid(tempoSegments([{ atSec: 4, bpm: 60, meter: '3/4' }], 120, 4), 10);
  assert.deepEqual(g.times.slice(0, 10), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]);
  assert.deepEqual(g.bars.map((b) => [b.t, b.n, b.beats]), [[0, 1, 4], [2, 2, 4], [4, 3, 3], [7, 4, 3]]);
  assert.equal(g.accents[8], true);    // el cambio empieza compás
  assert.equal(g.accents[9], false);
});

test('un cambio a mitad de compás corta ese compás y empieza otro', () => {
  const g = beatGrid(tempoSegments([{ atSec: 3, bpm: 120, meter: '4/4' }], 120, 4), 5);
  assert.deepEqual(g.bars.map((b) => b.t), [0, 2, 3, 5].filter((t) => t < 5));
});

test('ajustar a la rejilla: el pulso más cercano', () => {
  const g = beatGrid(tempoSegments([{ atSec: 4, bpm: 60 }], 120, 4), 10);
  assert.equal(nearestBeat(g, 1.2), 1);
  assert.equal(nearestBeat(g, 4.6), 5);
  assert.equal(nearestBeat(g, 3.8), 4);
});
