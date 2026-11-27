import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKey, findDate, parseLine, parseSetlistText, similarity, matchEntries } from '../src/js/data/setlistImportCore.js';

test('tonos en cifrado americano y latino', () => {
  assert.equal(toKey('Ab'), 'Ab');
  assert.equal(toKey('F#m'), 'F#m');
  assert.equal(toKey('(G)'), 'G');
  assert.equal(toKey('Sol'), 'G');
  assert.equal(toKey('Re m'), 'Dm');
  assert.equal(toKey('Sib'), 'Bb');
  assert.equal(toKey('La#m'), 'A#m');
  assert.equal(toKey('Mi bemol'), 'Eb');
  assert.equal(toKey('Grande'), '');
  assert.equal(toKey('Amor'), '');
});

test('fechas', () => {
  const today = Date.parse('2026-11-27T12:00:00');
  assert.equal(findDate('Domingo 6 de diciembre', today), '2026-12-06');
  assert.equal(findDate('*Alabanza 13 dic*', today), '2026-12-13');
  assert.equal(findDate('Servicio 06/12', today), '2026-12-06');
  assert.equal(findDate('Ensayo 3/1', today), '2027-01-03', 'enero que viene');
  assert.equal(findDate('20-11-2026', today), '2026-11-20');
  assert.equal(findDate('Way Maker', today), null);
});

test('líneas de canción', () => {
  assert.deepEqual(parseLine('1. Adiós al ayer (Ab)'), { title: 'Adiós al ayer', artist: '', key: 'Ab' });
  assert.deepEqual(parseLine('- Way Maker – Sinach – G'), { title: 'Way Maker', artist: 'Sinach', key: 'G' });
  assert.deepEqual(parseLine('Cuán grande es Él en Sib 🔥'), { title: 'Cuán grande es Él', artist: '', key: 'Bb' });
  assert.deepEqual(parseLine('3) *Tu fidelidad* - Tono: Re'), { title: 'Tu fidelidad', artist: '', key: 'D' });
  assert.deepEqual(parseLine('• Grande y fuerte - Miel San Marcos'), { title: 'Grande y fuerte', artist: 'Miel San Marcos', key: '' });
  assert.deepEqual(parseLine('Renuévame G'), { title: 'Renuévame', artist: '', key: 'G' });
  assert.equal(parseLine('10:30'), null);
  assert.equal(parseLine('Alabanza'), null);
  assert.equal(parseLine('Dirige: Juan'), null);
  assert.equal(parseLine('🔥🔥'), null);
});

test('mensaje completo de WhatsApp', () => {
  const r = parseSetlistText(`*Alabanza domingo 6 de diciembre* 🙌
Dirige: María
1. Adiós al ayer (Ab)
2. Way Maker - G
3. Cuán grande es Él en Sib

Ofrenda
4. Renuévame - Marcos Witt - D`, { today: Date.parse('2026-11-27T12:00:00') });
  assert.equal(r.date, '2026-12-06');
  assert.match(r.name, /Alabanza domingo 6 de diciembre/);
  assert.deepEqual(r.items.map((x) => [x.title, x.key]), [['Adiós al ayer', 'Ab'], ['Way Maker', 'G'], ['Cuán grande es Él', 'Bb'], ['Renuévame', 'D']]);
  assert.equal(r.items[3].artist, 'Marcos Witt');
});

test('casar con la librería, tolerando erratas del OCR', () => {
  assert.equal(similarity('Adiós al ayer', 'Adios al Ayer'), 1);
  assert.ok(similarity('Adi0s al ayer', 'Adios al Ayer') > 0.72, 'una errata');
  assert.ok(similarity('Way Maker', 'Cuán grande es Él') < 0.4);
  const lib = [{ id: 'a', title: 'Adios al Ayer', artist: 'Elevation' }, { id: 'b', title: 'Way Maker (En vivo)', artist: 'Sinach' }, { id: 'c', title: 'Renuevame', artist: 'Marcos Witt' }];
  const m = matchEntries(lib, [{ title: 'Adi0s al ayer' }, { title: 'Way Maker' }, { title: 'Renuévame', artist: 'Marcos Witt' }, { title: 'Canción nueva' }]);
  assert.deepEqual(m.map((x) => x.song && x.song.id), ['a', 'b', 'c', null]);
});
