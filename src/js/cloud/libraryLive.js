// ─────────────────────────────────────────────────────────────────────────
// Sincronización "en vivo" de la librería activa: baja en background los
// cambios que hacen otros miembros del equipo, sin pulsar "⬇ Bajar".
//
//   · al arrancar la app (tras un pequeño respiro)
//   · al volver a enfocar/mostrar la ventana (captó cambios estando fuera)
//   · al recuperar la conexión
//   · y cada POLL_MS mientras la app está online y visible
//
// Es best-effort: sin sesión, sin librería activa o sin internet, no hace nada.
// Cuando detecta cambios hechos por OTRO miembro, emite `livepads:library-activity`
// con { changes: [{ title, byName }] } para que la UI avise (toast/badge).
//
// Guardas de conflicto (para no pisar el trabajo local):
//   · no baja mientras hay una subida en vuelo (isPushInFlight)
//   · no baja mientras el editor de letra está abierto (#gi-lyrics-modal)
//   · no baja si hubo una edición local hace menos de LOCAL_EDIT_GRACE_MS
//     (deja que el auto-push la suba primero)
// La fusión en songSync solo aplica lo que la nube trae MÁS NUEVO, así que una
// edición local aún sin subir nunca se sobreescribe con datos viejos.
// ─────────────────────────────────────────────────────────────────────────

import { pullLibrarySongs, isPushInFlight } from './songSync.js';
import { isLoggedIn } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';

const POLL_MS = 45000;            // ronda periódica
const STARTUP_DELAY_MS = 4000;    // respiro tras arrancar antes del primer intento
const LOCAL_EDIT_GRACE_MS = 5000; // no bajar si hubo edición local hace <5s

let started = false;
let timer = null;
let pulling = false;
let lastLocalEdit = 0;

function markLocalEdit() { lastLocalEdit = Date.now(); }

function canPullNow() {
  if (pulling) return false;
  if (!isLoggedIn()) return false;
  if (!getActiveLibraryId()) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (isPushInFlight()) return false;
  // Editor de letra abierto: no tocar la lista por debajo del usuario.
  if (typeof document !== 'undefined' && document.getElementById('gi-lyrics-modal')) return false;
  // Edición local muy reciente: deja que el auto-push (debounce 2s) la suba
  // antes de bajar, para no pisarla con la copia previa de la nube.
  if (Date.now() - lastLocalEdit < LOCAL_EDIT_GRACE_MS) return false;
  return true;
}

async function pullNow() {
  if (!canPullNow()) return;
  pulling = true;
  try {
    const r = await pullLibrarySongs();
    if (r && Array.isArray(r.byOthers) && r.byOthers.length) {
      try {
        window.dispatchEvent(new CustomEvent('livepads:library-activity', { detail: { changes: r.byOthers } }));
      } catch (_) {}
    }
  } catch (_) {
    // sin red / sin permiso / sesión expirada: se reintenta en la próxima ronda
  } finally {
    pulling = false;
  }
}

// Arranca el sincronizador. Idempotente: llamarlo varias veces no duplica.
export function startLibraryLiveSync() {
  if (started) return;
  started = true;

  // Marca ediciones locales para respetar la ventana de gracia.
  window.addEventListener('livepads:cloud-dirty', markLocalEdit);
  window.addEventListener('livepads:songs-changed', markLocalEdit);

  // Vuelta a la app / reconexión → intento inmediato.
  window.addEventListener('focus', pullNow);
  window.addEventListener('online', pullNow);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullNow(); });

  // Ronda periódica + primer intento tras el arranque.
  timer = setInterval(pullNow, POLL_MS);
  setTimeout(pullNow, STARTUP_DELAY_MS);
}

export function stopLibraryLiveSync() {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

// Fuerza una comprobación ya (p. ej. justo tras unirse a una librería o cambiar
// la activa). Respeta las mismas guardas.
export function checkLibraryNow() { return pullNow(); }
