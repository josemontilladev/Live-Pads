// ─────────────────────────────────────────────────────────────────────────
// Lápidas de borrado (tabla `deletions`).
//
// El problema que resuelven: borrar una fila de Supabase NO es suficiente en un
// equipo. Cualquier compañero que todavía tenga la canción en su copia local la
// vuelve a insertar —con el mismo uuid— en su siguiente auto-push, y el borrado
// "revive". La lápida deja constancia de que ese id está muerto: los demás
// clientes borran su copia local y dejan de re-subirla.
//
// Tolerante a que la migración 0011 no esté aplicada todavía: si la tabla no
// existe, todo devuelve vacío y la app sigue funcionando como antes.
// ─────────────────────────────────────────────────────────────────────────

import { rest, getUser } from './supabase.js';

// Ids muertos ya conocidos, por librería: { libId: { song: Set, setlist: Set } }.
// Lo consulta el push para no resucitar nada entre bajada y bajada.
const known = new Map();

function bucket(libId) {
  if (!known.has(libId)) known.set(libId, { song: new Set(), setlist: new Set() });
  return known.get(libId);
}

/** ¿Este id de la nube está marcado como borrado? (consulta en memoria) */
export function isDeleted(libId, entity, entityId) {
  if (!libId || !entityId) return false;
  return bucket(libId)[entity].has(String(entityId));
}

/** Ids muertos conocidos de un tipo, como Set (para filtrar en bloque). */
export function deletedIds(libId, entity) {
  return libId ? bucket(libId)[entity] : new Set();
}

/**
 * Marca algo como borrado en la nube. Best-effort: sin sesión, sin permiso de
 * editor o sin la migración aplicada, no lanza (el DELETE ya se hizo igual).
 */
export async function recordDeletion(libId, entity, entityId, title) {
  if (!libId || !entityId) return false;
  bucket(libId)[entity].add(String(entityId));
  const me = getUser();
  if (!me) return false;
  try {
    await rest('/deletions?on_conflict=library_id,entity,entity_id', {
      method: 'POST',
      body: {
        library_id: libId,
        entity,
        entity_id: entityId,
        title: title ? String(title).slice(0, 300) : null,
        deleted_by: me.id,
      },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    return true;
  } catch (e) {
    // La causa habitual es que falte la migración 0011. Dejar rastro: un fallo
    // silencioso aquí devuelve el bug de los borrados que reaparecen.
    try { console.warn('[tombstones] no se pudo registrar el borrado:', e && e.message); } catch (_) {}
    return false;
  }
}

/**
 * Trae las lápidas de la librería y refresca la caché en memoria.
 * Devuelve { song: Set, setlist: Set } — vacíos si la tabla aún no existe.
 */
export async function fetchDeletions(libId) {
  if (!libId) return { song: new Set(), setlist: new Set() };
  const b = bucket(libId);
  try {
    const rows = await rest(`/deletions?library_id=eq.${libId}&select=entity,entity_id`);
    if (Array.isArray(rows)) {
      // Reconstruimos desde cero: si alguien quitó una lápida a propósito
      // (resucitar una canción), esa resurrección debe poder ocurrir.
      b.song = new Set();
      b.setlist = new Set();
      rows.forEach(r => { if (b[r.entity]) b[r.entity].add(String(r.entity_id)); });
    }
  } catch (_) {
    // Sin tabla / sin red: nos quedamos con lo que ya teníamos en memoria.
  }
  return b;
}

/** Levanta la lápida: permite volver a crear ese id (resurrección explícita). */
export async function clearDeletion(libId, entity, entityId) {
  if (!libId || !entityId) return false;
  bucket(libId)[entity].delete(String(entityId));
  try {
    await rest(
      `/deletions?library_id=eq.${libId}&entity=eq.${entity}&entity_id=eq.${entityId}`,
      { method: 'DELETE', prefer: 'return=minimal' }
    );
    return true;
  } catch (_) { return false; }
}
