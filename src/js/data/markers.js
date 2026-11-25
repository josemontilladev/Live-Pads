// ─────────────────────────────────────────────────────────────────────────
// Secciones de una canción POR PISTA. La secuencia y el original no duran igual
// ni empiezan igual (cuenta, compases de más…): las secciones marcadas en una no
// sirven en la otra. Cada sección lleva `src: 'sequence' | 'original'`; las
// antiguas (sin `src`) se siguen usando en la pista que aún no tenga las suyas.
// Todo viaja en el mismo campo `markers` (la nube no cambia).
// ─────────────────────────────────────────────────────────────────────────

export const markerSrc = (type) => (type === 'sequence' || type === 'original' ? type : '');

/** Secciones de la canción para la pista `type` (las suyas o, si no tiene, las antiguas). */
export function markersFor(song, type) {
  const all = song && Array.isArray(song.markers) ? song.markers.filter((m) => m && Number.isFinite(m.t)) : [];
  const src = markerSrc(type);
  if (src) {
    const mine = all.filter((m) => m.src === src);
    if (mine.length) return mine;
  }
  const legacy = all.filter((m) => !m.src);
  if (legacy.length || src) return legacy;
  return all;
}

/** Sustituye las secciones de la pista `type` (deja intactas las de la otra y las antiguas). */
export function withMarkersFor(song, type, list) {
  const src = markerSrc(type);
  const all = Array.isArray(song.markers) ? song.markers : [];
  if (!src) return list.map((m) => { const c = { ...m }; delete c.src; return c; }).concat(all.filter((m) => m && m.src));
  return all.filter((m) => m && m.src !== src).concat(list.map((m) => ({ ...m, src })));
}
