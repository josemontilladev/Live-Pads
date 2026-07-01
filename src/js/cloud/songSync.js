// ─────────────────────────────────────────────────────────────────────────
// Sincronización de canciones con la librería de Supabase del usuario.
//   · subir  → sube/actualiza las canciones locales a la librería activa
//   · bajar  → trae las de la librería y las fusiona en la lista local
// El disco local (canciones_app.json) sigue siendo la copia de trabajo/offline;
// Supabase es la copia compartida del equipo.
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn, getUser } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getSongs, setSongs } from '../state/store.js';
import { htmlToPlainLyrics } from '../utils/text.js';

// ── Mapeo entre el objeto local y la fila de Supabase ──────────────────────
// Clave natural para deduplicar: título + artista + TONO. Incluir el tono es
// clave: si duplicas una canción a propósito en otra tonalidad, cuenta como
// distinta y NO se fusiona; mismas tres → es la misma y se vincula.
function nkey(s) {
  const norm = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return `${norm(s.title)}|${norm(s.artist)}|${norm(s.key)}`;
}

function toTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function toRow(song, libraryId) {
  const me = getUser();
  const row = {
    library_id: libraryId,
    // Sella quién hace este cambio para poder avisar al equipo en la bajada
    // automática ("Fulano actualizó N canciones"). Best-effort: sin sesión, null.
    updated_by: me ? me.id : null,
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
      timeSig:    song.timeSig || null,
    },
  };
  // Solo se incluye el enlace de YouTube cuando LO HAY: el upsert es
  // merge-duplicates, así que omitirlo cuando está vacío evita pisar con NULL
  // un youtube_url ya puesto en la web GI.Setlist. La web usa este campo para
  // mostrar la carátula.
  if (song.youtubeUrl && String(song.youtubeUrl).trim()) row.youtube_url = String(song.youtubeUrl).trim();
  return row;
}

function fromRow(row) {
  const m = row.meta || {};
  return {
    id: 'song_cloud_' + row.id,
    cloudId: row.id,
    libraryId: row.library_id || null,
    title:  row.title || '',
    artist: row.artist || '',
    lyrics: htmlToPlainLyrics(row.lyrics || ''),
    bpm:    row.bpm || '',
    key:    row.key || '',
    genre:  row.genre || 'adoracion',
    tags:   Array.isArray(row.tags) ? row.tags : [],
    youtubeUrl: row.youtube_url || '',
    favorite:   !!m.favorite,
    addedAt:    m.addedAt || Date.parse(row.created_at) || Date.now(),
    showChords: !!m.showChords,
    audio:      m.audio || { sequence: null, original: null },
    timeSig:    m.timeSig || '4/4',
    cloudUpdatedAt: row.updated_at || null,
    updatedBy:      row.updated_by || null,
    // Nombre legible del último editor (perfil embebido por PostgREST). Solo se
    // usa para el aviso "quién cambió"; puede faltar en filas antiguas.
    updatedByName:  (row.editor && (row.editor.display_name || row.editor.email)) || null,
  };
}

function notifyUpdated() {
  try { window.dispatchEvent(new CustomEvent('livepads:library-synced')); } catch (_) {}
}

// Candado simple entre subir y bajar: la bajada automática en background NO debe
// solaparse con una subida (podría fusionar datos viejos encima de una edición
// que aún se está subiendo). La subida marca este flag mientras corre; la bajada
// de fondo lo consulta y, si está ocupado, se salta esta ronda (reintenta luego).
let _pushInFlight = false;
export function isPushInFlight() { return _pushInFlight; }

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
  return pushSongsToLibrary(getSongs(), libId);
}

// Auto-sync en background: sube/actualiza SOLO las canciones de la librería
// ACTIVA (las del repertorio que el usuario ve y edita), para que la otra app
// (misma BD de Supabase) las vea sin pulsar "Subir". Best-effort: sin sesión ni
// librería activa, no hace nada (no lanza). Idempotente (dedup + upsert).
export async function autoPushActiveLibrary() {
  if (!isLoggedIn()) return { created: 0, updated: 0, linked: 0 };
  const libId = getActiveLibraryId();
  if (!libId) return { created: 0, updated: 0, linked: 0 };
  // Solo las de esta librería (las sin asignar se consideran de la activa: es la
  // que el usuario está viendo al crearlas).
  const songs = getSongs().filter(s => (s.libraryId || libId) === libId);
  if (!songs.length) return { created: 0, updated: 0, linked: 0 };
  return pushSongsToLibrary(songs, libId);
}

