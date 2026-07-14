// ─────────────────────────────────────────────────────────────────────────
// Setlists (servicios) compartidos con el equipo, sobre la tabla `setlists`
// de la librería activa. Editores/dueños pueden guardar; cualquier miembro
// puede cargar. Solo se comparten canciones que están en la nube (cloudId).
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getServiceSongs, replaceService, upsertSavedSetlistFromCloud } from '../data/service.js';
import { getSongs } from '../state/store.js';

function requireContext() {
  if (!isLoggedIn()) throw new Error('Inicia sesión para usar la nube.');
  const libId = getActiveLibraryId();
  if (!libId) throw new Error('No hay una librería activa.');
  return libId;
}

// Guarda el servicio actual como un setlist compartido en la librería activa.
export async function saveServiceAsSetlist(name) {
  const { id, saved, skipped } = await upsertSharedSetlist(name);
  return { id, saved, skipped };
}

// Sube (o actualiza) el servicio actual como setlist compartido de la librería
// activa, con su FECHA en meta.date. Dedupe por NOMBRE dentro de la librería:
// re-guardar "Servicio Domingo" actualiza el mismo setlist en vez de duplicar.
// Con esto los setlists creados en LivePads aparecen en las vistas web de
// Cantantes y Producción (que leen la misma tabla `setlists`), y el badge HOY
// funciona gracias a meta.date. Solo se comparten canciones ya en la nube.
export async function upsertSharedSetlist(name, date) {
  const libId = requireContext();
  const songs = getServiceSongs();
  const song_ids = songs.map(s => s.cloudId).filter(Boolean);
  const skipped = songs.length - song_ids.length;
  if (!song_ids.length) {
    throw new Error('Las canciones del servicio aún no están en la nube. Sube tu librería primero (⬆ Subir mis canciones).');
  }
  const cleanName = (name || 'Servicio').slice(0, 120).trim() || 'Servicio';
  const meta = { date: (typeof date === 'string' && date) ? date : null };

  const existing = await rest(
    `/setlists?library_id=eq.${libId}&name=eq.${encodeURIComponent(cleanName)}&select=id`
  );
  let id;
  if (Array.isArray(existing) && existing.length) {
    id = existing[0].id;
    await rest(`/setlists?id=eq.${id}`, {
      method: 'PATCH',
      body: { song_ids, meta },
      prefer: 'return=minimal',
    });
  } else {
    const created = await rest('/setlists', {
      method: 'POST',
      body: { library_id: libId, name: cleanName, song_ids, meta },
      prefer: 'return=representation',
    });
    id = Array.isArray(created) ? created[0]?.id : created?.id;
  }
  return { id, saved: song_ids.length, skipped };
}

// Borra de la nube el setlist compartido con ese nombre (dedupe por nombre).
export async function deleteSharedSetlistByName(name) {
  const libId = requireContext();
  const cleanName = (name || '').slice(0, 120).trim();
  if (!cleanName) return false;
  await rest(
    `/setlists?library_id=eq.${libId}&name=eq.${encodeURIComponent(cleanName)}`,
    { method: 'DELETE', prefer: 'return=minimal' }
  );
  return true;
}

// Lista los setlists compartidos de la librería activa.
export async function listSharedSetlists() {
  const libId = requireContext();
  const rows = await rest(`/setlists?library_id=eq.${libId}&select=id,name,song_ids,updated_at&order=updated_at.desc`);
  return Array.isArray(rows) ? rows : [];
}

// Carga un setlist compartido en el servicio local (en orden).
export async function loadSharedSetlist(id) {
  requireContext();
  const rows = await rest(`/setlists?id=eq.${id}&select=song_ids`);
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
  replaceService(ordered);
  return { loaded: ordered.length, missing };
}

export async function deleteSharedSetlist(id) {
  requireContext();
  await rest(`/setlists?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
  return true;
}

// Materializa TODOS los setlists de la nube en los guardados locales. Es lo que
// hace que una PC nueva, al iniciar sesión, tenga ya los servicios del domingo
// sin copiar nada a mano. Se llama tras bajar las canciones (necesita cloudId).
export async function pullSharedSetlists() {
  const libId = requireContext();
  const rows = await rest(
    `/setlists?library_id=eq.${libId}&select=id,name,song_ids,meta,updated_at`
  );
  if (!Array.isArray(rows) || !rows.length) return { added: 0, updated: 0 };

  const byCloud = new Map();
  getSongs().forEach(s => { if (s.cloudId) byCloud.set(s.cloudId, s); });

  let added = 0, updated = 0;
  for (const row of rows) {
    const songs = (row.song_ids || []).map(cid => byCloud.get(cid)).filter(Boolean);
    const res = upsertSavedSetlistFromCloud({
      name: row.name,
      date: (row.meta && row.meta.date) || null,
      songs,
    });
    if (res === 'added') added++;
    else if (res === 'updated') updated++;
  }
  return { added, updated };
}
