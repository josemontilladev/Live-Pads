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
import { hasFeature } from '../billing/license.js';

const POLL_MS = 45000;            // ronda periódica
const STARTUP_DELAY_MS = 4000;    // respiro tras arrancar antes del primer intento
const LOCAL_EDIT_GRACE_MS = 5000; // no bajar si hubo edición local hace <5s

let started = false;
let timer = null;
let pulling = false;
let lastLocalEdit = 0;
// Última ronda que terminó BIEN (ms). Es el dato que responde "¿cuándo fue la
// última vez que esto habló con la nube?" en el panel Mi cuenta.
let lastSyncAt = 0;
export function getLastSyncAt() { return lastSyncAt; }

// Archivos (carátulas + audio): se revisan al arrancar, al volver a la app y, como
// mucho, cada FILE_CHECK_MS. Antes SOLO bajaban pulsando "Sincronizar" a mano: un
// invitado veía las canciones pero sin carátulas ni audios.
const FILE_CHECK_MS = 3 * 60 * 1000;
let lastFileCheck = 0;
let downloadingFiles = false;
let filesLibId = null;

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

async function syncFilesNow(force = false) {
  if (downloadingFiles) return;
  if (!isLoggedIn() || !getActiveLibraryId()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (!force && Date.now() - lastFileCheck < FILE_CHECK_MS) return;
  if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.libraryFilesStat) return;
  downloadingFiles = true;
  filesLibId = getActiveLibraryId();
  lastFileCheck = Date.now();
  let announced = false;
  try {
    const { bajarFaltantesAuto } = await import('./fileSync.js');
    const r = await bajarFaltantesAuto({
      shouldStop: () => (typeof navigator !== 'undefined' && !navigator.onLine) || getActiveLibraryId() !== filesLibId,
      onProgress: ({ done, total }) => {
        if (!total) return;
        try {
          window.dispatchEvent(new CustomEvent('livepads:file-sync', { detail: { done, total, announce: !announced } }));
        } catch (_) {}
        announced = true;
      },
      // Con las carátulas ya en disco, refresca la lista para que se vean.
      onImages: () => { try { window.dispatchEvent(new CustomEvent('livepads:library-synced')); } catch (_) {} },
    });
    if (r && r.downloaded > 0) {
      try { window.dispatchEvent(new CustomEvent('livepads:file-sync', { detail: { done: r.total, total: r.total, finished: true, downloaded: r.downloaded, failed: r.failed } })); } catch (_) {}
    }
  } catch (_) {
    // sin red / sin permiso: se reintenta en la próxima ronda
  } finally {
    downloadingFiles = false;
  }
}

async function pullNow() {
  if (!canPullNow()) return;
  pulling = true;
  try {
    const r = await pullLibrarySongs();
    // Los SERVICIOS viajan en la misma ronda, justo después de las canciones
    // (que es lo que les da el cloudId con el que se resuelven). Antes solo se
    // bajaban pulsando "⬇ Bajar" a mano, así que un servicio creado por otro
    // miembro no aparecía nunca solo — y la subida ciega del arranque llegaba a
    // pisarlo. autoSyncSetlists baja y luego publica lo que uno editó.
    try {
      const { autoSyncSetlists } = await import('./setlistSync.js');
      await autoSyncSetlists();
    } catch (_) {}
    lastSyncAt = Date.now();
    // Carátulas y audios que falten (en segundo plano; no bloquea esta ronda). Si la
    // ronda trajo canciones nuevas o cambios, se revisa ya sin esperar el intervalo.
    const hadChanges = !!(r && (r.added || r.refreshed || r.linked));
    syncFilesNow(hadChanges);
    if (r && ((Array.isArray(r.byOthers) && r.byOthers.length) || r.removed)) {
      try {
        window.dispatchEvent(new CustomEvent('livepads:library-activity', {
          detail: { changes: r.byOthers || [], removed: r.deletedTitles || [] },
        }));
      } catch (_) {}
    }
    // Conflictos: otro miembro editó una canción que tú también cambiaste sin
    // subir. NO se pisó nada; el usuario decide (diálogo mía/de ellos).
    if (r && Array.isArray(r.conflicts) && r.conflicts.length) {
      try {
        window.dispatchEvent(new CustomEvent('livepads:library-conflict', { detail: { conflicts: r.conflicts } }));
      } catch (_) {}
    }
  } catch (_) {
    // sin red / sin permiso / sesión expirada: se reintenta en la próxima ronda
  } finally {
    pulling = false;
  }
}

// Sincronización de ARRANQUE, con la pantalla de carga visible: baja canciones y
// servicios de la nube y las carátulas que falten ANTES de mostrar la app, y deja
// los audios (pesados) bajando en segundo plano. Nunca bloquea más de `maxMs`:
// sin sesión, sin red o con la nube lenta, la app abre igual con lo que hay local.
export async function bootSyncOnce({ onStatus = () => {}, maxMs = 12000 } = {}) {
  if (!hasFeature('cloud')) return null;
  if (!isLoggedIn() || !getActiveLibraryId()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const t0 = Date.now();
  const left = () => Math.max(0, maxMs - (Date.now() - t0));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res('timeout'), ms))]);
  pulling = true;
  try {
    onStatus('Buscando actualizaciones del repertorio…');
    const r = await withTimeout(pullLibrarySongs().catch(() => null), left());
    if (r && r !== 'timeout') {
      onStatus('Sincronizando servicios del equipo…');
      try {
        const { autoSyncSetlists } = await import('./setlistSync.js');
        await withTimeout(autoSyncSetlists().catch(() => null), left());
      } catch (_) {}
      lastSyncAt = Date.now();
      try { window.dispatchEvent(new CustomEvent('livepads:library-synced')); } catch (_) {}
    }
    if (left() > 1500 && window.electronAPI && window.electronAPI.libraryFilesStat) {
      onStatus('Revisando carátulas y audios…');
      const { bajarFaltantesAuto } = await import('./fileSync.js');
      const t1 = Date.now();
      await withTimeout(bajarFaltantesAuto({
        imagesOnly: true,
        shouldStop: () => Date.now() - t0 > maxMs,
        onProgress: ({ done, total }) => { if (total) onStatus(`Descargando carátulas (${Math.min(done + 1, total)}/${total})…`); },
      }).catch(() => null), left());
      void t1;
      try { window.dispatchEvent(new CustomEvent('livepads:library-synced')); } catch (_) {}
    }
  } catch (_) {
    // cualquier fallo: la app abre igual
  } finally {
    pulling = false;
  }
  // Los audios siguen en segundo plano (con aviso discreto) ya con la app abierta.
  setTimeout(() => syncFilesNow(true), 1500);
}

// Arranca el sincronizador. Idempotente: llamarlo varias veces no duplica.
export function startLibraryLiveSync() {
  if (!hasFeature('cloud')) return;
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

// Forzar la bajada de archivos ya (p. ej. al cambiar de librería o unirse a una).
export function checkFilesNow() { return syncFilesNow(true); }
