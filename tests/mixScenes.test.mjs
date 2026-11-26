import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureScene, sceneMarkerAt, sceneChanges, sceneSummary, templateKey, buildTemplate, applyTemplate } from '../src/js/stems/mixScenesCore.js';

const T = [
  { id: 1, name: 'Drums', kind: 'drums', volume: 0.8, pan: 0, muted: false },
  { id: 2, name: 'Bass', kind: 'bass', volume: 0.7, pan: 0, muted: false },
  { id: 3, name: 'Pad', kind: 'stem', volume: 0.5, pan: -0.3, muted: false },
];

test('la escena guarda volumen, paneo y silencio', () => {
  const s = captureScene(T);
  assert.deepEqual(s[3], { v: 0.5, p: -0.3, m: false });
});

test('manda el último marcador con escena que ya empezó', () => {
  const ms = [{ id: 'a', atSec: 0, mix: {} }, { id: 'b', atSec: 30 }, { id: 'c', atSec: 60, mix: {} }];
  assert.equal(sceneMarkerAt(ms, 10).id, 'a');
  assert.equal(sceneMarkerAt(ms, 45).id, 'a');   // «b» no tiene escena: sigue la de «a»
  assert.equal(sceneMarkerAt(ms, 60).id, 'c');
  assert.equal(sceneMarkerAt([{ id: 'x', atSec: 5, mix: {} }], 2), null);
});

test('cambios: solo lo que difiere y solo pistas que la escena conoce', () => {
  const scene = { 1: { v: 0.8, p: 0, m: true }, 2: { v: 0.7, p: 0, m: false } };
  assert.deepEqual(sceneChanges(T, scene), [{ id: 1, m: true }]);
});

test('resumen legible', () => {
  const names = { 1: 'Batería', 2: 'Bajo', 3: 'Pad' };
  const s = sceneSummary({ 1: { v: 0.8, p: 0, m: true }, 2: { v: 0.3, p: 0, m: false }, 3: { v: 1, p: 0, m: false } }, (id) => names[id]);
  assert.equal(s, 'Sin Batería · Bajo al 30 %');
});

test('plantilla: por tipo, o por nombre si no lo tiene', () => {
  assert.equal(templateKey({ kind: 'drums', name: 'x' }), 'k:drums');
  assert.equal(templateKey({ kind: 'stem', name: 'Pad Ambiente.wav' }), 'n:pad ambiente');
});

test('aplicar plantilla a otro multitrack: mezcla y orden', () => {
  const tpl = buildTemplate('Domingo', [
    { id: 9, name: 'Click', kind: 'click', volume: 1, pan: -1, muted: false },
    { id: 8, name: 'Bajo', kind: 'bass', volume: 0.6, pan: 1, muted: false },
    { id: 7, name: 'Pad', kind: 'stem', volume: 0.4, pan: 1, muted: true },
  ]);
  const other = [
    { id: 'a', name: 'Bass DI', kind: 'bass', volume: 1, pan: 0 },
    { id: 'b', name: 'Keys', kind: 'keys', volume: 1, pan: 0 },
    { id: 'c', name: 'CLICK', kind: 'click', volume: 1, pan: 0 },
    { id: 'd', name: 'pad', kind: 'stem', volume: 1, pan: 0 },
  ];
  const r = applyTemplate(tpl, other);
  assert.equal(r.matched, 3);
  assert.deepEqual(r.order, ['c', 'a', 'd', 'b']);
  assert.deepEqual(r.changes.find((c) => c.id === 'c'), { id: 'c', v: 1, p: -1, m: false, color: null });
  assert.equal(r.changes.find((c) => c.id === 'd').m, true);
});
