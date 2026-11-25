import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const V = await import('../src/js/live/voiceCuesCore.js');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('voces: cada sección y número tiene su archivo (y existe)', () => {
  const cases = ['Verso', 'Verso 2', 'Verso 9', 'Coro', 'Coro 3', 'Pre Coro', 'Pre Coro 2', 'Puente 1', 'Intro', 'Final', 'Instrumental', 'Interludio', 'Tag', 'Solo', 'Estribillo'];
  for (const c of cases) {
    const f = V.sectionFile(c);
    assert.ok(f, c);
    assert.ok(existsSync(join(SRC, f)), `${c} → ${f}`);
  }
  assert.equal(V.sectionFile('Verso 2'), 'assets/Spanish Guides/Song Sections/Spanish - Verso 2 (Verse 2).wav');
  assert.equal(V.sectionFile('Verso 9'), 'assets/Spanish Guides/Song Sections/Spanish - Verso (Verse).wav');
  assert.equal(V.sectionFile('Final'), 'assets/Spanish Guides/Song Sections/Spanish - Ending (Final).wav');
  assert.equal(V.sectionFile('Algo raro'), null);
  for (let n = 1; n <= 7; n++) assert.ok(existsSync(join(SRC, V.numberFile(n))));
  assert.equal(V.numberFile(8), null);
});

test('guía: avisa un compás antes; la primera sección (en el 0) no', () => {
  const ms = [{ label: 'Intro', t: 0 }, { label: 'Verso 1', t: 8 }, { label: 'Coro', t: 24 }];
  assert.equal(V.nextCue(ms, 0, 2), null);                     // aviso del verso a los 6 s
  assert.equal(V.nextCue(ms, 5.6, 2).marker.label, 'Verso 1');
  assert.equal(V.nextCue(ms, 5.6, 2).at, 6);
  assert.equal(V.nextCue(ms, 21.7, 2).marker.label, 'Coro');
});
