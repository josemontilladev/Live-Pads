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

test('diapositiva a diapositiva: cada línea sincronizada pone la diapositiva que la contiene', async () => {
  const { planSlides } = await import('../src/js/live/projectionCore.js');
  const slides = [
    { text: 'Un camino abriste en el mar\nTe doy gracias, aleluya' },
    { text: 'Aunque no lo merecía, lo hiciste\nAunque no lo merecía, lo diste' },
    { text: '¿Quién soy yo que escuchas mi clamor?\nAgradecido estoy' },
    { text: 'Santo santo, no hay nadie más\nToda gloria te voy a dar' },
    { text: '¿Quién soy yo que escuchas mi clamor?\nAgradecido estoy' },   // el coro, repetido en el orden del programa
  ];
  const ev = [
    { t: 10, text: 'Un camino abriste en el mar' }, { t: 14, text: 'Te doy gracias, aleluya' },
    { t: 18, text: 'Aunque no lo merecia, lo hiciste.' }, { t: 22, text: 'Aunque no lo merecia, lo diste.' },
    { t: 26, text: '¿Quién soy yo que escuchas mi clamor?' }, { t: 30, text: 'Agradecido estoy, agradecido estoy.' },
    { t: 40, text: 'Santo santo, no hay nadie mas' },
    { t: 50, text: '¿Quién soy yo que escuchas mi clamor?' },
    { t: 60, text: '¿Quién soy yo que escuchas mi clamor?' },
  ];
  // A los 60 s el coro vuelve a empezar y ya está en pantalla: no se reenvía.
  assert.deepEqual(planSlides(slides, ev), [{ t: 10, slide: 0 }, { t: 18, slide: 1 }, { t: 26, slide: 2 }, { t: 40, slide: 3 }, { t: 50, slide: 4 }]);
  // Coro en dos diapositivas que se repite: vuelve a la primera.
  const two = [{ text: 'Primera linea del coro / Segunda linea del coro' }, { text: 'Tercera linea del coro / Cuarta linea del coro' }];
  const rep = ['Primera linea del coro', 'Segunda linea del coro', 'Tercera linea del coro', 'Cuarta linea del coro'];
  const ev2 = [...rep, ...rep].map((text, i) => ({ t: i * 3, text }));
  assert.deepEqual(planSlides(two, ev2), [{ t: 0, slide: 0 }, { t: 6, slide: 1 }, { t: 12, slide: 0 }, { t: 18, slide: 1 }]);
});
