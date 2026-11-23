import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackQuery, matchPack, packQueryActive } from '../src/js/utils/packQuery.js';

const packs = [
  { id: 'a', title: 'Baila', artist: 'Generación 12', genre: 'pop worship', tier: 'pro' },
  { id: 'b', title: 'Profetizar', artist: 'Elevation Worship', genre: 'worship', mood: 'íntimo', tier: 'pro' },
  { id: 'c', title: 'Way Maker', artist: '', genre: 'balada', tier: 'free' },
];
const loops = {
  a: [{ title: 'Bajo Coro', bpm: 130, musical_key: 'E', tier: 'free' }, { title: 'Pad', bpm: 130, musical_key: 'E', tier: 'pro' }],
  b: [{ title: 'Batería', bpm: 72, musical_key: 'Bm', tier: 'pro' }],
  c: [{ title: 'Piano', bpm: 68, musical_key: 'E', tier: 'free' }],
};
const find = (s) => {
  const q = parsePackQuery(s);
  return packs.map((p) => [p, matchPack(p, loops[p.id], q)]).filter(([, m]) => m).sort((x, y) => y[1].score - x[1].score).map(([p]) => p.title);
};

test('texto libre en nombre y artista, sin tildes', () => {
  assert.deepEqual(find('baila'), ['Baila']);
  assert.deepEqual(find('elevation'), ['Profetizar']);
  assert.deepEqual(find('generacion'), ['Baila']);
});

test('el nombre gana al artista y a los tracks', () => {
  assert.deepEqual(find('worship'), ['Profetizar', 'Baila']);   // artista antes que género
  assert.deepEqual(find('piano'), ['Way Maker']);                // por un track
});

test('filtros: artista, género, tono, modo, bpm y marca', () => {
  assert.deepEqual(find('artista:elevation'), ['Profetizar']);
  assert.deepEqual(find('genero:balada'), ['Way Maker']);
  assert.deepEqual(find('tono:E'), ['Baila', 'Way Maker']);
  assert.deepEqual(find('modo:menor'), ['Profetizar']);
  assert.deepEqual(find('bpm:120-140'), ['Baila']);
  assert.deepEqual(find('es:gratis'), ['Baila', 'Way Maker']);
  assert.deepEqual(find('es:pro'), ['Baila', 'Profetizar']);
});

test('«pro» como palabra busca texto (Profetizar), no la marca', () => {
  assert.deepEqual(find('pro'), ['Profetizar']);
});

test('consulta vacía', () => {
  assert.equal(packQueryActive(parsePackQuery('')), false);
  assert.equal(packQueryActive(parsePackQuery('es:gratis')), true);
  assert.equal(find('').length, 3);
});
