import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessFromFilename, exactTempo, pickTempo, slugify, safeFileName } from '../src/js/stems/loopMeta.js';

test('guessFromFilename deduce instrumento, sección, título y BPM', () => {
  assert.deepEqual(guessFromFilename('02_Bateria-Coro_72bpm.wav'),
    { title: 'Bateria Coro', instrument: 'drums', section: 'chorus', bpmHint: 72 });
  assert.equal(guessFromFilename('Pad Ambient G.wav').instrument, 'pad');
  assert.equal(guessFromFilename('Shaker groove.wav').instrument, 'perc');
  assert.equal(guessFromFilename('bajo pre-coro.wav').section, 'prechorus');
  assert.equal(guessFromFilename('Bass intro.wav').section, 'intro');
  assert.deepEqual(guessFromFilename('algo raro.wav'), { title: 'algo raro', instrument: 'other', section: 'any', bpmHint: null });
});

test('exactTempo saca el BPM exacto de un loop de N compases', () => {
  // 4 compases a 72 BPM = 13.333 s; el detector dijo 71.4
  assert.deepEqual(exactTempo(13.3333333, 71.4).bpm, 72);
  assert.equal(exactTempo(13.3333333, 71.4).bars, 4);
  // Si el detector dio el doble (144), salen 8 compases a 144: también válido.
  assert.equal(exactTempo(13.3333333, 144).bars, 8);
});

test('pickTempo: el tempo del pack corrige un detector despistado', () => {
  // 4 compases a 80 BPM = 12 s; el detector dijo 180 en un pad sostenido.
  assert.deepEqual(pickTempo(12, 180, { packBpm: 80 }), { bpm: 80, bars: 4 });
  // El BPM del nombre manda sobre todo.
  assert.deepEqual(pickTempo(12, 140, { hintBpm: 80 }).bpm, 80);
});

test('pickTempo: sin pistas, prefiere compases musicales (no 7 ni 9)', () => {
  const r = pickTempo(12, 140);           // 12 s: 4 comp = 80, 8 comp = 160
  assert.ok([4, 8].includes(r.bars), `bars = ${r.bars}`);
  assert.deepEqual(pickTempo(12, 90), { bpm: 80, bars: 4 });
});

test('pickTempo: si el tempo del pack no encaja, no lo fuerza', () => {
  // 10 s a 80 BPM serían 3.33 compases: no se usa el del pack.
  const r = pickTempo(10, 96, { packBpm: 80 });
  assert.equal(r.bars, 4);
  assert.equal(r.bpm, 96);
});

test('slugify y safeFileName quitan acentos y símbolos', () => {
  assert.equal(slugify('Pack Adoración 2026!'), 'pack-adoracion-2026');
  assert.equal(safeFileName('Batería básica (G).wav'), 'Bateria-basica-G-.wav');
});
