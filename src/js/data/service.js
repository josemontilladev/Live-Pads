// Service setlist state + CRUD. Holds the running order of the current
// service. State is module-private; callers interact via the exported API
// so app.js no longer needs the underlying `let` globals.
//
// The render and applyGiSong functions live in app.js (heavy DOM logic),
// so they are injected once at boot via initService(deps).

import { confirmDialog } from '../ui/dialog.js';
import { getSongs as getLibrarySongs } from '../state/store.js';

let serviceSongs = [];
let activeServiceIndex = -1;
// Tonos que aplican SOLO en el servicio de hoy: { "<ref de canción>": "G" }.
// Sin entrada = la canción suena en el tono de la librería. Se persiste con la
// lista de trabajo y viaja a la nube dentro del setlist (setlists.song_keys),
// así que el equipo entero ve el mismo tono ese domingo.
let serviceKeys = {};
// Nombre del setlist cargado (para mostrarlo como título del servicio). Vacío =
// lista de trabajo sin nombre ("Tu lista de hoy").
let currentSetlistName = '';
export const getCurrentSetlistName = () => currentSetlistName;
export const setCurrentSetlistName = (n) => { currentSetlistName = n || ''; };
// Id del setlist guardado que está ACTIVO (la lista de trabajo ES ese setlist y
// se auto-guarda al editar). null = lista de hoy sin nombre (no persistida como
// setlist; se agrega igual, pero no aparece en el selector hasta nombrarla).
let currentSetlistId = null;
export const getCurrentSetlistId = () => currentSetlistId;

// Referencia estable de una canción DENTRO de un servicio. Se prefiere el
// cloudId porque es el único id que comparten todas las máquinas del equipo (el
// `id` local es distinto en cada PC). Es la clave del mapa de tonos.
export function songRef(song) {
  if (!song) return '';
  return String(song.cloudId || song.id || '');
}

// Vuelca la lista de trabajo al setlist guardado activo (si hay), para que
// agregar/quitar/reordenar se persista en vivo en ese setlist.
function syncActiveSetlist() {
  if (!currentSetlistId) return;
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === currentSetlistId);
  if (!e) { currentSetlistId = null; return; }
  e.songs = serviceSongs.map(({ serviceId, ...s }) => s);
  if (currentSetlistName) e.name = currentSetlistName;
  e.keys = { ...serviceKeys };
  writeSavedSetlists(arr);
}

let renderFn = null;
let applyGiSongFn = null;

export function initService({ render, applyGiSong }) {
  renderFn = render || null;
  applyGiSongFn = applyGiSong || null;
}

const triggerRender = () => { if (renderFn) renderFn(); };
const triggerApply = (song) => { if (applyGiSongFn) applyGiSongFn(song); };

export const getServiceSongs = () => serviceSongs;
export const getActiveServiceIndex = () => activeServiceIndex;
export const setActiveServiceIndex = (n) => { activeServiceIndex = n; };

export function loadServiceSongs() {
  currentSetlistName = localStorage.getItem('serviceName') || '';
  currentSetlistId = localStorage.getItem('serviceSetlistId') || null;
  try { serviceKeys = JSON.parse(localStorage.getItem('serviceKeys') || '{}') || {}; }
  catch (_) { serviceKeys = {}; }
  const saved = localStorage.getItem('serviceSongs');
  if (saved) {
    try {
      serviceSongs = JSON.parse(saved);
      triggerRender();
    } catch (e) {
      serviceSongs = [];
    }
  }
}

export function saveServiceSongs() {
  localStorage.setItem('serviceSongs', JSON.stringify(serviceSongs));
  localStorage.setItem('serviceName', currentSetlistName || '');
  localStorage.setItem('serviceSetlistId', currentSetlistId || '');
  localStorage.setItem('serviceKeys', JSON.stringify(serviceKeys));
  syncActiveSetlist(); // mantener el setlist guardado activo en sync
  try { window.dispatchEvent(new Event('livepads:settings-changed')); } catch (_) {}
  // La biblioteca escucha esto para repintar el badge "En servicio" + el ✓ del
  // botón añadir en vivo (antes solo se actualizaba al recargar con Ctrl+R).
  try { window.dispatchEvent(new Event('livepads:service-changed')); } catch (_) {}
}

export function addToService(song) {
  // Tag with a unique serviceId so drag-drop survives duplicates of the same song.
  const songToAdd = { ...song, serviceId: Date.now() + Math.random() };
  serviceSongs.push(songToAdd);
  saveServiceSongs();
  triggerRender();
}

