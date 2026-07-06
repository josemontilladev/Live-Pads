// ─────────────────────────────────────────────────────────────────────────
// Configuración personal por usuario, espejada en la nube (offline-first).
//   · MIDI (pads+stems)  · kits de batería  · servicios/listas  · preferencias
//
// La fuente de trabajo SIEMPRE es lo local (disco + localStorage): la app
// funciona perfecta sin internet y sin latencia. Cuando hay conexión, esto
// espeja la config a Supabase y la baja al entrar en otro equipo.
//
// Decisión de conflicto: last-write-wins por updated_at. Un mismo usuario rara
// vez edita en dos equipos a la vez; si pasara, gana el último que sincronizó.
// ─────────────────────────────────────────────────────────────────────────

import { rest, isCloudEnabled, isLoggedIn, getUser, onAuthChange } from './supabase.js';

const STAMP_KEY = 'livepads-settings-stamp';  // updated_at con el que estamos en sync
const DIRTY_KEY = 'livepads-settings-dirty';  // hay cambios locales sin subir
const PREF_KEYS = [
  'livepads.theme',
  'livepads.skin',
  'livepads:mixer-state',
  'lastPadBankIdx',
  'lastKitBankIdx',
  'tpAutoAdvance',
  'livepads-click-with-seq',
  'livepads-workspace',
];

let pushTimer = null;
let wired = false;
let wasLoggedIn = false;

const isOnline = () => (typeof navigator === 'undefined') || navigator.onLine;
const isDirty = () => localStorage.getItem(DIRTY_KEY) === '1';
function setDirty(v) { try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch (_) {} }

// ── Recolectar la config local actual (para subir) ─────────────────────────
async function collect() {
  const out = { v: 1 };
  try { const m = await import('../midi/midiMap.js'); out.midi = m.getAllMidiMaps(); } catch (_) {}
  try { out.drums = window.electronAPI ? await window.electronAPI.loadUserDrums() : null; } catch (_) {}
  try { const s = await import('../data/service.js'); out.service = s.getServiceSongs(); } catch (_) {}
  out.prefs = {};
  PREF_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v != null) out.prefs[k] = v; });
  return out;
}

// ── Escribir una config bajada en los almacenes locales ────────────────────
// Solo escribe a disco/localStorage; el arranque (o un reload) la aplica.
async function writeToLocal(data) {
  if (!data) return;
  if (data.midi && window.electronAPI?.saveMidiMapSync) {
    try { window.electronAPI.saveMidiMapSync(data.midi); } catch (_) {}
  }
  if (data.drums && window.electronAPI?.saveUserDrums) {
    try { await window.electronAPI.saveUserDrums(data.drums); } catch (_) {}
  }
  if (Array.isArray(data.service)) {
    try { localStorage.setItem('serviceSongs', JSON.stringify(data.service)); } catch (_) {}
  }
  if (data.prefs && typeof data.prefs === 'object') {
    Object.entries(data.prefs).forEach(([k, v]) => { try { localStorage.setItem(k, String(v)); } catch (_) {} });
  }
}

// ── Subir (push) ────────────────────────────────────────────────────────────
async function doPush() {
  if (!isCloudEnabled() || !isLoggedIn() || !isOnline()) return false;
  const u = getUser(); if (!u) return false;
  try {
    const data = await collect();
    const rows = await rest('/user_settings?on_conflict=user_id', {
      method: 'POST',
      body: [{ user_id: u.id, data }],
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.updated_at) localStorage.setItem(STAMP_KEY, row.updated_at);
    setDirty(false);
    return true;
  } catch (_) { return false; /* sin red/permiso: queda dirty, reintenta luego */ }
}

// Marca cambios y agenda una subida (silenciosa, con rebote).
function notifyChanged() {
  setDirty(true);
  if (!isCloudEnabled() || !isLoggedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { doPush(); }, 4000);
}

// ── Escuchas de runtime (una sola vez) ──────────────────────────────────────
function wireRuntime() {
  if (wired) return;
  wired = true;
  wasLoggedIn = isLoggedIn();
  window.addEventListener('livepads:settings-changed', notifyChanged);
  window.addEventListener('online', () => { if (isDirty()) doPush(); });
  // Login a mitad de sesión → baja la config del usuario y reaplica.
  onAuthChange((session) => {
    const now = !!(session && session.access_token);
    if (now && !wasLoggedIn) { wasLoggedIn = true; handleFreshLogin(); }
    else if (!now) { wasLoggedIn = false; }
  });
}

async function handleFreshLogin() {
  if (!isOnline()) return;
  const u = getUser(); if (!u) return;
  try {
    const rows = await rest(`/user_settings?select=data,updated_at&user_id=eq.${u.id}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) {
      if (row.updated_at !== localStorage.getItem(STAMP_KEY)) {
        await writeToLocal(row.data);
        localStorage.setItem(STAMP_KEY, row.updated_at);
        setDirty(false);
        location.reload();  // aplica MIDI/kits/servicios/prefs de forma limpia
        return;
      }
    } else {
      await doPush();       // primera vez: sube la config local de este equipo
    }
  } catch (_) {}
}

// ── Sincronización al arrancar, ANTES de que el boot lea la config local ────
// Si la nube tiene algo más nuevo, lo escribe en local y el arranque lo toma.
// Si no hay nada en la nube (o hay cambios locales sin subir), lo sube luego.
export async function bootSyncBeforeLoad() {
  if (!isCloudEnabled()) { return; }
  if (!isLoggedIn() || !isOnline()) { wireRuntime(); return; }
  const u = getUser();
  try {
    const rows = await rest(`/user_settings?select=data,updated_at&user_id=eq.${u.id}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      setDirty(true);                       // aún no hay nube → subiremos lo local
    } else if (row.updated_at !== localStorage.getItem(STAMP_KEY)) {
      await writeToLocal(row.data);          // nube más nueva → a local antes de cargar
      localStorage.setItem(STAMP_KEY, row.updated_at);
      setDirty(false);
    }
  } catch (_) { /* sin red: arranca en local, sin bloquear */ }
  wireRuntime();
  if (isDirty()) setTimeout(() => doPush(), 6000);   // subida inicial tras el arranque
}

// Forzar subida/bajada manual (por si lo quieres exponer en el panel).
export const syncSettingsNow = doPush;
