// ─────────────────────────────────────────────────────────────────────────
// Edge Function: admin
//
// Panel de administración de suscripciones (solo correos de ADMIN_EMAILS).
// La app la llama con el JWT del administrador y { action, ... }:
//   overview                      → resumen (por plan) + lista de cuentas
//   payments  { limit? }          → últimos cobros/eventos
//   grant_comp  { userId }        → Pro de cortesía sin fecha de fin
//   revoke_comp { userId }        → quita la cortesía
//   extend_trial { userId, days } → alarga (o da) la prueba de Pro
//   sync_team                     → cortesía para todos los miembros de las
//                                   librerías del administrador (= SQL 0015)
//
// Secrets: ADMIN_KEY (obligatoria; segunda llave que solo tiene la app de
// administración del teléfono) y ADMIN_EMAILS opcional (separados por coma;
// por defecto, el correo del administrador de LivePads).
// Desplegar:  supabase functions deploy admin
// ─────────────────────────────────────────────────────────────────────────

import { cors, db, json } from '../_shared/billing.ts';

const COMP_UNTIL = '2099-12-31T00:00:00Z';
const PRICE: Record<string, Record<string, number>> = {
  pro: { month: 6.99, year: 49.99 },
  church: { month: 17.99, year: 149.99 },
};
const FOUNDER_PRICE: Record<string, Record<string, number>> = {
  pro: { month: 3.49, year: 24.99 },
  church: { month: 8.99, year: 74.99 },
};

