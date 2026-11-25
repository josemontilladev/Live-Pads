import { test } from 'node:test';
import assert from 'node:assert/strict';
const V = await import('../src/js/live/vocalRangeCore.js');

test('rango vocal: nota estable, nombre y tipo de voz', () => {
  const s = []; for (let i = 0; i <= 10; i++) s.push({ t: i * 0.1, m: 57.1 + (i % 2) * 0.2 });
  assert.equal(V.stableNote(s, 1.0), 57);
  const wob = s.map((x, i) => ({ ...x, m: x.m + (i === 5 ? 2 : 0) }));
  assert.equal(V.stableNote(wob, 1.0), null);
  assert.equal(V.noteName(57), 'La3');
  assert.equal(V.voiceType(45, 64), 'Barítono');
  assert.equal(V.voiceType(55, 74), 'Mezzosoprano');
});

test('tono sugerido: la melodía típica cabe en la voz; si ya cabe, se queda', () => {
  // Tenor cómodo Do3–La4 (48–69): el tramo -5…+16 cabe con tónica Fa3..Fa#3 → original en G queda en G o cerca.
  const t = V.suggestKey(48, 69, 'G');
  assert.ok(t && Math.abs(t.shift) <= 2, JSON.stringify(t));
  // Voz grave (La2–Re4, 45–62) con un tema en E: debe bajar.
  const low = V.suggestKey(45, 62, 'E');
  assert.ok(low.shift < 0, JSON.stringify(low));
  // Menor conserva el modo.
  assert.match(V.suggestKey(48, 69, 'Am').key, /m$/);
  assert.equal(V.suggestKey(48, 69, 'xx'), null);
});
