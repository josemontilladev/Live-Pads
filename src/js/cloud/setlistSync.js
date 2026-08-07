// ─────────────────────────────────────────────────────────────────────────
// Setlists (servicios) compartidos con el equipo, sobre la tabla `setlists`
// de la librería activa. Editores/dueños pueden guardar; cualquier miembro
// puede cargar. Solo se comparten canciones que están en la nube (cloudId).
//
// Reglas de convivencia (por qué está escrito así):
//
//   · IDENTIDAD POR cloudId, no por nombre. El dedupe por nombre hacía que
//     renombrar un servicio creara uno nuevo y dejara huérfano el viejo, y que
//     dos servicios homónimos se pisaran. Cada setlist local guarda el uuid de
//     su fila; el nombre solo sirve para ADOPTAR los que ya existían.
//
//   · SOLO SE SUBE LO SUCIO. Antes se subían TODOS los setlists locales cada
//     vez, con un PATCH incondicional. Una PC que arrancaba con datos viejos
//     pisaba el trabajo del resto del equipo. Ahora sube quien realmente editó
//     (editedAt > cloudUpdatedAt) y gana la edición más reciente.
//
//   · BAJADA AUTOMÁTICA. La ronda en vivo (libraryLive.js) llama a syncSetlists
//     después de las canciones, así que un servicio creado por otro miembro
//     aparece solo, sin pulsar "⬇ Bajar".
//
//   · BORRADOS CON LÁPIDA. Borrar un servicio deja constancia en `deletions`
//     para que no reaparezca en la siguiente bajada de otro miembro.
//
//   · TONOS POR SERVICIO en la columna `song_keys`.
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import {
  getServiceSongs, replaceService, upsertSavedSetlistFromCloud, listSavedSetlists,
  isSetlistDirty, markSetlistSynced, removeSavedSetlistByCloudId, getServiceKeys,
  getCurrentSetlistId,
} from '../data/service.js';
import { getSongs } from '../state/store.js';
import { recordDeletion, fetchDeletions, deletedIds } from './tombstones.js';

function requireContext() {
  if (!isLoggedIn()) throw new Error('Inicia sesión para usar la nube.');
  const libId = getActiveLibraryId();
  if (!libId) throw new Error('No hay una librería activa.');
  return libId;
}

// La columna song_keys llegó en la migración 0011. Si la BD del equipo aún no
// está migrada, PostgREST responde 400 y el push entero fallaba en silencio: en
// cuanto pasa una vez, dejamos de mandarla y todo lo demás sigue sincronizando.
let songKeysSupported = true;

// Fila de la nube a partir de un setlist local. `keys` se filtra a las canciones
// que realmente están en el servicio para no arrastrar tonos de canciones ya
// quitadas.
function toRow(libId, name, date, songs, keys) {
  const song_ids = songs.map(s => s.cloudId).filter(Boolean);
  const inSet = new Set(song_ids.map(String));
  const song_keys = {};
  Object.entries(keys || {}).forEach(([ref, k]) => { if (inSet.has(String(ref)) && k) song_keys[ref] = k; });
  const row = {
    library_id: libId,
    name: (name || 'Servicio').slice(0, 120).trim() || 'Servicio',
    song_ids,
    meta: { date: (typeof date === 'string' && date) ? date : null },
  };
  if (songKeysSupported) row.song_keys = song_keys;
  return { row, song_ids, skipped: songs.length - song_ids.length };
}

// Escribe la fila y devuelve { id, updated_at }. Reintenta una vez sin
// song_keys si la BD todavía no tiene la columna.
async function writeRow(cloudId, row) {
  const send = async (body) => {
    if (cloudId) {
      const res = await rest(`/setlists?id=eq.${cloudId}`, {
        method: 'PATCH', body, prefer: 'return=representation',
      });
      return Array.isArray(res) ? res[0] : res;
    }
    const res = await rest('/setlists', {
      method: 'POST', body, prefer: 'return=representation',
    });
    return Array.isArray(res) ? res[0] : res;
  };
  try {
    return await send(row);
  } catch (e) {
    if (songKeysSupported && 'song_keys' in row) {
      songKeysSupported = false;
      const { song_keys, ...rest_ } = row;
      try { console.warn('[setlistSync] `song_keys` no existe en la BD (falta la migración 0011); los tonos por servicio no se comparten todavía.'); } catch (_) {}
      return await send(rest_);
    }
    throw e;
  }
}

