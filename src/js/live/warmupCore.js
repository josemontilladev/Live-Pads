// ─────────────────────────────────────────────────────────────────────────
// Lógica pura del calentamiento vocal (live/warmup.js). Se prueba en Node.
// Cada ejercicio es una frase (grados de la escala mayor, en semitonos desde la
// tónica) que se canta sobre su acorde; cada vuelta sube medio tono y, al llegar
// arriba, vuelve a bajar.
// ─────────────────────────────────────────────────────────────────────────

export const EXERCISES = [
  { id: 'five', name: 'Escala de 5 notas', how: 'Con los labios vibrando («brrr») o con «mmm».', notes: [0, 2, 4, 5, 7, 5, 4, 2, 0], beat: 0.42 },
  { id: 'arp', name: 'Arpegio «mi-me-ma-mo-mu»', how: 'Una vocal por nota, boca abierta y relajada.', notes: [0, 4, 7, 12, 7, 4, 0], beat: 0.48 },
  { id: 'octave', name: 'Salto de octava «ya»', how: 'Sube la octava sin empujar: la nota de arriba suave.', notes: [0, 12, 11, 9, 7, 5, 4, 2, 0], beat: 0.42 },
  { id: 'scale', name: 'Escala completa «a»', how: 'Legato, todas las notas unidas, con aire constante.', notes: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0], beat: 0.36 },
  { id: 'breath', name: 'Respiración 4-4-8', how: 'Inhala 4 tiempos, sostén 4, suelta el aire en 8 con «sss».', notes: null, beat: 1 },
];

// Tesituras: nota MIDI más baja de inicio y cuánto subir.
export const RANGES = [
  { id: 'low', name: 'Voces graves', from: 45, to: 52 },     // La2–Mi3
  { id: 'mid', name: 'Voces medias', from: 50, to: 57 },     // Re3–La3
  { id: 'high', name: 'Voces agudas', from: 57, to: 64 },    // La3–Mi4
];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** «F#», «Bb», «Am» → clase de altura (la menor usa su tónica: el calentamiento va en mayor). */
export function tonicPc(key) {
  const m = /^\s*([A-G])([#b]?)/.exec(String(key || ''));
  if (!m) return 0;
  return ((PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)) % 12 + 12) % 12;
}

/** Primera tónica (MIDI) del ejercicio: la del tono dentro de la tesitura. */
export function startMidi(pc, rangeId) {
  const r = RANGES.find((x) => x.id === rangeId) || RANGES[1];
  let m = r.from;
  while (((m % 12) + 12) % 12 !== pc) m++;
  return m;
}

/**
 * Plan del ejercicio: [{ t, notes:[midi], dur, chord?, rep }] en segundos.
 * steps = cuántos medios tonos sube (y luego baja). speed 1 = normal.
 */
export function buildPlan(exId, pc, rangeId, { steps = 4, speed = 1 } = {}) {
  const ex = EXERCISES.find((e) => e.id === exId) || EXERCISES[0];
  if (!ex.notes) return [];
  const base = startMidi(pc, rangeId);
  const roots = [];
  for (let i = 0; i <= steps; i++) roots.push(base + i);
  for (let i = steps - 1; i >= 0; i--) roots.push(base + i);
  const beat = ex.beat / speed;
  const out = [];
  let t = 0;
  roots.forEach((root, rep) => {
    out.push({ t, notes: [root - 12, root + 4 - 12, root + 7 - 12], dur: beat * 2, chord: true, rep });   // acorde de referencia (una octava abajo)
    t += beat * 2.5;
    for (const n of ex.notes) { out.push({ t, notes: [root + n], dur: beat * 0.95, rep }); t += beat; }
    t += beat * 1.5;                                                         // respirar
  });
  return out;
}

/** Nombre de una nota MIDI en español («Do4», «Fa#3»). */
export function noteName(midi) {
  const N = ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  return N[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
