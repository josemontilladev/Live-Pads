import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const B = await import('../src/js/live/bassCore.js');
const G = await import('../src/js/live/grooveCore.js');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('bajo: registro de bajo y muestra real más cercana', () => {
  assert.equal(B.bassMidi(10), 34);  // La#1
  assert.equal(B.bassMidi(9), 45);   // La2
  assert.equal(B.bassMidi(0), 36);   // Do2
  for (let pc = 0; pc < 12; pc++) {
    const s = B.bassSample(B.bassMidi(pc));
    assert.ok(existsSync(join(SRC, s.file)), s.file);
    assert.ok(s.rate > 0.9 && s.rate < 1.1, `${pc}: ${s.rate}`);   // nunca más de ±1,5 semitonos
  }
});

test('bajo: va con el bombo, en el 1, y calla en el redoble', () => {
  const pop = G.withTracks(G.GROOVES.find((g) => g.id === 'pop'));
  // Verso pop: bombo en 0, 8 y 10.
  assert.ok(B.bassHit(pop, 'A', 0));
  assert.equal(B.bassHit(pop, 'A', 4), null);
  assert.ok(B.bassHit(pop, 'A', 8));
  assert.ok(B.bassHit(pop, 'A', 4, true), 'cambio de acorde en un tiempo');
  assert.equal(B.bassHit(pop, 'A', 0).len, 8);            // hasta el siguiente bombo (paso 8)
  assert.ok(B.bassHit(pop, 'fill', 0));
  assert.equal(B.bassHit(pop, 'fill', 8), null);
});
