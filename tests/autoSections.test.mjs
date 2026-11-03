import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoMarkers, lyricSections } from '../src/js/ui/autoSections.js';

const det = (pairs) => pairs.map(([atSec, cueId]) => ({ atSec, cueId }));

test('sin letra: versos numerados y nombres del menú', () => {
  const r = buildAutoMarkers(det([[0, 'intro'], [12, 'verso'], [40, 'coro'], [70, 'verso'], [98, 'coro'], [130, 'puente'], [160, 'coro'], [190, 'outro']]), '', 210);
  assert.deepEqual(r.map((m) => m.label), ['Intro', 'Verso 1', 'Coro', 'Verso 2', 'Coro', 'Puente', 'Coro', 'Final']);
  assert.equal(r[1].t, 12);
});

test('tramos seguidos del mismo tipo se juntan', () => {
  const r = buildAutoMarkers(det([[0, 'intro'], [10, 'coro'], [25, 'coro'], [40, 'verso']]), '', 100);
  assert.deepEqual(r.map((m) => [m.label, m.t]), [['Intro', 0], ['Coro', 10], ['Verso 1', 40]]);
});

test('la letra pone los nombres si el número de tramos cantados cuadra', () => {
  const lyrics = '[Verso 1]\nla la\n\n[Pre-Coro]\nle le\n\n[Coro]\nli li\n\n[Puente]\nlo lo';
  assert.equal(lyricSections(lyrics).length, 4);
  const r = buildAutoMarkers(det([[0, 'intro'], [8, 'verso'], [30, 'verso-x'], [44, 'coro'], [70, 'coro'], [71, 'instrumental'], [90, 'verso']]), lyrics, 120);
  // verso-x → verso (se funde con el anterior); quedan 4 cantados: Verso, Coro, Verso… = no cuadra
  assert.deepEqual(r.map((m) => m.label), ['Intro', 'Verso 1', 'Coro', 'Instrumental', 'Verso 2']);
  const r2 = buildAutoMarkers(det([[0, 'intro'], [8, 'verso'], [30, 'pre-coro'], [44, 'coro'], [80, 'puente'], [110, 'outro']]), lyrics, 130);
  assert.deepEqual(r2.map((m) => m.label), ['Intro', 'Verso 1', 'Pre Coro', 'Coro', 'Puente', 'Final']);
});

test('descarta un marcador en el último segundo y vacío si no hay nada', () => {
  assert.deepEqual(buildAutoMarkers([], '', 100), []);
  const r = buildAutoMarkers(det([[0, 'intro'], [99.5, 'outro']]), '', 100);
  assert.deepEqual(r.map((m) => m.label), ['Intro']);
});
