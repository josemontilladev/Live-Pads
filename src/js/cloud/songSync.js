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
import { logActivity } from './activity.js';
import { recordDeletion, fetchDeletions, deletedIds } from './tombstones.js';

// Tope para no inundar el historial en la PRIMERA subida masiva (importas 100
// canciones → no queremos 100 filas de actividad). En uso normal editas 1-2.
const ACTIVITY_LOG_CAP = 12;

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

// ── Hash de contenido sincronizable ────────────────────────────────────────
// Firma del contenido COMPARTIDO de la canción (no del audio local, que es por
// PC). Se "sella" (song.syncHash) cada vez que subimos o bajamos: así sabemos si
// una canción tiene ediciones locales SIN subir (hash actual ≠ sellado) → sirve
// para registrar solo ediciones reales (actividad) y detectar conflictos.
function syncContent(s) {
  return JSON.stringify([
    String(s.title || '').trim(), String(s.artist || '').trim(), String(s.lyrics || ''),
    String(s.bpm || ''), String(s.key || ''), String(s.genre || ''),
    toTags(s.tags).join(','), !!s.favorite, !!s.showChords,
    String(s.timeSig || '4/4'), String(s.youtubeUrl || '').trim(),
  ]);
}
function hashOf(s) {
  const str = syncContent(s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}
// Dirty = tiene una firma sellada Y el contenido actual difiere (edición local
// aún no subida). Sin firma previa → NO dirty (baseline desconocido; no bloquea).
function isDirty(s) { return !!s.syncHash && s.syncHash !== hashOf(s); }

function toRow(song, libraryId) {
  const me = getUser();
  const row = {
    library_id: libraryId,
    // Sella quién hace este cambio para poder avisar al equipo en la bajada
    // automática ("Fulano actualizó N canciones"). Best-effort: sin sesión, null.
    updated_by: me ? me.id : null,
    title:  (song.title || 'Sin título').slice(0, 300),
    artist: song.artist || null,
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
      // La CARÁTULA viaja como ruta ("livepads://app/Covers/x.jpg"). Los bytes
      // van a R2 (fileSync.js): sin esta ruta, otra PC no sabría qué bajar.
      cover:      song.cover || null,
    },
  };
  // El enlace de YouTube y la LETRA solo viajan cuando LOS HAY: el upsert es
  // merge-duplicates, así que omitirlos cuando están vacíos evita que una copia
  // local que todavía no bajó la letra (p. ej. escrita en la web GI.Setlist)
  // la pise con NULL.
  //
  // La excepción es el borrado INTENCIONADO: si la canción tiene cambios
  // locales sin subir (dirty) y el campo quedó vacío, es que el usuario lo
  // vació a propósito → mandamos null explícito para que se propague. Sin esta
  // distinción, vaciar una letra era invisible para el equipo: se quedaba con
  // la vieja para siempre.
  const clearing = isDirty(song);
  const yt = String(song.youtubeUrl || '').trim();
  if (yt) row.youtube_url = yt;
  else if (clearing) row.youtube_url = null;

  if (song.lyrics && String(song.lyrics).trim()) row.lyrics = song.lyrics;
  else if (clearing) row.lyrics = null;
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
    cover:      m.cover || null,
    cloudUpdatedAt: row.updated_at || null,
    updatedBy:      row.updated_by || null,
    // Nombre legible del último editor (perfil embebido por PostgREST). Solo se
    // usa para el aviso "quién cambió"; puede faltar en filas antiguas.
    updatedByName:  (row.editor && (row.editor.display_name || row.editor.email)) || null,
  };
}
// Como fromRow pero sella la firma de contenido (llegó de la nube = en sync).
function fromRowSynced(row) {
  const s = fromRow(row);
  s.syncHash = hashOf(s);
  return s;
}

// ── Lotes con claves uniformes ─────────────────────────────────────────────
// PostgREST EXIGE que todas las filas de un insert/upsert masivo tengan las
// MISMAS claves ("All object keys must match"); si no, rechaza TODO el lote con
// 400. Como toRow omite youtube_url cuando está vacío, una librería mixta (unas
// canciones con video y otras sin) hacía fallar el update masivo EN SILENCIO:
// las canciones nuevas llegaban a la nube (lote de 1), pero las LETRAS —que se
// añaden después de crear y solo viajan en ese update— no llegaban nunca a
// GI.Setlist. Partimos los pares {canción, fila} en grupos de claves idénticas.
function batchPairsByRowKeys(pairs) {
  const groups = new Map();
  for (const p of pairs) {
    const k = Object.keys(p.row).sort().join(',');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()];
}

