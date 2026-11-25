// ─────────────────────────────────────────────────────────────────────────
// Lógica pura de «La letra sigue a la banda» (live/bandFollow.js).
// El micrófono reconoce el acorde que suena; aquí se decide en qué línea de la
// letra va la banda, buscando ese acorde un poco más adelante en la hoja
// (o al principio de una sección, para repeticiones y saltos del líder).
// Sin navegador: se prueba en Node (tests/bandFollow.test.mjs).
// ─────────────────────────────────────────────────────────────────────────

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** «F#m7/C#» → { pc: 6, minor: true }; null si no es un acorde. */
export function parseChord(name) {
  const m = /^\s*([A-G])([#b]?)(.*)$/.exec(String(name || ''));
  if (!m) return null;
  let pc = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  pc = ((pc % 12) + 12) % 12;
  const rest = m[3].split('/')[0];
  if (!/^(?:maj|min|dim|aug|sus|add|m|M|°|ø|\+|-|\d|b|#|\(|\)|,)*$/.test(rest)) return null;
  const minor = /^(m(?!aj)|min|-)/.test(rest) || /^m7b5|^dim|^°/.test(rest);
  return { pc, minor };
}

export const sameChord = (a, b) => !!a && !!b && a.pc === b.pc && a.minor === b.minor;

/**
 * Lista ordenada de acordes de la hoja: [{ line, chord:{pc,minor}, section }]
 * a partir de [{ chords:['G','D'], section: bool }] (una entrada por línea).
 * Se juntan acordes repetidos seguidos.
 */
export function chordTokens(lines) {
  const out = [];
  lines.forEach((l, line) => {
    for (const name of l.chords || []) {
      const chord = parseChord(name);
      if (!chord) continue;
      const prev = out[out.length - 1];
      if (prev && sameChord(prev.chord, chord) && prev.line === line) continue;
      out.push({ line, chord, section: !!l.section && !out.some((t) => t.line === line) });
    }
  });
  return out;
}

/**
 * Siguiente posición dado el acorde oído. pos = índice de token actual (−1 al empezar).
 * Busca hacia delante (hasta `ahead` tokens); si no lo encuentra, prueba los
 * comienzos de sección (repetir el coro, volver al verso…). Devuelve el nuevo
 * índice o `pos` si no hay coincidencia clara.
 */
export function advance(tokens, pos, heard, { ahead = 6 } = {}) {
  if (!heard || !tokens.length) return pos;
  if (pos >= 0 && sameChord(tokens[pos].chord, heard)) return pos;
  for (let i = pos + 1; i <= Math.min(tokens.length - 1, pos + ahead); i++) {
    if (sameChord(tokens[i].chord, heard)) return i;
  }
  // Salto: un comienzo de sección cuyo primer acorde es el oído (el más cercano por delante, luego desde el inicio).
  const starts = tokens.map((t, i) => (t.section ? i : -1)).filter((i) => i >= 0 && sameChord(tokens[i].chord, heard));
  if (!starts.length) return pos;
  const fwd = starts.find((i) => i > pos);
  return fwd != null ? fwd : starts[0];
}
