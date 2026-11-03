import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, parseLyricStructure, keyOffset, labelSegments, songChordSegments, mapMarkersToLyrics } from '../src/js/ui/songStructure.js';

const CELEBRAMOS = `VERSO 1

[A]
Damos gloria al Padre
[D]
Cantamos gloria al Hijo
F#m A/C# D
Gloria al Santo Espíritu de Dios

CORO 1

[A]
Cantamos Santo
[E/G#]
Dios de Israel
F#m
El Dios que siempre fue

INTERLUDIO
[A] [E/G#]
`;

const GRITA = `[INTRO] [Dm] [C] [Dm] [C] [Gm] [F]

Primera Parte

[Dm] [C]
Me encuentro en frente a Jericó

Pre-Estribillo

[Bb]
Si Él lo prometió, lo creere

Estribillo

[Dm]
Grita y las murallas caerán
Todas caerán`;

test('parseChord: calidades y bajo', () => {
  assert.deepEqual(parseChord('F#m'), { r: 6, q: 1, b: -1, n: 'F#m' });
  assert.deepEqual(parseChord('[A/C#]'), { r: 9, q: 0, b: 1, n: 'A/C#' });
  assert.equal(parseChord('Bbmaj7').q, 3);
  assert.equal(parseChord('Em7').q, 4);
  assert.equal(parseChord('Dsus4').q, 5);
  assert.equal(parseChord('Hola'), null);
});

test('letra → secciones con sus acordes (formatos de verdad)', () => {
  const c = parseLyricStructure(CELEBRAMOS);
  assert.deepEqual(c.map((s) => s.label), ['Verso 1', 'Coro 1', 'Interludio']);
  assert.deepEqual(c[0].chords.map((x) => x.n), ['A', 'D', 'F#m', 'A/C#', 'D']);
  assert.deepEqual(c[2].chords.map((x) => x.n), ['A', 'E/G#']);
  const g = parseLyricStructure(GRITA);
  assert.deepEqual(g.map((s) => s.label), ['Intro', 'Verso 1', 'Pre Coro', 'Coro']);
  assert.equal(g[0].chords.length, 6);
});

// Audio un tono por debajo de la letra (G en vez de A): k = 2.
const det = [
  { s: 0, e: 4, r: 7, q: 0, b: -1 }, { s: 4, e: 8, r: 0, q: 0, b: -1 }, { s: 8, e: 10, r: 4, q: 1, b: -1 }, { s: 10, e: 12, r: 7, q: 0, b: 11 }, { s: 12, e: 16, r: 0, q: 0, b: -1 },
  { s: 16, e: 20, r: 7, q: 0, b: -1 }, { s: 20, e: 24, r: 2, q: 0, b: 6 }, { s: 24, e: 28, r: 4, q: 1, b: -1 },
];

test('tono: detecta que la letra está 2 semitonos por encima', () => {
  assert.equal(keyOffset(parseLyricStructure(CELEBRAMOS), det).k, 2);
});

test('acordes de la letra colocados en los cambios que se oyen', () => {
  const L = parseLyricStructure(CELEBRAMOS);
  const segs = songChordSegments([{ t: 0, label: 'Verso 1' }, { t: 16, label: 'Coro' }], L, det, 2, 28);
  assert.deepEqual(segs.map((x) => [x.n, x.s]), [['A', 0], ['D', 4], ['F#m', 8], ['A/C#', 10], ['D', 12], ['A', 16], ['E/G#', 20], ['F#m', 24]]);
  assert.ok(segs.every((x) => !x.guess));
});

test('sin acordes en la letra: se quedan los detectados (suposición)', () => {
  const segs = songChordSegments([{ t: 0, label: 'Puente' }], parseLyricStructure(CELEBRAMOS), det, 2, 28);
  assert.ok(segs.length && segs.every((x) => x.guess));
});

test('tramos detectados → nombres de la letra por sus acordes', () => {
  const L = parseLyricStructure(CELEBRAMOS);
  const audio = [{ s: 0, e: 16, cueId: 'verso' }, { s: 16, e: 28, cueId: 'coro' }];
  assert.deepEqual(labelSegments(audio, L, det, 2).map((x) => x.label), ['Verso 1', 'Coro 1']);
});

test('marcadores → secciones de la letra', () => {
  const L = parseLyricStructure(CELEBRAMOS);
  assert.deepEqual(mapMarkersToLyrics([{ label: 'Intro' }, { label: 'Verso 1' }, { label: 'Coro' }, { label: 'Coro' }], L), [-1, 0, 1, 1]);
});
