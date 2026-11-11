import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongFile, parseChordPro, parseOpenSong, normalizeKey } from '../src/js/data/songFileImport.js';

test('ChordPro: metadatos, secciones y acordes en línea', () => {
  const src = [
    '{title: Cuán grande es Él}', '{artist: Himno}', '{key: bb}', '{tempo: 72 bpm}', '# nota interna',
    '{start_of_verse: Verse 1}', '[Bb]Señor mi Dios, al [Eb]contemplar los cielos', '{end_of_verse}',
    '{soc}', '[Bb]Mi corazón en[F]tona la canción', '{eoc}',
    '{c: Bridge}', 'Puente', '{comment: Repetir 2 veces}',
    '{sot}', 'e|--3--|', '{eot}',
  ].join('\n');
  const s = parseSongFile('cuan-grande.cho', src);
  assert.equal(s.format, 'ChordPro');
  assert.equal(s.title, 'Cuán grande es Él');
  assert.equal(s.artist, 'Himno');
  assert.equal(s.key, 'Bb');
  assert.equal(s.bpm, '72');
  assert.match(s.lyrics, /^VERSO 1\n\[Bb\]Señor mi Dios/);
  assert.match(s.lyrics, /\nCORO\n\[Bb\]Mi corazón/);
  assert.match(s.lyrics, /\nPUENTE\nPuente\n\(Repetir 2 veces\)/);
  assert.ok(!s.lyrics.includes('e|--3--|'), 'la tablatura no se importa');
  assert.ok(!s.lyrics.includes('nota interna'));
});

test('ChordPro sin título usa el nombre del archivo y se detecta por contenido', () => {
  const s = parseSongFile('Mi_Cancion.txt', '{key: Am}\n[Am]Hola');
  assert.equal(s.format, 'ChordPro');
  assert.equal(s.title, 'Mi Cancion');
  assert.equal(s.key, 'Am');
});

test('OpenSong: etiquetas, líneas de acordes y de letra', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><song><title>Santo &amp; Digno</title><author>Autor</author><key>G</key><tempo>88</tempo>
<lyrics>[V1]
.G       C
 Santo, santo
;suave
[C]
.D
 Digno___ es|
</lyrics></song>`;
  const s = parseSongFile('santo', xml);
  assert.equal(s.format, 'OpenSong');
  assert.equal(s.title, 'Santo & Digno');
  assert.equal(s.key, 'G');
  assert.equal(s.bpm, '88');
  const lines = s.lyrics.split('\n');
  assert.equal(lines[0], 'VERSO 1');
  assert.equal(lines[1], ' G       C');        // misma columna que la letra de abajo
  assert.equal(lines[2], ' Santo, santo');
  assert.ok(s.lyrics.includes('(suave)'));
  assert.ok(s.lyrics.includes('\nCORO\n'));
  assert.ok(s.lyrics.includes('Digno es'));
});

test('Texto plano: título del archivo y letra tal cual', () => {
  const s = parseSongFile('C:\\canciones\\Eres todopoderoso.txt', 'G   D\nEres todopoderoso\r\n');
  assert.equal(s.format, 'texto');
  assert.equal(s.title, 'Eres todopoderoso');
  assert.equal(s.lyrics, 'G   D\nEres todopoderoso');
});

test('normalizeKey', () => {
  assert.equal(normalizeKey('f#'), 'F#');
  assert.equal(normalizeKey('A minor'), 'Am');
  assert.equal(normalizeKey('E♭'), 'Eb');
  assert.equal(normalizeKey('???'), '');
  assert.equal(parseChordPro('{key: C#m}').key, 'C#m');
  assert.equal(parseOpenSong('<song><lyrics>x</lyrics><key>Dm</key></song>').key, 'Dm');
});
