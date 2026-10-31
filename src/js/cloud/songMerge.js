// Fusión de tres vías de una canción (sin dependencias: se prueba en Node).
//
// `base` es la copia de la canción tal como estaba la última vez que este equipo
// y la nube coincidieron (se guarda al sincronizar: song.syncBase). Si yo y otro
// miembro cambiamos campos DISTINTOS desde entonces, se juntan los dos cambios
// sin preguntar. Solo es conflicto cuando ambos cambiamos el MISMO campo a
// valores distintos.
//
//   mergeSong(base, mine, theirs) → { fields, conflicts: ['lyrics', …] }
//     fields = valores fusionados de los campos compartidos

export const SYNC_FIELDS = ['title', 'artist', 'lyrics', 'bpm', 'key', 'genre', 'tags', 'favorite', 'showChords', 'timeSig', 'youtubeUrl', 'markers'];

export const FIELD_LABELS = {
  title: 'título', artist: 'artista', lyrics: 'letra', bpm: 'BPM', key: 'tono', genre: 'género',
  tags: 'etiquetas', favorite: 'favorita', showChords: 'acordes', timeSig: 'compás', youtubeUrl: 'video', markers: 'secciones',
};

function toTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

// Forma canónica de cada campo para comparar (así "120" y 120, o un video con
// espacios, no cuentan como cambio).
function canon(field, v) {
  switch (field) {
    case 'title': case 'artist': case 'youtubeUrl': return String(v || '').trim();
    case 'tags': return toTags(v).join(',');
    case 'favorite': case 'showChords': return !!v;
    case 'timeSig': return String(v || '4/4');
    case 'markers': return JSON.stringify(Array.isArray(v) ? v : []);
    default: return String(v == null ? '' : v);
  }
}

const same = (field, a, b) => canon(field, a) === canon(field, b);

/** Copia de los campos compartidos (lo que se guarda como song.syncBase). */
export function snapshot(s) {
  const out = {};
  for (const f of SYNC_FIELDS) {
    const v = s ? s[f] : undefined;
    out[f] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : (v === undefined ? null : v);
  }
  return out;
}

export function mergeSong(base, mine, theirs) {
  const fields = {};
  const conflicts = [];
  for (const f of SYNC_FIELDS) {
    const b = base ? base[f] : undefined, m = mine[f], t = theirs[f];
    if (same(f, m, t)) fields[f] = t;            // ya coinciden
    else if (same(f, b, m)) fields[f] = t;       // solo cambió la nube
    else if (same(f, b, t)) fields[f] = m;       // solo cambié yo
    else { fields[f] = m; conflicts.push(f); }   // ambos, distinto
  }
  return { fields, conflicts };
}
