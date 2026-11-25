// ─────────────────────────────────────────────────────────────────────────
// Lógica pura del bajo automático (lo toca la caja de ritmos, live/groovePlayer.js).
// El bajo va con el bombo: la fundamental del acorde en cada golpe de bombo (y en
// el 1 de cada compás), cambia de nota si el acorde cambia en un tiempo, y calla
// en los redobles. Muestras reales: assets/Bass (cada tercera menor, desde La#1).
// ─────────────────────────────────────────────────────────────────────────

import { steps, partOf } from './grooveCore.js';

const SAMPLES = [
  ['As1', 34], ['Cs2', 37], ['E2', 40], ['G2', 43], ['As2', 46], ['Cs3', 49], ['E3', 52], ['G3', 55], ['As3', 58], ['Cs4', 61],
];

/** Nota MIDI del bajo: entre La#1 (34) y La2 (45), registro normal de bajo y siempre a ≤ 1,5 semitonos de una muestra real. */
export const bassMidi = (pc) => 34 + ((((pc - 10) % 12) + 12) % 12);

/** Muestra más cercana y cuánto hay que afinarla. */
export function bassSample(midi) {
  let best = SAMPLES[0];
  for (const s of SAMPLES) if (Math.abs(s[1] - midi) < Math.abs(best[1] - midi)) best = s;
  return { file: `assets/Bass/${best[0]}.mp3`, rate: Math.pow(2, (midi - best[1]) / 12) };
}

/** ¿Hay golpe de bombo en este paso de esta parte? */
export function kickAt(g, part, i) {
  const p = partOf(g, part);
  return (g.tracks || []).some((t) => t.voice === 'kick' && !t.mute && p[t.id] && /[Xxo]/.test(p[t.id][i] || ''));
}

/**
 * ¿Toca el bajo en el paso i? → { len } (pasos hasta el siguiente golpe del bajo o el final del compás) o null.
 * chordChanged: el acorde cambió respecto a la última nota del bajo.
 */
export function bassHit(g, part, i, chordChanged = false) {
  if (part === 'fill') return i === 0 ? { len: g.spb } : null;      // en el redoble, solo el 1
  const n = steps(g);
  const onBeat = i % g.spb === 0;
  if (!(i === 0 || kickAt(g, part, i) || (chordChanged && onBeat))) return null;
  let len = 1;
  while (i + len < n && !kickAt(g, part, i + len) && (i + len) % (g.spb * 2) !== 0) len++;
  return { len };
}
