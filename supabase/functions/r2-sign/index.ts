// ─────────────────────────────────────────────────────────────────────────
// Edge Function: r2-sign
//
// PORTERO de la biblioteca de archivos en Cloudflare R2. Las credenciales de
// R2 viven SOLO aquí (secrets de la función) — nunca en la app, que la usan
// varias personas de la iglesia.
//
// Flujo: la app manda su JWT de Supabase + { libraryId, path, op }.
//   1. Se valida la sesión.
//   2. Se comprueba la MEMBRESÍA en esa librería (y que sea editor si sube).
//   3. Se devuelve una URL PREFIRMADA (SigV4) de R2, válida 10 minutos, para
//      esa clave exacta:  lib/<libraryId>/<path>
//
// La app sube/baja los bytes DIRECTO a R2 con esa URL (no pasan por aquí), así
// que no hay límite de tamaño de la función ni coste de egress de Supabase.
//
// Secrets necesarios (Supabase → Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// Desplegar:  supabase functions deploy r2-sign
// ─────────────────────────────────────────────────────────────────────────

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const EXPIRES = 600; // 10 min: de sobra para subir/bajar un archivo grande

// Evita que un `path` malicioso se salga de su carpeta (lib/<libraryId>/…).
function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null;
  if (clean.length > 400) return null;
  return clean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const ACCOUNT = Deno.env.get('R2_ACCOUNT_ID');
  const KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
  const SECRET = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const BUCKET = Deno.env.get('R2_BUCKET');
  if (!URL_ || !ANON) return json({ error: 'Configuración de Supabase incompleta' }, 500);
  if (!ACCOUNT || !KEY_ID || !SECRET || !BUCKET)
    return json({ error: 'Configuración de R2 incompleta (faltan secrets)' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);

  let body: { libraryId?: string; path?: string; op?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400);
  }

  const op = body.op === 'put' ? 'put' : 'get';
  const libraryId = typeof body.libraryId === 'string' ? body.libraryId : '';
  const path = safePath(body.path);
  if (!libraryId || !path) return json({ error: 'Parámetros inválidos' }, 400);

  // 1) ¿Quién llama?
  const uRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const user = await uRes.json();
  if (!user?.id) return json({ error: 'Usuario no encontrado' }, 401);

  // 2) ¿Es miembro de esa librería? (y editor/dueño si va a SUBIR).
  //    Se consulta con el JWT del propio usuario: las RLS de `memberships` ya
  //    impiden ver membresías ajenas, así que esto es honesto por construcción.
  const mRes = await fetch(
    `${URL_}/rest/v1/memberships?library_id=eq.${libraryId}&user_id=eq.${user.id}&select=role`,
    { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } }
  );
  if (!mRes.ok) return json({ error: 'No se pudo verificar la membresía' }, 502);
  const rows = await mRes.json();
  const role = Array.isArray(rows) && rows.length ? rows[0].role : null;
  if (!role) return json({ error: 'No perteneces a esta librería' }, 403);
  if (op === 'put' && role !== 'owner' && role !== 'editor')
    return json({ error: 'Necesitas permiso de edición para subir archivos' }, 403);

  // 3) Firmar la URL de R2 (S3-compatible, SigV4).
  const client = new AwsClient({
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    service: 's3',
    region: 'auto',
  });
  const key = `lib/${libraryId}/${path}`;
  const endpoint = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const signed = await client.sign(
    new Request(`${endpoint}?X-Amz-Expires=${EXPIRES}`, {
      method: op === 'put' ? 'PUT' : 'GET',
    }),
    { aws: { signQuery: true } }
  );

  return json({ url: signed.url, key, expiresIn: EXPIRES });
});
