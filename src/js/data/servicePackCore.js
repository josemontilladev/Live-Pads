// ─────────────────────────────────────────────────────────────────────────
// Paquete del servicio sin conexión: qué viaja de cada canción y cómo se junta
// con la librería del otro portátil. Puro (probado en tests/servicePack.test.mjs).
// ─────────────────────────────────────────────────────────────────────────

// Datos internos de cada equipo que no tienen sentido en otro portátil.
const LOCAL_ONLY = ['serviceId', 'syncHash', 'syncBase', 'cloudUpdatedAt', 'updatedBy', 'updatedByName', 'libraryId'];

/** Copia de la canción para el paquete (sin las pistas separadas, que no viajan). */
export function packSong(song) {
  const s = JSON.parse(JSON.stringify(song || {}));
  for (const k of LOCAL_ONLY) delete s[k];
  if (s.audio) delete s.audio.stems;
  return s;
}

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** La canción de la librería que corresponde a una del paquete (por nube, id, o título + artista). */
export function findInLibrary(lib, s) {
  return (s.cloudId && lib.find((x) => x.cloudId && String(x.cloudId) === String(s.cloudId)))
    || (s.id != null && lib.find((x) => String(x.id) === String(s.id) && norm(x.title) === norm(s.title)))
    || lib.find((x) => norm(x.title) === norm(s.title) && norm(x.artist) === norm(s.artist))
    || null;
}

/**
 * Junta las canciones del paquete con la librería. La versión de la librería manda
 * (no se pisa nada de lo que ya hay); solo se rellena lo que le falta: audios, letra,
 * secciones, notas. Las que no están se añaden.
 *   → { songs: [canción de la librería por cada una del paquete], added: [], filled: n }
 */
export function mergePack(lib, packSongs, now = Date.now()) {
  const out = [], added = [];
  let filled = 0;
  const ids = new Set(lib.map((x) => String(x.id)));
  packSongs.forEach((raw, i) => {
    const s = packSong(raw);
    const have = findInLibrary(lib.concat(added), s);
    if (have) {
      let changed = false;
      have.audio = have.audio || {};
      for (const slot of ['sequence', 'original']) if (!have.audio[slot] && s.audio && s.audio[slot]) { have.audio[slot] = s.audio[slot]; changed = true; }
      if ((!Array.isArray(have.audio.voices) || !have.audio.voices.length) && s.audio && Array.isArray(s.audio.voices) && s.audio.voices.length) { have.audio.voices = s.audio.voices; changed = true; }
      if (!String(have.lyrics || '').trim() && s.lyrics) { have.lyrics = s.lyrics; changed = true; }
      if ((!Array.isArray(have.markers) || !have.markers.length) && Array.isArray(s.markers) && s.markers.length) { have.markers = s.markers; changed = true; }
      if ((!Array.isArray(have.bandNotes) || !have.bandNotes.length) && Array.isArray(s.bandNotes) && s.bandNotes.length) { have.bandNotes = s.bandNotes; changed = true; }
      if (!have.cover && s.cover) { have.cover = s.cover; changed = true; }
      if (changed) filled++;
      out.push(have);
      return;
    }
    const fresh = { ...s };
    if (fresh.id == null || ids.has(String(fresh.id))) fresh.id = `song_pack_${now}_${i}`;
    // Viene de la nube de OTRO equipo: aquí es una canción nueva de esta librería.
    delete fresh.cloudId;
    fresh.addedAt = now;
    ids.add(String(fresh.id));
    added.push(fresh);
    out.push(fresh);
  });
  return { songs: out, added, filled };
}