// Reemplaza todo el servicio de una vez (p.ej. al cargar un setlist compartido
// de la nube). Re-etiqueta serviceId y renderiza una sola vez.
export function replaceService(songs, keys) {
  serviceSongs = (songs || []).map((s, i) => ({ ...s, serviceId: Date.now() + i + Math.random() }));
  activeServiceIndex = -1;
  currentSetlistName = ''; // por defecto sin nombre/id; loadSavedSetlist los fija después
  currentSetlistId = null;
  // Los tonos son del servicio que se carga, no del anterior.
  serviceKeys = (keys && typeof keys === 'object') ? { ...keys } : {};
  saveServiceSongs();
  triggerRender();
}

export function removeFromService(serviceId) {
  serviceSongs = serviceSongs.filter(s => s.serviceId !== serviceId);
  saveServiceSongs();
  triggerRender();
}

export function clearServiceList() {
  if (serviceSongs.length === 0) return;
  confirmDialog({
    title: 'Vaciar servicio',
    message: `¿Quitar las ${serviceSongs.length} canciones del set de hoy? La librería no se ve afectada.`,
    confirmLabel: 'Vaciar',
    danger: true,
    onConfirm: () => {
      // Vaciar = empezar una lista de hoy vacía SIN tocar el setlist guardado
      // (se "desengancha" poniendo id=null). Lo guardado conserva sus canciones.
      serviceSongs = [];
      currentSetlistName = '';
      currentSetlistId = null;
      activeServiceIndex = -1;
      saveServiceSongs();
      triggerRender();
    }
  });
}

export function serviceNextSong() {
  if (serviceSongs.length === 0) return;
  activeServiceIndex = (activeServiceIndex + 1) % serviceSongs.length;
  triggerApply(serviceSongs[activeServiceIndex]);
}

/** Read-only peek at the song that comes after the active one (no mutation). */
export function peekNextServiceSong() {
  if (serviceSongs.length === 0) return null;
  const nextIdx = (activeServiceIndex + 1) % serviceSongs.length;
  return serviceSongs[nextIdx];
}

export function servicePrevSong() {
  if (serviceSongs.length === 0) return;
  activeServiceIndex = activeServiceIndex <= 0 ? serviceSongs.length - 1 : activeServiceIndex - 1;
  triggerApply(serviceSongs[activeServiceIndex]);
}

// Drag-and-drop reorder helper. Mutates state and persists; caller re-renders.
export function reorderService(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const item = serviceSongs.splice(fromIdx, 1)[0];
  serviceSongs.splice(toIdx, 0, item);
  saveServiceSongs();
}

// ── Setlists guardados (con nombre + fecha) ───────────────────────────────
// El "Servicio" es la lista de trabajo actual; estos son snapshots con nombre
// que el usuario guarda para reusar (Domingo AM, Jóvenes, etc.). Se guardan
// local Y se comparten a la nube (ver cloud/setlistSync.js), de modo que en una
// PC nueva se materializan solos al iniciar sesión.
const SAVED_KEY = 'livepads-saved-setlists';

export function listSavedSetlists() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch (_) { return []; }
}

// Persiste los setlists guardados.
//   opts.local === false → el cambio VIENE de la nube: no se sella `editedAt`
//   (si se sellara, el setlist quedaría "con cambios sin subir" para siempre y
//   volvería a subir lo que acabamos de bajar, en bucle).
// Firma del contenido COMPARTIBLE de un setlist: lo que viaja a la nube. El
// resto (savedAt, cloudUpdatedAt…) no cuenta como edición.
function setlistFingerprint(s) {
  return JSON.stringify([
    s.name || '', s.date || null, s.description || '',
    (s.songs || []).map(x => String(x.cloudId || x.id || '')),
    // Ordenado: el orden de inserción de un objeto no es contenido, y sin esto
    // un mismo mapa de tonos podía parecer "cambiado" y forzar subidas de más.
    Object.entries(s.keys || {}).sort((a, b) => a[0] < b[0] ? -1 : 1),
  ]);
}

function writeSavedSetlists(arr, opts = {}) {
  const local = opts.local !== false;
  if (local) {
    // Sellar `editedAt` SOLO en los que cambiaron de verdad. Marcarlos todos en
    // cada guardado los dejaría permanentemente "sucios" y volveríamos a subir
    // la lista entera en cada ronda — justo lo que pisaba el trabajo del equipo.
    const prev = new Map(listSavedSetlists().map(s => [s.id, setlistFingerprint(s)]));
    const now = Date.now();
    arr.forEach(s => {
      if (prev.get(s.id) !== setlistFingerprint(s)) s.editedAt = now;
    });
  }
  localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
  // Un cambio LOCAL dispara la subida a la nube (debounced en el listener) para
  // que aparezca en las vistas web y en la app móvil. La subida solo manda los
  // que tienen cambios sin publicar (editedAt > cloudUpdatedAt).
  //
  // Un cambio venido de la nube NO dispara nada: si lo hiciera, cada bajada
  // pediría una subida que a su vez volvería a bajar — una ronda de red
  // perpetua sin ningún cambio real que publicar.
  if (!local) return;
  try { window.dispatchEvent(new Event('livepads:setlists-changed')); } catch (_) {}
}

