import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChordLinesForDisplay, formatLyrics } from '../src/js/ui/lyricsFormat.js';

// Acordes en su propia línea, alineados en el editor (ancho fijo): al mostrarlos
// se anclan a la sílaba de debajo para que no se desplacen con la fuente proporcional.
test('línea de acordes + letra → acordes anclados a su sílaba', () => {
  const out = mergeChordLinesForDisplay([
    'C                      G',
    'Puedo ver tu hermosura',
  ]);
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith('[C]Puedo ver tu hermosura'));
  // G estaba más allá del final de la letra: va en su columna, no montado sobre la última letra.
  assert.match(out[0], /hermosura +\[G\]/);
});

test('acordes en medio de la palabra caen en su letra exacta', () => {
  const out = mergeChordLinesForDisplay(['Em                D', 'y no hay nada que se pueda']);
  assert.equal(out[0], '[Em]y no hay nada que [D]se pueda');
});

test('no se une lo que no debe: progresión sin alineación, encabezados, líneas ya con [acordes]', () => {
  assert.deepEqual(mergeChordLinesForDisplay(['C G Em D', 'Letra']), ['C G Em D', 'Letra']);
  assert.deepEqual(mergeChordLinesForDisplay(['C      G', 'CORO']), ['C      G', 'CORO']);
  assert.deepEqual(mergeChordLinesForDisplay(['C      G', '[Am]ya con acorde']), ['C      G', '[Am]ya con acorde']);
});

test('formatLyrics pinta la pareja como una sola línea con acordes en línea', () => {
  const html = formatLyrics('C          G\nPuedo ver tu hermosura');
  assert.ok(!html.includes('chord-line'));
  assert.match(html, /lyric-line has-inline-chords/);
  // El acorde va unido a su palabra (si la línea se parte, baja con ella).
  assert.match(html, /<span class="chw"><span class="inline-chord">C<\/span>Puedo<\/span>/);
});

test('una línea que empieza y acaba en acorde no es un encabezado', () => {
  assert.ok(!formatLyrics('[C]Puedo ver tu hermosura[G]').includes('section-header-line'));
  assert.ok(formatLyrics('[CORO]').includes('section-header-line'));
});

test('acordes después de la última palabra: a 2 espacios de ella y con su separación', () => {
  const out = mergeChordLinesForDisplay(['                      D   Em   D/F#', 'vivo está'])[0];
  const plain = out.replace(/\u2007/g, '·');
  assert.equal(plain, 'vivo está··[D]····[Em]·····[D/F#]·');
});

test('una letra que acaba en «s» no pierde letras al alargarla', () => {
  // G va después del final de la letra: se alarga con relleno sin comerse la «s».
  const out = mergeChordLinesForDisplay(['C                              G', 'Los cielos ya están abiertos'])[0];
  assert.ok(out.includes('abiertos '), out);
});

test('progresión con «x4 Times» se pinta como acordes (mismo tamaño que los demás)', async () => {
  const { isRepeatedProgression } = await import('../src/js/ui/lyricsFormat.js');
  assert.ok(isRepeatedProgression('C - G - Em - D x4 Times'));
  assert.ok(isRepeatedProgression('Am F C G (x2) veces'));
  assert.ok(isRepeatedProgression('Am  F  C  G  4x'));
  assert.ok(!isRepeatedProgression('Te alabaré x4 veces'));
  assert.ok(!isRepeatedProgression('C x4'));               // un solo acorde: ya era línea de acordes o no aplica
  assert.match(formatLyrics('C - G - Em - D x4 Times'), /class="chord-line">C - G - Em - D x4 Times</);
});
