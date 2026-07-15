// ─────────────────────────────────────────────────────────────────────────
// Datos del repertorio para la PWA (solo lectura).
// Mismas tablas que la app de escritorio: libraries, songs, setlists.
// El audio/carátulas se firman con la Edge Function r2-sign (op:'get').
// ─────────────────────────────────────────────────────────────────────────

import { rest, invokeFunction } from './supabase.js';

const LIB_KEY = 'lpm-active-library';
const SONGS_CACHE = 'lpm-songs-cache'; // pinta al instante sin red

export function getActiveLibraryId() {
  try { return localStorage.getItem(LIB_KEY) || null; } catch (_) { return null; }
}
export function setActiveLibraryId(id) {
  try { id ? localStorage.setItem(LIB_KEY, id) : localStorage.removeItem(LIB_KEY); } catch (_) {}
}

// Librerías donde soy miembro (RLS ya filtra).
export function listLibraries() {
  return rest('/libraries?select=id,name,owner_id&order=created_at.asc');
}

// "livepads://app/Sequences/x.mp3" → "Sequences/x.mp3"
export function urlToRelPath(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^livepads:\/\/app\/(.+)$/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

// Fila de la nube → canción para la PWA (mismo mapeo que el escritorio).
function fromRow(row) {
  const m = row.meta || {};
  const audio = m.audio || {};
  return {
    cloudId: row.id,
    title: row.title || 'Sin título',
    artist: row.artist || '',
    bpm: row.bpm || '',
    key: row.key || '',
    genre: row.genre || '',
    lyrics: row.lyrics || '',
    youtubeUrl: row.youtube_url || '',
    timeSig: m.timeSig || '4/4',
    favorite: !!m.favorite,
    // Rutas RELATIVAS dentro de la biblioteca (lo que firma r2-sign):
    sequencePath: urlToRelPath(audio.sequence),
    originalPath: urlToRelPath(audio.original),
    coverPath: urlToRelPath(m.cover),
    pitch: Number(audio.pitch) || 0,
  };
}

export async function fetchSongs(libraryId) {
  const rows = await rest(
    `/songs?library_id=eq.${libraryId}&select=id,title,artist,bpm,key,genre,lyrics,youtube_url,meta&order=title.asc`
  );
  const songs = (Array.isArray(rows) ? rows : []).map(fromRow);
  try { localStorage.setItem(SONGS_CACHE, JSON.stringify({ libraryId, songs })); } catch (_) {}
  return songs;
}

export function cachedSongs(libraryId) {
  try {
    const c = JSON.parse(localStorage.getItem(SONGS_CACHE) || 'null');
    if (c && c.libraryId === libraryId && Array.isArray(c.songs)) return c.songs;
  } catch (_) {}
  return null;
}

export async function fetchSetlists(libraryId) {
  const rows = await rest(
    `/setlists?library_id=eq.${libraryId}&select=id,name,song_ids,meta&order=updated_at.desc`
  );
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id: r.id,
    name: r.name,
    songIds: r.song_ids || [],
    date: (r.meta && r.meta.date) || null,
  }));
}

// ── Crear / editar / borrar SERVICIOS (setlists) en la nube ────────────────
// Escriben en la MISMA tabla `setlists` que LivePads y las webs. Requiere ser
// editor/dueño de la librería (lo impone la RLS). song_ids en orden.
export async function createSetlist(libraryId, { name, date, songIds }) {
  const rows = await rest('/setlists', {
    method: 'POST',
    body: {
      library_id: libraryId,
      name: (name || 'Servicio').slice(0, 120),
      song_ids: songIds || [],
      meta: { date: date || null },
    },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updateSetlist(id, { name, date, songIds }) {
  const body = {};
  if (name != null) body.name = name.slice(0, 120);
  if (songIds != null) body.song_ids = songIds;
  if (date !== undefined) body.meta = { date: date || null };
  await rest(`/setlists?id=eq.${id}`, { method: 'PATCH', body, prefer: 'return=minimal' });
}

export async function deleteSetlist(id) {
  await rest(`/setlists?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// URL firmada de LECTURA para un archivo de la biblioteca (10 min).
export async function signGet(libraryId, relPath) {
  const r = await invokeFunction('r2-sign', { libraryId, path: relPath, op: 'get' });
  if (!r || !r.url) throw new Error(r?.error || 'No se pudo firmar la descarga.');
  return r.url;
}
