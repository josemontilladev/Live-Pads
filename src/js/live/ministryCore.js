// Progresiones del modo ministración (cálculo puro; probado en tests/ministry.test.mjs).
// Grados en mayor; en un tono menor se usan sus equivalentes (i, VI, III, VII…).

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const FLAT_PC = new Set([5, 10, 3, 8, 1, 6]);

export const PROGRESSIONS = [
  { id: 'pop', label: 'I – V – vi – IV', major: [[0, 0], [7, 0], [9, 1], [5, 0]], minor: [[0, 1], [10, 0], [8, 0], [3, 0]] },
  { id: 'worship', label: 'I – IV', major: [[0, 0], [5, 0]], minor: [[0, 1], [5, 1]] },
  { id: 'vi', label: 'vi – IV – I – V', major: [[9, 1], [5, 0], [0, 0], [7, 0]], minor: [[0, 1], [8, 0], [3, 0], [10, 0]] },
  { id: 'fifties', label: 'I – vi – IV – V', major: [[0, 0], [9, 1], [5, 0], [7, 0]], minor: [[0, 1], [8, 0], [5, 1], [7, 0]] },
  { id: 'two', label: 'IV – I (plagal)', major: [[5, 0], [0, 0]], minor: [[5, 1], [0, 1]] },
  { id: 'drone', label: 'Solo el tono (sostener)', major: [[0, 0]], minor: [[0, 1]] },
];

/** Acordes de una progresión en un tono: [{ pc, minor, name }]. */
export function progressionChords(key, id) {
  const m = String(key || '').trim().match(/^([A-G][#b]?)(m(?!aj)|min|-)?/);
  const p = PROGRESSIONS.find((x) => x.id === id) || PROGRESSIONS[0];
  if (!m || PC[m[1]] == null) return [];
  const root = PC[m[1]], minor = !!m[2];
  const names = m[1][1] === '#' ? SHARP : m[1][1] === 'b' ? FLAT : (FLAT_PC.has(root) ? FLAT : SHARP);
  return (minor ? p.minor : p.major).map(([i, mi]) => {
    const pc = (root + i) % 12;
    return { pc, minor: !!mi, name: names[pc] + (mi ? 'm' : '') };
  });
}