// Un mismo cloudId NO puede aparecer dos veces en el mismo upsert: Postgres
// aborta la sentencia entera con "ON CONFLICT DO UPDATE command cannot affect
// row a second time". Pasa cuando dos canciones locales duplicadas acabaron
// apuntando al mismo registro de la nube. Nos quedamos con una por registro
// (preferimos la que tenga cambios sin subir) para que el push no reviente.
function dedupePairsByCloudId(pairs) {
  const byId = new Map();
  for (const p of pairs) {
    const prev = byId.get(p.s.cloudId);
    if (!prev) { byId.set(p.s.cloudId, p); continue; }
    if (!isDirty(prev.s) && isDirty(p.s)) byId.set(p.s.cloudId, p);
  }
  return [...byId.values()];
}

// ¿Cuántas canciones de la librería activa tienen algo sin publicar? Son las
// que nunca llegaron a la nube (sin cloudId) más las editadas aquí desde la
// última sincronización. Lo usa el panel "Mi cuenta" para poder responder con
// certeza a "¿ya se subió todo?" — la sincronización es silenciosa, así que
// tiene que haber al menos un sitio donde mirar.
export function countPendingSongs() {
  const libId = getActiveLibraryId();
  if (!libId) return 0;
  return getSongs()
    .filter(s => (s.libraryId || libId) === libId)
    .filter(s => !s.cloudId || isDirty(s))
    .length;
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

async function pushSongsToLibraryCore(allSongs, libId) {
  let created = 0, updated = 0, linked = 0, dupes = 0;

  // Nunca re-subir algo que el equipo borró: eso era exactamente lo que hacía
  // reaparecer las canciones eliminadas. La caché se refresca en cada bajada.
  const dead = deletedIds(libId, 'song');
  const songs = dead.size
    ? allSongs.filter(s => !(s.cloudId && dead.has(String(s.cloudId))))
    : allSongs;

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
    // Un registro de la nube solo puede vincularse a UNA canción local: si hay
    // duplicados locales (mismo título+artista+tono), enlazar los dos al mismo
    // id hacía que el upsert intentara tocar la misma fila dos veces y Postgres
    // abortaba TODO el push con "ON CONFLICT DO UPDATE command cannot affect
    // row a second time".
    const usedCloudIds = new Set(songs.map(s => s.cloudId).filter(Boolean));
    withoutCloud.forEach(s => {
      const id = cloudByKey.get(nkey(s));
      if (id && !usedCloudIds.has(id)) {
        s.cloudId = id; s.libraryId = libId; linked++;
        usedCloudIds.add(id);
      }
    });
  }

  const toCreate = songs.filter(s => !s.cloudId);
  const toUpdate = songs.filter(s => s.cloudId);

  // Actividad a registrar: nuevas = "added"; existentes REALMENTE editadas
  // (contenido ≠ firma sellada) = "edited". Se calcula ANTES de sellar la firma.
  const addedTitles = toCreate.map(s => s.title || 'Sin título');
  const editedTitles = toUpdate.filter(isDirty).map(s => s.title || 'Sin título');

  // Nuevas: inserción en bloque, por LOTES de claves uniformes; cada lote
  // devuelve filas en orden para sellar el id.
  if (toCreate.length) {
    const pairs = toCreate.map(s => ({ s, row: toRow(s, libId) }));
    for (const batch of batchPairsByRowKeys(pairs)) {
      const rows = await rest('/songs', {
        method: 'POST',
        body: batch.map(p => p.row),
        prefer: 'return=representation',
      });
      if (Array.isArray(rows)) {
        rows.forEach((row, i) => {
          const s = batch[i] && batch[i].s;
          if (s) { s.cloudId = row.id; s.libraryId = row.library_id || libId; s.cloudUpdatedAt = row.updated_at; s.syncHash = hashOf(s); }
        });
        created += rows.length;
      }
    }
  }

  // Existentes: upsert por id (merge-duplicates), también por LOTES de claves
  // uniformes. Pedimos la representación para SELLAR la marca de tiempo del
  // servidor (updated_at) en la copia local. Sin esto, la marca local quedaría
  // vieja y una bajada de fondo posterior podría considerar "más nueva" a la
  // nube y pisar una edición local recién hecha.
  if (toUpdate.length) {
    const allPairs = toUpdate.map(s => ({ s, row: Object.assign({ id: s.cloudId }, toRow(s, libId)) }));
    const pairs = dedupePairsByCloudId(allPairs);
    dupes = allPairs.length - pairs.length;
    if (dupes) {
      console.warn(`[songSync] ${dupes} canción(es) locales comparten registro en la nube (duplicados). Se sube una por registro.`);
    }
    for (const batch of batchPairsByRowKeys(pairs)) {
      const rows = await rest('/songs?on_conflict=id', {
        method: 'POST',
        body: batch.map(p => p.row),
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      if (Array.isArray(rows)) {
        const byId = new Map(rows.map(r => [r.id, r]));
        batch.forEach(p => { const r = byId.get(p.s.cloudId); if (r && r.updated_at) p.s.cloudUpdatedAt = r.updated_at; });
      }
      batch.forEach(p => { p.s.syncHash = hashOf(p.s); }); // sella: local == nube
      updated += batch.length;
    }
  }

  // Registrar actividad de cambios REALES (best-effort, sin bloquear el push).
  // Se omite si es una subida masiva (primera sync) para no inundar el historial.
  const changes = addedTitles.map(t => ['added', t]).concat(editedTitles.map(t => ['edited', t]));
  if (changes.length && changes.length <= ACTIVITY_LOG_CAP) {
    changes.forEach(([type, title]) => { logActivity(libId, type, title); });
  }

  if (created || linked) { setSongs(getSongs().slice()); notifyUpdated(); } // persiste cloudId sellado
  return { created, updated, linked, dupes };
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
  // Lápidas primero: lo que el equipo borró no se baja ni se conserva local.
  const dead = (await fetchDeletions(libId)).song;
  // Trae el perfil del último editor embebido (updated_by → profiles) para poder
  // decir "quién" cambió. `editor` es el alias del embed; puede venir null.
  const rows = await rest(`/songs?library_id=eq.${libId}&select=*,editor:updated_by(display_name,email)&order=title.asc`);
  if (!Array.isArray(rows)) return { added: 0, refreshed: 0, linked: 0, removed: 0, byOthers: [] };

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
  const byOthers = [];  // cambios de OTROS miembros, para el aviso
  const conflicts = []; // { cloudId, title, byName, theirs } — otro editó Y yo tengo cambios locales sin subir
  let added = 0, refreshed = 0, linked = 0, removed = 0;
  // `keepLocalText` = mi copia tiene texto sin subir que la nube no conoce. Solo
  // en ese caso una fila sin letra deja intacta la letra local: si mi copia YA
  // está en sync, una letra vacía en la nube es un borrado deliberado de un
  // compañero y debe aplicarse (antes se ignoraba y el borrado nunca llegaba).
  const applyOnto = (target, incoming, keepLocalText) => {
    const localAudio = target.audio;
    const localLyrics = target.lyrics;
    const localCover = target.cover;
    Object.assign(target, incoming, { id: target.id });
    if (localAudio && (localAudio.sequence || localAudio.original)) target.audio = localAudio;
    // Igual que el audio: una fila sin carátula no borra la carátula local (las
    // filas antiguas de la nube no traen `meta.cover`).
    if (!incoming.cover && localCover) target.cover = localCover;
    if (keepLocalText && (!incoming.lyrics || !String(incoming.lyrics).trim()) && localLyrics) {
      target.lyrics = localLyrics;
    }
    target.syncHash = hashOf(target); // local == nube
  };
  for (const row of rows) {
    if (dead.has(String(row.id))) continue; // borrada por el equipo: ni bajarla
    const incoming = fromRowSynced(row);
    const fromOther = !!(incoming.updatedBy && incoming.updatedBy !== myId);
    const existing = byCloud.get(row.id);
    if (existing) {
      // Guarda: no pisar una canción protegida (abierta en el editor ahora mismo).
      if (protectIds && protectIds.has(row.id)) continue;
      // Solo aplicamos si la nube trae algo MÁS NUEVO. Así el poller periódico
      // no re-renderiza ni reescribe a disco cuando no hay cambios.
      if (!isNewer(incoming, existing)) continue;
      // ¿Tengo ediciones locales sin subir? Con firma sellada es exacto. SIN
      // firma (canción importada, creada offline o venida de un JSON viejo) el
      // antiguo isDirty devolvía false y la nube la pisaba EN SILENCIO — una de
      // las causas reales de "se me perdió el cambio". Sin línea base comparamos
      // el contenido directamente: si difiere del entrante, hay algo mío que la
      // nube no tiene.
      const dirty = existing.syncHash ? isDirty(existing) : hashOf(existing) !== hashOf(incoming);
      // CONFLICTO: otro miembro la cambió (más nueva) y yo tengo ediciones
      // locales sin subir. No pisamos: el usuario decide (mía / de ellos).
      if (fromOther && dirty) {
        conflicts.push({ cloudId: row.id, title: existing.title, byName: incoming.updatedByName, theirs: incoming });
        continue;
      }
      applyOnto(existing, incoming, dirty);
      refreshed++;
      if (fromOther) byOthers.push({ title: incoming.title, byName: incoming.updatedByName });
      continue;
    }
    // ¿Existe ya localmente (mismo título+artista+tono) sin vincular? → vincula
    // en vez de duplicar. Un duplicado intencional en otro tono NO coincide.
    const k = nkey(incoming);
    const adopt = !consumed.has(k) ? localUntagged.get(k) : null;
    if (adopt && !adopt.cloudId) {
      // La copia local nunca se subió: su texto manda sobre una fila vacía.
      applyOnto(adopt, incoming, true);
      consumed.add(k);
      linked++;
    } else {
      songs.push(incoming);
      added++;
      // Una canción nueva creada por otro miembro también es "actividad".
      if (fromOther) byOthers.push({ title: incoming.title, byName: incoming.updatedByName });
    }
  }

  // Borrados del equipo: quitar de la copia local lo que alguien borró. Sin
  // esto la canción seguía aquí y el auto-push la resucitaba en la nube con el
  // mismo uuid — el borrado nunca "cuajaba" para nadie.
  const deletedTitles = [];
  const kept = songs.filter(s => {
    if (s.cloudId && dead.has(String(s.cloudId))) { deletedTitles.push(s.title); removed++; return false; }
    return true;
  });

  if (added || refreshed || linked || removed) { setSongs(kept); notifyUpdated(); }
  return { added, refreshed, linked, removed, deletedTitles, byOthers, conflicts };
}

// ── Resolución de conflictos ────────────────────────────────────────────────
// "Usar la de ellos": aplica la versión de la nube sobre la canción local.
export function resolveConflictUseTheirs(cloudId, theirs) {
  const songs = getSongs();
  const s = songs.find(x => x.cloudId === cloudId);
  if (!s || !theirs) return false;
  const localAudio = s.audio;
  Object.assign(s, theirs, { id: s.id });
  if (localAudio && (localAudio.sequence || localAudio.original)) s.audio = localAudio;
  s.syncHash = hashOf(s);
  setSongs(songs.slice()); notifyUpdated();
  return true;
}
// "Mantener la mía": sube mi versión local, pisando la de la nube.
export async function resolveConflictKeepMine(cloudId) {
  const libId = getActiveLibraryId();
  const s = getSongs().find(x => x.cloudId === cloudId);
  if (!libId || !s) return false;
  await pushSongsToLibrary([s], libId);
  return true;
}

// Borra una canción de la nube (por cloudId) Y deja la lápida. El borrado local
// lo hace la UI. La lápida es lo que hace que el borrado sea DEFINITIVO para el
// equipo: sin ella, el primer compañero que aún la tuviera local la re-insertaba
// con el mismo uuid en su siguiente auto-push.
export async function deleteCloudSong(cloudId, title) {
  if (!cloudId) return false;
  const libId = requireContext();
  await rest(`/songs?id=eq.${cloudId}`, { method: 'DELETE', prefer: 'return=minimal' });
  await recordDeletion(libId, 'song', cloudId, title);
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
    // return=representation para SELLAR el updated_at del servidor: sin esto la
    // marca local quedaba vieja y la siguiente bajada creía que la nube era
    // "más nueva", aplicando la fila entera encima de la canción local.
    const res = await rest(`/songs?id=eq.${rowId}`, {
      method: 'PATCH',
      body: { youtube_url: String(song.youtubeUrl).trim() },
      prefer: 'return=representation',
    });
    const r = Array.isArray(res) ? res[0] : res;
    if (r && r.updated_at) { song.cloudUpdatedAt = r.updated_at; song.syncHash = hashOf(song); }
    return true;
  } catch (_) {
    return false;
  }
}
