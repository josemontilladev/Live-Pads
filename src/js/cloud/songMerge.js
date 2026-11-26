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

import { mergeNotes, notesSig } from '../live/bandNotesCore.js';
import { cleanArrangements } from '../live/songMapCore.js';

export const SYNC_FIELDS = ['title', 'artist', 'lyrics', 'bpm', 'key', 'genre', 'tags', 'favorite', 'showChords', 'timeSig', 'youtubeUrl', 'markers', 'singerKeys', 'bandNotes', 'arrangements'];

export const FIELD_LABELS = {
  title: 'título', artist: 'artista', lyrics: 'letra', bpm: 'BPM', key: 'tono', genre: 'género',
  tags: 'etiquetas', favorite: 'favorita', showChords: 'acordes', timeSig: 'compás', youtubeUrl: 'video', markers: 'secciones', singerKeys: 'tonos por cantante', bandNotes: 'notas para la banda', arrangements: 'mapa de la canción',
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
    case 'title': case 'artist': case 'youtubeUrl': case 'singerKeys': return String(v || '').trim();
    case 'tags': return toTags(v).join(',');
    case 'favorite': case 'showChords': return !!v;
    case 'timeSig': return String(v || '4/4');
    case 'markers': return JSON.stringify(Array.isArray(v) ? v : []);
    case 'bandNotes': return notesSig(v);
    case 'arrangements': return JSON.stringify(cleanArrangements(v));
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
    // Notas para la banda: se suman las de los dos lados (nunca es conflicto).
    if (f === 'arrangements' && t === undefined) { fields[f] = m; continue; }   // la nube no sabe de mapas: no se tocan
    if (f === 'bandNotes') { fields[f] = t === undefined ? m : same(f, m, t) ? t : mergeNotes(b, m, t); continue; }
    if (same(f, m, t)) fields[f] = t;            // ya coinciden
    else if (same(f, b, m)) fields[f] = t;       // solo cambió la nube
    else if (same(f, b, t)) fields[f] = m;       // solo cambié yo
    else { fields[f] = m; conflicts.push(f); }   // ambos, distinto
  }
  return { fields, conflicts };
}

// Al aplicar una fila de la nube, este equipo conserva SUS rutas de secuencia y
// original (pueden ser locales y aún no subidas). Pero las VOCES de referencia
// (audio.voices: 2.ª, 3.ª voz… grabadas desde GI App) solo se editan en el móvil:
// las de la nube mandan siempre. Antes se descartaban con el resto del audio de la
// nube y, al subir después cualquier cambio de esa canción, se borraban para todos.
export function keepLocalAudio(localAudio, incomingAudio, localDirty = false) {
  const hasLocal = localAudio && (localAudio.sequence || localAudio.original);
  const stems = mergeStems(localAudio, incomingAudio, localDirty);
  if (!hasLocal) {
    const base = incomingAudio || localAudio || { sequence: null, original: null };
    if (stems === undefined) return base;
    const out = { ...base };
    if (stems) out.stems = stems; else delete out.stems;
    return out;
  }
  const out = { ...localAudio };
  const voices = incomingAudio && Array.isArray(incomingAudio.voices) ? incomingAudio.voices : null;
  if (voices && voices.length) out.voices = voices; else delete out.voices;
  if (stems !== undefined) { if (stems) out.stems = stems; else delete out.stems; }
  return out;
}

// Pistas separadas de la canción (audio.stems) al aplicar una fila de la nube.
// Devuelve la lista final, null (sin pistas) o undefined (no tocar lo que haya).
//  · La nube no dice nada de pistas (fila antigua, o subida por un equipo que
//    aún no las conocía) → se conservan las locales: nunca se borran por omisión.
//  · Mi copia tiene cambios sin subir → se juntan: las mías más las de la nube
//    que yo no tenga.
//  · Estoy al día → manda la nube (así también llega que alguien quitó una).
function mergeStems(localAudio, incomingAudio, localDirty) {
  const valid = (list) => (Array.isArray(list) ? list.filter((x) => x && x.url) : []);
  const local = valid(localAudio && localAudio.stems);
  const cloudSays = !!incomingAudio && Array.isArray(incomingAudio.stems);
  if (!cloudSays) return local.length ? local : undefined;
  const cloud = valid(incomingAudio.stems);
  if (!localDirty) return cloud.length ? cloud : null;
  const seen = new Set(local.map((x) => x.url));
  const out = local.concat(cloud.filter((x) => !seen.has(x.url)));
  return out.length ? out : null;
}

// Tono ligado del audio (keyPitch) al aplicar una fila de la nube: es del equipo,
// como el tono de la tarjeta. Si la nube lo trae y mi copia no tiene cambios sin
// subir, manda el de la nube (pitch = keyPitch); si no lo trae (fila de una
// versión anterior), se queda el local.
export function adoptCloudKeyPitch(audio, incomingAudio, localDirty = false) {
  if (localDirty || !incomingAudio) return audio;
  const v = incomingAudio.keyPitch;
  if (v === undefined || v === null || v === '') return audio;
  const kp = Number(v) || 0;
  return { ...(audio || {}), keyPitch: kp, pitch: kp, keyPitchSet: !!incomingAudio.keyPitchSet };
}
