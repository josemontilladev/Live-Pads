import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { placeCues, labelCues, isSectionKey } from '../src/js/stems/guideCuesCore.js';
const require = createRequire(import.meta.url);
const W = require('../whisperGuide.js');

test('cada aviso va al inicio del compás siguiente (la guía avisa un compás antes)', () => {
  // 120 BPM 4/4 → compás de 2 s. «Verse» dicho en 10,1 s → sección en 12 s.
  const c = placeCues([{ t: 2.1, key: 'intro' }, { t: 10.12, key: 'verso-1' }, { t: 26.3, key: 'coro' }], { bpm: 120 });
  assert.deepEqual(c.map((x) => x.atSec), [4, 12, 28]);
});

test('aviso justo en la raya del compás: va al siguiente; con desplazamiento de rejilla', () => {
  assert.deepEqual(placeCues([{ t: 4.0, key: 'coro' }], { bpm: 120 }).map((x) => x.atSec), [6]);
  assert.deepEqual(placeCues([{ t: 4.6, key: 'coro' }], { bpm: 120, gridOffset: 0.5 }).map((x) => x.atSec), [6.5]);
});

test('se ignoran cuentas y palabras que no son sección; repetidos pegados cuentan una vez', () => {
  const c = placeCues([{ t: 1, key: null }, { t: 2.1, key: 'coro' }, { t: 2.9, key: 'coro' }, { t: 9, key: 'last-time' }], { bpm: 120, onlySections: true });
  assert.deepEqual(c.map((x) => x.key), ['coro']);
});

test('sin tempo: el marcador queda en el aviso', () => {
  assert.deepEqual(placeCues([{ t: 3.3, key: 'puente' }]).map((x) => x.atSec), [3.3]);
});

test('nombres: Verso/Coro numerados por orden; los que traen número se respetan', () => {
  const L = { verso: 'Verso', 'verso-2': 'Verso 2', coro: 'Coro', 'coro-2': 'Coro 2', puente: 'Puente', intro: 'Intro' };
  const r = labelCues([{ key: 'intro' }, { key: 'verso' }, { key: 'coro' }, { key: 'verso-2' }, { key: 'coro' }, { key: 'puente' }], (k) => L[k]);
  assert.deepEqual(r.map((x) => x.label), ['Intro', 'Verso 1', 'Coro 1', 'Verso 2', 'Coro 2', 'Puente']);
});

test('secciones y avisos', () => {
  assert.ok(isSectionKey('coro-2') && !isSectionKey('all-in') && !isSectionKey(null));
});

test('Whisper: espectrograma log-mel del tamaño correcto y en rango', () => {
  const pcm = new Float32Array(16000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 16000);
  const m = W.logMel(pcm);
  assert.equal(m.length, 80 * 3000);
  let max = -Infinity, min = Infinity;
  for (const v of m) { if (v > max) max = v; if (v < min) min = v; }
  assert.ok(max <= 1.6 && min >= max - 2.01, `${min} ${max}`);
});

test('Whisper: tramos con voz (se ignoran golpes cortos de click)', () => {
  const pcm = new Float32Array(16000 * 6);
  for (let i = 0; i < pcm.length; i++) { const t = i / 16000; if (t % 0.5 < 0.012) pcm[i] = 0.05; if (t > 2 && t < 2.6) pcm[i] = 0.4 * Math.sin(2 * Math.PI * 200 * t); }
  const r = W.speechRegions(pcm);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].start - 2) < 0.05 && Math.abs(r[0].end - 2.6) < 0.05, JSON.stringify(r));
});

test('Whisper: la tabla de frases cubre las secciones y los avisos', () => {
  const keys = new Set(W.PHRASES.map((p) => p[1]));
  for (const k of ['intro', 'verso-1', 'pre-coro', 'coro', 'puente', 'ending', 'outro', null]) assert.ok(keys.has(k), String(k));
  assert.ok(W.PHRASES.every((p) => Array.isArray(p[2]) && p[2].length >= 1));
});
