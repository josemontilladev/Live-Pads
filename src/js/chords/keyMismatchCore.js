// ¿La grabación suena en otro tono que la canción? (puro; tests/keyMismatch.test.mjs)
// Compara los acordes de la letra (escritos en el tono de la tarjeta) con los que se oyen
// en la pista. keyOffset() da k = tono de la letra − tono de la grabación (en semitonos):
// si el audio ya se mueve `total` semitonos y k ≠ total, la pista suena en otro tono.
import { keyOffset } from '../ui/songStructure.js';

const norm = (d) => { const m = ((Math.round(d) % 12) + 12) % 12; return m > 6 ? m - 12 : m; };   // −5…+6

/**
 * lyr = parseLyricStructure(letra), det = acordes detectados de la grabación, total = semitonos
 * que ya se mueve el audio. → { delta } (semitonos que habría que mover además) o null si cuadra
 * o no hay datos claros.
 */
export function keyMismatch(lyr, det, total = 0) {
  if (!Array.isArray(lyr) || !lyr.some((x) => x.chords && x.chords.length) || !Array.isArray(det) || det.length < 8) return null;
  const best = keyOffset(lyr, det);
  if (!best || !(best.score > 0)) return null;
  const pref = keyOffset(lyr, det, total);      // devuelve `total` si encaja casi igual de bien
  if (((pref.k - total) % 12 + 12) % 12 === 0) return null;
  const delta = norm(best.k - total);
  return delta ? { delta, score: best.score } : null;
}

/** «bajar 1 tono», «subir medio tono», «bajar 3 semitonos». */
export function deltaText(d) {
  const a = Math.abs(d), dir = d < 0 ? 'Bajar' : 'Subir';
  if (a === 1) return `${dir} medio tono`;
  if (a === 2) return `${dir} 1 tono`;
  if (a === 4) return `${dir} 2 tonos`;
  return `${dir} ${a} semitonos`;
}
