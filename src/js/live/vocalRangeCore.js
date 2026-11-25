// ─────────────────────────────────────────────────────────────────────────
// Lógica pura de la prueba de rango vocal (live/vocalRange.js). Se prueba en Node.
// ─────────────────────────────────────────────────────────────────────────

const N = ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
export const noteName = (m) => N[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Nota estable: las últimas lecturas (MIDI con decimales) dentro de ±0,6 semitonos durante ≥ minSec. */
export function stableNote(samples, now, minSec = 0.9) {
  const recent = samples.filter((s) => now - s.t <= minSec + 0.05);
  if (!recent.length || now - recent[0].t < minSec * 0.9) return null;
  const sorted = recent.map((s) => s.m).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  if (recent.every((s) => Math.abs(s.m - med) <= 0.6)) return Math.round(med);
  return null;
}

/** Tipo de voz aproximado por el rango cómodo. */
export function voiceType(low, high) {
  const mid = (low + high) / 2;
  if (mid < 51) return 'Bajo';
  if (mid < 55) return 'Barítono';
  if (mid < 59) return 'Tenor';
  if (mid < 62) return 'Contralto';
  if (mid < 65) return 'Mezzosoprano';
  return 'Soprano';
}

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJ = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MIN = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
export function parseKey(k) {
  const m = /^\s*([A-G])([#b]?)(m(?!aj))?/.exec(String(k || ''));
  if (!m) return null;
  return { pc: ((PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)) % 12 + 12) % 12, minor: !!m[3] };
}

// Tramo típico de una melodía de alabanza respecto a la tónica (semitonos):
// de la 5.ª por debajo a la 3.ª por encima de la octava.
const MELODY = [-5, 16];

/**
 * Tono sugerido para un cantante (rango cómodo [low, high], MIDI) a partir del tono
 * original: aquel en que la melodía típica cabe mejor; a igualdad, el más cercano al original.
 * → { key, shift } (shift en semitonos respecto al original, −6…+5) o null.
 */
export function suggestKey(low, high, originalKey) {
  const o = parseKey(originalKey);
  if (!o || !(high > low)) return null;
  let best = null;
  for (let shift = -6; shift <= 5; shift++) {
    const pc = (o.pc + shift + 12) % 12;
    // Mejor octava para esa tónica.
    for (let tonic = low - 12; tonic <= high + 12; tonic++) {
      if (((tonic % 12) + 12) % 12 !== pc) continue;
      const a = tonic + MELODY[0], b = tonic + MELODY[1];
      const out = Math.max(0, low - a) + Math.max(0, b - high);       // semitonos fuera del rango
      const score = out * 10 + Math.abs(shift);
      if (!best || score < best.score) best = { score, shift, pc };
    }
  }
  return { key: (o.minor ? MIN : MAJ)[best.pc], shift: best.shift };
}
