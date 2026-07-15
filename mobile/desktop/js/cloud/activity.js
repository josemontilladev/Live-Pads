// ─────────────────────────────────────────────────────────────────────────
// Historial de actividad de la librería compartida: quién añadió/editó/borró
// una canción o se unió al equipo. Append-only (tabla library_activity, RLS).
// Todo best-effort: sin sesión/red o si falta la migración 0008, no rompe nada.
// ─────────────────────────────────────────────────────────────────────────

import { rest, getUser, isLoggedIn } from './supabase.js';

// Registra un evento. `type`: 'added' | 'edited' | 'deleted' | 'joined'.
// Fire-and-forget: nunca lanza (se traga los errores) para no afectar el sync.
export async function logActivity(libraryId, type, songTitle) {
  const u = getUser();
  if (!libraryId || !u || !isLoggedIn()) return;
  try {
    await rest('/library_activity', {
      method: 'POST',
      body: { library_id: libraryId, actor_id: u.id, type, song_title: songTitle ? String(songTitle).slice(0, 300) : null },
      prefer: 'return=minimal',
    });
  } catch (_) { /* sin red / sin tabla / sin permiso: se ignora */ }
}

// Últimos N eventos de la librería, con el nombre del actor embebido.
export function listActivity(libraryId, limit = 15) {
  return rest(`/library_activity?select=type,song_title,created_at,actor:actor_id(display_name,email)&library_id=eq.${libraryId}&order=created_at.desc&limit=${limit}`);
}
