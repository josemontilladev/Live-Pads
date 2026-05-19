// Genre filter counters for the Library tab — populates the count chips
// in the filter dropdown (Todas / Alabanza / Adoración).

import { q } from '../utils/dom.js';

// Genre matching is accent-insensitive and lowercase so "Adoración" and
// "adoracion" both bucket into the same count.
function normalizeGenre(s) {
  return s ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
}

function countByGenre(songs, needle) {
  let c = 0;
  for (const s of songs) {
    if (normalizeGenre(s.genre).includes(needle)) c++;
  }
  return c;
}

// Refresh the three count chips (Todas / Alabanza / Adoración) inside the
// filter dropdown menu. Call after any mutation of the song catalog.
export function updateFilterCounts(songs) {
  const total     = songs.length;
  const alabanzas = countByGenre(songs, 'alabanza');
  const adoracion = countByGenre(songs, 'adoracion');

  const cAll = q('#gi-filter-count-all');
  if (cAll) cAll.textContent = String(total);
  const cAla = q('#gi-filter-count-alabanza');
  if (cAla) cAla.textContent = String(alabanzas);
  const cAdo = q('#gi-filter-count-adoracion');
  if (cAdo) cAdo.textContent = String(adoracion);
}
