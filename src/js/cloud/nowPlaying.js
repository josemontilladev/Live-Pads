// ─────────────────────────────────────────────────────────────────────────
// Publica "qué suena ahora" en la nube (tabla now_playing, una fila por
// librería) para que la banda lo vea desde el móvil sin estar en la misma
// WiFi. Best-effort: sin sesión, sin librería activa o sin la migración 0012
// aplicada, no hace nada y no molesta.
// ─────────────────────────────────────────────────────────────────────────

import { rest, isLoggedIn, getUser } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getServiceSongs, getActiveServiceIndex, getEffectiveKey } from '../data/service.js';
import { isLiveAudio } from '../ui/liveGuard.js';

const DEBOUNCE_MS = 700;
const HEARTBEAT_MS = 60000;   // refresca is_live/updated_at aunque no cambie la canción

let started = false;
let timer = null;
let lastPayload = '';
let unsupported = false;      // la tabla no existe (migración pendiente) → silencio

function snapshot() {
  const songs = getServiceSongs();
  const idx = getActiveServiceIndex();
  const now = idx >= 0 ? songs[idx] : null;
  const next = idx >= 0 ? songs[idx + 1] : null;
  return {
    song_id: now?.cloudId || null,
    title: now ? (now.title || 'Sin título') : null,
    artist: now ? (now.artist || '') : null,
    key: now ? (getEffectiveKey(now) || null) : null,
    next_song_id: next?.cloudId || null,
    next_title: next ? (next.title || 'Sin título') : null,
    next_key: next ? (getEffectiveKey(next) || null) : null,
    position: idx >= 0 ? idx + 1 : null,
    total: songs.length,
    is_live: isLiveAudio(),
  };
}

async function publish(force = false) {
  if (unsupported || !isLoggedIn()) return;
  const libId = getActiveLibraryId();
  const user = getUser();
  if (!libId || !user) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const body = { library_id: libId, updated_by: user.id, updated_at: new Date().toISOString(), ...snapshot() };
  const sig = JSON.stringify({ ...body, updated_at: null });
  if (!force && sig === lastPayload) return;

  try {
    await rest('/now_playing?on_conflict=library_id', {
      method: 'POST',
      body,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    lastPayload = sig;
  } catch (e) {
    const msg = String(e && e.message || e);
    // 404 / relación inexistente: la BD del equipo aún no tiene la migración.
    if (/404|does not exist|not found|could not find|schema cache|42P01|PGRST205/i.test(msg)) unsupported = true;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => publish(false), DEBOUNCE_MS);
}

export function startNowPlayingPublisher() {
  if (started) return;
  started = true;
  window.addEventListener('livepads:song-state', schedule);
  // Cambiar de librería dispara una bajada → republicar en la nueva.
  window.addEventListener('livepads:library-synced', () => { lastPayload = ''; schedule(); });
  window.addEventListener('online', schedule);
  setInterval(() => publish(true), HEARTBEAT_MS);
  setTimeout(() => publish(false), 5000);
}
