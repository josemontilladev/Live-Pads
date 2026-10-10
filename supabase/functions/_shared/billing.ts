// ─────────────────────────────────────────────────────────────────────────
// Código común de cobros (PayPal Subscriptions) para `billing` y
// `paypal-webhook`. Todo lo que escribe en la base usa la clave de servicio:
// los clientes nunca pueden darse un plan a sí mismos.
//
// Secrets:
//   PAYPAL_CLIENT_ID, PAYPAL_SECRET
//   PAYPAL_API            https://api-m.sandbox.paypal.com  |  https://api-m.paypal.com
//   PLAN_PRO_MONTH, PLAN_PRO_YEAR, PLAN_CHURCH_MONTH, PLAN_CHURCH_YEAR
//   PLAN_F_PRO_MONTH, PLAN_F_PRO_YEAR, PLAN_F_CHURCH_MONTH, PLAN_F_CHURCH_YEAR  (fundadores)
//   LICENSE_PRIVATE_JWK   clave ECDSA P-256 (JWK) con la que se firman las licencias
//   APP_URL               https://livepads.online
// (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone Supabase.)
// ─────────────────────────────────────────────────────────────────────────

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) || '';

export type Plan = 'pro' | 'church';
export type Interval = 'month' | 'year';

export const PAYPAL_API = () => env('PAYPAL_API') || 'https://api-m.sandbox.paypal.com';
export const isSandbox = () => PAYPAL_API().includes('sandbox');

export function planId(plan: Plan, interval: Interval, founder: boolean): string {
  const k = `PLAN_${founder ? 'F_' : ''}${plan === 'church' ? 'CHURCH' : 'PRO'}_${interval === 'year' ? 'YEAR' : 'MONTH'}`;
  return env(k);
}

// ── PayPal ──────────────────────────────────────────────────────────────
let tok: { v: string; exp: number } | null = null;
export async function paypalToken(): Promise<string> {
  if (tok && tok.exp > Date.now() + 60_000) return tok.v;
  const r = await fetch(`${PAYPAL_API()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_SECRET')}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth ${r.status}`);
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000 };
  return tok.v;
}

export async function paypal(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${PAYPAL_API()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await paypalToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const txt = await r.text();
  const body = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error(`PayPal ${path} ${r.status}: ${body?.message || txt.slice(0, 200)}`);
  return body;
}

// ── Base de datos (PostgREST con la clave de servicio) ──────────────────
export async function db(path: string, init: RequestInit = {}): Promise<any> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`DB ${path} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

export async function getSub(uid: string): Promise<any | null> {
  const rows = await db(`lp_subscriptions?user_id=eq.${uid}&select=*`);
  return rows?.[0] || null;
}

// ── Aplicar una suscripción de PayPal a nuestra tabla ───────────────────
// custom_id = "<uid>|<plan>|<interval>|<libraryId?>"
export function parseCustom(c: string | undefined) {
  const [uid, plan, interval, lib] = String(c || '').split('|');
  if (!/^[0-9a-f-]{36}$/i.test(uid || '')) return null;
  return {
    uid,
    plan: (plan === 'church' ? 'church' : 'pro') as Plan,
    interval: (interval === 'year' ? 'year' : 'month') as Interval,
    libraryId: /^[0-9a-f-]{36}$/i.test(lib || '') ? lib : null,
  };
}

const STATUS: Record<string, string> = {
  APPROVAL_PENDING: 'pending',
  APPROVED: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'past_due',
  CANCELLED: 'canceled',
  EXPIRED: 'expired',
};

/** Lee la suscripción en PayPal (fuente de verdad) y la guarda. Devuelve la fila. */
export async function applyPaypalSub(subId: string, expectUid?: string): Promise<any> {
  const s = await paypal(`/v1/billing/subscriptions/${encodeURIComponent(subId)}`);
  const c = parseCustom(s.custom_id);
  if (!c) throw new Error('Suscripción sin custom_id válido');
  if (expectUid && c.uid !== expectUid) throw new Error('La suscripción no es de esta cuenta');

  const status = STATUS[s.status] || 'pending';
  const cur = await getSub(c.uid);

  // Una suscripción nueva aún sin aprobar no pisa una que ya está pagada.
  const curPaid = cur && cur.provider_sub_id && cur.provider_sub_id !== s.id &&
    ['active', 'past_due'].includes(cur.status) && cur.current_period_end && new Date(cur.current_period_end) > new Date();
  if (status === 'pending' && curPaid) return cur;
  // Eventos tardíos de una suscripción vieja (ya reemplazada) no tocan nada.
  if (cur && cur.provider_sub_id && cur.provider_sub_id !== s.id && status !== 'active' && status !== 'pending') return cur;

  let periodEnd: string | null = s.billing_info?.next_billing_time || null;
  if (status === 'active' && !periodEnd) {
    const start = new Date(s.start_time || Date.now());
    start.setUTCDate(start.getUTCDate() + (c.interval === 'year' ? 366 : 31));
    periodEnd = start.toISOString();
  }
  if (!periodEnd && cur?.provider_sub_id === s.id) periodEnd = cur.current_period_end; // cancelada: vale hasta fin del periodo
  // Margen de 3 días por si PayPal tarda en cobrar la renovación
  if (periodEnd && status === 'active') periodEnd = new Date(new Date(periodEnd).getTime() + 3 * 864e5).toISOString();

  // Cambio de plan: al activarse la nueva, se cancela la anterior en PayPal.
  if (status === 'active' && curPaid) {
    try {
      await paypal(`/v1/billing/subscriptions/${cur.provider_sub_id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cambio de plan en LivePads' }),
      });
    } catch (_) { /* ya estaba cancelada */ }
  }

  const row = {
    user_id: c.uid,
    plan: status === 'pending' && cur ? cur.plan : c.plan,
    status: status === 'pending' && cur?.status && cur.status !== 'none' ? cur.status : status,
    billing_interval: c.interval,
    provider: 'paypal',
    provider_sub_id: s.id,
    library_id: c.plan === 'church' ? c.libraryId : null,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString(),
  };
  // Mientras está pendiente solo recordamos el id (para `sync`), sin cambiar el plan.
  if (status === 'pending') {
    Object.assign(row, { plan: cur?.plan || 'free', current_period_end: cur?.current_period_end || null });
  }
  const out = await db('lp_subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  return out?.[0] || row;
}

export async function logEvent(e: { user_id?: string | null; provider_sub_id?: string | null; event: string; amount?: number | null; currency?: string | null; raw?: unknown }) {
  try {
    await db('lp_payments', { method: 'POST', body: JSON.stringify(e) });
  } catch (_) { /* el log nunca debe tumbar el cobro */ }
}

// ── Licencia firmada (ES256) para usar la app sin internet ──────────────
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
let signKey: CryptoKey | null = null;

export async function signLicense(payload: Record<string, unknown>): Promise<string> {
  if (!signKey) {
    const jwk = JSON.parse(env('LICENSE_PRIVATE_JWK'));
    signKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}