// ¿Este setlist tiene ediciones locales que la nube todavía no conoce?
export function isSetlistDirty(entry) {
  if (!entry) return false;
  if (!entry.cloudId) return true;                    // nunca publicado
  const local = Number(entry.editedAt || entry.savedAt || 0);
  const cloud = Date.parse(entry.cloudUpdatedAt || '') || 0;
  return local > cloud;
}

// Sella en un setlist local el resultado de una publicación exitosa: id de la
// nube + la marca de tiempo que devolvió el servidor. A partir de aquí deja de
// contar como "sucio" y ya no se re-sube en cada ronda.
export function markSetlistSynced(localId, cloudId, cloudUpdatedAt) {
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === localId);
  if (!e) return false;
  e.cloudId = cloudId || e.cloudId || null;
  e.cloudUpdatedAt = cloudUpdatedAt || e.cloudUpdatedAt || null;
  writeSavedSetlists(arr, { local: false });
  return true;
}

// Trae un setlist de la NUBE a los guardados locales.
//
// Identidad: `cloudId` primero (sobrevive a renombrarlo, que era el agujero del
// dedupe por nombre); el nombre solo se usa para ADOPTAR un setlist local que
// todavía no tiene cloudId — la migración de los que ya existían.
//
// Nunca pisa una edición local más nueva: si el usuario tocó este setlist
// después de la última versión publicada, se conserva lo suyo y la subida (que
// corre en la misma ronda) lo publica. Devuelve 'added' | 'updated' | null.
export function upsertSavedSetlistFromCloud({ cloudId, name, date, songs, keys, updatedAt }) {
  const list = Array.isArray(songs) ? songs : [];
  if (!name || !list.length) return null;
  const arr = listSavedSetlists();
  const clean = list.map(({ serviceId, ...s }) => s);
  const existing = (cloudId && arr.find(s => s.cloudId === cloudId))
                || arr.find(s => !s.cloudId && s.name === name);
  if (existing) {
    // Mi versión es más nueva que la de la nube → no la toco (se subirá).
    if (isSetlistDirty(existing) && Number(existing.editedAt || 0) > (Date.parse(updatedAt || '') || 0)) {
      if (cloudId && !existing.cloudId) { existing.cloudId = cloudId; writeSavedSetlists(arr, { local: false }); }
      return null;
    }
    existing.cloudId = cloudId || existing.cloudId || null;
    existing.cloudUpdatedAt = updatedAt || existing.cloudUpdatedAt || null;
    existing.name = name;
    existing.songs = clean;
    existing.keys = keys && typeof keys === 'object' ? { ...keys } : {};
    existing.date = date || existing.date || null;
    existing.savedAt = Date.now();
    writeSavedSetlists(arr, { local: false });
    // Si es el que está montado ahora mismo, refrescar la lista de trabajo para
    // que el cambio del compañero se vea sin recargar ni recargar el setlist.
    if (currentSetlistId === existing.id) {
      serviceSongs = clean.map((s, i) => ({ ...s, serviceId: Date.now() + i + Math.random() }));
      serviceKeys = { ...(existing.keys || {}) };
      currentSetlistName = existing.name || currentSetlistName;
      saveServiceSongs();
      triggerRender();
    }
    return 'updated';
  }
  arr.unshift({
    id: 's_' + Date.now() + '_' + Math.floor(performance.now()),
    cloudId: cloudId || null,
    cloudUpdatedAt: updatedAt || null,
    name,
    date: date || null,
    savedAt: Date.now(),
    editedAt: 0,          // recién bajado: nada pendiente de subir
    keys: keys && typeof keys === 'object' ? { ...keys } : {},
    songs: clean,
  });
  writeSavedSetlists(arr, { local: false });
  return 'added';
}

