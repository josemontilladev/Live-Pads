// ─────────────────────────────────────────────────────────────────────────
// Capa de datos de la nube: librerías (carpetas) + membresías + invitaciones.
// Todo pasa por las políticas RLS del servidor; aquí solo armamos las llamadas
// REST/RPC. La librería "activa" se recuerda en localStorage por usuario.
// ─────────────────────────────────────────────────────────────────────────

import { rest, rpc, getUser } from './supabase.js';
import { logActivity } from './activity.js';

const ACTIVE_LIB_KEY = 'livepads-active-library';

// ── Librerías ─────────────────────────────────────────────────────────────

// Última lista conocida de librerías, para consultas SÍNCRONAS (p. ej. al pintar
// el form de editar/crear canción, que no puede await-ear). Se refresca sola en
// cada `listLibraries()` (lo llaman el selector, ensureActiveLibrary, etc.).
// Además se PERSISTE en disco (localStorage) por usuario, para que las librerías
// sigan disponibles SIN internet una vez que se cargaron estando online.
let _librariesCache = [];
const LIB_CACHE_KEY = 'livepads-libraries-cache';
function libCacheKey() {
  const u = getUser();
  return u && u.id ? `${LIB_CACHE_KEY}::${u.id}` : LIB_CACHE_KEY;
}

// Última lista conocida — en memoria, o rehidratada del disco (offline). Vacía
// solo si el usuario nunca cargó sus librerías estando online.
export function getCachedLibraries() {
  if (_librariesCache.length) return _librariesCache;
  try {
    const raw = localStorage.getItem(libCacheKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) { _librariesCache = arr; return arr; } }
  } catch (_) {}
  return _librariesCache;
}

// Todas las librerías donde el usuario es miembro (suyas + invitadas).
export async function listLibraries() {
  const rows = await rest('/libraries?select=id,name,owner_id,created_at&order=created_at.asc');
  if (Array.isArray(rows)) {
    _librariesCache = rows;
    try { localStorage.setItem(libCacheKey(), JSON.stringify(rows)); } catch (_) {}  // cache offline
  }
  return rows;
}

export async function createLibrary(name) {
  const u = getUser();
  if (!u) throw new Error('No has iniciado sesión.');
  const rows = await rest('/libraries', {
    method: 'POST',
    body: { name: String(name || '').trim() || 'Mi librería', owner_id: u.id },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function renameLibrary(id, name) {
  await rest(`/libraries?id=eq.${id}`, {
    method: 'PATCH',
    body: { name: String(name || '').trim() },
    prefer: 'return=minimal',
  });
  return true;
}

export async function deleteLibrary(id) {
  await rest(`/libraries?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (getActiveLibraryId() === id) setActiveLibraryId(null);
  return true;
}

// Salir de una librería en la que eres invitado (borra tu propia membresía).
// El dueño no "sale": elimina la librería. RLS solo permite borrar la membresía
// propia de rol distinto a owner.
export async function leaveLibrary(libraryId) {
  const u = getUser();
  if (!u) throw new Error('Sesión no válida.');
  await rest(`/memberships?library_id=eq.${libraryId}&user_id=eq.${u.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (getActiveLibraryId() === libraryId) setActiveLibraryId(null);
  return true;
}

// ── Membresías (miembros de una librería) ─────────────────────────────────

// Devuelve los miembros con su correo (vía join al profile).
export function listMembers(libraryId) {
  return rest(`/memberships?select=id,role,user_id,created_at,profiles(email,display_name)&library_id=eq.${libraryId}&order=created_at.asc`);
}

export async function removeMember(membershipId) {
  await rest(`/memberships?id=eq.${membershipId}`, { method: 'DELETE', prefer: 'return=minimal' });
  return true;
}

export async function changeMemberRole(membershipId, role) {
  await rest(`/memberships?id=eq.${membershipId}`, {
    method: 'PATCH', body: { role }, prefer: 'return=minimal',
  });
  return true;
}

// ── Invitaciones ───────────────────────────────────────────────────────────

export function listInvites(libraryId) {
  return rest(`/invites?select=id,email,role,token,status,expires_at,created_at&library_id=eq.${libraryId}&order=created_at.desc`);
}

export async function createInvite(libraryId, email, role = 'viewer') {
  const u = getUser();
  const rows = await rest('/invites', {
    method: 'POST',
    body: {
      library_id: libraryId,
      email: String(email || '').trim().toLowerCase(),
      role: role === 'editor' ? 'editor' : 'viewer',
      invited_by: u ? u.id : null,
    },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

// Crea una invitación "por enlace/código" SIN correo concreto: genera el token
// (código) para compartir por WhatsApp/chat. Requiere la migración 0007
// (invites.email nullable). Devuelve la fila con su `token`.
export async function createShareInvite(libraryId, role = 'viewer') {
  const u = getUser();
  const rows = await rest('/invites', {
    method: 'POST',
    body: {
      library_id: libraryId,
      email: null,
      role: role === 'editor' ? 'editor' : 'viewer',
      invited_by: u ? u.id : null,
    },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function revokeInvite(inviteId) {
  await rest(`/invites?id=eq.${inviteId}`, {
    method: 'PATCH', body: { status: 'revoked' }, prefer: 'return=minimal',
  });
  return true;
}

// Aceptar una invitación con su código/token (la llama el invitado logueado).
// Devuelve el id de la librería a la que se unió.
export async function acceptInvite(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Pega el código de invitación.');
  const libId = await rpc('accept_invite', { invite_token: t });
  if (libId) { setActiveLibraryId(libId); logActivity(libId, 'joined', null); }
  return libId;
}

// ── Librería activa (recordada localmente) ─────────────────────────────────

export function getActiveLibraryId() {
  return localStorage.getItem(ACTIVE_LIB_KEY) || null;
}
export function setActiveLibraryId(id) {
  if (id) localStorage.setItem(ACTIVE_LIB_KEY, id);
  else localStorage.removeItem(ACTIVE_LIB_KEY);
}

// Asegura que el usuario tenga al menos una librería y devuelve la activa.
// Si no tiene ninguna, crea "Mi librería" automáticamente.
export async function ensureActiveLibrary() {
  const libs = await listLibraries();
  if (!libs || !libs.length) {
    const lib = await createLibrary('Mi librería');
    setActiveLibraryId(lib.id);
    return lib;
  }
  const activeId = getActiveLibraryId();
  const found = activeId && libs.find(l => l.id === activeId);
  const active = found || libs[0];
  setActiveLibraryId(active.id);
  return active;
}
