import { test } from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../src/js/live/bandFollowCore.js');

test('lee acordes con extensiones, bemoles y bajos', () => {
  assert.deepEqual(core.parseChord('F#m7/C#'), { pc: 6, minor: true });
  assert.deepEqual(core.parseChord('Bbmaj7'), { pc: 10, minor: false });
  assert.deepEqual(core.parseChord('G/B'), { pc: 7, minor: false });
  assert.equal(core.parseChord('Coro'), null); // palabra, no acorde
  assert.equal(core.parseChord('Am7(b5)')?.minor, true);
});

const sheet = [
  { section: true, chords: [] },          // [Verso]
  { chords: ['G', 'D'] },
  { chords: ['Em', 'C'] },
  { section: true, chords: [] },          // [Coro]
  { chords: ['C', 'G'] },
  { chords: ['D', 'Em'] },
];

test('avanza por la hoja según los acordes que suenan', () => {
  const tk = core.chordTokens(sheet);
  assert.equal(tk.length, 8);
  let pos = -1;
  for (const c of ['G', 'D', 'Em', 'C']) pos = core.advance(tk, pos, core.parseChord(c));
  assert.equal(tk[pos].line, 2);
  pos = core.advance(tk, pos, core.parseChord('G'));  // coro: C ya contado → G de la línea 4
  assert.equal(tk[pos].line, 4);
  pos = core.advance(tk, pos, core.parseChord('A'));  // acorde que no está: se queda
  assert.equal(tk[pos].line, 4);
});

test('repetir: vuelve al comienzo de la sección', () => {
  const tk = core.chordTokens([{ section: true, chords: ['G', 'D'] }, { chords: ['Em', 'C'] }, { section: true, chords: ['Am', 'F'] }, { chords: ['C', 'G'] }]);
  let pos = tk.length - 1; // final del coro
  pos = core.advance(tk, pos, core.parseChord('Am'));
  assert.equal(tk[pos].line, 2);
});