const admins = () =>
  (Deno.env.get('ADMIN_EMAILS') || 'montillajose221@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

async function authUsers(): Promise<any[]> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users?page=${page}&per_page=500`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`auth admin ${r.status}`);
    const j = await r.json();
    const users = j.users || [];
    out.push(...users);
    if (users.length < 500) break;
  }
  return out;
}

// Plan efectivo (misma lógica que lp_entitlement, sin la cobertura Iglesia).
function effective(s: any, now: number) {
  if (!s) return { plan: 'free', label: 'Gratis', kind: 'free' };
  const end = s.current_period_end ? Date.parse(s.current_period_end) : 0;
  if (['active', 'past_due', 'canceled'].includes(s.status) && end > now) {
    if (s.provider === 'comp') return { plan: s.plan, label: 'Cortesía', kind: 'comp' };
    return { plan: s.plan, label: s.status === 'canceled' ? 'Cancelada (vigente)' : s.status === 'past_due' ? 'Pago pendiente' : 'Pagando', kind: 'paid' };
  }
  const trial = s.trial_ends_at ? Date.parse(s.trial_ends_at) : 0;
  if (trial > now) return { plan: 'pro', label: 'Prueba', kind: 'trial' };
  return { plan: 'free', label: 'Gratis', kind: 'free' };
}

async function upsert(row: Record<string, unknown>) {
  return db('lp_subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

async function log(adminId: string, event: string, raw: unknown, userId?: string) {
  try {
    await db('lp_payments', { method: 'POST', body: JSON.stringify({ user_id: userId || null, event: `admin.${event}`, raw: { by: adminId, ...(raw as object) } }) });
  } catch (_) { /* el registro no debe tumbar la acción */ }
}

const isPaying = (s: any) =>
  s && s.provider === 'paypal' && ['active', 'past_due'].includes(s.status) && s.current_period_end && Date.parse(s.current_period_end) > Date.now();

async function grantComp(userId: string) {
  const [cur] = await db(`lp_subscriptions?user_id=eq.${userId}&select=*`);
  if (isPaying(cur)) return { skipped: 'paga con PayPal' };
  await upsert({ user_id: userId, plan: 'pro', status: 'active', provider: 'comp', provider_sub_id: null, current_period_end: COMP_UNTIL, founder: true });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  if (!URL_ || !ANON) return json({ error: 'Configuración de Supabase incompleta' }, 500);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);
  const uRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const me = await uRes.json();
  if (!admins().includes(String(me.email || '').toLowerCase())) return json({ error: 'Solo para administradores' }, 403);

  // Segunda llave: la app de administración envía una clave secreta propia.
  // Sin ella no basta con tener la sesión del administrador.
  const KEY = Deno.env.get('ADMIN_KEY') || '';
  if (!KEY) return json({ error: 'Falta configurar ADMIN_KEY en el servidor' }, 503);
  const given = req.headers.get('x-admin-key') || '';
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(KEY);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  if (diff !== 0) {
    await new Promise((r) => setTimeout(r, 800)); // frena los intentos a ciegas
    return json({ error: 'Clave de administrador incorrecta' }, 403);
  }

  let body: { action?: string; userId?: string; days?: number; limit?: number };
  try { body = await req.json(); } catch { body = {}; }
  const uid = String(body.userId || '');
  const validUid = /^[0-9a-f-]{36}$/i.test(uid);

  try {
    switch (body.action || 'overview') {
      case 'overview': {
        const [users, subs] = await Promise.all([authUsers(), db('lp_subscriptions?select=*')]);
        const byId = new Map((subs || []).map((s: any) => [s.user_id, s]));
        const now = Date.now();
        const stats = { total: 0, paid: 0, comp: 0, trial: 0, free: 0, mrr: 0, founders: 0 };
        const rows = users.map((u) => {
          const s: any = byId.get(u.id) || null;
          const e = effective(s, now);
          stats.total++;
          (stats as any)[e.kind]++;
          if (s?.founder) stats.founders++;
          if (e.kind === 'paid' && s.status !== 'canceled') {
            const p = (s.founder ? FOUNDER_PRICE : PRICE)[s.plan]?.[s.billing_interval] || 0;
            stats.mrr += s.billing_interval === 'year' ? p / 12 : p;
          }
          return {
            id: u.id,
            email: u.email,
            name: u.user_metadata?.display_name || '',
            created: u.created_at,
            lastSeen: u.last_sign_in_at,
            plan: e.plan, label: e.label, kind: e.kind,
            status: s?.status || 'none',
            interval: s?.billing_interval || null,
            until: e.kind === 'trial' ? s?.trial_ends_at : s?.current_period_end || null,
            founder: !!s?.founder,
            provider: s?.provider || null,
          };
        }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
        stats.mrr = Math.round(stats.mrr * 100) / 100;
        return json({ stats, rows });
      }

      case 'payments': {
        const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
        const rows = await db(`lp_payments?select=id,user_id,event,amount,currency,created_at,provider_sub_id&order=id.desc&limit=${limit}`);
        return json({ rows });
      }

      case 'grant_comp': {
        if (!validUid) return json({ error: 'Usuario inválido' }, 400);
        const r = await grantComp(uid);
        await log(me.id, 'grant_comp', r, uid);
        return json(r);
      }

      case 'revoke_comp': {
        if (!validUid) return json({ error: 'Usuario inválido' }, 400);
        const [cur] = await db(`lp_subscriptions?user_id=eq.${uid}&select=*`);
        if (!cur || cur.provider !== 'comp') return json({ error: 'Esa cuenta no tiene cortesía' }, 400);
        await upsert({ user_id: uid, status: 'expired', current_period_end: new Date().toISOString() });
        await log(me.id, 'revoke_comp', {}, uid);
        return json({ ok: true });
      }

      case 'extend_trial': {
        if (!validUid) return json({ error: 'Usuario inválido' }, 400);
        const days = Math.min(Math.max(Math.round(Number(body.days) || 0), 1), 365);
        const [cur] = await db(`lp_subscriptions?user_id=eq.${uid}&select=*`);
        const base = Math.max(Date.now(), cur?.trial_ends_at ? Date.parse(cur.trial_ends_at) : 0);
        const until = new Date(base + days * 864e5).toISOString();
        await upsert({ user_id: uid, trial_ends_at: until, ...(cur ? {} : { plan: 'pro', status: 'trial' }) });
        await log(me.id, 'extend_trial', { days, until }, uid);
        return json({ ok: true, until });
      }

      case 'sync_team': {
        const libs = await db(`libraries?owner_id=eq.${me.id}&select=id`);
        if (!libs?.length) return json({ granted: 0, skipped: 0, total: 0 });
        const ids = libs.map((l: any) => l.id).join(',');
        const mem = await db(`memberships?library_id=in.(${ids})&select=user_id`);
        const users = [...new Set((mem || []).map((m: any) => m.user_id))] as string[];
        let granted = 0, skipped = 0;
        for (const u of users) {
          try {
            const r = await grantComp(u);
            if (r.ok) granted++; else skipped++;
          } catch (_) { skipped++; } // p. ej. sin perfil todavía
        }
        await log(me.id, 'sync_team', { granted, skipped, total: users.length });
        return json({ granted, skipped, total: users.length });
      }

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    console.error('admin', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
