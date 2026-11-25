// ─────────────────────────────────────────────────────────────────────────
// Grados / números Nashville: «C – G – Am – F» en C se lee «1 – 5 – 6m – 4».
// Si el líder cambia de tono a última hora, la banda no tiene que transponer de
// cabeza: los números son los mismos en cualquier tono.
//
// · Se cuenta desde la tónica del tono de la canción (en menor, desde la tónica
//   menor: en Dm, Dm = 1m, C = b7, F = b3).
// · Se conserva el sufijo del acorde (m, 7, maj7, sus4…) y el bajo: G/B en C → 5/7.
// · Preferencia global (todas las vistas de letra, también la ventana de la TV):
//   cada acorde se pinta con su nombre Y su número, y la clase «chord-nums» en
//   <html> decide cuál se ve (cambio instantáneo, sin volver a pintar).
// Puro salvo las funciones de preferencia; probado en tests/chordNumbers.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, 'E#': 5, Fb: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0 };
const DEG = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
const mod12 = (v) => ((v % 12) + 12) % 12;

/** Tónica de un tono («G», «F#m», «Bb», «Sol»…) → { pc, minor } o null. */
export function keyTonic(key) {
  const s = String(key || '').trim()
    .replace(/^Do/i, 'C').replace(/^Re/i, 'D').replace(/^Mi/i, 'E').replace(/^Fa/i, 'F')
    .replace(/^Sol/i, 'G').replace(/^La/i, 'A').replace(/^Si/i, 'B');
  const m = s.match(/^([A-G])([#b♯♭]?)(.*)$/);
  if (!m) return null;
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  const pc = PC[m[1] + acc];
  if (pc == null) return null;
  const rest = m[3].trim().toLowerCase();
  const minor = /^(m(?!aj)|min|-)/.test(rest) || rest.startsWith('menor');
  return { pc, minor };
}

/** Acorde («Am7», «G/B», «F#sus4») → su número en el tono («6m7», «5/7», «#4sus4»). null si no es un acorde. */
export function chordNumber(chord, key) {
  const t = typeof key === 'object' && key ? key : keyTonic(key);
  if (!t) return null;
  // Sufijo: solo lo que puede llevar un acorde (así «Coro» no se lee como C + «oro»).
  const m = String(chord || '').trim().match(/^([A-G])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|\d|\+|-|°|º|ø|#|b|\(|\)|,)*)(?:\/([A-G])([#b]?))?$/);
  if (!m) return null;
  const root = PC[m[1] + m[2]];
  if (root == null) return null;
  let out = DEG[mod12(root - t.pc)] + m[3];
  if (m[4]) {
    const bass = PC[m[4] + m[5]];
    if (bass == null) return null;
    out += '/' + DEG[mod12(bass - t.pc)];
  }
  return out;
}

// ── Preferencia (todas las vistas) ──
export const NUMS_KEY = 'livepads.chordNumbers';
export function chordNumbersOn() {
  try { return localStorage.getItem(NUMS_KEY) === '1'; } catch (_) { return false; }
}
export function applyChordNumbers(doc = document) {
  try { doc.documentElement.classList.toggle('chord-nums', chordNumbersOn()); } catch (_) {}
}
export function setChordNumbers(on) {
  try { localStorage.setItem(NUMS_KEY, on ? '1' : '0'); } catch (_) {}
  applyChordNumbers();
  try { window.dispatchEvent(new CustomEvent('livepads:chord-numbers', { detail: { on: !!on } })); } catch (_) {}
}
