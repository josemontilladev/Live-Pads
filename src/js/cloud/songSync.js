// ─────────────────────────────────────────────────────────────────────────
// Sincronización de canciones con la librería de Supabase del usuario.
//   · subir  → sube/actualiza las canciones locales a la librería activa
//   · bajar  → trae las de la librería y las fusiona en la lista local
// El disco local (canciones_app.json) sigue siendo la copia de trabajo/offline;
// Supabase es la copia compartida del equipo.
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getSongs, setSongs } from '../state/store.js';

// ── Mapeo entre el objeto local y la fila de Supabase ──────────────────────
function toTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function toRow(song, libraryId) {
  return {
    library_id: libraryId,
    title:  (song.title || 'Sin título').slice(0, 300),
    artist: song.artist || null,
    lyrics: song.lyrics || null,
    bpm:    song.bpm != null ? String(song.bpm) : null,
    key:    song.key || null,
    genre:  song.genre || null,
    tags:   toTags(song.tags),
    meta: {
      favorite:   !!song.favorite,
      addedAt:    song.addedAt || null,
      showChords: !!song.showChords,
      audio:      song.audio || null,
    },
  };
}

function fromRow(row) {
  const m = row.meta || {};
  return {
    id: 'song_cloud_' + row.id,
    cloudId: row.id,
    title:  row.title || '',
    artist: row.artist || '',
    lyrics: row.lyrics || '',
    bpm:    row.bpm || '',
    key:    row.key || '',
    genre:  row.genre || 'adoracion',
    tags:   Array.isArray(row.tags) ? row.tags : [],
    favorite:   !!m.favorite,
    addedAt:    m.addedAt || Date.parse(row.created_at) || Date.now(),
    showChords: !!m.showChords,
    audio:      m.audio || { sequence: null, original: null },
    cloudUpdatedAt: row.updated_at || null,
  };
}

function notifyUpdated() {
  try { window.dispatchEvent(new CustomEvent('livepads:library-synced')); } catch (_) {}
}

function requireContext() {
  if (!isLoggedIn()) throw new Error('Inicia sesión para usar la nube.');
  const libId = getActiveLibraryId();
  if (!libId) throw new Error('No hay una librería activa. Crea o elige una en "Mi cuenta".');
  return libId;
}

// ── Subir (push) ────────────────────────────────────────────────────────────
// Devuelve { created, updated }. Sella el cloudId en las canciones nuevas.
export async function pushLibrarySongs() {
  const libId = requireContext();
  const songs = getSongs();
  const toCreate = songs.filter(s => !s.cloudId);
  const toUpdate = songs.filter(s => s.cloudId);

  let created = 0, updated = 0;

  // Nuevas: inserción en bloque, devuelve filas en orden para sellar el id.
  if (toCreate.length) {
    const rows = await rest('/songs', {
      method: 'POST',
      body: toCreate.map(s => toRow(s, libId)),
      prefer: 'return=representation',
    });
    if (Array.isArray(rows)) {
      rows.forEach((row, i) => {
        if (toCreate[i]) { toCreate[i].cloudId = row.id; toCreate[i].cloudUpdatedAt = row.updated_at; }
      });
      created = rows.length;
    }
  }

  // Existentes: upsert por id (merge-duplicates).
  if (toUpdate.length) {
    const body = toUpdate.map(s => Object.assign({ id: s.cloudId }, toRow(s, libId)));
    await rest('/songs?on_conflict=id', {
      method: 'POST',
      body,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    updated = toUpdate.length;
  }

  if (created) { setSongs(getSongs().slice()); notifyUpdated(); } // persiste cloudId sellado
  return { created, updated };
}

// ── Bajar (pull) ──────────────────────────────────────────────────────────
// Trae las canciones de la librería y las fusiona por cloudId. No borra las
// locales que no estén en la nube. Devuelve { added, refreshed }.
export async function pullLibrarySongs() {
  const libId = requireContext();
  const rows = await rest(`/songs?library_id=eq.${libId}&select=*&order=title.asc`);
  if (!Array.isArray(rows)) return { added: 0, refreshed: 0 };

  const songs = getSongs().slice();
  const byCloud = new Map();
  songs.forEach(s => { if (s.cloudId) byCloud.set(s.cloudId, s); });

  let added = 0, refreshed = 0;
  for (const row of rows) {
    const incoming = fromRow(row);
    const existing = byCloud.get(row.id);
    if (existing) {
      // Conserva el id local y las asignaciones de audio locales (rutas del PC).
      const localAudio = existing.audio;
      Object.assign(existing, incoming, { id: existing.id });
      if (localAudio && (localAudio.sequence || localAudio.original)) existing.audio = localAudio;
      refreshed++;
    } else {
      songs.push(incoming);
      added++;
    }
  }
  if (added || refreshed) { setSongs(songs); notifyUpdated(); }
  return { added, refreshed };
}

// Borra una canción de la nube (por cloudId). El borrado local lo hace la UI.
export async function deleteCloudSong(cloudId) {
  if (!cloudId) return false;
  requireContext();
  await rest(`/songs?id=eq.${cloudId}`, { method: 'DELETE', prefer: 'return=minimal' });
  return true;
}
