// ─────────────────────────────────────────────────────────────────────────
// Edge Function: billing
//
// La app la llama con su JWT de Supabase y { action, ... }:
//   status                         → plan actual + licencia firmada (14 días)
//   subscribe { plan, interval, libraryId? } → URL de PayPal para aprobar
//   sync      { subId? }           → relee la suscripción en PayPal y la guarda
//   cancel                         → cancela la renovación (vale hasta fin del periodo)
//   manage                         → enlace a PayPal para administrar el pago
//
// Secrets: ver supabase/functions/_shared/billing.ts
// Desplegar:  supabase functions deploy billing
// ─────────────────────────────────────────────────────────────────────────

import { applyPaypalSub, cors, getSub, isSandbox, json, logEvent, paypal, planId, signLicense, db } from '../_shared/billing.ts';
import type { Interval, Plan } from '../_shared/billing.ts';

const LICENSE_DAYS = 14;

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
  const user = await uRes.json();
  const uid: string = user.id;

  let body: { action?: string; plan?: string; interval?: string; libraryId?: string; subId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Plan actual, calculado por la base con la sesión del usuario.
  const entitlement = async () => {
    const r = await fetch(`${URL_}/rest/v1/rpc/lp_entitlement`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new Error(`lp_entitlement ${r.status}`);
    return await r.json();
  };
  const status = async () => {
    const ent = await entitlement();
    const now = Math.floor(Date.now() / 1000);
    const license = await signLicense({
      sub: uid,
      plan: ent.plan,
      status: ent.status,
      until: ent.until || null,
      founder: !!ent.founder,
      iat: now,
      exp: now + LICENSE_DAYS * 86400,
    });
    return { ...ent, license };
  };

  try {
    switch (body.action || 'status') {
      case 'status':
        return json(await status());

      case 'subscribe': {
        const plan: Plan = body.plan === 'church' ? 'church' : 'pro';
        const interval: Interval = body.interval === 'year' ? 'year' : 'month';
        let libraryId = '';
        if (plan === 'church') {
          libraryId = String(body.libraryId || '');
          const libs = await db(`libraries?id=eq.${encodeURIComponent(libraryId)}&owner_id=eq.${uid}&select=id`);
          if (!libs?.length) return json({ error: 'El plan Iglesia lo contrata el dueño de la librería' }, 403);
        }
        const cur = await getSub(uid);
        const id = planId(plan, interval, !!cur?.founder);
        if (!id) return json({ error: 'Plan no configurado' }, 500);
        const app = Deno.env.get('APP_URL') || 'https://livepads.online';
        const sub = await paypal('/v1/billing/subscriptions', {
          method: 'POST',
          headers: { 'PayPal-Request-Id': crypto.randomUUID(), Prefer: 'return=representation' },
          body: JSON.stringify({
            plan_id: id,
            custom_id: [uid, plan, interval, libraryId].join('|'),
            subscriber: user.email ? { email_address: user.email } : undefined,
            application_context: {
              brand_name: 'LivePads',
              locale: 'es-ES',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'SUBSCRIBE_NOW',
              return_url: `${app}/billing/ok`,
              cancel_url: `${app}/billing/cancel`,
            },
          }),
        });
        const approve = (sub.links || []).find((l: any) => l.rel === 'approve')?.href;
        if (!approve) return json({ error: 'PayPal no devolvió el enlace de pago' }, 502);
        await logEvent({ user_id: uid, provider_sub_id: sub.id, event: 'subscribe.created', raw: { plan, interval, libraryId, founder: !!cur?.founder } });
        return json({ subId: sub.id, approveUrl: approve, founder: !!cur?.founder });
      }

      case 'sync': {
        const cur = await getSub(uid);
        const subId = body.subId || cur?.provider_sub_id;
        if (subId) await applyPaypalSub(subId, uid);
        return json(await status());
      }

      case 'cancel': {
        const cur = await getSub(uid);
        if (!cur?.provider_sub_id) return json({ error: 'No tienes una suscripción activa' }, 400);
        try {
          await paypal(`/v1/billing/subscriptions/${cur.provider_sub_id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Cancelada desde LivePads' }),
          });
        } catch (e) {
          if (!String(e).includes('422')) throw e; // 422 = ya estaba cancelada
        }
        await applyPaypalSub(cur.provider_sub_id, uid);
        await logEvent({ user_id: uid, provider_sub_id: cur.provider_sub_id, event: 'cancel.user' });
        return json(await status());
      }

      case 'manage':
        return json({
          url: isSandbox() ? 'https://www.sandbox.paypal.com/myaccount/autopay/' : 'https://www.paypal.com/myaccount/autopay/',
        });

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    console.error('billing', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
