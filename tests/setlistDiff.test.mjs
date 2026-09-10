import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudSetlistUnchanged, keysSignature } from '../src/js/data/setlistDiff.js';

const songs = [{ id: 1, title: 'Grita', key: 'F' }, { id: 2, title: 'Abba Padre', key: 'C' }];
const existing = {
  cloudId: 'c1', cloudUpdatedAt: '2026-09-01T10:00:00Z', name: 'Domingo', date: '2026-09-07',
  keys: { 1: 'G', 2: 'D' }, songs,
};
const incoming = () => ({
  cloudId: 'c1', updatedAt: '2026-09-01T10:00:00Z', name: 'Domingo', date: '2026-09-07',
  keys: { 2: 'D', 1: 'G' }, songs: songs.map(s => ({ ...s })),
});

test('la misma versión de la nube no cuenta como cambio (orden de keys indiferente)', () => {
  assert.equal(cloudSetlistUnchanged(existing, incoming()), true);
});

test('cambios reales sí se detectan', () => {
  assert.equal(cloudSetlistUnchanged(existing, { ...incoming(), updatedAt: '2026-09-02T10:00:00Z' }), false);
  assert.equal(cloudSetlistUnchanged(existing, { ...incoming(), name: 'Lunes' }), false);
  assert.equal(cloudSetlistUnchanged(existing, { ...incoming(), keys: { 1: 'A', 2: 'D' } }), false);
  assert.equal(cloudSetlistUnchanged(existing, { ...incoming(), songs: songs.slice(0, 1) }), false);
});

test('la nube sin fecha no pisa la fecha local ni provoca re-render', () => {
  assert.equal(cloudSetlistUnchanged(existing, { ...incoming(), date: null }), true);
});

test('setlist local sin cloudUpdatedAt todavía se actualiza la primera vez', () => {
  assert.equal(cloudSetlistUnchanged({ ...existing, cloudUpdatedAt: null }, incoming()), false);
});

test('keysSignature es estable', () => {
  assert.equal(keysSignature({ b: 2, a: 1 }), keysSignature({ a: 1, b: 2 }));
  assert.equal(keysSignature(null), '');
});
