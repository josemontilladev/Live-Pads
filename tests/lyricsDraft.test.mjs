import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLyricsDraft } from '../src/js/live/lyricsDraftCore.js';

test('una línea por frase y estrofa nueva tras un silencio', () => {
  const t = buildLyricsDraft([
    { t0: 10, t1: 13, text: ' me compraste con tu sangre' },
    { t0: 13.4, t1: 16, text: 'me escogiste, me amaste.' },
    { t0: 22, t1: 25, text: 'en tu sombra me escondiste' },
  ]);
  assert.equal(t, 'Me compraste con tu sangre\nMe escogiste, me amaste\n\nEn tu sombra me escondiste\n');
});

test('con secciones marcadas: título de cada estrofa', () => {
  const t = buildLyricsDraft([
    { t0: 10, t1: 13, text: 'primera línea' },
    { t0: 13.2, t1: 15, text: 'segunda línea' },
    { t0: 30.1, t1: 33, text: 'el coro' },
  ], [{ t: 8, label: 'Verso 1' }, { t: 30, label: 'Coro' }]);
  assert.equal(t, '[Verso 1]\nPrimera línea\nSegunda línea\n\n[Coro]\nEl coro\n');
});

test('repeticiones idénticas pegadas se quitan; las de otro momento se quedan', () => {
  const t = buildLyricsDraft([
    { t0: 1, t1: 2, text: 'Aleluya' }, { t0: 2.2, t1: 3, text: 'aleluya' }, { t0: 3.1, t1: 4, text: 'Aleluya' },
    { t0: 20, t1: 21, text: 'Aleluya' },
  ]);
  assert.equal(t, 'Aleluya\n\nAleluya\n');
});

test('un bucle del reconocimiento dentro de la frase se deja una vez; «Santo, santo, santo» se queda', async () => {
  const { collapseLoops } = await import('../src/js/live/lyricsDraftCore.js');
  assert.equal(collapseLoops('Esto es mi amor, a la gloria es soy, a la gloria es soy, a la gloria es soy, a la gloria es soy'), 'Esto es mi amor, a la gloria es soy');
  assert.equal(collapseLoops('Santo, santo, santo es el Señor'), 'Santo, santo, santo es el Señor');
  assert.equal(collapseLoops('me compraste con tu sangre'), 'me compraste con tu sangre');
});
