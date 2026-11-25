// Acordes para cada músico (Companion): el mismo acorde escrito como lo necesita cada instrumento.
//   chords  → como están (teclado, guitarra sin cejilla)
//   capo    → guitarra con cejilla N: las FORMAS a tocar (C con cejilla 2 → «Bb»)
//   bass    → bajo: solo la nota base (G/B → B; Am7 → A)
//   bb      → vientos en Si♭ (trompeta, clarinete, saxo tenor): +2 semitonos
//   eb      → vientos en Mi♭ (saxo alto, barítono): +9 semitonos
//   nums    → grados (1·4·5) respecto al tono de la canción
// Sin dependencias: se carga en el navegador del móvil y en las pruebas de Node.
(function (root) {
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'E#': 5, Fb: 4, 'B#': 0 };
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const DEG = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
  const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]);       // F Bb Eb Ab Db Gb (mayores)
  const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);      // Dm Gm Cm Fm Bbm Ebm
  const mod = (v) => ((v % 12) + 12) % 12;
  const RE = /^([A-G])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|\d|\+|-|°|º|ø|#|b|\(|\)|,)*)(?:\/([A-G])([#b]?))?$/;

  function keyInfo(key) {
    const m = String(key || '').trim().match(/^([A-G])([#b]?)(.*)$/);
    if (!m || PC[m[1] + m[2]] == null) return null;
    return { pc: PC[m[1] + m[2]], minor: /^(m(?!aj)|min|-)/.test(m[3].trim()) };
  }
  function names(pc, minor) { return (minor ? FLAT_MINOR : FLAT_KEYS).has(mod(pc)) ? FLAT : SHARP; }

  /** Desplazamiento (semitonos) que aplica cada vista. */
  function shiftFor(mode, capo) {
    if (mode === 'capo') return -Math.max(0, Math.min(11, capo | 0));
    if (mode === 'bb') return 2;
    if (mode === 'eb') return 9;
    return 0;
  }

  /** Tono escrito para esa vista (p. ej. G con cejilla 2 → F; C en Si♭ → D). */
  function viewKey(key, mode, capo) {
    const k = keyInfo(key);
    if (!k) return key || '';
    const pc = mod(k.pc + shiftFor(mode, capo));
    return names(pc, k.minor)[pc] + (k.minor ? 'm' : '');
  }

  /** Un acorde visto por un instrumento. null si no es un acorde (se deja igual). */
  function chordFor(chord, { mode = 'chords', capo = 0, nums = false, key = '' } = {}) {
    const m = String(chord || '').trim().match(RE);
    if (!m || PC[m[1] + m[2]] == null) return null;
    const root = PC[m[1] + m[2]], bass = m[4] ? PC[m[4] + m[5]] : null;
    const k = keyInfo(key);
    if (nums && k) {
      if (mode === 'bass') return DEG[mod((bass ?? root) - k.pc)];
      return DEG[mod(root - k.pc)] + m[3] + (bass != null ? '/' + DEG[mod(bass - k.pc)] : '');
    }
    const sh = shiftFor(mode, capo);
    const tk = k ? mod(k.pc + sh) : null;
    const N = k ? names(tk, k.minor) : (m[2] === 'b' ? FLAT : SHARP);
    if (mode === 'bass') return N[mod((bass ?? root) + sh)];
    return N[mod(root + sh)] + m[3] + (bass != null ? '/' + N[mod(bass + sh)] : '');
  }

  // Cejilla sugerida para el tono (formas abiertas G C D A E · Em Am Dm). Misma regla
  // que src/js/utils/capo.js en la app (tests/capo.test.mjs las compara).
  const SHAPES_MAJOR = { 7: ['G', 0], 0: ['C', 0], 2: ['D', 0], 9: ['A', 1], 4: ['E', 1] };
  const SHAPES_MINOR = { 4: ['Em', 0], 9: ['Am', 0], 2: ['Dm', 1] };
  function bestCapo(key) {
    const k = keyInfo(key);
    if (!k) return null;
    const table = k.minor ? SHAPES_MINOR : SHAPES_MAJOR;
    let best = null;
    for (let capo = 0; capo <= 7; capo++) {
      const s = table[mod(k.pc - capo)];
      if (!s) continue;
      const cost = s[1] + capo * 0.5;
      if (!best || cost < best.cost) best = { capo, shape: s[0], cost };
    }
    return best ? { capo: best.capo, shape: best.shape } : null;
  }

  const api = { chordFor, viewKey, keyInfo, bestCapo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LPInstrument = api;
})(typeof window !== 'undefined' ? window : globalThis);
