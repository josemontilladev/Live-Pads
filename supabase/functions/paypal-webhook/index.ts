// ─────────────────────────────────────────────────────────────────────────
// Edge Function: paypal-webhook
//
// PayPal avisa aquí cuando una suscripción se activa, renueva, suspende,
// cancela o expira. Se verifica la firma con la API de PayPal y luego se
// relee la suscripción (PayPal es la fuente de verdad) para guardarla.
//
// Secrets extra: PAYPAL_WEBHOOK_ID (id del webhook registrado en PayPal)
// Desplegar:  supabase functions deploy paypal-webhook --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────

import { applyPaypalSub, json, logEvent, paypal } from '../_shared/billing.ts';

const SUB_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
]);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const raw = await req.text();
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400);
  }

  // 1) ¿De verdad viene de PayPal?
  const h = (k: string) => req.headers.get(k) || '';
  try {
    const v = await paypal('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: Deno.env.get('PAYPAL_WEBHOOK_ID') || '',
        webhook_event: event,
      }),
    });
    if (v.verification_status !== 'SUCCESS') return json({ error: 'Firma inválida' }, 400);
  } catch (e) {
    console.error('verify', e);
    // Cabeceras inválidas (4xx de PayPal) → rechazo; fallo de red/PayPal → 500 y PayPal reintenta
    if (/ 4\d\d:/.test(String(e))) return json({ error: 'Firma inválida' }, 400);
    return json({ error: 'No se pudo verificar' }, 500);
  }

  // 2) Aplicar
  const type: string = event.event_type || '';
  const res = event.resource || {};
  try {
    let subId: string | null = null;
    if (SUB_EVENTS.has(type)) subId = res.id;
    else if (type === 'PAYMENT.SALE.COMPLETED' || type === 'PAYMENT.SALE.REFUNDED' || type === 'PAYMENT.SALE.REVERSED')
      subId = res.billing_agreement_id || null;

    let row: any = null;
    if (subId) row = await applyPaypalSub(subId);
    await logEvent({
      user_id: row?.user_id || null,
      provider_sub_id: subId,
      event: type,
      amount: res.amount?.total ? Number(res.amount.total) : null,
      currency: res.amount?.currency || null,
      raw: event,
    });
    return json({ ok: true });
  } catch (e) {
    console.error('webhook', type, e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
