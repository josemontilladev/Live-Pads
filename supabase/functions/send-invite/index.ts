// ─────────────────────────────────────────────────────────────────────────
// Edge Function: send-invite
// Envía por correo (Resend) una invitación a una librería de LivePads.
// La llama la app ya autenticada (JWT del invitador).
//
// Secrets necesarios (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   → API key de Resend (re_...)
//   INVITE_FROM      → remitente verificado, p.ej. "LivePads <invitaciones@livepads.online>"
//   APP_URL          → (opcional) URL de la web, p.ej. https://livepads.online
//
// Desplegar:  supabase functions deploy send-invite
// ─────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const FROM = Deno.env.get('INVITE_FROM') || 'LivePads <onboarding@resend.dev>';
  const APP_URL = Deno.env.get('APP_URL') || 'https://livepads.online';
  if (!RESEND_API_KEY) return json({ error: 'Falta RESEND_API_KEY en los secrets' }, 500);

  let payload: { email?: string; code?: string; libraryName?: string; role?: string; invitedBy?: string };
  try { payload = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const email = (payload.email || '').trim();
  const code = (payload.code || '').trim();
  const libraryName = payload.libraryName || 'una librería';
  const role = payload.role === 'editor' ? 'editar' : 'ver';
  if (!email || !code) return json({ error: 'Faltan email o code' }, 400);

  const subject = `Te invitaron a "${libraryName}" en LivePads`;
  const html = `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">
    <div style="background:#0a0a0a;border-radius:14px;padding:28px;text-align:center;color:#fff">
      <h1 style="margin:0 0 4px;font-size:22px">Live<span style="color:#FBAE00">Pads</span></h1>
      <p style="margin:0;color:#a3a3a3;font-size:13px">Invitación a una librería compartida</p>
    </div>
    <div style="padding:24px 4px">
      <p>¡Hola!</p>
      <p>Te invitaron a la librería <b>${esc(libraryName)}</b> con permiso para <b>${role}</b>.</p>
      <p>Para unirte:</p>
      <ol style="line-height:1.6">
        <li>Descarga LivePads en <a href="${esc(APP_URL)}" style="color:#FBAE00">${esc(APP_URL)}</a> e inicia sesión (o crea tu cuenta).</li>
        <li>Abre el menú → <b>Mi cuenta y librerías</b>.</li>
        <li>En <b>Unirme a una librería</b>, pega este código:</li>
      </ol>
      <div style="background:#f4f4f5;border:1px dashed #d4d4d8;border-radius:10px;padding:14px;text-align:center;font-size:18px;letter-spacing:1px;font-weight:700">
        ${esc(code)}
      </div>
      <p style="color:#71717a;font-size:12px;margin-top:20px">Si no esperabas esta invitación, puedes ignorar este correo.</p>
    </div>
  </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject, html }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: data?.message || 'Resend rechazó el envío', detail: data }, 502);
  return json({ ok: true, id: data?.id || null });
});
