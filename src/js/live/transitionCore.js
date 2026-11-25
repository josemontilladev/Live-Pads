// ─────────────────────────────────────────────────────────────────────────
// Transición entre tonos (cálculo puro; probado en tests/transition.test.mjs).
// Del tono actual al de la siguiente canción, con la cadencia más natural:
//   tono actual → acorde puente (uno que exista en los DOS tonos) → V del nuevo
//   tono (dominante) → nuevo tono.
// Si no hay acorde común, se va directo por la dominante.
// ─────────────────────────────────────────────────────────────────────────

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_PC = new Set([5, 10, 3, 8, 1, 6]);
const mod = (v) => ((v % 12) + 12) % 12;

export function parseKeyName(k) {
  const m = String(k || '').trim().match(/^([A-G][#b]?)(m(?!aj)|min|-)?/);
  if (!m || PC[m[1]] == null) return null;
  return { pc: PC[m[1]], minor: !!m[2] };
}

// Acordes de un tono como { pc, minor } (mayor: I ii iii IV V vi; menor: i III iv v VI VII).
function diatonic(k) {
  const d = k.minor ? [[0, 1], [3, 0], [5, 1], [7, 1], [8, 0], [10, 0]] : [[0, 0], [2, 1], [4, 1], [5, 0], [7, 0], [9, 1]];
  return d.map(([i, mi]) => ({ pc: mod(k.pc + i), minor: !!mi }));
}
const same = (a, b) => a.pc === b.pc && a.minor === b.minor;

/** Plan de la transición: [{ pc, minor, role, name }] (vacío si el tono no cambia). */
export function planTransition(fromKey, toKey) {
  const a = parseKeyName(fromKey), b = parseKeyName(toKey);
  if (!a || !b || (a.pc === b.pc && a.minor === b.minor)) return [];
  // Notación del tono NUEVO tal como está escrito (F# con sostenidos, Gb con bemoles); si no lo dice, la habitual.
  const tk = String(toKey).trim();
  const names = tk[1] === '#' ? SHARP : tk[1] === 'b' ? FLAT : (FLAT_PC.has(b.pc) ? FLAT : SHARP);
  const fromChords = diatonic(a);
  // Acorde puente: preferimos IV, ii o vi del tono nuevo que también exista en el actual.
  const tgt = b.minor ? [{ pc: mod(b.pc + 5), minor: true }, { pc: mod(b.pc + 8), minor: false }, { pc: mod(b.pc + 3), minor: false }]
    : [{ pc: mod(b.pc + 5), minor: false }, { pc: mod(b.pc + 2), minor: true }, { pc: mod(b.pc + 9), minor: true }];
  const pivot = tgt.find((c) => fromChords.some((f) => same(f, c)) && !(c.pc === a.pc && c.minor === a.minor));
  const steps = [{ ...a, role: 'actual' }];
  if (pivot) steps.push({ ...pivot, role: 'puente' });
  steps.push({ pc: mod(b.pc + 7), minor: false, role: 'dominante', seventh: true });
  steps.push({ ...b, role: 'nuevo' });
  return steps.map((s) => ({ ...s, name: names[s.pc] + (s.minor ? 'm' : '') + (s.seventh ? '7' : '') }));
}
