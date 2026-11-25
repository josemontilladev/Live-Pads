// Cálculo puro de los medleys (live/medley.js); probado en tests/medley.test.mjs.

/** Segundo en que se sale de la canción: la sección marcada o el final de la pista. */
export function medleyExitAt(link, duration) {
  if (!link) return NaN;
  if (Number.isFinite(link.out) && link.out > 0) return link.out;
  return Number.isFinite(duration) && duration > 0 ? duration - 0.15 : NaN;
}
