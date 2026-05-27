// ─────────────────────────────────────────────────────────────────────────
// Edge Function: delete-account
// Borra la cuenta del usuario que la llama. El borrado del usuario en
// auth.users cascadea a profiles, libraries (propias), memberships, songs,
// setlists y user_settings (claves foráneas ON DELETE CASCADE).
//
// Supabase inyecta automáticamente SUPABASE_URL, SUPABASE_ANON_KEY y
// SUPABASE_SERVICE_ROLE_KEY en las funciones. Desplegar:
//   supabase functions deploy delete-account
// ─────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!URL || !ANON || !SERVICE) return json({ error: 'Configuración incompleta' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);

  // ¿Quién llama?
  const uRes = await fetch(`${URL}/auth/v1/user`, {
    headers: { 'apikey': ANON, 'Authorization': `Bearer ${jwt}` },
  });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const user = await uRes.json();
  if (!user || !user.id) return json({ error: 'Usuario no encontrado' }, 401);

  // Borrar con privilegios de administrador (service_role).
  const dRes = await fetch(`${URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: { 'apikey': SERVICE, 'Authorization': `Bearer ${SERVICE}` },
  });
  if (!dRes.ok) {
    const t = await dRes.text().catch(() => '');
    return json({ error: 'No se pudo eliminar la cuenta', detail: t }, 502);
  }
  return json({ ok: true });
});
