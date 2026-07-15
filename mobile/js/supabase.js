// ─────────────────────────────────────────────────────────────────────────
// Cliente Supabase SLIM para la PWA móvil (fetch puro, sin librería).
// Igual filosofía que la app de escritorio, con una diferencia: la sesión se
// persiste en localStorage (no hay safeStorage de Electron). Es el mismo
// riesgo que cualquier web app; el dispositivo es personal.
// ─────────────────────────────────────────────────────────────────────────

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const REST = `${SUPABASE_URL}/rest/v1`;
const SESSION_KEY = 'lpm-session';

let session = null;
const listeners = new Set();

export function getSession() { return session; }
export function getUser() { return session ? session.user : null; }
export function isLoggedIn() { return !!(session && session.access_token); }
export function onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { listeners.forEach(cb => { try { cb(session); } catch (_) {} }); }

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

// fetch con timeout: la PWA se usa en el escenario con WiFi dudoso — ninguna
// llamada puede colgar la interfaz.
function httpFetch(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function authFetch(path, { method = 'POST', body, token } = {}) {
  const res = await httpFetch(`${AUTH}${path}`, {
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
    const msg = (data && (data.error_description || data.msg || data.message)) || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function setFromTokenResponse(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
    user: data.user || (session && session.user) || null,
  };
  persist();
  emit();
}

export async function signIn(email, password) {
  const data = await authFetch('/token?grant_type=password', {
    body: { email: String(email || '').trim(), password },
  });
  setFromTokenResponse(data);
  return session.user;
}

export function signOut() {
  session = null;
  persist();
  emit();
}

// ── Google (OAuth de Supabase, flujo web con redirect) ─────────────────────
// Redirige a Google; al volver, GoTrue añade los tokens en el hash de la URL.
export function signInWithGoogle() {
  const redirectTo = location.origin + location.pathname + location.search;
  const url = `${AUTH}/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.href = url;
}

// Al cargar la página, detecta el retorno de OAuth (#access_token=…) y crea la
// sesión. Devuelve el usuario si venía de Google, o null si no.
export async function handleOAuthCallback() {
  const hash = location.hash || '';
  if (hash.indexOf('access_token=') === -1) {
    // ¿Vino un error de OAuth? (p. ej. provider no habilitado)
    if (hash.indexOf('error') !== -1) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    }
    return null;
  }
  const p = new URLSearchParams(hash.slice(1));
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  const expires_in = Number(p.get('expires_in')) || 3600;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  if (!access_token) return null;

  let user = null;
  try {
    const res = await httpFetch(`${AUTH}/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` },
    });
    if (res.ok) user = await res.json();
  } catch (_) {}
  session = {
    access_token,
    refresh_token,
    expires_at: Date.now() + (expires_in - 60) * 1000,
    user,
  };
  persist();
  emit();
  return user;
}

async function refreshSession() {
  if (!session || !session.refresh_token) throw new Error('Sin sesión');
  const data = await authFetch('/token?grant_type=refresh_token', {
    body: { refresh_token: session.refresh_token },
  });
  setFromTokenResponse(data);
}

// Token válido (refresca si está por vencer). null si no hay sesión.
export async function validToken() {
  if (!session) return null;
  if (Date.now() >= (session.expires_at || 0)) {
    try { await refreshSession(); } catch (_) { signOut(); return null; }
  }
  return session.access_token;
}

// Restaura la sesión guardada al arrancar. Devuelve el usuario o null.
export async function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    session = JSON.parse(raw);
  } catch (_) { return null; }
  const token = await validToken();
  if (!token) return null;
  emit();
  return session.user;
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const token = await validToken();
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers['Prefer'] = prefer;
  const res = await httpFetch(`${REST}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && (data.message || data.hint)) || `Error ${res.status}`);
  return data;
}

// Edge Function autenticada (r2-sign).
export async function invokeFunction(name, payload) {
  const token = await validToken();
  const res = await httpFetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Error ${res.status}`);
  return data;
}
