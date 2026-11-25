import { test } from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../src/js/live/tempoFollowCore.js');

function hits(bpm, secs, { jitter = 0.008, eighths = false, seed = 7 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = [], step = 60 / bpm / (eighths ? 2 : 1);
  for (let t = 0.3; t < secs; t += step) out.push(t + rnd() * jitter);
  return out;
}

test('estima el tempo real de la banda cerca del BPM de la canción', () => {
  const r = core.estimateTempo(hits(96, 9), 90);
  assert.ok(r && Math.abs(r.bpm - 96) <= 0.6, JSON.stringify(r));
  const r2 = core.estimateTempo(hits(118, 9, { eighths: true }), 120);
  assert.ok(r2 && Math.abs(r2.bpm - 118) <= 0.6, JSON.stringify(r2));
});

test('no salta al doble ni a la mitad, y sin golpes claros no decide', () => {
  const r = core.estimateTempo(hits(140, 9), 72); // 140 ≈ doble de 70
  assert.ok(!r || (r.bpm >= 72 * 0.88 && r.bpm <= 72 * 1.12));
  assert.equal(core.estimateTempo([1, 2, 3], 100), null);
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const noise = Array.from({ length: 30 }, () => rnd() * 8).sort((a, b) => a - b);
  const rn = core.estimateTempo(noise, 100);
  assert.ok(!rn || rn.confidence < 2);
});

test('fase: error del golpe frente al click y corrección suave', () => {
  assert.ok(Math.abs(core.phaseError(10.03, 10, 0.5) - 0.03) < 1e-9);
  assert.ok(Math.abs(core.phaseError(9.98, 10, 0.5) + 0.02) < 1e-9);
  assert.ok(Math.abs(core.phaseError(11.52, 10, 0.5) - 0.02) < 1e-9);
  assert.equal(core.phaseNudge([0.03, 0.03], 0.5), 0); // pocos datos
  const n = core.phaseNudge([0.03, 0.04, 0.035, 0.2], 0.5); // 0.2 está lejos del click: no cuenta
  assert.ok(n > 0 && n <= 0.02);
});

test('el tempo cambia poco a poco', () => {
  assert.equal(core.smoothBpm(90, 96), 91.5);
  assert.equal(core.smoothBpm(90, 89.2), 89.2);
  assert.equal(core.smoothBpm(0, 100), 100);
});

test('detector de golpes: picos claros sí, ruido de fondo no', () => {
  const p = new core.OnsetPicker();
  let found = 0;
  for (let i = 0; i < 600; i++) {
    const t = i * 0.0058;
    const f = i % 86 === 0 && i > 40 ? 1 : 0.01 + (i % 7) * 0.001;
    if (p.push(t, f)) found++;
  }
  assert.equal(found, 6);
});
