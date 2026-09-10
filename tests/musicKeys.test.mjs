import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, transposeKey, keyDelta, keyChoices, isKnownKey } from '../src/js/utils/musicKeys.js';

test('parseKey entiende cifrado americano, latino y alteraciones', () => {
  assert.deepEqual(parseKey('G'), { semitone: 7, minor: false, flats: false, suffix: '' });
  assert.equal(parseKey('Bb').semitone, 10);
  assert.equal(parseKey('Bb').flats, true);
  assert.equal(parseKey('F#m').minor, true);
  assert.equal(parseKey('Solm').semitone, 7);
  assert.equal(parseKey('Solm').minor, true);
  assert.equal(parseKey('Re').semitone, 2);
  assert.equal(parseKey('Mi bemol').semitone, 3);
  assert.equal(parseKey('Cmaj7').minor, false);
});

test('parseKey rechaza texto libre', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('   '), null);
  assert.equal(parseKey('H'), null);
  assert.equal(isKnownKey('xyz'), false);
});

test('transposeKey conserva modo y grafía', () => {
  assert.equal(transposeKey('Em', 3), 'Gm');
  assert.equal(transposeKey('Bb', 2), 'C');
  assert.equal(transposeKey('Ab', -1), 'G');
  assert.equal(transposeKey('C#', 1), 'D');
  assert.equal(transposeKey('???', 2), '???');
});

test('keyDelta elige el salto más corto', () => {
  assert.equal(keyDelta('C', 'B'), -1);
  assert.equal(keyDelta('C', 'F#'), -6);   // el tritono cae en el extremo negativo del rango [-6, +5]
  assert.equal(keyDelta('G', 'C'), 5);
  assert.equal(keyDelta('G', 'zz'), null);
});

test('keyChoices da 12 opciones ordenadas con el original marcado', () => {
  const c = keyChoices('Em');
  assert.equal(c.length, 12);
  assert.equal(c.find(x => x.semitones === 0).label, 'Em (original)');
  assert.ok(c.every(x => x.key.endsWith('m')));
  assert.deepEqual(keyChoices('nope'), []);
});
