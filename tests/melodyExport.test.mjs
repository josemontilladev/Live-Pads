import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monophonic, partsToMidi, keyFifths, splitDuration, measuresOf, partsToMusicXML } from '../src/js/voices/melodyExportCore.js';

test('una voz no tiene notas superpuestas', () => {
  const m = monophonic([{ s: 1, e: 2, m: 62 }, { s: 0, e: 1.5, m: 60 }, { s: 1.5, e: 1.51, m: 64 }, { s: NaN, e: 2, m: 60 }]);
  assert.deepEqual(m.map((n) => [n.s, n.e, n.m]), [[0, 1, 60], [1, 1.5, 62], [1.5, 1.51, 64]]);
});

test('MIDI: cabecera de formato 1, pista de tempo y una por voz', () => {
  const b = partsToMidi([{ name: 'Melodía', notes: [{ s: 0, e: 0.5, m: 60 }] }, { name: '2.ª voz', notes: [{ s: 0, e: 0.5, m: 64 }] }], 120);
  assert.equal(String.fromCharCode(...b.slice(0, 4)), 'MThd');
  assert.equal(b[9], 1, 'formato 1');
  assert.equal(b[11], 3, 'tempo + 2 voces');
  const s = Buffer.from(b).toString('latin1');
  assert.equal(s.split('MTrk').length - 1, 3);
  assert.ok(s.includes('Melod'));
});

test('armadura y figuras', () => {
  assert.equal(keyFifths({ k: 7, m: false }), 1);   // G
  assert.equal(keyFifths({ k: 10, m: false }), -2); // Bb
  assert.equal(keyFifths({ k: 9, m: true }), 0);    // Am
  assert.equal(keyFifths({ k: 2, m: true }), -1);   // Dm
  assert.equal(keyFifths(null), 0);
  assert.deepEqual(splitDuration(7).map((f) => f[0]), [6, 1]);
  assert.deepEqual(splitDuration(10).map((f) => f[0]), [8, 2]);
});

test('compases: negras exactas, silencios y notas ligadas sobre la barra', () => {
  // 120 BPM: negra = 0,5 s. Cuatro negras, un silencio de negra y una blanca que cruza la barra.
  const notes = [{ s: 0, e: 0.5, m: 60 }, { s: 0.5, e: 1, m: 62 }, { s: 1, e: 1.5, m: 64 }, { s: 1.5, e: 2, m: 65 }, { s: 2.5, e: 3.0, m: 67 }, { s: 3.75, e: 4.75, m: 69 }];
  const ms = measuresOf(notes, { bpm: 120, bar: 16 });
  assert.equal(ms.length, 3);
  assert.deepEqual(ms[0].map((e) => [e.dur, e.m]), [[4, 60], [4, 62], [4, 64], [4, 65]]);
  assert.deepEqual(ms[1].map((e) => [e.dur, e.m]), [[4, null], [4, 67], [6, null], [2, 69]]);
  assert.equal(ms[1][3].tieStart, true, 'la última nota sigue en el compás siguiente');
  assert.equal(ms[2][0].m, 69); assert.equal(ms[2][0].tieStop, true);
  assert.equal(ms.every((m) => m.reduce((a, e) => a + e.dur, 0) === 16), true, 'cada compás suma 4/4');
});

test('MusicXML bien formado con armadura, tempo, ligaduras y bemoles', () => {
  const x = partsToMusicXML([{ name: 'Melodía', notes: [{ s: 0, e: 0.5, m: 70 }, { s: 1.75, e: 2.75, m: 63 }] }, { name: '3.ª voz', notes: [{ s: 0, e: 1, m: 50 }] }], { bpm: 120, key: { k: 10, m: false }, title: 'Prueba & co' });
  assert.match(x, /^<\?xml/);
  assert.match(x, /<fifths>-2<\/fifths>/);
  assert.match(x, /<per-minute>120<\/per-minute>/);
  assert.match(x, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave>/, 'Bb con bemol');
  assert.match(x, /<tie type="start"\/>/);
  assert.match(x, /<sign>F<\/sign>/, 'la voz grave en clave de fa');
  assert.match(x, /Prueba &amp; co/);
  assert.equal((x.match(/<measure /g) || []).length, 2 + 1, '2 compases de melodía + 1 de la 3.ª voz');
});
