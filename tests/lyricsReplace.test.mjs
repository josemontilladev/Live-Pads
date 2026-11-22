import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceLyricsKeepChords } from '../src/js/utils/lyricsReplace.js';

const N = '\n';

test('misma estructura: cada acorde va a su palabra equivalente', () => {
  const old = ['Coro 2:', '           F   (Am) G            C/E    Am', 'Oyenos cantar Santo, Rey de majestad Santo',
    '               Dm     G             C', 'Por siempre serás Santo, Santo por siempre'].join(N);
  const neu = ['Coro 2', 'Tu gente cantará santo', 'Rey de reyes eres santo', 'Tú siempre serás', 'Santo por siempre'].join(N);
  const { text } = replaceLyricsKeepChords(old, neu);
  assert.equal(text, ['Coro 2', 'Tu gente [F]cantará [Am]santo', '[G]Rey de reyes [C/E]eres [Am]santo', 'Tú siempre [Dm]serás', '[G]Santo por [C]siempre'].join(N));
});

test('palabras que no cambian conservan su acorde', () => {
  const old = ['Coro', '[F]Tu nombre es más [Am]alto', '[G]Tu nombre es más [C]grande'].join(N);
  const neu = ['Coro', 'Tu nombre es más alto', 'Tu nombre es más fuerte'].join(N);
  const { text } = replaceLyricsKeepChords(old, neu);
  assert.equal(text, ['Coro', '[F]Tu nombre es más [Am]alto', '[G]Tu nombre es más [C]fuerte'].join(N));
});

test('secciones por nombre y número, aunque cambie el orden', () => {
  const old = ['Verso 1', '[C]Uno dos', 'Coro', '[G]Tres cuatro'].join(N);
  const neu = ['Coro', 'Cinco seis', 'Verso 1', 'Siete ocho'].join(N);
  const { text, report } = replaceLyricsKeepChords(old, neu);
  assert.equal(text, ['Coro', '[G]Cinco seis', '', 'Verso 1', '[C]Siete ocho'].join(N));
  assert.deepEqual(report.map((r) => r.from), ['Coro', 'Verso 1']);
});

test('una sección nueva sin igual en la vieja queda sin acordes', () => {
  const { text, report } = replaceLyricsKeepChords(['Verso 1', '[C]Hola'].join(N), ['Puente', 'Nada aquí'].join(N));
  assert.equal(text, ['Puente', 'Nada aquí'].join(N));
  assert.equal(report[0].from, null);
});

test('los acordes que no caben no se pierden: van en una línea aparte', () => {
  const old = ['Verso 1', '[C]Mil gene[F]raciones a[C]doran a una voz [Am]le cantan'].join(N);
  const neu = ['Verso 1', 'Mil gracias'].join(N);
  const { text } = replaceLyricsKeepChords(old, neu);
  const lines = text.split(N);
  assert.equal(lines[1], '[C]Mil [F]gracias');
  assert.equal(lines[2], 'C  Am');
});

test('una sección sin letra (Intro) toma las líneas de acordes de la vieja', () => {
  const old = ['Intro', 'F (Am) G C/E Am G C', '', 'Verso 1', '[C]Hola'].join(N);
  const neu = ['Intro', '', 'Verso 1', 'Adiós'].join(N);
  const { text } = replaceLyricsKeepChords(old, neu);
  assert.equal(text, ['Intro', 'F (Am) G C/E Am G C', '', 'Verso 1', '[C]Adiós'].join(N));
});
