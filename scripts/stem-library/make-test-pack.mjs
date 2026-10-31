// Genera un pack de PRUEBA sintético para la biblioteca de stems: batería,
// pad y bajo a 72 BPM, 4/4, 4 compases, progresión G–Em–C–D (tono G).
// Sirve para probar el flujo completo (subir → explorar → escuchar → arrastrar
// al editor) antes de tener loops reales. Pack gratis; bórralo antes de lanzar:
//   node scripts/stem-library/upload-pack.mjs --delete prueba-livepads
//
// Uso:  node scripts/stem-library/make-test-pack.mjs <carpeta-destino>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWav } from './wav.mjs';

const out = process.argv[2];
if (!out) {
  console.error('Uso: node scripts/stem-library/make-test-pack.mjs <carpeta-destino>');
  process.exit(1);
}

const SR = 48000, BPM = 72, BEATS = 4, BARS = 4;
const beat = 60 / BPM;
const frames = Math.round(BARS * BEATS * beat * SR);
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Ruido determinista: el pack sale idéntico cada vez.
let seed = 12345;
const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x7fffffff) - 1;

function normalize(chs, peakDb = -3) {
  let peak = 0;
  for (const ch of chs) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = peak ? Math.pow(10, peakDb / 20) / peak : 1;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return chs;
}

function drums() {
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const hit = (at, fn, len, panL = 1, panR = 1) => {
    const s0 = Math.round(at * SR);
    for (let i = 0; i < len * SR && s0 + i < frames; i++) {
      const v = fn(i / SR);
      L[s0 + i] += v * panL; R[s0 + i] += v * panR;
    }
  };
  let prev = 0;
  for (let b = 0; b < BARS * BEATS; b++) {
    const t = b * beat;
    if (b % 2 === 0) { // bombo en 1 y 3
      let ph = 0;
      hit(t, (x) => { ph += 2 * Math.PI * (45 + 75 * Math.exp(-x * 30)) / SR; return Math.sin(ph) * Math.exp(-x * 7); }, 0.5);
    } else {           // caja en 2 y 4
      hit(t, (x) => (0.6 * noise() + 0.5 * Math.sin(2 * Math.PI * 185 * x)) * Math.exp(-x * 16), 0.35);
    }
    for (const sub of [0, 0.5]) { // hi-hat en corcheas, un poco a la derecha
      // Diferencia de ruido = ruido con agudos (filtro paso alto de 1 polo).
      hit(t + sub * beat, (x) => { const n = noise(); const v = n - prev; prev = n; return 0.25 * v * Math.exp(-x * 60); }, 0.06, 0.7, 1);
    }
  }
  return normalize([L, R]);
}

const PROG = [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]]; // G Em C D
const ROOTS = [43, 40, 36, 38];

function pad() {
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const barLen = BEATS * beat;
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    const bar = Math.min(BARS - 1, Math.floor(t / barLen));
    const tb = t - bar * barLen;
    const env = Math.min(1, tb / 0.35) * Math.min(1, (barLen - tb) / 0.08);
    let l = 0, r = 0;
    for (const m of PROG[bar]) {
      const f = hz(m);
      for (let h = 1; h <= 4; h++) {
        l += Math.sin(2 * Math.PI * f * h * 1.002 * t) / (h * h);
        r += Math.sin(2 * Math.PI * f * h * 0.998 * t) / (h * h);
      }
    }
    L[i] = l * env; R[i] = r * env;
  }
  return normalize([L, R], -4);
}

function bass() {
  const M = new Float32Array(frames);
  const eighth = beat / 2;
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    const step = Math.floor(t / eighth);
    const bar = Math.min(BARS - 1, Math.floor(step / (BEATS * 2)));
    const te = t - step * eighth;
    const f = hz(ROOTS[bar] + (step % 4 === 3 ? 7 : 0)); // quinta al final de cada grupo
    const env = Math.exp(-te * 6) * Math.min(1, (eighth - te) / 0.01);
    M[i] = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * env;
  }
  normalize([M], -4);
  return [M, M.slice()];
}

mkdirSync(out, { recursive: true });
const files = [
  { file: 'bateria-basica-72.wav', title: 'Batería básica', instrument: 'drums', key: null, data: drums() },
  { file: 'pad-g-em-c-d-72.wav', title: 'Pad G–Em–C–D', instrument: 'pad', key: 'G', data: pad() },
  { file: 'bajo-g-em-c-d-72.wav', title: 'Bajo G–Em–C–D', instrument: 'bass', key: 'G', data: bass() },
];
for (const f of files) writeFileSync(join(out, f.file), writeWav(f.data, SR));

const pack = {
  slug: 'prueba-livepads',
  title: 'Pack de prueba',
  description: 'Loops sintéticos para probar la biblioteca de stems. Borrar antes de lanzar.',
  genre: 'worship',
  mood: 'prueba',
  tier: 'free',
  published: true,
  sort: 999,
  loops: files.map((f, i) => ({
    file: f.file, title: f.title, instrument: f.instrument, section: 'any',
    bpm: BPM, key: f.key, bars: BARS, beatsPerBar: BEATS, tags: ['prueba'], sort: i,
  })),
};
writeFileSync(join(out, 'pack.json'), JSON.stringify(pack, null, 2));
console.log(`Pack de prueba generado en ${out} (${files.length} loops, ${BPM} BPM, ${BARS} compases).`);
