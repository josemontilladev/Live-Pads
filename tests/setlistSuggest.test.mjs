import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fifthsDistance, transitionNote, orderForFlow, lastPlayedMap, suggestSongs } from '../src/js/data/setlistSuggestCore.js';

test('distancia de tonos y nota de transición', () => {
  assert.equal(fifthsDistance('C', 'G'), 1);
  assert.equal(fifthsDistance('C', 'Am'), 0);
  assert.equal(fifthsDistance('C', 'F#'), 6);
  assert.equal(fifthsDistance('C', ''), null);
  assert.match(transitionNote('G', 'G'), /Mismo tono/);
  assert.match(transitionNote('G', 'Ab'), /medio tono/);
  assert.match(transitionNote('C', 'Am'), /relativo/);
  assert.match(transitionNote('C', 'F#'), /lejanos/);
});

test('orden para fluir: de la más movida a la más lenta, con tonos cercanos', () => {
  const s = [
    { id: 1, title: 'Lenta', bpm: 64, key: 'D' },
    { id: 2, title: 'Rápida', bpm: 150, key: 'G' },
    { id: 3, title: 'Media', bpm: 100, key: 'C' },
    { id: 4, title: 'Media2', bpm: 96, key: 'F#' },
  ];
  const { order, notes } = orderForFlow(s);
  assert.equal(order[0].title, 'Rápida');
  assert.equal(order[order.length - 1].title, 'Lenta');
  assert.equal(order.indexOf(s[2]) < order.indexOf(s[3]), true, 'tras G va mejor C (vecino) que F#');
  assert.equal(notes.length, 3);
  assert.equal(orderForFlow(s.slice(0, 2)).order.length, 2);
});

test('última vez que se tocó, por servicios guardados con fecha', () => {
  const today = Date.parse('2026-11-27T12:00:00');
  const m = lastPlayedMap([
    { date: '2026-11-22', songs: [{ id: 'a', title: 'Uno' }] },
    { date: '2026-10-01', songs: [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }] },
    { date: '2027-01-01', songs: [{ id: 'c', title: 'Futura' }] },
    { date: null, songs: [{ id: 'd', title: 'Sin fecha' }] },
  ], today);
  assert.equal(m.get('i:a'), Date.parse('2026-11-22T12:00:00'));
  assert.equal(m.get('t:dos'), Date.parse('2026-10-01T12:00:00'));
  assert.equal(m.has('i:c'), false, 'servicios futuros no cuentan');
  assert.equal(m.has('i:d'), false);
});

test('sugerir: por tema, sin las recién tocadas, priorizando las listas, con tempos variados', () => {
  const today = Date.parse('2026-11-27T12:00:00');
  const lib = [
    { id: 'a', title: 'Gracia sublime', bpm: 70, key: 'G', lyrics: 'gracia', audio: { sequence: 'x' } },
    { id: 'b', title: 'Tu gracia', bpm: 140, key: 'A', audio: { original: 'y' } },
    { id: 'c', title: 'Cuán grande', bpm: 72, key: 'Bb', lyrics: 'su gracia me alcanzó', audio: {} },
    { id: 'd', title: 'Otra cosa', bpm: 120, key: 'C', lyrics: 'nada que ver', audio: { sequence: 'z' } },
    { id: 'e', title: 'Gracia (recién)', bpm: 100, key: 'D', audio: { sequence: 'w' } },
  ];
  const lastPlayed = lastPlayedMap([{ date: '2026-11-22', songs: [{ id: 'e', title: 'Gracia (recién)' }] }], today);
  const r = suggestSongs(lib, { count: 3, theme: 'gracia', lastPlayed, today });
  const ids = r.map((x) => x.song.id);
  assert.equal(ids.includes('d'), false, 'no habla del tema');
  assert.equal(ids.includes('e'), false, 'se tocó hace 5 días');
  assert.deepEqual(new Set(ids), new Set(['a', 'b', 'c']));
  assert.equal(ids[0], 'b', 'empieza por la más movida');
  assert.ok(r[0].reasons.some((x) => /gracia/.test(x)));
  // Sin tema: todas cuentan, y salen las que tienen audio antes.
  const r2 = suggestSongs(lib, { count: 2, lastPlayed, today });
  assert.equal(r2.length, 2);
  assert.ok(r2.every((x) => x.song.audio && (x.song.audio.sequence || x.song.audio.original)));
  assert.equal(suggestSongs([], { count: 3 }).length, 0);
});
