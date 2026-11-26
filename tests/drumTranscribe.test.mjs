import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, segment, buildGroove, barStrings, arrangementPart, arrangementBars, gridSteps, HOP } from '../src/js/live/drumTranscribeCore.js';

// Interpretación sintética a 100 BPM (pulso 0,6 s, semicorchea 0,15 s): envolventes en dB por banda.
const BPM = 100, BEAT = 60 / BPM, SIXT = BEAT / 4;
function perform(bars) {
  const dur = bars.length * 4 * BEAT + 2, n = Math.ceil(dur / HOP);
  const f = { low: new Float32Array(n).fill(-80), mid: new Float32Array(n).fill(-80), noise: new Float32Array(n).fill(-80), high: new Float32Array(n).fill(-80) };
  const hit = (band, t, db, decay) => { const f0 = Math.round(t / HOP); for (let k = 0; k < decay && f0 + k < n; k++) f[band][f0 + k] = Math.max(f[band][f0 + k], db - (k * 30) / decay); };
  bars.forEach((pat, b) => {
    for (let s = 0; s < 16; s++) {
      const t = 1 + (b * 16 + s) * SIXT;
      if (pat.kick[s] !== '-') { hit('low', t, pat.kick[s] === 'X' ? -6 : -12, 12); hit('mid', t, -30, 5); }
      if (pat.snare[s] !== '-') { hit('mid', t, pat.snare[s] === 'X' ? -8 : -14, 10); hit('noise', t, pat.snare[s] === 'X' ? -9 : -15, 12); hit('high', t, -22, 6); hit('low', t, -24, 6); }
      if (pat.hhc[s] !== '-') hit('high', t, pat.hhc[s] === 'X' ? -10 : -16, 6);
      if (pat.crash && pat.crash[s] !== '-') hit('high', t, -4, 120);
    }
  });
  const beats = []; for (let i = 0; i <= bars.length * 4; i++) beats.push(1 + i * BEAT);
  return { features: f, grid: { beats, beatsPerBar: 4, downbeats: [1] } };
}
const VERSE = { kick: 'X-------x-------', snare: '----X-------X---', hhc: 'x-x-x-x-x-x-x-x-' };
const FILL = { kick: 'X---------------', snare: '----X-------xxXX', hhc: 'x-x-x-x---------' };
// Coro: bombo más movido y el crash «de ride» en cada pulso (como se toca en un coro de alabanza).
const CHORUS1 = { kick: 'X-----x-X-----x-', snare: '----X-------X---', hhc: '----------------', crash: 'X---x---x---x---' };
const CHORUS = CHORUS1;
const song = [VERSE, VERSE, VERSE, FILL, CHORUS1, CHORUS, CHORUS, CHORUS, VERSE, VERSE, VERSE, VERSE];

test('rejilla: 16 pasos por compás desde el primer tiempo fuerte', () => {
  const g = gridSteps({ beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], beatsPerBar: 4, downbeats: [0] }, 4);
  assert.equal(g.length, 32);
  assert.deepEqual(g.slice(0, 3).map((s) => +s.t.toFixed(3)), [0, 0.125, 0.25]);
  assert.equal(g[16].bar, 1);
});

test('transcribe: bombo, caja y hi-hat de cada compás (y el crash del coro)', () => {
  const { features, grid } = perform(song);
  const r = transcribe(features, grid, { spb: 4 });
  assert.equal(r.bars.length, 12);
  const v = barStrings(r.bars[0]);
  assert.equal(v.kick.replace(/[Xxo]/g, '#'), '#-------#-------');
  assert.equal(v.snare.replace(/[Xxo]/g, '#'), '----#-------#---');
  assert.equal(v.hhc.replace(/[Xxo]/g, '#'), '#-#-#-#-#-#-#-#-');
  const c = barStrings(r.bars[4]);
  assert.equal(c.kick.replace(/[Xxo]/g, '#'), '#-----#-#-----#-');
  assert.ok(c.crash && c.crash[0] !== '-' && c.crash[4] !== '-', 'crash en cada pulso del coro');
  assert.equal(barStrings(r.bars[3]).snare.replace(/[Xxo]/g, '#'), '----#-------####');
});

test('secciones, ritmo y arreglo en el orden de la grabación', () => {
  const { features, grid } = perform(song);
  const r = transcribe(features, grid, { spb: 4 });
  const secs = segment(r.bars, { spb: 4 });
  assert.deepEqual(secs.map((s) => [s.from, s.to, s.part, s.fill]), [[0, 3, 'A', true], [4, 7, 'B', false], [8, 11, 'A', false]]);
  const g = buildGroove(r.bars, secs, { steps: 16 });
  assert.equal(g.parts.A.kick.replace(/[Xxo]/g, '#'), '#-------#-------');
  assert.equal(g.parts.B.kick.replace(/[Xxo]/g, '#'), '#-----#-#-----#-');
  assert.equal(g.parts.fill.snare.replace(/[Xxo]/g, '#'), '----#-------####');
  assert.equal(g.parts.B.crash.replace(/[Xxo]/g, '#'), '#---#---#---#---', 'el crash «de ride» se queda en el coro');
  assert.deepEqual(g.arrangement, [{ part: 'A', bars: 3 }, { part: 'fill', bars: 1 }, { part: 'B', bars: 4, crash: true }, { part: 'A', bars: 4 }]);
  assert.equal(arrangementBars(g.arrangement), 12);
  assert.deepEqual([0, 2, 3, 4, 7, 8, 11, 12].map((i) => arrangementPart(g.arrangement, i)), ['A', 'A', 'fill', 'B', 'B', 'A', 'A', null]);
});
