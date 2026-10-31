import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestStructure, rankCandidates, sectionStarts, STRUCTURE_PRESETS } from '../src/js/stems/loopStructure.js';

const L = (id, instrument, section, extra = {}) => ({
  id, instrument, section, pack_id: 'A', bpm: 72, musical_key: 'G', bars: 4, beats_per_bar: 4, title: id, ...extra,
});
const project = { bpm: 72, key: 'G', beatsPerBar: 4 };

test('prefiere el loop de la misma sección, luego "cualquiera"', () => {
  const loops = [L('d-any', 'drums', 'any'), L('d-coro', 'drums', 'chorus'), L('d-verso', 'drums', 'verse')];
  assert.equal(rankCandidates(loops, 'drums', 'chorus', project)[0].id, 'd-coro');
  assert.equal(rankCandidates(loops, 'drums', 'intro', project)[0].id, 'd-any');
});

test('a igualdad de sección, prefiere menos estiramiento de tempo', () => {
  const loops = [L('lejos', 'bass', 'any', { bpm: 90 }), L('cerca', 'bass', 'any', { bpm: 74 })];
  assert.equal(rankCandidates(loops, 'bass', 'verse', project)[0].id, 'cerca');
});

test('las secciones del mismo tipo reciben el mismo loop', () => {
  const loops = [L('d1', 'drums', 'chorus'), L('d2', 'drums', 'chorus', { bpm: 73 })];
  const sections = [{ type: 'chorus', bars: 8 }, { type: 'verse', bars: 8 }, { type: 'chorus', bars: 8 }];
  const { picks } = suggestStructure({ sections, instruments: ['drums'], loops, project });
  assert.equal(picks[0].drums, picks[2].drums);
});

test('favorece el pack que cubre más instrumentos', () => {
  const loops = [
    L('a-d', 'drums', 'any'), L('a-b', 'bass', 'any'),
    L('b-d', 'drums', 'any', { pack_id: 'B', bpm: 72 }),
  ];
  const { mainPack, picks } = suggestStructure({ sections: [{ type: 'verse', bars: 8 }], instruments: ['drums', 'bass'], loops, project });
  assert.equal(mainPack, 'A');
  assert.equal(picks[0].drums, 'a-d');
});

test('sin loops de un instrumento, la celda queda vacía', () => {
  const { picks } = suggestStructure({ sections: [{ type: 'intro', bars: 4 }], instruments: ['drums', 'pad'], loops: [L('d', 'drums', 'any')], project });
  assert.equal(picks[0].pad, null);
});

test('sectionStarts acumula los compases', () => {
  const sections = STRUCTURE_PRESETS.corta.map(([type, bars]) => ({ type, bars }));
  assert.deepEqual(sectionStarts(sections), { starts: [0, 4, 12, 20, 28], totalBars: 32 });
});
