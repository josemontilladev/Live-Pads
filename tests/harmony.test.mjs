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

test('una nota larga con reverberación y restos de la mezcla no se corta', () => {
  // 2,5 s de La (220 Hz) que se apaga, con ruido y un eco (como una voz separada por IA).
  const sr = 44100, n = Math.round(2.5 * sr), x = new Float32Array(n);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, env = Math.exp(-t * 0.9);
    x[i] = env * (0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 440 * t)) + 2 * env * rnd();
    if (i > 2205) x[i] += 0.35 * x[i - 2205] + 0.3 * Math.sin(2 * Math.PI * 233 * t) * env;
  }
  const notes = segmentNotes(trackPitch(x, sr));
  const long = notes.filter((q) => q.m === 57).reduce((s, q) => s + (q.e - q.s), 0);
  assert.ok(long > 2.2, `la nota dura ${long.toFixed(2)} s`);
});

test('un salto falso de octava en medio de una nota se corrige', () => {
  const hop = 0.01, N = 200, f0 = new Float32Array(N), conf = new Float32Array(N).fill(0.95);
  for (let i = 0; i < N; i++) f0[i] = midiToHz(i >= 100 && i < 130 ? 62 : 74);
  const notes = segmentNotes({ hop, f0, conf });
  assert.deepEqual(notes.map((q) => q.m), [74]);
});

test('fraseo: se liga donde la voz sigue sonando y se respeta la respiración', async () => {
  const { legato } = await import('../src/js/voices/harmonyCore.js');
  const hop = 0.01, rms = new Float32Array(400).fill(0.5);
  for (let k = 200; k < 260; k++) rms[k] = 0.005;   // respiración (silencio) de 2,0 a 2,6 s
  for (let k = 330; k < 400; k++) rms[k] = 0.001;   // final: silencio desde 3,3 s
  const notes = [{ s: 0.1, e: 0.8, m: 60 }, { s: 0.95, e: 1.9, m: 62 }, { s: 2.6, e: 3.0, m: 64 }];
  const out = legato(notes, rms, hop);
  assert.equal(out[0].e, 0.95, 'consonante entre notas: ligada');
  assert.ok(out[1].e < 2.05 && out[1].e >= 1.9, 'antes de la respiración no se alarga de más');
  assert.ok(Math.abs(out[2].e - 3.3) < 0.02, 'la última nota dura mientras suena la vocal');
});

test('tonalidad: la melodía oída desafinada vuelve a la escala y las voces nunca se salen', async () => {
  const { fitToKey } = await import('../src/js/voices/harmonyCore.js');
  const key = { k: 0, m: false };   // Do mayor
  const scale = [0, 2, 4, 5, 7, 9, 11];
  // Melodía con notas «oídas» fuera de la escala (61 = Do#, 66 = Fa#, 70 = Sib)
  const mel = [60, 61, 64, 66, 67, 70, 69, 65, 62, 63, 60].map((m, i) => ({ s: i * 0.5, e: i * 0.5 + 0.45, m }));
  const chords = [{ s: 0, e: 2, pcs: [0, 4, 7] }, { s: 2, e: 4, pcs: [5, 9, 0] }, { s: 4, e: 6, pcs: [7, 11, 2] }];
  const fit = fitToKey(mel, key, chords);
  assert.ok(fit.every((n) => scale.includes(((n.m % 12) + 12) % 12)), fit.map((n) => n.m).join(','));
  for (const style of ['arriba-abajo', 'arriba', 'abajo']) {
    const h = harmonize(mel, { key, chords, style });
    for (const v of ['v2', 'v3']) assert.ok(h[v].every((n) => scale.includes(((n.m % 12) + 12) % 12)), `${style} ${v}: ${h[v].map((n) => n.m).join(',')}`);
  }
});

test('tonalidad: un cromatismo de verdad (nota de un acorde de fuera) se respeta', async () => {
  const { fitToKey } = await import('../src/js/voices/harmonyCore.js');
  const key = { k: 0, m: false };
  const mel = [{ s: 0, e: 1, m: 68 }];                 // Sol# sobre Mi mayor (V/vi en Do)
  const chords = [{ s: 0, e: 1, pcs: [4, 8, 11] }];
  assert.equal(fitToKey(mel, key, chords)[0].m, 68);
  assert.equal(fitToKey(mel, key, [{ s: 0, e: 1, pcs: [4, 7, 11] }])[0].m !== 68, true);
});