// Núcleo del push: sube/actualiza `songs` a la librería `libId`. Sella cloudId.
async function pushSongsToLibrary(songs, libId) {
  _pushInFlight = true;
  try {
    return await pushSongsToLibraryCore(songs, libId);
  } finally {
    _pushInFlight = false;
  }
}

async function pushSongsToLibraryCore(songs, libId) {
  let created = 0, updated = 0, linked = 0;

  // Dedup: antes de crear, vincula las locales sin cloudId que YA existen en la
  // nube (mismo título+artista+tono) para no subir copias. Hace el push
  // idempotente (correrlo dos veces no duplica).
  const withoutCloud = songs.filter(s => !s.cloudId);
  if (withoutCloud.length) {
    const existRows = await rest(`/songs?library_id=eq.${libId}&select=id,title,artist,key`);
    const cloudByKey = new Map();
    (Array.isArray(existRows) ? existRows : []).forEach(r => {
      const k = nkey(r); if (!cloudByKey.has(k)) cloudByKey.set(k, r.id);
    });
    withoutCloud.forEach(s => {
      const id = cloudByKey.get(nkey(s));
      if (id) { s.cloudId = id; s.libraryId = libId; linked++; }
    });
  }

  const toCreate = songs.filter(s => !s.cloudId);
  const toUpdate = songs.filter(s => s.cloudId);

  // Nuevas: inserción en bloque, devuelve filas en orden para sellar el id.
  if (toCreate.length) {
    const rows = await rest('/songs', {
      method: 'POST',
      body: toCreate.map(s => toRow(s, libId)),
      prefer: 'return=representation',
    });
    if (Array.isArray(rows)) {
      rows.forEach((row, i) => {
        if (toCreate[i]) { toCreate[i].cloudId = row.id; toCreate[i].libraryId = row.library_id || libId; toCreate[i].cloudUpdatedAt = row.updated_at; }
      });
      created = rows.length;
    }
  }

  // Existentes: upsert por id (merge-duplicates). Pedimos la representación para
  // SELLAR la marca de tiempo del servidor (updated_at) en la copia local. Sin
  // esto, la marca local quedaría vieja y una bajada de fondo posterior podría
  // considerar "más nueva" a la nube y pisar una edición local recién hecha.
  if (toUpdate.length) {
    const body = toUpdate.map(s => Object.assign({ id: s.cloudId }, toRow(s, libId)));
    const rows = await rest('/songs?on_conflict=id', {
      method: 'POST',
      body,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    if (Array.isArray(rows)) {
      const byId = new Map(rows.map(r => [r.id, r]));
      toUpdate.forEach(s => { const r = byId.get(s.cloudId); if (r && r.updated_at) s.cloudUpdatedAt = r.updated_at; });
    }
    updated = toUpdate.length;
  }

  if (created || linked) { setSongs(getSongs().slice()); notifyUpdated(); } // persiste cloudId sellado
  return { created, updated, linked };
}

// ── Bajar (pull) ──────────────────────────────────────────────────────────
// Trae las canciones de la librería y las fusiona por cloudId. No borra las
// locales que no estén en la nube.
//
// Opciones (para la bajada automática en background — cloud/libraryLive.js):
//   · protectIds : Set de cloudIds que NO deben sobreescribirse (p. ej. la
//     canción abierta ahora mismo en el editor de letra). Evita pisar una
//     edición en curso con datos de la nube.
//
// Devuelve { added, refreshed, linked, byOthers } donde `byOthers` es la lista
// de cambios hechos por OTRO miembro (no yo), para el aviso al equipo:
//   byOthers = [{ title, byName }]
export async function pullLibrarySongs(opts = {}) {
  const protectIds = opts.protectIds instanceof Set ? opts.protectIds : null;
  const myId = (getUser() || {}).id || null;
  const libId = requireContext();
  // Trae el perfil del último editor embebido (updated_by → profiles) para poder
  // decir "quién" cambió. `editor` es el alias del embed; puede venir null.
  const rows = await rest(`/songs?library_id=eq.${libId}&select=*,editor:updated_by(display_name,email)&order=title.asc`);
  if (!Array.isArray(rows)) return { added: 0, refreshed: 0, linked: 0, byOthers: [] };

  const songs = getSongs().slice();
  const byCloud = new Map();
  const localUntagged = new Map(); // nkey → canción local sin cloudId (candidata a vincular)
  songs.forEach(s => {
    if (s.cloudId) byCloud.set(s.cloudId, s);
    else { const k = nkey(s); if (!localUntagged.has(k)) localUntagged.set(k, s); }
  });

  // ¿El cambio entrante es realmente más nuevo que lo que ya tengo? Compara la
  // marca de tiempo del servidor (updated_at). Sin marca previa → sí es nuevo.
  const isNewer = (incoming, existing) => {
    const a = Date.parse(incoming.cloudUpdatedAt || '') || 0;
    const b = Date.parse(existing.cloudUpdatedAt || '') || 0;
    return a > b;
  };

  const consumed = new Set();
  const byOthers = []; // cambios de OTROS miembros, para el aviso
  let added = 0, refreshed = 0, linked = 0;
  for (const row of rows) {
    const incoming = fromRow(row);
    const fromOther = !!(incoming.updatedBy && incoming.updatedBy !== myId);
    const existing = byCloud.get(row.id);
    if (existing) {
      // Guarda de conflicto: no pisar una canción protegida (abierta en el
      // editor ahora mismo). Se sincronizará cuando el usuario la cierre.
      if (protectIds && protectIds.has(row.id)) continue;
      // Solo aplicamos si la nube trae algo MÁS NUEVO. Así el poller periódico
      // no re-renderiza ni reescribe a disco cuando no hay cambios, y una
      // edición local aún sin subir (marca más nueva) no se pisa con datos
      // viejos de la nube.
      if (!isNewer(incoming, existing)) continue;
      // Conserva el id local y las asignaciones de audio locales (rutas del PC).
      const localAudio = existing.audio;
      Object.assign(existing, incoming, { id: existing.id });
      if (localAudio && (localAudio.sequence || localAudio.original)) existing.audio = localAudio;
      refreshed++;
      if (fromOther) byOthers.push({ title: incoming.title, byName: incoming.updatedByName });
      continue;
    }
    // ¿Existe ya localmente (mismo título+artista+tono) sin vincular? → vincula
    // en vez de duplicar. Un duplicado intencional en otro tono NO coincide.
    const k = nkey(incoming);
    const adopt = !consumed.has(k) ? localUntagged.get(k) : null;
    if (adopt && !adopt.cloudId) {
      const localAudio = adopt.audio;
      Object.assign(adopt, incoming, { id: adopt.id });
      if (localAudio && (localAudio.sequence || localAudio.original)) adopt.audio = localAudio;
      consumed.add(k);
      linked++;
    } else {
      songs.push(incoming);
      added++;
      // Una canción nueva creada por otro miembro también es "actividad".
      if (fromOther) byOthers.push({ title: incoming.title, byName: incoming.updatedByName });
    }
  }
  if (added || refreshed || linked) { setSongs(songs); notifyUpdated(); }
  return { added, refreshed, linked, byOthers };
}

// Borra una canción de la nube (por cloudId). El borrado local lo hace la UI.
export async function deleteCloudSong(cloudId) {
  if (!cloudId) return false;
  requireContext();
  await rest(`/songs?id=eq.${cloudId}`, { method: 'DELETE', prefer: 'return=minimal' });
  return true;
}

// Auto-sync puntual: sube SOLO el youtube_url de una canción que YA existe en la
// librería ACTIVA del usuario (PATCH a la fila por su id de Supabase). Lo usa
// LivePads al asignar un original desde YouTube → la web GI.Setlist muestra la
// carátula sin un ⬆ Subir completo. Best-effort y multi-tenant-correcto: sin
// sesión / librería activa / id en la nube, no hace nada (no crea duplicados ni
// escribe en otra librería). `cloudId` (sync Supabase) o `_id` (legacy) son el
// mismo id de fila de Supabase.
export async function pushSongYoutubeUrl(song) {
  if (!song || !song.youtubeUrl) return false;
  const rowId = song.cloudId || song._id;
  if (!rowId || !isLoggedIn() || !getActiveLibraryId()) return false;
  try {
    await rest(`/songs?id=eq.${rowId}`, {
      method: 'PATCH',
      body: { youtube_url: String(song.youtubeUrl).trim() },
      prefer: 'return=minimal',
    });
    return true;
  } catch (_) {
    return false;
  }
}
