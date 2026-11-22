import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matchSong, toggleToken } from '../src/js/utils/songQuery.js';

const songs = [
  { title: 'Alabaré', artist: 'Tradicional', key: 'G', bpm: '120', tags: ['alegre'], lyrics: '[G]Alabaré a mi [D]Señor', audio: { sequence: 's.mp3' } },
  { title: 'Santo por Siempre', artist: 'Chris Tomlin', key: 'C', bpm: '72', tags: [], lyrics: 'Claman ángeles santo', audio: { original: 'o.mp3' } },
  { title: 'En Cristo Puedo', artist: 'Gateway Worship', key: 'Am', bpm: '118', tags: ['navidad'], lyrics: '', audio: {} },
];
const find = (q) => songs.filter((s) => matchSong(s, parseQuery(q))).map((s) => s.title);

test('texto libre: sin tildes, todas las palabras, en cualquier campo', () => {
  assert.deepEqual(find('alabare'), ['Alabaré']);
  assert.deepEqual(find('siempre santo'), ['Santo por Siempre']);
  assert.deepEqual(find('tomlin'), ['Santo por Siempre']);
});

test('tolera una falta de ortografía en el título', () => {
  assert.deepEqual(find('alabre'), ['Alabaré']);
  assert.deepEqual(find('cristp'), ['En Cristo Puedo']);   // una letra cambiada
  assert.deepEqual(find('crsitpo'), []);                    // dos faltas: no se adivina
});

test('frase de la letra: se dice dónde y se muestra la línea', () => {
  const r = matchSong(songs[1], parseQuery('angeles'));
  assert.equal(r.where, 'letra');
  assert.equal(r.snippet, 'Claman ángeles santo');
});

test('filtros: tono, modo, bpm, tag, artista', () => {
  assert.deepEqual(find('tono:G'), ['Alabaré']);
  assert.deepEqual(find('modo:menor'), ['En Cristo Puedo']);
  assert.deepEqual(find('bpm:110-125'), ['Alabaré', 'En Cristo Puedo']);
  assert.deepEqual(find('bpm:>100'), ['Alabaré', 'En Cristo Puedo']);
  assert.deepEqual(find('bpm:<80'), ['Santo por Siempre']);
  assert.deepEqual(find('bpm:119'), ['Alabaré', 'En Cristo Puedo']);   // ±2
  assert.deepEqual(find('tag:navidad'), ['En Cristo Puedo']);
  assert.deepEqual(find('artista:gateway'), ['En Cristo Puedo']);
});

test('tiene / sin: secuencia, original, letra, acordes', () => {
  assert.deepEqual(find('tiene:secuencia'), ['Alabaré']);
  assert.deepEqual(find('tiene:original'), ['Santo por Siempre']);
  assert.deepEqual(find('tiene:acordes'), ['Alabaré']);
  assert.deepEqual(find('sin:letra'), ['En Cristo Puedo']);
});

test('combinados: texto + filtros', () => {
  assert.deepEqual(find('santo tiene:original bpm:<100'), ['Santo por Siempre']);
  assert.deepEqual(find('santo tiene:secuencia'), []);
});

test('píldoras: añadir y quitar filtros del texto', () => {
  assert.equal(toggleToken('santo', 'tiene:secuencia'), 'santo tiene:secuencia ');
  assert.equal(toggleToken('santo tiene:secuencia ', 'tiene:secuencia'), 'santo ');
  assert.equal(toggleToken('modo:mayor', 'modo:menor'), 'modo:menor ');
  assert.equal(toggleToken('tiene:letra', 'sin:letra'), 'sin:letra ');
});
