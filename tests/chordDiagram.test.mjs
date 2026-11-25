import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChordName, guitarShape, chordNotes } from '../src/js/ui/chordDiagram.js';

const db = JSON.parse(readFileSync(new URL('../src/js/data/chordShapes.json', import.meta.url), 'utf8'));

test('nombres de acordes', () => {
  assert.deepEqual(parseChordName('F#m7/E'), { root: 'F#', suffix: 'm7', bass: 'E' });
  assert.equal(parseChordName('Coro'), null);
});

test('posiciones de guitarra (incluye bajos y sostenidos)', () => {
  assert.deepEqual(guitarShape('C', db).f, [-1, 3, 2, 0, 1, 0]);
  assert.ok(guitarShape('F#m', db));
  assert.ok(guitarShape('Bbmaj7', db));
  assert.ok(guitarShape('G/B', db));
  assert.ok(guitarShape('D2', db), 'D2 = sus2');
  assert.ok(guitarShape('Am7', db));
});

test('notas para el piano', () => {
  assert.deepEqual(chordNotes('C').notes, [0, 4, 7]);
  assert.deepEqual(chordNotes('Am7').notes, [9, 0, 4, 7]);
  assert.equal(chordNotes('G/B').bass, 11);
  assert.deepEqual(chordNotes('Esus4').notes, [4, 9, 11]);
});
