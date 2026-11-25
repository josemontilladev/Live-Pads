// ─────────────────────────────────────────────────────────────────────────
// Lógica pura de «La caja de ritmos sigue la canción» (live/grooveFollow.js).
// Se prueba en Node (tests/grooveFollow.test.mjs).
// ─────────────────────────────────────────────────────────────────────────

/** Sección del espectro → parte del ritmo. */
export function partForLabel(label) {
  const l = String(label || '').toLowerCase();
  if (/^intro/.test(l)) return 'intro';
  if (/^puente|bridge/.test(l)) return 'C';
  if (/^(coro|estribillo|chorus|tag|repetir|post)/.test(l)) return 'B';
  if (/^(instrumental|interludio|solo)/.test(l)) return 'B';
  return 'A';   // verso, pre coro, final, vamp…
}

/** Índice del pulso más cercano a t (array ordenado), o -1. */
export function nearestIdx(arr, t) {
  if (!arr || !arr.length) return -1;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(arr[lo - 1] - t) <= Math.abs(arr[lo] - t)) lo--;
  return lo;
}
/** Primer elemento ≥ t (o null). */
export function firstAtOrAfter(arr, t) {
  for (const x of arr || []) if (x >= t - 1e-6) return x;
  return null;
}

/**
 * Qué pedir al ritmo ahora. mt = tiempo de la pista; barSec = duración de un compás.
 * → { part }      la parte que debe sonar ya (si no suena),
 *   { fillThen }  redoble en el compás que empieza y luego esa parte (antes de una sección nueva),
 *   null          nada que hacer.
 * done = Set de ids de secciones ya preparadas (para pedir el redoble una sola vez).
 */
export function followStep(markers, mt, barSec, { current, fills = true, done = new Set() } = {}) {
  const ms = (markers || []).filter((m) => Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
  if (!ms.length) return null;
  let cur = null, next = null;
  for (const m of ms) { if (m.t <= mt + 0.05) cur = m; else { next = m; break; } }
  let want = partForLabel(cur ? cur.label : ms[0].label);
  if (next) {
    const id = next.id || `${next.label}@${next.t}`;
    const nextPart = partForLabel(next.label);
    const ahead = next.t - mt;
    // El cambio ya está preparado (redoble en curso o parte pedida): lo que toca es la sección nueva.
    if (done.has(id) && ahead <= barSec * 2.1) want = nextPart;
    // Faltan entre 1 y 2 compases: el próximo compás es el último → redoble y luego la sección nueva.
    if (fills && !done.has(id) && ahead <= barSec * 2.05 && ahead > barSec * 0.9 && nextPart !== want) {
      done.add(id);
      return { fillThen: nextPart };
    }
    // Sin redoble: pedir la parte nueva un compás antes (entra justo en la sección).
    if (!fills && !done.has(id) && ahead <= barSec * 1.05 && nextPart !== current) {
      done.add(id);
      return { part: nextPart };
    }
  }
  if (want !== current) return { part: want };
  return null;
}
