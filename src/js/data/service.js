// Service setlist state + CRUD. Holds the running order of the current
// service. State is module-private; callers interact via the exported API
// so app.js no longer needs the underlying `let` globals.
//
// The render and applyGiSong functions live in app.js (heavy DOM logic),
// so they are injected once at boot via initService(deps).

import { confirmDialog } from '../ui/dialog.js';

let serviceSongs = [];
let activeServiceIndex = -1;
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

// Vuelca la lista de trabajo al setlist guardado activo (si hay), para que
// agregar/quitar/reordenar se persista en vivo en ese setlist.
function syncActiveSetlist() {
  if (!currentSetlistId) return;
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === currentSetlistId);
  if (!e) { currentSetlistId = null; return; }
  e.songs = serviceSongs.map(({ serviceId, ...s }) => s);
  if (currentSetlistName) e.name = currentSetlistName;
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
  syncActiveSetlist(); // mantener el setlist guardado activo en sync
  try { window.dispatchEvent(new Event('livepads:settings-changed')); } catch (_) {}
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
export function replaceService(songs) {
  serviceSongs = (songs || []).map((s, i) => ({ ...s, serviceId: Date.now() + i + Math.random() }));
  activeServiceIndex = -1;
  currentSetlistName = ''; // por defecto sin nombre/id; loadSavedSetlist los fija después
  currentSetlistId = null;
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
// que el usuario guarda para reusar (Domingo AM, Jóvenes, etc.). Solo locales.
const SAVED_KEY = 'livepads-saved-setlists';

export function listSavedSetlists() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch (_) { return []; }
}
function writeSavedSetlists(arr) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
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
// Crea un setlist NUEVO y vacío, y lo deja ACTIVO (para empezar a agregarle
// canciones desde la Librería). Devuelve la entrada.
export function createNewSetlist(name, date) {
  const arr = listSavedSetlists();
  const entry = {
    id: 's_' + Date.now() + '_' + Math.floor(performance.now()),
    name: String(name || 'Servicio').trim() || 'Servicio',
    date: (typeof date === 'string' && date) ? date : null,
    savedAt: Date.now(),
    songs: [],
  };
  arr.unshift(entry);
  writeSavedSetlists(arr);
  serviceSongs = [];
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
  replaceService(entry.songs || []);     // setea songs, limpia name/id
  currentSetlistId = entry.id;           // …y acá enganchamos el setlist activo
  currentSetlistName = entry.name || '';
  saveServiceSongs();                    // re-persistir name/id (sync = no-op)
  return true;
}
export function deleteSavedSetlist(id) {
  writeSavedSetlists(listSavedSetlists().filter(s => s.id !== id));
  // Si borramos el setlist activo, la lista de trabajo se "desengancha".
  if (currentSetlistId === id) {
    currentSetlistId = null;
    currentSetlistName = '';
    saveServiceSongs();
  }
}
export function renameSavedSetlist(id, name) {
  const arr = listSavedSetlists();
  const e = arr.find(s => s.id === id);
  if (!e) return;
  e.name = String(name || '').trim() || e.name;
  writeSavedSetlists(arr);
}

// Used by applyGiSong: find the matching service entry by title+artist and
// update the active pointer. Returns the matched index (-1 if not found).
export function syncActiveByTitleArtist(song) {
  const idx = serviceSongs.findIndex(s => s.title === song.title && s.artist === song.artist);
  activeServiceIndex = idx;
  return idx;
}
