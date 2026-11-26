import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRpp, rppFiles, rppStemTracks, rppTokens } from '../src/js/stems/rppCore.js';

const RPP = `<REAPER_PROJECT 0.1 "7.0/win64" 1700000000
  RIPPLE 0
  TEMPO 72 6 8
  MARKER 1 0 Intro 0
  MARKER 2 15.5 "Coro 1" 0
  MARKER 3 40 "Puente" 1
  MARKER 3 60 "" 1
  <TRACK {AAA}
    NAME Click
    VOLPAN 1 -1 -1 -1 1
    MUTESOLO 0 0 0
    <ITEM
      POSITION 0
      LENGTH 120
      FADEIN 1 0.01 0 1 0 0 0
      <SOURCE WAVE
        FILE "Audio\\Click.wav"
      >
    >
  >
  <TRACK {BBB}
    NAME "Bass DI"
    VOLPAN 0.5 0.25 -1 -1 1
    MUTESOLO 1 0 0
    <ITEM
      POSITION 4
      LENGTH 10
      SOFFS 2
      <SOURCE SECTION
        LENGTH 10
        <SOURCE MP3
          FILE "C:\\Sesiones\\bass.mp3"
        >
      >
    >
    <ITEM
      POSITION 30
      LENGTH 5
      SOFFS 30
      <SOURCE MP3
        FILE "C:\\Sesiones\\bass.mp3"
      >
    >
  >
  <TRACK {CCC}
    NAME "Vacia"
  >
>`;

test('palabras con comillas', () => {
  assert.deepEqual(rppTokens('MARKER 2 15.5 "Coro 1" 0'), ['MARKER', '2', '15.5', 'Coro 1', '0']);
});

test('tempo, compás y marcadores (región = su inicio)', () => {
  const p = parseRpp(RPP);
  assert.equal(p.bpm, 72);
  assert.equal(p.beatsPerBar, 6);
  assert.equal(p.beatValue, 8);
  assert.deepEqual(p.markers.map((m) => [m.label, m.atSec]), [['Intro', 0], ['Coro 1', 15.5], ['Puente', 40]]);
});

test('pistas con mezcla y clips (fuentes anidadas); las vacías no', () => {
  const p = parseRpp(RPP);
  assert.equal(p.tracks.length, 2);
  const b = p.tracks[1];
  assert.equal(b.name, 'Bass DI');
  assert.equal(b.muted, true);
  assert.equal(b.pan, 0.25);
  assert.equal(b.clips.length, 2);
  assert.equal(b.clips[0].file, 'C:\\Sesiones\\bass.mp3');
  assert.equal(p.tracks[0].clips[0].fadeIn, 0.01);
});

test('archivos usados, sin repetir', () => {
  assert.deepEqual(rppFiles(RPP), ['Audio\\Click.wav', 'C:\\Sesiones\\bass.mp3']);
});

test('clips para Stems: empiezan en POSITION y suenan desde SOFFS', () => {
  const st = rppStemTracks(parseRpp(RPP));
  const bass = st.find((t) => t.name === 'Bass DI');
  const c = bass.clips[0];
  // inicio en el timeline = shift + trimStart = 4
  assert.equal(c.shift + c.trimStartSec, 4);
  assert.equal(c.trimStartSec, 2);
  assert.equal(c.trimEndSec, 12);
});

test('un archivo que no es de REAPER da un error claro', () => {
  assert.throws(() => parseRpp('hola'), /REAPER/);
});

import { writeRpp } from '../src/js/stems/rppCore.js';
test('exportar a REAPER y volver a importar: lo mismo (ida y vuelta)', () => {
  const proj = {
    name: 'Domingo', bpm: 72, beatsPerBar: 6, beatValue: 8,
    markers: [{ label: 'Intro', atSec: 0 }, { label: 'Coro "1"', atSec: 15.5 }],
    tracks: [
      { name: 'Click', volume: 0.85, pan: -1, muted: false, file: 'Audio/Click.wav', clips: [{ startSec: 0, endSec: 120, trimStartSec: 0, fadeInSec: 0, fadeOutSec: 0 }] },
      { name: 'Bajo', volume: 0.425, pan: 0.3, muted: true, file: 'Audio/Bajo.mp3', clips: [
        { startSec: 4, endSec: 14, trimStartSec: 2, fadeInSec: 0.5, fadeOutSec: 0 },
        { startSec: 30, endSec: 35, trimStartSec: 30, fadeInSec: 0, fadeOutSec: 1 }] },
    ],
  };
  const back = parseRpp(writeRpp(proj));
  assert.equal(back.bpm, 72); assert.equal(back.beatsPerBar, 6); assert.equal(back.beatValue, 8);
  assert.deepEqual(back.markers.map((m) => [m.label, m.atSec]), [['Intro', 0], ["Coro '1'", 15.5]]);
  const b = back.tracks.find((t) => t.name === 'Bajo');
  assert.equal(b.muted, true); assert.equal(b.pan, 0.3); assert.ok(Math.abs(b.volume - 0.425) < 1e-6);
  assert.deepEqual(b.clips.map((c) => [c.file, c.position, c.length, c.offset, c.fadeIn, c.fadeOut]),
    [['Audio/Bajo.mp3', 4, 10, 2, 0.5, 0], ['Audio/Bajo.mp3', 30, 5, 30, 0, 1]]);
  const st = rppStemTracks(back).find((t) => t.name === 'Bajo');
  assert.equal(st.clips[0].shift + st.clips[0].trimStartSec, 4);
});
