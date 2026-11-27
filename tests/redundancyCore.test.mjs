import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedTime, followStep, shouldTakeOver, principalState, DRIFT_S } from '../src/js/live/redundancyCore.js';

const song = { id: 's1', title: 'Way Maker', artist: 'Sinach' };
const R = (o = {}) => ({ songId: 's1', title: 'Way Maker', artist: 'Sinach', slot: 'sequence', t: 10, playing: true, rate: 1, pitch: 0, recvAt: 1000, ...o });
const L = (o = {}) => ({ song, type: 'sequence', playing: true, t: 10, pitch: 0, lastSeekAt: -1e9, ...o });

test('la posición esperada avanza con el tiempo desde que llegó el mensaje', () => {
  assert.ok(Math.abs(expectedTime(R(), 1500) - 10.505) < 1e-9);
  assert.ok(Math.abs(expectedTime(R({ rate: 0.5 }), 3000) - (10 + 2.005 * 0.5)) < 1e-9);
  assert.equal(expectedTime(R({ playing: false }), 9999), 10);
});

test('seguir: carga otra canción, play, pausa, tono y recolocación', () => {
  assert.equal(followStep(R({ songId: 'otra', title: 'Otra' }), L(), 1000).action, 'load');
  assert.equal(followStep(R({ slot: 'original' }), L(), 1000).action, 'load');
  // Misma canción por título aunque el id sea otro (librerías distintas en cada PC).
  assert.equal(followStep(R({ songId: 'x9' }), L({ t: 10.005 }), 1000).action, 'none');
  assert.equal(followStep(R(), L({ playing: false }), 1000).action, 'play');
  assert.equal(followStep(R({ playing: false }), L(), 1000).action, 'pause');
  assert.deepEqual(followStep(R({ pitch: 2 }), L(), 1000), { action: 'pitch', pitch: 2 });
  // Desfase pequeño: nada. Grande: recolocar (pero no dos veces seguidas).
  assert.equal(followStep(R(), L({ t: 10 + DRIFT_S / 2 }), 1000).action, 'none');
  const s = followStep(R(), L({ t: 11 }), 1000);
  assert.equal(s.action, 'seek');
  assert.ok(Math.abs(s.t - 10.005) < 1e-9);
  assert.equal(followStep(R(), L({ t: 11, lastSeekAt: 500 }), 1000).action, 'none');
  // Parado: se deja exactamente donde está el principal.
  assert.equal(followStep(R({ playing: false }), L({ playing: false, t: 10.2, lastSeekAt: 999 }), 1000).action, 'seek');
  assert.equal(followStep({ songId: null }, L(), 1000).action, 'none');
});

test('relevo solo si el principal sonaba y se calló', () => {
  assert.equal(shouldTakeOver(R(), 1000, 2000), false);
  assert.equal(shouldTakeOver(R(), 1000, 2300), true);
  assert.equal(shouldTakeOver(R({ playing: false }), 1000, 9000), false);
  assert.equal(shouldTakeOver(null, 1000, 9000), false);
});

test('estado del principal', () => {
  const st = principalState({ song, type: 'sequence', audio: { currentTime: 12.34567, paused: false, playbackRate: 1 }, pitch: -2, serviceIndex: 1 });
  assert.deepEqual(st, { songId: 's1', title: 'Way Maker', artist: 'Sinach', slot: 'sequence', t: 12.346, playing: true, rate: 1, pitch: -2, serviceIndex: 1 });
  assert.deepEqual(principalState({ song: null }), { songId: null });
});
