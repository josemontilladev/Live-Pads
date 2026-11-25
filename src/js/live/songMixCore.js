// Lógica pura de la mezcla por canción (live/songMix.js). Se prueba en Node.

/** Clave estable de una canción (la de la nube si la tiene, para que valga en todos sus equipos). */
export const mixKeyOf = (s) => String((s && (s.cloudId || s.id)) ?? '');

/** Mezcla que toca: la de la canción si tiene; si no, la general (o nada). */
export function pickMix(all, key) {
  if (!all) return null;
  if (key && all.songs && all.songs[key]) return all.songs[key];
  return all.general || null;
}
