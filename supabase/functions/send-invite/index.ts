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
  const logo = `${APP_URL.replace(/\/$/, '')}/assets/logo.png`;
  const html = `
  <div style="margin:0;padding:24px;background:#f4f4f5;font-family:Inter,'Segoe UI',Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)">
      <div style="background:#0a0a0a;padding:30px 28px;text-align:center">
        <img src="${esc(logo)}" alt="LivePads" width="56" height="56" style="display:inline-block;border-radius:14px;margin-bottom:10px">
        <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.02em">Live<span style="color:#FBAE00">Pads</span></div>
        <div style="color:#a3a3a3;font-size:12px;margin-top:4px">Invitación a una librería compartida</div>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 12px;color:#111;font-size:15px">¡Hola! 👋</p>
        <p style="margin:0 0 18px;color:#3f3f46;font-size:14px;line-height:1.6">
          Te invitaron a la librería <b style="color:#111">${esc(libraryName)}</b> en LivePads,
          con permiso para <b style="color:#111">${role}</b>. Usa este código para unirte:
        </p>
        <div style="background:#faf7ef;border:1px dashed #FBAE00;border-radius:12px;padding:16px;text-align:center;font-size:20px;letter-spacing:2px;font-weight:800;color:#0a0a0a">
          ${esc(code)}
        </div>
        <p style="margin:22px 0 10px;color:#3f3f46;font-size:13px;font-weight:600">Cómo unirte:</p>
        <ol style="margin:0;padding-left:18px;color:#3f3f46;font-size:13px;line-height:1.8">
          <li>Descarga LivePads en <a href="${esc(APP_URL)}" style="color:#B97D00;font-weight:600">livepads.online</a> e inicia sesión.</li>
          <li>Menú → <b>Mi cuenta y librerías</b>.</li>
          <li>En <b>Unirme a una librería</b>, pega el código de arriba.</li>
        </ol>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #f0f0f0;text-align:center">
        <p style="margin:0;color:#a1a1aa;font-size:11px">Si no esperabas esta invitación, puedes ignorar este correo.</p>
      </div>
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
