import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordEngineFactory, analyzeChords, chordName, keyName, CHORD_SR } from '../src/js/chords/chordEngine.js';

// Canción sintética: C – G – Am – F (2 compases cada uno) a 120 BPM, con bajo en la raíz,
// acordes con armónicos y un bombo en cada pulso.
function synthSong() {
  const sr = CHORD_SR, bpm = 120, beat = 60 / bpm;
  const prog = [[48, [60, 64, 67]], [43, [59, 62, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]]];
  const bars = 2, loops = 3;
  const dur = prog.length * bars * 4 * beat * loops;
  const x = new Float32Array(Math.ceil(dur * sr));
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    const ci = Math.floor(t / (bars * 4 * beat)) % prog.length;
    const [bass, notes] = prog[ci];
    const tb = t % beat;
    const env = Math.exp(-tb * 2.5);
    let v = 0.5 * Math.sin(2 * Math.PI * hz(bass) * t) * env;
    for (const n of notes) for (let h = 1; h <= 3; h++) v += (0.3 / h) * Math.sin(2 * Math.PI * hz(n) * h * t) * env;
    v += 0.8 * Math.sin(2 * Math.PI * 60 * tb) * Math.exp(-tb * 30); // bombo
    x[i] = v * 0.2;
  }
  return x;
}

test('detecta tono, BPM y acordes de una progresión C G Am F', () => {
  const r = analyzeChords(synthSong());
  assert.equal(keyName(r), 'C');
  assert.ok(Math.abs(r.bpm - 120) < 2, `BPM ${r.bpm}`);
  const names = new Set(r.seg.filter(s => s.r >= 0 && s.e - s.s > 1).map(s => chordName(s, { basic: true })));
  for (const c of ['C', 'G', 'Am', 'F']) assert.ok(names.has(c), `falta ${c} en ${[...names]}`);
  assert.equal(chordName({ r: 9, q: 1, b: -1 }, { latin: true }), 'Lam');
  assert.equal(chordName({ r: 0, q: 0, b: 7 }, { shift: 2 }), 'D/A');
});

test('el motor no depende de nada externo (se puede arrancar en un Worker desde un Blob)', () => {
  const E = new Function(`return (${chordEngineFactory.toString()})();`)();
  const r = E.analyzeChords(new Float32Array(CHORD_SR * 4));
  assert.equal(typeof r.bpm, 'number');
  assert.ok(Array.isArray(r.seg));
});
