import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPitch, segmentNotes, harmonize, noteName, midiToHz, chordsWithPcs } from '../src/js/voices/harmonyCore.js';

// Voz sintética: armónicos + vibrato + respiros entre notas.
function sing(melody, sr = 44100) {
  const total = melody.reduce((a, n) => a + n.d + (n.rest || 0), 0);
  const out = new Float32Array(Math.ceil(total * sr));
  let t0 = 0, phase = 0;
  for (const n of melody) {
    const f = midiToHz(n.m), N = Math.floor(n.d * sr), start = Math.floor(t0 * sr);
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t);
      phase += (2 * Math.PI * f * vib) / sr;
      const env = Math.min(1, i / (0.02 * sr), (N - i) / (0.02 * sr));
      out[start + i] = env * 0.4 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
    }
    t0 += n.d + (n.rest || 0);
  }
  return out;
}

test('nombres de nota', () => {
  assert.equal(noteName(66), 'F#4');
  assert.equal(noteName(63, true), 'Eb4');
  assert.equal(noteName(40), 'E2');
});

test('la melodía cantada se recupera nota a nota (con vibrato y respiros)', () => {
  const mel = [{ m: 64, d: 0.5 }, { m: 67, d: 0.4 }, { m: 69, d: 0.6, rest: 0.15 }, { m: 67, d: 0.3 }, { m: 64, d: 0.8 }];
  const tr = trackPitch(sing(mel), 44100);
  const notes = segmentNotes(tr);
  assert.deepEqual(notes.map((n) => n.m), [64, 67, 69, 67, 64]);
  assert.ok(Math.abs(notes[2].s - 0.9) < 0.06, `inicio de la 3.ª nota: ${notes[2].s}`);
});

test('voz grave (hombre) y aguda (mujer) también', () => {
  for (const base of [45, 72]) {
    const mel = [{ m: base, d: 0.5 }, { m: base + 2, d: 0.5 }, { m: base + 4, d: 0.5 }];
    const notes = segmentNotes(trackPitch(sing(mel), 44100));
    assert.deepEqual(notes.map((n) => n.m), [base, base + 2, base + 4], `base ${base}`);
  }
});

test('armonía en Do mayor sin acordes: terceras por la escala', () => {
  const mel = [{ s: 0, e: 1, m: 64 }, { s: 1, e: 2, m: 65 }, { s: 2, e: 3, m: 67 }];   // E F G
  const h = harmonize(mel, { key: { k: 0, m: false }, style: 'arriba-abajo' });
  assert.deepEqual(h.v2.map((n) => n.m), [67, 69, 71]);   // G A B
  assert.deepEqual(h.v3.map((n) => n.m), [60, 62, 64]);   // C D E
});

test('con acordes, la armonía se queda en notas del acorde', () => {
  // Melodía D (nota del acorde G) sobre G: la 3.ª arriba por escala sería F (no está en G) → G o B.
  const QUAL = [['', [0, 4, 7]], ['m', [0, 3, 7]]];
  const chords = chordsWithPcs([{ s: 0, e: 2, r: 7, q: 0 }], QUAL);
  const h = harmonize([{ s: 0, e: 1, m: 62 }], { key: { k: 0, m: false }, chords, style: 'arriba-abajo' });
  assert.ok([67, 71].includes(h.v2[0].m), `2.ª voz ${h.v2[0].m}`);
  assert.ok(h.v2[0].m > 62);
  assert.ok([55, 59].includes(h.v3[0].m) && h.v3[0].m < 62, `3.ª voz ${h.v3[0].m}`);
});

test('en menor y en otros estilos: siempre del lado pedido', () => {
  const mel = [{ s: 0, e: 1, m: 69 }, { s: 1, e: 2, m: 72 }, { s: 2, e: 3, m: 71 }];
  for (const style of ['arriba', 'abajo']) {
    const h = harmonize(mel, { key: { k: 9, m: true }, style });
    for (const v of ['v2', 'v3']) h[v].forEach((n, i) => assert.ok(style === 'arriba' ? n.m > mel[i].m : n.m < mel[i].m, `${style} ${v} ${i}`));
  }
});

test('los picos falsos del detector (notas muy cortas encajadas) se quitan', () => {
  // A (0,5 s) – pico de 0,12 s una quinta arriba – A otra vez; y un salto real que se queda.
  const mel = [{ m: 66, d: 0.5 }, { m: 73, d: 0.12 }, { m: 66, d: 0.5 }, { m: 69, d: 0.5 }, { m: 71, d: 0.5 }];
  const notes = segmentNotes(trackPitch(sing(mel), 44100));
  assert.deepEqual(notes.map((n) => n.m), [66, 69, 71]);
});
