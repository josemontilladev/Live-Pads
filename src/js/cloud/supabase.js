// ─────────────────────────────────────────────────────────────────────────
// Cliente Supabase mínimo (auth + REST) hecho con fetch.
//
// No usamos la librería @supabase/supabase-js para no inflar el bundle: el
// renderer carga ES modules crudos (sin empaquetador) y la prioridad es que la
// app sea ligera y rápida. Esto habla directo con la API REST de GoTrue/PostgREST,
// que es exactamente lo que hace la librería grande por debajo.
// ─────────────────────────────────────────────────────────────────────────

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from './config.js';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const REST = `${SUPABASE_URL}/rest/v1`;

// Sesión en memoria: { access_token, refresh_token, expires_at(ms), user }
let session = null;
const listeners = new Set();

export function isCloudEnabled() { return CLOUD_ENABLED; }
export function getSession() { return session; }
export function getUser() { return session ? session.user : null; }
export function isLoggedIn() { return !!(session && session.access_token); }

// Suscribirse a cambios de sesión (login/logout/refresh). Devuelve un
// des-suscriptor.
export function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() { listeners.forEach(cb => { try { cb(session); } catch (_) {} }); }

// ── Persistencia cifrada (vía main process / safeStorage) ─────────────────
async function persist() {
  try {
    if (session) await window.electronAPI.authSaveSession(session);
    else await window.electronAPI.authClearSession();
  } catch (_) {}
}

// ── Llamadas HTTP base ────────────────────────────────────────────────────
async function authFetch(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(`${AUTH}${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.error_description || data.msg || data.error || data.message)) || `Error ${res.status}`;
    throw new Error(translateAuthError(msg));
  }
  return data;
}

function translateAuthError(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed'))        return 'Aún no confirmaste tu correo. Revisa tu bandeja de entrada.';
  if (m.includes('user already registered'))    return 'Ya existe una cuenta con ese correo.';
  if (m.includes('password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('unable to validate email'))   return 'El correo no es válido.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  return msg;
}

function applyTokenResponse(data) {
  // respuesta de /token o /signup con sesión activa
  if (!data || !data.access_token) return null;
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
    user: data.user || (session && session.user) || null,
  };
  persist();
  emit();
  return session;
}

// ── API pública ───────────────────────────────────────────────────────────

// Registro. Con confirmación por correo activada, NO devuelve sesión: el
// usuario debe confirmar el email antes de poder entrar.
export async function signUp(email, password, displayName) {
  const data = await authFetch('/signup', {
    body: {
      email, password,
      data: displayName ? { display_name: displayName } : undefined,
    },
  });
  // Si el proyecto NO exige confirmación, signup devuelve sesión: la aplicamos.
  if (data && data.access_token) applyTokenResponse(data);
  // needsConfirmation = true cuando hay usuario pero todavía sin sesión.
  const needsConfirmation = !!(data && !data.access_token);
  return { needsConfirmation, user: data && (data.user || data) };
}

export async function signIn(email, password) {
  const data = await authFetch('/token?grant_type=password', { body: { email, password } });
  return applyTokenResponse(data);
}

export async function resetPassword(email) {
  await authFetch('/recover', { body: { email } });
  return true;
}

export async function signOut() {
  try {
    if (session && session.access_token) {
      await authFetch('/logout', { token: session.access_token });
    }
  } catch (_) { /* da igual si el token ya no es válido */ }
  session = null;
  persist();
  emit();
}

// Renueva el access_token usando el refresh_token. Devuelve true si quedó una
// sesión válida.
async function refreshSession() {
  if (!session || !session.refresh_token) return false;
  try {
    const data = await authFetch('/token?grant_type=refresh_token', {
      body: { refresh_token: session.refresh_token },
    });
    return !!applyTokenResponse(data);
  } catch (_) {
    // refresh inválido → sesión muerta
    session = null;
    persist();
    emit();
    return false;
  }
}

// Devuelve un access_token vigente (refrescando si está por caducar).
async function validToken() {
  if (!session) return null;
  if (Date.now() > session.expires_at - 60_000) {
    const ok = await refreshSession();
    if (!ok) return null;
  }
  return session.access_token;
}

// Llamada genérica a la API REST (PostgREST) ya autenticada. `path` empieza
// por "/", p.ej. "/songs?select=*".
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const token = await validToken();
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${REST}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && (data.message || data.hint)) || `Error ${res.status}`);
  return data;
}

// Llama a una función RPC de Postgres (p.ej. accept_invite).
export function rpc(fn, args) {
  return rest(`/rpc/${fn}`, { method: 'POST', body: args || {} });
}

// Restaura la sesión guardada al arrancar la app. Refresca el token si hace
// falta. Devuelve el usuario o null.
export async function restoreSession() {
  if (!CLOUD_ENABLED) return null;
  try {
    const saved = await window.electronAPI.authLoadSession();
    if (saved && saved.access_token) {
      session = saved;
      // refresca de forma silenciosa si está por caducar
      if (Date.now() > session.expires_at - 60_000) await refreshSession();
      emit();
    }
  } catch (_) {}
  return getUser();
}
