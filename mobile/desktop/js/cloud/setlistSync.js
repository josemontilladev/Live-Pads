// ─────────────────────────────────────────────────────────────────────────
// Setlists (servicios) compartidos con el equipo, sobre la tabla `setlists`
// de la librería activa. Editores/dueños pueden guardar; cualquier miembro
// puede cargar. Solo se comparten canciones que están en la nube (cloudId).
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getServiceSongs, replaceService } from '../data/service.js';
import { getSongs } from '../state/store.js';

function requireContext() {
  if (!isLoggedIn()) throw new Error('Inicia sesión para usar la nube.');
  const libId = getActiveLibraryId();
  if (!libId) throw new Error('No hay una librería activa.');
  return libId;
}

// Guarda el servicio actual como un setlist compartido en la librería activa.
export async function saveServiceAsSetlist(name) {
  const libId = requireContext();
  const songs = getServiceSongs();
  const song_ids = songs.map(s => s.cloudId).filter(Boolean);
  const skipped = songs.length - song_ids.length;
  if (!song_ids.length) {
    throw new Error('Las canciones del servicio aún no están en la nube. Sube tu librería primero (⬆ Subir mis canciones).');
  }
  await rest('/setlists', {
    method: 'POST',
    body: { library_id: libId, name: (name || 'Servicio').slice(0, 120), song_ids, meta: {} },
    prefer: 'return=minimal',
  });
  return { saved: song_ids.length, skipped };
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