// Borra un setlist local porque desapareció de la nube (lápida). No pregunta:
// ya lo confirmó quien lo borró, en su máquina.
export function removeSavedSetlistByCloudId(cloudId) {
  if (!cloudId) return false;
  const arr = listSavedSetlists();
  const e = arr.find(s => s.cloudId === cloudId);
  if (!e) return false;
  writeSavedSetlists(arr.filter(s => s.id !== e.id), { local: false });
  if (currentSetlistId === e.id) {
    currentSetlistId = null;
    currentSetlistName = '';
    saveServiceSongs();
  }
  return true;
}
// Guarda el servicio ACTUAL como un setlist con nombre + fecha (YYYY-MM-DD).
// Devuelve la entrada.
export function saveCurrentAsSetlist(name, date) {
  if (!serviceSongs.length) return null;
  const arr = listSavedSetlists();
  const entry = {
    id: 's_' + Date.now() + '_' + Math.floor(performance.now()),
    name: String(name || 'Servicio').trim() || 'Servicio',
    date: (typeof date === 'string' && date) ? date : null, // fecha del servicio
    savedAt: Date.now(),
    keys: { ...serviceKeys },                            // tonos de hoy
    songs: serviceSongs.map(({ serviceId, ...s }) => s), // serviceId se re-genera al cargar
  };
  arr.unshift(entry);
  writeSavedSetlists(arr);
  // La lista de trabajo PASA A SER este setlist (activo): futuras ediciones se
  // auto-guardan en él.
  currentSetlistId = entry.id;
  currentSetlistName = entry.name;
  saveServiceSongs();
  return entry;
}
// Crea un setlist NUEVO (con canciones iniciales opcionales) y lo deja ACTIVO.
// songs = array de canciones de la librería a incluir de una. Devuelve la entrada.
export function createNewSetlist(name, date, songs, description) {
  const initial = Array.isArray(songs) ? songs : [];
  const arr = listSavedSetlists();
  const entry = {
    id: 's_' + Date.now() + '_' + Math.floor(performance.now()),
    name: String(name || 'Servicio').trim() || 'Servicio',
    date: (typeof date === 'string' && date) ? date : null,
    description: (description || '').trim() || undefined,
    savedAt: Date.now(),
    keys: {},
    songs: initial.map(({ serviceId, ...s }) => s),
  };
  arr.unshift(entry);
  writeSavedSetlists(arr);
  serviceSongs = initial.map((s, i) => ({ ...s, serviceId: Date.now() + i + Math.random() }));
  serviceKeys = {};
  activeServiceIndex = -1;
  currentSetlistId = entry.id;
  currentSetlistName = entry.name;
  saveServiceSongs();
  triggerRender();
  return entry;
}
// Carga un setlist guardado → pasa a ser la lista activa (se edita en vivo).
export function loadSavedSetlist(id) {
  const entry = listSavedSetlists().find(s => s.id === id);
  if (!entry) return false;
  replaceService(entry.songs || [], entry.keys); // setea songs+tonos, limpia name/id
  currentSetlistId = entry.id;           // …y acá enganchamos el setlist activo
  currentSetlistName = entry.name || '';
  saveServiceSongs();                    // re-persistir name/id (sync = no-op)
  return true;
}
// Borra un setlist guardado. Devuelve su cloudId (si lo tenía) para que quien
// llama propague el borrado a la nube — sin esto, el setlist reaparecía en la
// siguiente bajada de cualquier miembro.
export function deleteSavedSetlist(id) {
  const entry = listSavedSetlists().find(s => s.id === id);
  const cloudId = entry ? (entry.cloudId || null) : null;
  writeSavedSetlists(listSavedSetlists().filter(s => s.id !== id));
  // Si borramos el setlist activo, la lista de trabajo se "desengancha".
  if (currentSetlistId === id) {
    currentSetlistId = null;
    currentSetlistName = '';
    saveServiceSongs();
  }
  return cloudId;
}
export function renameSavedSetlist(id, name) {
  updateSetlistMeta(id, name);
}
// Actualiza nombre y/o fecha de un setlist guardado. Si es el activo, refleja el
// nombre en la lista de trabajo.
export function updateSetlistMeta(id, name, date) {
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === id);
  if (!e) return;
  if (name != null) e.name = String(name || '').trim() || e.name;
  if (typeof date === 'string') e.date = date || null;
  writeSavedSetlists(arr);
  if (currentSetlistId === id) { currentSetlistName = e.name; saveServiceSongs(); }
}
// Re-sincroniza las copias del service y de los setlists guardados con la
// canción VIVA de la librería (por id): audio (secuencia/original), tonalidad,
// BPM, carátula, letra, etc. Necesario porque al agregar una canción se copia su
// estado del momento; si luego en Stems se le crea la secuencia (u otra edición),
// la copia del setlist quedaba vieja y no reflejaba el cambio.
const SYNC_FIELDS = ['title', 'artist', 'key', 'bpm', 'cover', 'coverUrl', 'durationSec', 'lyrics', 'tags', 'genre', 'showChords', 'audio'];
export function syncServiceWithLibrary() {
  const lib = getLibrarySongs() || [];
  if (!lib.length) return false;
  const byId = new Map(lib.map(s => [String(s.id), s]));
  // …y por cloudId: es el único id común entre máquinas. Sin esto, una canción
  // que llegó de la nube con otro id local no refrescaba la copia del setlist y
  // el servicio seguía mostrando el tono/letra viejos.
  const byCloud = new Map(lib.filter(s => s.cloudId).map(s => [String(s.cloudId), s]));
  let changed = false;
  const clone = (v) => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  const refresh = (entry) => {
    if (!entry) return;
    const live = (entry.id != null && byId.get(String(entry.id)))
              || (entry.cloudId && byCloud.get(String(entry.cloudId)));
    if (!live) return;
    for (const f of SYNC_FIELDS) {
      if (JSON.stringify(live[f]) !== JSON.stringify(entry[f])) {
        entry[f] = clone(live[f]);
        changed = true;
      }
    }
  };
  serviceSongs.forEach(refresh);
  const saved = listSavedSetlists();
  saved.forEach(set => (set.songs || []).forEach(refresh));
  if (changed) {
    writeSavedSetlists(saved);   // persiste TODOS los setlists guardados sincronizados
    saveServiceSongs();          // persiste la lista de trabajo (+ re-sync del activo)
  }
  return changed;
}

