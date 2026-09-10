import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStemRole, STEM_KIND_BADGE } from '../src/js/stems/stemRole.js';

test('detecta el rol por sufijo, prefijo, paréntesis y guion bajo', () => {
  assert.deepEqual(detectStemRole('ASÍ SERÁ (SO BE IT) - vocals.mp3'), { kind: 'vocals', name: 'ASÍ SERÁ (SO BE IT)' });
  assert.deepEqual(detectStemRole('ASÍ SERÁ (SO BE IT) - drums.wav'),  { kind: 'drums',  name: 'ASÍ SERÁ (SO BE IT)' });
  assert.deepEqual(detectStemRole('bass_Asi Sera.wav'),                 { kind: 'bass',   name: 'Asi Sera' });
  assert.deepEqual(detectStemRole('Asi Sera (Other).mp3'),              { kind: 'other',  name: 'Asi Sera' });
  assert.deepEqual(detectStemRole('Voces - Grita.wav'),                 { kind: 'vocals', name: 'Grita' });
  assert.deepEqual(detectStemRole('Grita_click.wav'),                   { kind: 'click',  name: 'Grita' });
  assert.deepEqual(detectStemRole('Grita guia.mp3'),                    { kind: 'guide',  name: 'Grita' });
});

test('sin token conocido queda como audio genérico con el nombre intacto', () => {
  assert.deepEqual(detectStemRole('Mi Canción.mp3'), { kind: 'stem', name: 'Mi Canción' });
  assert.equal(detectStemRole('').kind, 'stem');
});

test('si el nombre es solo el rol, se conserva como nombre', () => {
  assert.deepEqual(detectStemRole('Instrumental.mp3'), { kind: 'other', name: 'Instrumental' });
});

test('todo rol detectable tiene badge', () => {
  for (const kind of ['vocals', 'drums', 'bass', 'other', 'click', 'guide']) assert.ok(STEM_KIND_BADGE[kind]);
});
