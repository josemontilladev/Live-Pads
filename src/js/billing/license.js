// ─────────────────────────────────────────────────────────────────────────
// Licencia de LivePads.
//
// El servidor (función `billing`) devuelve el plan firmado con ECDSA P-256.
// Aquí se verifica con la clave PÚBLICA (la privada solo vive en Supabase), se
// guarda y sirve 14 días sin internet: en un culto sin WiFi la app no se
// bloquea. Pasado ese plazo sin conexión, vuelve al plan Gratis hasta que
// pueda comprobarlo de nuevo.
// ─────────────────────────────────────────────────────────────────────────

import { BILLING_ENABLED } from '../cloud/config.js';
import { getUser, isLoggedIn, invokeFunction, onAuthChange } from '../cloud/supabase.js';
import { LIMITS, FEATURE_TEXT } from './plans.js';

const PUBLIC_JWK = {
  kty: 'EC', crv: 'P-256',
  x: 'VW6RcEduryO7SG8d22W6huM0Bfu-AN_vIKCI1YzeRv4',
  y: 'yIuwfOQEKAbf5hDy5duKSuvcDOHuto0r9jXlbljxWXI',
};
const CACHE_KEY = 'lp.license.v1';
const REFRESH_MS = 6 * 3600 * 1000;

let current = null; // { plan, status, until, founder, exp, sub, raw:{...} }
let refreshing = null;
let lastRefresh = 0;

const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let pubKey = null;
async function verify(token) {
  try {
    const [h, b, s] = String(token).split('.');
    if (!h || !b || !s) return null;
    if (!pubKey) pubKey = await crypto.subtle.importKey('jwk', PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64uBytes(s), new TextEncoder().encode(`${h}.${b}`));
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(b64uBytes(b)));
  } catch (_) {
    return null;
  }
}

// ¿Sigue valiendo esta licencia ahora mismo, para esta cuenta?
function valid(c) {
  if (!c) return false;
  const u = getUser();
  if (!u || c.sub !== u.id) return false;
  return c.exp * 1000 > Date.now();
}

function effectivePlan(c) {
  if (!valid(c)) return 'free';
  if (c.until && new Date(c.until).getTime() < Date.now()) return 'free'; // la prueba o el periodo ya terminó
  return LIMITS[c.plan] ? c.plan : 'free';
}

// Días que quedan: redondeado (tolera unos minutos de diferencia de reloj con el
// servidor); el último día cuenta como 1 hasta que se acaba.
function daysLeft(until) {
  const d = (new Date(until).getTime() - Date.now()) / 864e5;
  if (d <= 0) return 0;
  return d > 1 ? Math.round(d) : 1;
}

function emit() {
  window.dispatchEvent(new CustomEvent('livepads:plan-changed', { detail: getPlanInfo() }));
}

async function adopt(token, extra) {
  const claims = await verify(token);
  if (!claims) return false;
  current = { ...claims, extra: extra || {} };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ token, extra: extra || {} })); } catch (_) {}
  emit();
  return true;
}

/** Plan efectivo y datos para mostrar. */
export function getPlanInfo() {
  if (!BILLING_ENABLED) return { plan: 'pro', status: 'disabled', enabled: false };
  const plan = effectivePlan(current);
  return {
    enabled: true,
    plan,
    status: valid(current) ? current.status : (isLoggedIn() ? 'unknown' : 'guest'),
    until: valid(current) ? current.until : null,
    founder: !!(current && current.founder),
    source: current?.extra?.source || null,
    libraryId: current?.extra?.library_id || null,
    interval: current?.extra?.interval || null,
    trialDaysLeft: plan === 'pro' && current?.status === 'trial' && current.until
      ? daysLeft(current.until) : null,
  };
}

export function hasFeature(f) {
  return !!LIMITS[getPlanInfo().plan][f];
}
export function limitOf(f) {
  return LIMITS[getPlanInfo().plan][f];
}

/**
 * Comprueba una función de pago. Si no está incluida, abre la ventana de planes
 * explicando por qué y devuelve false.
 */
export function requireFeature(f, reason) {
  if (hasFeature(f)) return true;
  openPlans(reason || FEATURE_TEXT[f]);
  return false;
}
/** Para límites numéricos (canciones): ¿cabe `n` más? */
export function requireRoom(f, have, adding = 1, reason) {
  const max = limitOf(f);
  if (have + adding <= max) return true;
  openPlans(reason || FEATURE_TEXT[f]);
  return false;
}

export function openPlans(reason) {
  import('./plansModal.js').then((m) => m.openPlansModal({ reason })).catch((e) => console.error('[LivePads] planes:', e));
}

/** Pregunta al servidor el plan actual (con red). */
export function refreshLicense({ force = false } = {}) {
  if (!BILLING_ENABLED || !isLoggedIn()) return Promise.resolve(getPlanInfo());
  if (!force && Date.now() - lastRefresh < 60_000 && current) return Promise.resolve(getPlanInfo());
  if (refreshing) return refreshing;
  refreshing = callBilling('status').finally(() => { refreshing = null; });
  return refreshing;
}

/** Llama una acción de la función `billing` y adopta la licencia que devuelva. */
export async function callBilling(action, payload = {}) {
  const r = await invokeFunction('billing', { action, ...payload });
  if (r && r.license) {
    lastRefresh = Date.now();
    await adopt(r.license, { source: r.source, library_id: r.library_id, interval: r.interval, last_status: r.last_status });
    return getPlanInfo();
  }
  return r;
}

/** Arranque: carga la licencia guardada (sin red) y luego refresca en segundo plano. */
export async function initLicense() {
  if (!BILLING_ENABLED) return;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (saved && saved.token) {
      const claims = await verify(saved.token);
      if (claims) current = { ...claims, extra: saved.extra || {} };
    }
  } catch (_) {}
  emit();
  const fresh = refreshLicense({ force: true }).catch(() => {});
  if (isLoggedIn() && !valid(current) && navigator.onLine) {
    await Promise.race([fresh, new Promise((r) => setTimeout(r, 5000))]);
  }
  onAuthChange(() => {
    if (!isLoggedIn()) { current = null; try { localStorage.removeItem(CACHE_KEY); } catch (_) {} emit(); return; }
    if (!valid(current)) current = null;
    refreshLicense({ force: true }).catch(() => {});
  });
  setInterval(() => { if (navigator.onLine) refreshLicense({ force: true }).catch(() => {}); }, REFRESH_MS);
}

// Solo para pruebas automáticas: fija una licencia sin firma.
export function __setTestPlan(c) { if (!window.__LP_TEST) return; current = c; emit(); }
