import { test } from 'node:test';
import assert from 'node:assert/strict';
import { octaveProfile, masterGains, TARGET } from '../src/js/audio/autoMasterCore.js';

const SR = 44100;
// Ruido rosa (Voss-McCartney simplificado) y versiones oscurecida/brillante.
function pink(n, seed = 1) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const rows = new Float64Array(16); let run = 0; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const z = i ^ (i + 1); for (let r = 0; r < 16; r++) if (z & (1 << r)) { run -= rows[r]; rows[r] = rnd(); run += rows[r]; } out[i] = (run + rnd()) * 0.05; }
  return out;
}
function onePole(x, a) { const y = new Float32Array(x.length); let p = 0; for (let i = 0; i < x.length; i++) { p += a * (x[i] - p); y[i] = p; } return y; }
function highpass(x, a) { const lp = onePole(x, a); return x.map((v, i) => v - lp[i]); }

test('el perfil del ruido rosa sale casi plano por octavas', () => {
  const p = octaveProfile(pink(SR * 20), SR);
  for (const v of p.slice(1, 7)) assert.ok(Math.abs(v) < 3, 'octava ' + v.toFixed(1));
});

test('una mezcla oscura recibe más agudos; una brillante, menos; con tope', () => {
  const x = pink(SR * 20);
  const dark = masterGains(octaveProfile(onePole(x, 0.08), SR));       // pasa-bajos ~600 Hz
  const bright = masterGains(octaveProfile(highpass(x, 0.05), SR));    // le faltan graves
  assert.ok(dark.high > 2, 'oscura → sube agudos: ' + dark.high);
  assert.ok(dark.high <= 4);
  assert.ok(bright.low > 1, 'sin graves → sube graves: ' + bright.low);
  // El rosa plano es más brillante que la referencia: baja algo los agudos.
  const flat = masterGains(octaveProfile(x, SR));
  assert.ok(flat.high < 0 && flat.high >= -4, 'rosa → baja agudos: ' + flat.high);
  for (const g of [dark, bright, flat]) { assert.ok(g.mud <= 0 && g.mud >= -3); assert.ok(Math.abs(g.low) <= 4); }
});

test('silencio o pista muy corta: sin cambios', () => {
  assert.equal(octaveProfile(new Float32Array(SR * 5), SR), null);
  assert.equal(octaveProfile(new Float32Array(1000), SR), null);
  assert.deepEqual(masterGains(null), { low: 0, mud: 0, high: 0 });
  assert.deepEqual(masterGains(TARGET.slice()), { low: 0, mud: 0, high: 0 }, 'ya está en la referencia');
});
