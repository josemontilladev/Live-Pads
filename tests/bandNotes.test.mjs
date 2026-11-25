import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNotes, mergeNotes, secMatches, notesForSection, generalNotes, sectionsOf, noteLine } from '../src/js/live/bandNotesCore.js';
import { mergeSong, snapshot } from '../src/js/cloud/songMerge.js';

const n = (id, o = {}) => ({ id, sec: 'Coro', who: 'all', text: 'Nota ' + id, by: 'Ana', at: 100, ...o });

test('limpia: sin texto fuera, «para» desconocido = todos, recorta y ordena por fecha', () => {
  const out = cleanNotes([n('b', { at: 5 }), { id: 'x', text: '   ' }, n('a', { at: 1, who: 'piano' }), n('c', { text: 'x'.repeat(300) })]);
  assert.deepEqual(out.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(out[0].who, 'all');
  assert.equal(out[2].text.length, 140);
});

test('«Coro» vale para todos los coros; «Coro 2» solo para el segundo', () => {
  assert.equal(secMatches('Coro', 'CORO 2'), true);
  assert.equal(secMatches('Coro', '[Coro]'), true);
  assert.equal(secMatches('Coro 2', 'Coro'), false);
  assert.equal(secMatches('Coro 2', 'Coro 2'), true);
  assert.equal(secMatches('Verso 1', 'Verso 2'), false);
  assert.equal(secMatches('Coro', 'Puente'), false);
  assert.equal(secMatches('', 'Coro'), false);
  // Sinónimos de la app: «Chorus» y «Coro» son la misma sección.
  assert.equal(secMatches('Coro', 'Chorus'), true);
});

test('notas de una sección y generales', () => {
  const list = [n('a'), n('b', { sec: 'Puente' }), n('c', { sec: '' })];
  assert.deepEqual(notesForSection(list, 'Coro 1').map((x) => x.id), ['a']);
  assert.deepEqual(generalNotes(list).map((x) => x.id), ['c']);
  assert.equal(noteLine(n('d', { who: 'bass', text: 'aquí para' })), 'Bajo: aquí para');
  assert.equal(noteLine(n('e', { who: 'all', text: 'suave' })), 'suave');
});

test('fusión: se suman las nuevas de los dos lados', () => {
  const base = [n('a')];
  const r = mergeNotes(base, [n('a'), n('m', { at: 200 })], [n('a'), n('t', { at: 150 })]);
  assert.deepEqual(r.map((x) => x.id), ['a', 't', 'm']);
});

test('fusión: un borrado de un lado se respeta; si el otro la editó después, se queda', () => {
  const base = [n('a'), n('b')];
  const r1 = mergeNotes(base, [n('b')], [n('a'), n('b')]);
  assert.deepEqual(r1.map((x) => x.id), ['b']);
  const r2 = mergeNotes(base, [n('b')], [n('a', { at: 300, text: 'editada' }), n('b')]);
  assert.deepEqual(r2.map((x) => x.id), ['b', 'a']);
});

test('fusión: ambos editaron la misma, gana la más reciente', () => {
  const r = mergeNotes([n('a')], [n('a', { at: 200, text: 'mía' })], [n('a', { at: 300, text: 'suya' })]);
  assert.equal(r[0].text, 'suya');
});

test('mergeSong: las notas nunca son conflicto y una fila sin notas no borra las locales', () => {
  const song = (o) => ({ title: 'X', lyrics: '', key: 'C', markers: [], ...o });
  const base = snapshot(song({ bandNotes: [n('a')] }));
  const r = mergeSong(base, song({ bandNotes: [n('a'), n('m', { at: 9 })] }), song({ bandNotes: [n('a'), n('t', { at: 8 })] }));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.fields.bandNotes.map((x) => x.id), ['t', 'm', 'a']);   // por fecha
  const r2 = mergeSong(base, song({ bandNotes: [n('a'), n('m')] }), song({ bandNotes: undefined }));
  assert.deepEqual(r2.fields.bandNotes.map((x) => x.id), ['a', 'm']);
});

test('secciones de la canción: de la letra y de las marcas, sin repetir', () => {
  const lyrics = '[Verso 1]\nHola\n\nCORO\nAleluya\n[C] [G]\nVerso 2\nOtra\nCoro\nAleluya';
  const s = sectionsOf(lyrics, [{ t: 1, label: 'Intro' }, { t: 9, label: 'Coro' }]);
  assert.deepEqual(s, ['Verso 1', 'CORO', 'Verso 2', 'Intro']);
});