// Guarda el servicio actual como un setlist compartido en la librería activa.
// Si la lista de trabajo ES un setlist guardado, se le sella el id de la nube:
// desde ahí queda emparejado y las ediciones siguientes actualizan esa misma
// fila (renombrarlo incluido) en vez de crear un duplicado huérfano.
export async function saveServiceAsSetlist(name) {
  const activeId = getCurrentSetlistId();
  const active = activeId ? listSavedSetlists().find(s => s.id === activeId) : null;
  const r = await upsertSharedSetlist(name, active ? active.date : null, null, null, active ? active.cloudId : null);
  if (active) markSetlistSynced(active.id, r.id, r.updatedAt);
  return { id: r.id, saved: r.saved, skipped: r.skipped };
}

// Sube (o actualiza) el servicio actual —o una lista concreta— como setlist
// compartido de la librería activa, con su FECHA en meta.date. Los setlists
// creados en LivePads aparecen así en las vistas web de Cantantes y Producción
// (que leen la misma tabla) y el badge HOY funciona gracias a meta.date.
//
// `cloudId` fija a qué fila escribir. Sin él se busca por nombre — solo para
// adoptar los setlists creados antes de que existiera el cloudId local.
export async function upsertSharedSetlist(name, date, songsArg, keysArg, cloudId) {
  const libId = requireContext();
  const songs = Array.isArray(songsArg) ? songsArg : getServiceSongs();
  const keys = keysArg || (Array.isArray(songsArg) ? {} : getServiceKeys());
  const { row, song_ids, skipped } = toRow(libId, name, date, songs, keys);
  if (!song_ids.length) {
    throw new Error('Las canciones del servicio aún no están en la nube. Sube tu librería primero (⬆ Subir mis canciones).');
  }

  let target = cloudId || null;
  if (!target) {
    const existing = await rest(
      `/setlists?library_id=eq.${libId}&name=eq.${encodeURIComponent(row.name)}&select=id`
    );
    if (Array.isArray(existing) && existing.length) target = existing[0].id;
  }
  // Nunca reescribir algo que el equipo ya borró.
  if (target && deletedIds(libId, 'setlist').has(String(target))) target = null;

  const saved = await writeRow(target, row);
  return {
    id: (saved && saved.id) || target,
    updatedAt: (saved && saved.updated_at) || null,
    saved: song_ids.length,
    skipped,
  };
}

// Borra de la nube el setlist compartido con ese nombre (compat con la UI que
// aún borra por nombre). Deja lápida para que no reaparezca en otras máquinas.
export async function deleteSharedSetlistByName(name) {
  const libId = requireContext();
  const cleanName = (name || '').slice(0, 120).trim();
  if (!cleanName) return false;
  const rows = await rest(
    `/setlists?library_id=eq.${libId}&name=eq.${encodeURIComponent(cleanName)}&select=id`
  );
  for (const r of (Array.isArray(rows) ? rows : [])) {
    await deleteSharedSetlist(r.id, cleanName);
  }
  return true;
}

// Lista los setlists compartidos de la librería activa.
export async function listSharedSetlists() {
  const libId = requireContext();
  const rows = await rest(`/setlists?library_id=eq.${libId}&select=id,name,song_ids,updated_at&order=updated_at.desc`);
  return Array.isArray(rows) ? rows : [];
}

