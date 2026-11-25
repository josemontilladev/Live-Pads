// ─────────────────────────────────────────────────────────────────────────
// Contador de repeticiones en vivo: «Coro 2/3». Cuenta las veces que se canta
// cada sección (por tipo: coro, puente…) en esta pasada de la canción, también
// las repeticiones hechas con «Arreglo», y cuántas van a ser en total.
//   · Un salto atrás que cae en un coro cuenta como otra vez (repetición).
//   · Saltar adelante a mano no confunde la cuenta: nunca baja de la posición del
//     coro en la canción (el 3.er coro marcado es, como poco, la 3.ª vez).
//   · Volver al principio (antes de 1,5 s) empieza la cuenta de nuevo.
//   · Solo se muestra si esa sección sale 2 o más veces y su nombre no lleva ya
//     número («Verso 2» ya lo dice).
// Puro: probado en tests/sectionCount.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import { detectSectionHeader } from '../ui/lyricsFormat.js';

function kind(label) {
  const h = detectSectionHeader(String(label || ''));
  if (h) return { canon: h.canon, num: h.num || '' };
  const s = String(label || '').trim().toLowerCase();
  const m = s.match(/(\d+)\s*$/);
  return { canon: s.replace(/\d+\s*$/, '').trim(), num: m ? m[1] : '' };
}

export function createSectionCounter() {
  let lastIdx = -1, lastT = 0, lastKey = null;
  const counts = new Map();
  const reset = () => { lastIdx = -1; counts.clear(); };

  /** markers ordenadas por t. → { label, n, total, show } o null (antes de la 1.ª sección). */
  function update(markers, t, songKey = '') {
    if (songKey !== lastKey) { lastKey = songKey; reset(); lastT = t; }
    const back = t < lastT - 0.5;
    if (back && t < 1.5) reset();
    let idx = -1;
    for (let i = 0; i < markers.length; i++) { if (markers[i].t <= t + 0.05) idx = i; else break; }
    const entered = idx >= 0 && (idx !== lastIdx || (back && t - markers[idx].t < 2.5));
    lastT = t;
    if (idx < 0) { lastIdx = -1; return null; }
    const k = kind(markers[idx].label);
    const planned = markers.filter((m) => kind(m.label).canon === k.canon).length;
    // Posición de este coro entre los marcados (el 2.º coro de la canción = 2).
    const occ = markers.slice(0, idx + 1).filter((m) => kind(m.label).canon === k.canon).length;
    if (entered) {
      counts.set(k.canon, Math.max((counts.get(k.canon) || 0) + 1, occ));
      lastIdx = idx;
    }
    const n = counts.get(k.canon) || occ;
    // Lo previsto más las repeticiones hechas (lo que se va por delante de la posición).
    const total = planned + Math.max(0, n - occ);
    return { label: markers[idx].label, n, total, show: total >= 2 && !k.num };
  }
  return { update, reset };
}
