import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLoop, loopSemitones, pickTempoFactor, barsToSamples, needsProcessing, isCompatible } from '../src/js/stems/loopFit.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('loopSemitones toma el salto más corto y respeta las relativas', () => {
  assert.equal(loopSemitones('C', 'D'), 2);
  assert.equal(loopSemitones('C', 'B'), -1);
  assert.equal(loopSemitones('G', 'C'), 5);
  assert.equal(loopSemitones('Em', 'G'), 0);   // relativa menor: mismas notas
  assert.equal(loopSemitones('Em', 'A'), 2);
  assert.equal(loopSemitones('Bb', 'A#'), 0);  // enarmónicos
  assert.equal(loopSemitones('Solm', 'Am'), 2); // cifrado latino
});

test('loopSemitones no transpone loops sin tono ni proyectos sin tono', () => {
  assert.equal(loopSemitones(null, 'G'), 0);
  assert.equal(loopSemitones('G', ''), 0);
  assert.equal(loopSemitones('texto raro', 'G'), 0);
});

test('pickTempoFactor elige medio o doble tiempo cuando estira menos', () => {
  assert.equal(pickTempoFactor(120, 124), 1);
  assert.equal(pickTempoFactor(140, 72), 0.5);
  assert.equal(pickTempoFactor(70, 138), 2);
});

test('fitLoop en el mismo tempo y tono no procesa nada', () => {
  const f = fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 72, key: 'G' });
  near(f.ratio, 1);
  assert.equal(f.semitones, 0);
  near(f.stPitch, 0);
  assert.equal(f.quality, 'ok');
  assert.equal(needsProcessing(f), false);
});

test('fitLoop compensa en el pitch el cambio de velocidad', () => {
  const f = fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 76, key: 'A' });
  near(f.ratio, 76 / 72);
  assert.equal(f.semitones, 2);
  near(f.stPitch, 2 - 12 * Math.log2(76 / 72));
  assert.equal(needsProcessing(f), true);
});

test('fitLoop reinterpreta los compases en medio tiempo', () => {
  const f = fitLoop({ loopBpm: 140, loopKey: null, bars: 4 }, { bpm: 70, key: 'D' });
  assert.equal(f.factor, 0.5);
  near(f.ratio, 1);
  assert.equal(f.bars, 2);
  assert.equal(f.semitones, 0);
});

test('fitLoop avisa de estiramientos fuertes y compases distintos', () => {
  assert.equal(fitLoop({ loopBpm: 100, bars: 4 }, { bpm: 115 }).quality, 'stretched');
  assert.equal(fitLoop({ loopBpm: 100, bars: 4 }, { bpm: 130 }).quality, 'extreme');
  const m = fitLoop({ loopBpm: 70, bars: 4, beatsPerBar: 6 }, { bpm: 70, beatsPerBar: 4 });
  assert.deepEqual(m.warnings, ['meter']);
});

test('fitLoop usa varispeed solo en loops sin tono y con poco cambio de tempo', () => {
  const drums = fitLoop({ loopBpm: 72, loopKey: null, bars: 4 }, { bpm: 76, key: 'A' });
  assert.equal(drums.varispeed, true);
  assert.equal(drums.stPitch, 0);
  assert.equal(needsProcessing(drums), true);
  // Mucho cambio de tempo → vuelve a corregir la afinación.
  assert.equal(fitLoop({ loopBpm: 72, bars: 4 }, { bpm: 82 }).varispeed, false);
  // Con tono nunca se hace varispeed (desafinaría la canción).
  const pad = fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 74, key: 'G' });
  assert.equal(pad.varispeed, false);
  near(pad.stPitch, -12 * Math.log2(74 / 72));
});

test('isCompatible: poco estiramiento, poca transposición y mismo compás', () => {
  assert.equal(isCompatible(fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 76, key: 'A' })), true);   // 5.5 %, +2
  assert.equal(isCompatible(fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 82, key: 'G' })), false);  // 14 %
  assert.equal(isCompatible(fitLoop({ loopBpm: 72, loopKey: 'G', bars: 4 }, { bpm: 72, key: 'C' })), false);  // +5 st
  assert.equal(isCompatible(fitLoop({ loopBpm: 140, bars: 4 }, { bpm: 72 })), true);                          // medio tiempo
  assert.equal(isCompatible(fitLoop({ loopBpm: 72, bars: 4, beatsPerBar: 3 }, { bpm: 72, beatsPerBar: 4 })), false);
});

test('barsToSamples cuadra la rejilla al sample', () => {
  assert.equal(barsToSamples(4, 4, 120, 48000), 384000);   // 8 s
  assert.equal(barsToSamples(1, 4, 72, 44100), 147000);
});