// Carga un setlist compartido en el servicio local (en orden, con sus tonos).
export async function loadSharedSetlist(id) {
  requireContext();
  const cols = songKeysSupported ? 'song_ids,song_keys' : 'song_ids';
  const rows = await rest(`/setlists?id=eq.${id}&select=${cols}`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('Setlist no encontrado.');
  const byCloud = new Map();
  getSongs().forEach(s => { if (s.cloudId) byCloud.set(s.cloudId, s); });
  const ordered = [];
  let missing = 0;
  (row.song_ids || []).forEach(cid => {
    const s = byCloud.get(cid);
    if (s) ordered.push(s); else missing++;
  });
  replaceService(ordered, row.song_keys || {});
  return { loaded: ordered.length, missing };
}

// Borra un setlist de la nube Y registra la lápida. Sin la lápida, el resto del
// equipo lo re-subía desde su copia local en la ronda siguiente.
export async function deleteSharedSetlist(id, title) {
  const libId = requireContext();
  await rest(`/setlists?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
  await recordDeletion(libId, 'setlist', id, title);
  return true;
}

// ── Ronda completa: bajar y luego subir ────────────────────────────────────
// Este orden importa. Bajar primero deja la copia local al día; subir después
// publica solo lo que este usuario editó de verdad. Al revés, una subida ciega
// pisaría el trabajo del equipo con datos que aún no se habían actualizado.
// Best-effort: sin sesión/librería/red no hace nada y no lanza.
export async function autoSyncSetlists() {
  if (!isLoggedIn() || !getActiveLibraryId()) return { pushed: 0, skipped: 0, added: 0, updated: 0 };
  let down = { added: 0, updated: 0, removed: 0 };
  try { down = await pullSharedSetlists(); } catch (_) {}
  let up = { pushed: 0, skipped: 0 };
  try { up = await pushSavedSetlists(); } catch (_) {}
  return { ...down, ...up };
}

// Sube los setlists guardados que tienen cambios locales SIN publicar. Los que
// aún no tienen ninguna canción en la nube se saltan (no se puede referenciar lo
// que no existe allí). `opts.all = true` fuerza subirlos todos — es lo que hace
// el botón manual "⬆ Subir" de Mi cuenta.
export async function pushSavedSetlists(opts = {}) {
  requireContext();
  const all = listSavedSetlists();
  const pending = opts.all ? all : all.filter(isSetlistDirty);
  let pushed = 0, skipped = 0;
  for (const s of pending) {
    try {
      const r = await upsertSharedSetlist(s.name, s.date, s.songs || [], s.keys || {}, s.cloudId);
      markSetlistSynced(s.id, r.id, r.updatedAt);
      pushed++;
    } catch (_) {
      skipped++;
    }
  }
  return { pushed, skipped };
}

// Materializa los setlists de la nube en los guardados locales y aplica los
// borrados del equipo. Es lo que hace que una PC nueva, al iniciar sesión, tenga
// ya los servicios del domingo sin copiar nada a mano, y que un servicio que
// creó un compañero aparezca solo. Necesita las canciones ya bajadas (cloudId).
export async function pullSharedSetlists() {
  const libId = requireContext();

  // Primero las lápidas: lo borrado no debe ni bajarse ni re-subirse.
  const dead = await fetchDeletions(libId);
  let removed = 0;
  dead.setlist.forEach(cid => { if (removeSavedSetlistByCloudId(cid)) removed++; });

  const cols = songKeysSupported
    ? 'id,name,song_ids,song_keys,meta,updated_at'
    : 'id,name,song_ids,meta,updated_at';
  let rows;
  try {
    rows = await rest(`/setlists?library_id=eq.${libId}&select=${cols}`);
  } catch (e) {
    if (!songKeysSupported) throw e;
    songKeysSupported = false;
    rows = await rest(`/setlists?library_id=eq.${libId}&select=id,name,song_ids,meta,updated_at`);
  }
  if (!Array.isArray(rows) || !rows.length) return { added: 0, updated: 0, removed };

  const byCloud = new Map();
  getSongs().forEach(s => { if (s.cloudId) byCloud.set(s.cloudId, s); });

  let added = 0, updated = 0;
  for (const row of rows) {
    if (dead.setlist.has(String(row.id))) continue;
    const songs = (row.song_ids || []).map(cid => byCloud.get(cid)).filter(Boolean);
    const res = upsertSavedSetlistFromCloud({
      cloudId: row.id,
      name: row.name,
      date: (row.meta && row.meta.date) || null,
      songs,
      keys: row.song_keys || {},
      updatedAt: row.updated_at || null,
    });
    if (res === 'added') added++;
    else if (res === 'updated') updated++;
  }
  return { added, updated, removed };
}
