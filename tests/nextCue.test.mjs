import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueVisible, cueContent, CUE_LEAD_S, CUE_AFTER_MS } from '../src/js/live/nextCueCore.js';

test('se ve en los últimos 20 s sonando y un rato después de terminar; no si se cerró', () => {
  assert.equal(cueVisible({ remaining: 60, playing: true, endedAt: 0, now: 0 }), false);
  assert.equal(cueVisible({ remaining: CUE_LEAD_S, playing: true, endedAt: 0, now: 0 }), true);
  assert.equal(cueVisible({ remaining: 5, playing: false, endedAt: 0, now: 0 }), false, 'parado a mitad: no');
  assert.equal(cueVisible({ remaining: 0, playing: false, endedAt: 1000, now: 5000 }), true, 'terminó: sí');
  assert.equal(cueVisible({ remaining: 0, playing: false, endedAt: 1000, now: 1000 + CUE_AFTER_MS + 1 }), false);
  assert.equal(cueVisible({ remaining: 5, playing: true, endedAt: 0, now: 0, dismissedFor: 'a>b', key: 'a>b' }), false);
  assert.equal(cueVisible({ remaining: 5, playing: true, endedAt: 0, now: 0, dismissedFor: 'a>b', key: 'b>c' }), true);
});

test('contenido: título, tono, BPM, cejilla y notas (máx. 3)', () => {
  const c = cueContent({ next: { title: 'Way Maker', bpm: '68' }, key: 'G', capo: { capo: 0, shape: 'G' }, notes: ['Entra solo piano', 'Bajo: en el coro', 'x', 'y'], remaining: 12.4, playing: true });
  assert.equal(c.title, 'Way Maker');
  assert.equal(c.meta, 'G · 68 BPM');
  assert.deepEqual(c.lines, ['Entra solo piano', 'Bajo: en el coro', 'x'], 'sin cejilla no se dice nada');
  assert.equal(c.inSec, 12);
  const d = cueContent({ next: { title: 'Cuán grande' }, key: 'Bb', capo: { capo: 3, shape: 'G' }, notes: [], playing: false });
  assert.deepEqual(d.lines, ['Guitarra: cejilla 3 (formas de G)']);
  assert.equal(d.meta, 'Bb');
  assert.equal(d.inSec, null);
  assert.equal(cueContent({ next: null }), null);
});
