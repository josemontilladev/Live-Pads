// Aviso entre canciones (puro; tests/nextCue.test.mjs): qué decir de la siguiente canción
// del servicio y cuándo enseñarlo.

export const CUE_LEAD_S = 20;          // se enseña en los últimos 20 s de la canción…
export const CUE_AFTER_MS = 120000;    // …y hasta 2 min después de terminar (si no entra otra)

/**
 * ¿Se enseña ahora? state = { remaining (s, o null), playing, endedAt (ms o 0), now }
 */
export function cueVisible({ remaining, playing, endedAt, now, dismissedFor, key }) {
  if (dismissedFor && dismissedFor === key) return false;
  if (endedAt && now - endedAt < CUE_AFTER_MS) return true;
  return !!(playing && Number.isFinite(remaining) && remaining <= CUE_LEAD_S && remaining >= 0);
}

/**
 * Contenido del aviso.
 * next = { title, artist, bpm }, key = tono del día, capo = { capo, shape } | null,
 * notes = textos de la banda para el principio de esa canción.
 */
export function cueContent({ next, key, capo, notes = [], remaining = null, playing = false }) {
  if (!next) return null;
  const lines = [];
  if (capo && capo.capo) lines.push(`Guitarra: cejilla ${capo.capo} (formas de ${capo.shape})`);
  for (const n of notes.slice(0, 3)) lines.push(n);
  const bpm = Number(next.bpm);
  return {
    title: String(next.title || 'Siguiente canción'),
    meta: [key, bpm > 0 ? `${Math.round(bpm)} BPM` : ''].filter(Boolean).join(' · '),
    lines,
    inSec: playing && Number.isFinite(remaining) ? Math.max(0, Math.round(remaining)) : null,
  };
}
