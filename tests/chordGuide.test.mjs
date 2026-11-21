import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chordContext, enforceMinDuration } from '../src/js/chords/trackChords.js';
import { chordEngineFactory } from '../src/js/chords/chordEngine.js';

const require = createRequire(import.meta.url);
const { buildPrior, smoothPath } = require('../chordModel.js');
const CLASSES = 170;
// Clase del modelo: raíz × 14 + calidad (0 min, 1 maj).
const cls = (root, minor) => root * 14 + (minor ? 0 : 1);

test('tonalidad Cm: sus acordes no se castigan, los ajenos sí', () => {
  const p = buildPrior(CLASSES, { key: { k: 0, m: true } });
  for (const [r, m] of [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]]) {
    assert.equal(p[cls(r, m)], 0, `diatónico ${r}${m ? 'm' : ''}`);
  }
  assert.ok(p[cls(8, true)] < 0, 'Abm fuera de Cm');
  assert.ok(p[cls(0, false)] < 0, 'C mayor fuera de Cm');
  assert.equal(p[169], 0, '«sin acorde» no se castiga');
});

test('con acordes de la letra, lo que no está en ella casi no puede salir', () => {
  const p = buildPrior(CLASSES, { vocab: [{ r: 0, m: false }, { r: 7, m: false }, { r: 9, m: true }, { r: 5, m: false }] });
  assert.equal(p[cls(0, false)], 0);
  assert.equal(p[cls(9, true)], 0);
  assert.ok(p[cls(2, true)] <= -4, 'Dm no está en la letra');
  assert.ok(p[cls(3, false)] <= -4, 'Eb no está en la letra');
});

test('el Viterbi con preferencia elige el acorde de la tonalidad ante uno ajeno casi igual', () => {
  // 20 cuadros donde «Abm» supera por poco a «Ab» (un caso típico de voz encima).
  const frames = 20, logits = new Float32Array(frames * CLASSES).fill(-10);
  for (let f = 0; f < frames; f++) { logits[f * CLASSES + cls(8, true)] = 2.0; logits[f * CLASSES + cls(8, false)] = 1.6; }
  const sin = smoothPath(logits, frames, CLASSES, 20, null);
  const con = smoothPath(logits, frames, CLASSES, 20, buildPrior(CLASSES, { key: { k: 0, m: true } }));
  assert.equal(sin[10], cls(8, true), 'sin guía sale Abm');
  assert.equal(con[10], cls(8, false), 'en Cm sale Ab');
});

test('duración mínima: los cambios sueltos de menos de 2 pulsos se funden', () => {
  // 128 BPM → 2 pulsos ≈ 0,94 s
  const seg = [
    { s: 0, e: 4, r: 0, q: 1 }, { s: 4, e: 4.5, r: 10, q: 0 }, { s: 4.5, e: 8, r: 0, q: 1 }, { s: 8, e: 12, r: 8, q: 0 },
  ];
  const out = enforceMinDuration(seg, 2 * 60 / 128);
  assert.deepEqual(out.map((x) => x.r), [0, 8], 'el Bb de medio segundo desaparece y Cm queda en un solo tramo');
  assert.equal(out[0].e, 8);
});

test('contexto: con acordes en la letra se usan como vocabulario (en el tono del audio)', () => {
  const song = { key: 'C', bpm: '72', lyrics: '[Verso]\n[C]Puedo ver tu [G]hermosura\n[Am]nada se [F]compara' };
  // Audio detectado un tono más alto (D): la letra está en C → vocabulario en D E… (+2).
  const base = { k: 2, m: false, seg: [
    { s: 0, e: 2, r: 2, q: 0 }, { s: 2, e: 4, r: 9, q: 0 }, { s: 4, e: 6, r: 11, q: 1 }, { s: 6, e: 8, r: 7, q: 0 },
  ] };
  const ctx = chordContext(song, 'original', base);
  assert.ok(ctx.vocab, 'hay vocabulario');
  const roots = ctx.vocab.map((v) => v.r + (v.m ? 'm' : '')).sort();
  assert.deepEqual(roots, ['11m', '2', '7', '9'].sort(), 'C G Am F de la letra → D A Bm G en el audio');
  assert.equal(ctx.bpm, 72);
});

test('contexto: sin acordes en la letra, la secuencia usa el tono de la canción', () => {
  const ctx = chordContext({ key: 'Cm', bpm: '128', lyrics: 'Solo letra\nsin acordes' }, 'sequence', { k: 3, m: false, seg: [] });
  assert.deepEqual(ctx.key, { k: 0, m: true });
  assert.equal(ctx.vocab, undefined);
});

test('notación según el tono: Bb y Ab en Cm; G#m y D# en E', () => {
  const E = chordEngineFactory();
  assert.equal(E.chordName({ r: 10, q: 0, b: -1 }, { key: { k: 0, m: true } }), 'Bb');
  assert.equal(E.chordName({ r: 8, q: 0, b: -1 }, { key: { k: 0, m: true } }), 'Ab');
  assert.equal(E.chordName({ r: 8, q: 1, b: -1 }, { key: { k: 4, m: false } }), 'G#m');
  assert.equal(E.chordName({ r: 3, q: 0, b: -1 }, { key: { k: 4, m: false } }), 'D#');
});