// Duplica un setlist guardado (para servicios recurrentes con variantes).
export function duplicateSetlist(id) {
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === id);
  if (!e) return null;
  const copy = {
    id: 's_' + Date.now() + '_' + Math.floor(performance.now()),
    name: `${e.name || 'Servicio'} (copia)`,
    date: e.date || null,
    description: e.description,
    savedAt: Date.now(),
    // Copia = setlist NUEVO: sin cloudId (se publica como otro registro) pero
    // conservando los tonos elegidos, que es justo lo que se quiere al armar
    // una variante del mismo servicio.
    cloudId: null,
    cloudUpdatedAt: null,
    keys: { ...(e.keys || {}) },
    songs: (e.songs || []).map(s => ({ ...s })),
  };
  arr.unshift(copy);
  writeSavedSetlists(arr);
  return copy;
}

// ── Tono por servicio ──────────────────────────────────────────────────────
// El tono "oficial" de la canción vive en la librería (song.key) y no se toca.
// Aquí se guarda el tono que se usa SOLO en este servicio. Todo lo que suena o
// se muestra en vivo —el pad, los acordes de la letra, el chip de la tarjeta—
// debe pasar por getEffectiveKey, no por song.key.

/** Tono con el que hay que tocar esta canción HOY (override o el de librería). */
export function getEffectiveKey(song) {
  if (!song) return '';
  return serviceKeys[songRef(song)] || song.key || '';
}
/** El override si lo hay, o null si la canción va en su tono de librería. */
export function getKeyOverride(song) {
  if (!song) return null;
  return serviceKeys[songRef(song)] || null;
}
/** ¿Alguna canción del servicio va en un tono distinto al de la librería? */
export function hasKeyOverrides() { return Object.keys(serviceKeys).length > 0; }

/** Fija el tono de esta canción para el servicio actual. */
export function setKeyOverride(song, key) {
  const ref = songRef(song);
  if (!ref) return false;
  const clean = String(key || '').trim();
  // Elegir el mismo tono que la librería = quitar el override (no ensuciamos el
  // mapa con entradas redundantes que luego confunden el chip).
  if (!clean || clean === (song.key || '')) return clearKeyOverride(song);
  serviceKeys[ref] = clean;
  saveServiceSongs();
  return true;
}
/** Vuelve al tono de la librería en este servicio. */
export function clearKeyOverride(song) {
  const ref = songRef(song);
  if (!ref || !(ref in serviceKeys)) return false;
  delete serviceKeys[ref];
  saveServiceSongs();
  return true;
}
/** Mapa completo (para publicarlo en la nube). Copia, no la referencia viva. */
export function getServiceKeys() { return { ...serviceKeys }; }

// Used by applyGiSong: find the matching service entry by title+artist and
// update the active pointer. Returns the matched index (-1 if not found).
export function syncActiveByTitleArtist(song) {
  const idx = serviceSongs.findIndex(s => s.title === song.title && s.artist === song.artist);
  activeServiceIndex = idx;
  return idx;
}
