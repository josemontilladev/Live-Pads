import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricStructure, alignLyricChords } from '../src/js/ui/songStructure.js';
import { detectSectionHeader } from '../src/js/ui/lyricsFormat.js';

const names = (sec) => sec.chords.map((c) => c.n).join(' ');

test('cifrados mixtos: acordes sin corchetes junto a otros entre corchetes, y marcas de repetición', () => {
  const lyr = parseLyricStructure([
    'VERSO 1:', 'Bb F', 'La muerte no pudo vencer', '[Dm7] C Bb', 'El que con amor salvo',
    'INTERLUDIO-(RAP):', '////Gm - Dm - F - Am////',
    'FINAL:', '//Bb - F - Dm7 - C//',
    'CORO', '[G]Santo es el [D/F#]Señor',
  ].join('\n'));
  assert.deepEqual(lyr.map((s) => s.label), ['Verso 1', 'Interludio', 'Final', 'Coro']);
  assert.equal(names(lyr[0]), 'Bb F Dm7 C Bb');
  assert.equal(names(lyr[1]), 'Gm Dm F Am');
  assert.equal(names(lyr[2]), 'Bb F Dm7 C');
  assert.equal(names(lyr[3]), 'G D/F#');            // letra con acordes entre corchetes: igual que antes
  // Las posiciones siguen apuntando al nombre exacto (para corregirlo desde la franja).
  const c = lyr[1].chords[0];
  assert.equal('////Gm - Dm - F - Am////'.slice(c.pos.start, c.pos.end), 'Gm');
});

test('encabezados con añadido entre paréntesis', () => {
  assert.deepEqual(detectSectionHeader('INTERLUDIO-(RAP):'), { canon: 'INTERLUDIO', num: '' });
  assert.deepEqual(detectSectionHeader('CORO (x2)'), { canon: 'CORO', num: '' });
  assert.deepEqual(detectSectionHeader('Verso 2'), { canon: 'VERSO', num: '2' });
  assert.equal(detectSectionHeader('Am F C G'), null);
});

test('alineación sin secciones: acordes de la letra donde suenan, con el coro repetido', () => {
  const lyr = parseLyricStructure(['VERSO', '[C] [G] [Am] [F]', 'CORO', '[F] [G] [C]'].join('\n'));
  // Audio en Re (2 semitonos arriba): verso, coro, coro otra vez. k = −2 (letra → audio).
  const D = 2, E = 4, G = 7, A = 9, Bm = 11;
  const det = [];
  let t = 0;
  const add = (r, q, d = 4) => { det.push({ s: t, e: t + d, r, q, b: -1 }); t += d; };
  add(D, 0); add(A, 0); add(Bm, 1); add(G, 0);   // verso
  add(G, 0); add(A, 0); add(D, 0, 8);            // coro
  add(G, 0); add(A, 0); add(D, 0, 8);            // coro de nuevo (la letra lo escribe una vez)
  const out = alignLyricChords(lyr, det, -2, t);
  assert.ok(out.agree > 0.95, `coincidencia ${out.agree}`);
  // El F final del verso y el F que abre el coro suenan seguidos: es un solo tramo.
  assert.equal(out.map((x) => x.n).join(' '), 'C G Am F G C F G C');
  // (ese F compartido puede contarse del verso o del coro: es el mismo acorde)
  assert.deepEqual(out.slice(0, 3).map((x) => x.sec), ['Verso', 'Verso', 'Verso']);
  assert.deepEqual(out.slice(4).map((x) => x.sec), ['Coro', 'Coro', 'Coro', 'Coro', 'Coro']);
  assert.equal(out[2].r, Bm); assert.equal(out[2].q, 1);   // en el tono del audio
  assert.equal(out[6].s, 32);
});

test('alineación: si lo que suena no tiene que ver con la letra, la confianza es baja', () => {
  const lyr = parseLyricStructure(['VERSO', '[C] [G] [Am] [F]'].join('\n'));
  const det = [];
  for (let i = 0; i < 12; i++) det.push({ s: i * 3, e: i * 3 + 3, r: [1, 6, 8, 3][i % 4], q: 0, b: -1 });  // C# F# G# D#
  const out = alignLyricChords(lyr, det, 0, 36);
  assert.ok(out.agree < 0.6, `coincidencia ${out.agree}`);
});
