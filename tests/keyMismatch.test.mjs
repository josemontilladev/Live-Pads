import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyMismatch, deltaText } from '../src/js/chords/keyMismatchCore.js';
import { parseLyricStructure } from '../src/js/ui/songStructure.js';

// Letra en C (Am F C G); acordes de la grabación (raíz, menor) — `shift` semitonos más arriba.
const LYR = parseLyricStructure('[Verso 1]\n[Am]Un camino [F]abriste [C]en el mar [G]\n[Am]Te doy [F]gracias [C]aleluya [G]\n\n[Coro]\n[C]Quién soy [G]yo [Am]que escuchas [F]mi clamor');
function det(shift) {
  const prog = [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']];
  const out = []; let t = 0;
  for (let i = 0; i < 24; i++) { const [r, q] = prog[i % 4]; out.push({ s: t, e: t + 2, r: (r + shift) % 12, q }); t += 2; }
  return out;
}

test('grabación en D y canción en C: hay que bajar 1 tono', () => {
  const m = keyMismatch(LYR, det(2), 0);
  assert.deepEqual(m && m.delta, -2);
  assert.equal(deltaText(m.delta), 'Bajar 1 tono');
});

test('si el audio ya se baja lo que toca, o la grabación está en C, no avisa', () => {
  assert.equal(keyMismatch(LYR, det(2), -2), null);
  assert.equal(keyMismatch(LYR, det(0), 0), null);
});

test('sin acordes en la letra o con pocos detectados, no avisa', () => {
  assert.equal(keyMismatch(parseLyricStructure('[Verso]\nsolo letra'), det(2), 0), null);
  assert.equal(keyMismatch(LYR, det(2).slice(0, 4), 0), null);
  assert.equal(deltaText(1), 'Subir medio tono');
  assert.equal(deltaText(-3), 'Bajar 3 semitonos');
});
