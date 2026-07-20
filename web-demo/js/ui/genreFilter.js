// Genre filter counters for the Library tab — populates the count chips
// in the filter dropdown (Todas / Alabanza / Adoración).

import { q } from '../utils/dom.js';
import { isRecentSong } from '../state/store.js';

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
  const favorites = songs.reduce((n, s) => n + (s.favorite ? 1 : 0), 0);
  const now = Date.now();
  const recientes = songs.reduce((n, s) => n + (isRecentSong(s, now) ? 1 : 0), 0);

  const cAll = q('#gi-filter-count-all');
  if (cAll) cAll.textContent = String(total);
  const cRec = q('#gi-filter-count-recientes');
  if (cRec) cRec.textContent = String(recientes);
  const cAla = q('#gi-filter-count-alabanza');
  if (cAla) cAla.textContent = String(alabanzas);
  const cAdo = q('#gi-filter-count-adoracion');
  if (cAdo) cAdo.textContent = String(adoracion);
  const cFav = q('#gi-filter-count-favoritos');
  if (cFav) cFav.textContent = String(favorites);
}
