import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Metronome } from '../src/js/audio/Metronome.js';

// Motor falso: guarda a qué tiempo se programó cada click.
function fakeEngine() {
  const e = { ctx: { currentTime: 0 }, clicks: [] };
  e.playClick = (_accent, _sound, _vol, _pan, time) => e.clicks.push(time);
  return e;
}

// Avanza el "reloj" y deja que el planificador programe los clicks.
function run(m, e, seconds) {
  m._nextNoteTime = 0;
  m.running = true;
  m._scheduledBeats = [];
  for (let t = 0; t <= seconds; t += 0.025) {
    e.ctx.currentTime = t;
    m._scheduler();
  }
  m.running = false;
}

test('sin escala el click respeta el BPM', () => {
  const e = fakeEngine();
  const m = new Metronome(e);
  m.setBPM(120);
  run(m, e, 4);
  const gaps = e.clicks.slice(1).map((t, i) => +(t - e.clicks[i]).toFixed(3));
  assert.ok(gaps.every((g) => Math.abs(g - 0.5) < 1e-6), `huecos ${gaps}`);
});

test('con modo práctica al 50 % el click va a la mitad de velocidad', () => {
  const e = fakeEngine();
  const m = new Metronome(e);
  m.setBPM(120);
  m.tempoScale = 0.5;
  run(m, e, 6);
  const gaps = e.clicks.slice(1).map((t, i) => +(t - e.clicks[i]).toFixed(3));
  assert.ok(gaps.length >= 4);
  assert.ok(gaps.every((g) => Math.abs(g - 1) < 1e-6), `huecos ${gaps}`);
});

test('el BPM mostrado no cambia al bajar la velocidad', () => {
  const m = new Metronome(fakeEngine());
  m.setBPM(128);
  m.tempoScale = 0.7;
  assert.equal(m.bpm, 128);
});

test('la escala se combina con el multiplicador 2x', () => {
  const e = fakeEngine();
  const m = new Metronome(e);
  m.setBPM(120);
  m.multiplier = 2;
  m.tempoScale = 0.5;       // 120 × 2 × 0.5 = 120 clicks/min → cada 0.5 s
  run(m, e, 3);
  const gaps = e.clicks.slice(1).map((t, i) => +(t - e.clicks[i]).toFixed(3));
  assert.ok(gaps.every((g) => Math.abs(g - 0.5) < 1e-6), `huecos ${gaps}`);
});
