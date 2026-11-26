import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionKind, groupName, openlpTag, openlpSlideIndex, bestTitle } from '../src/js/live/projectionCore.js';

test('secciones de LivePads (español o inglés) → tipo y número', () => {
  assert.deepEqual(sectionKind('Coro 2'), { kind: 'chorus', num: 2 });
  assert.deepEqual(sectionKind('Verso uno'), { kind: 'verse', num: 1 });
  assert.deepEqual(sectionKind('Pre Coro'), { kind: 'pre_chorus', num: 1 });
  assert.deepEqual(sectionKind('Puente'), { kind: 'bridge', num: 1 });
  assert.deepEqual(sectionKind('Final'), { kind: 'outro', num: 1 });
  assert.equal(sectionKind('Batería entra').kind, null);
});

test('nombres de grupo para FreeShow y ProPresenter', () => {
  assert.equal(groupName('Verso 1'), 'Verse 1');
  assert.equal(groupName('Coro'), 'Chorus');
  assert.equal(groupName('Coro 2'), 'Chorus 2');
  assert.equal(groupName('Pre Coro'), 'Pre-Chorus');
  assert.equal(groupName('Puente'), 'Bridge');
});

test('OpenLP: etiqueta de estrofa y diapositiva', () => {
  assert.equal(openlpTag('Verso 2'), 'V2');
  assert.equal(openlpTag('Coro'), 'C1');
  assert.equal(openlpTag('Puente'), 'B1');
  const slides = [{ tag: 'V1' }, { tag: 'V1' }, { tag: 'C1' }, { tag: 'V2' }, { tag: 'B1' }];
  assert.equal(openlpSlideIndex(slides, 'Coro 1'), 2);
  assert.equal(openlpSlideIndex(slides, 'Verso 2'), 3);
  assert.equal(openlpSlideIndex(slides, 'Verso 3'), 0);   // no hay V3: la primera estrofa
  assert.equal(openlpSlideIndex(slides, 'Solo de guitarra'), -1);
});

test('buscar la canción por título (tildes, mayúsculas, títulos parecidos)', () => {
  const items = [{ name: 'Grande es tu fidelidad' }, { name: 'Way Maker (Español)' }, { name: 'Abba Padre' }];
  assert.equal(bestTitle('Way Maker', items).name, 'Way Maker (Español)');
  assert.equal(bestTitle('ABBA PADRE', items).name, 'Abba Padre');
  assert.equal(bestTitle('Grande Es Tu Fidelidad', items).name, 'Grande es tu fidelidad');
  assert.equal(bestTitle('Océanos', items), null);
});
