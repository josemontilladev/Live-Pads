// ─────────────────────────────────────────────────────────────────────────
// Edge Function: r2-sign
//
// PORTERO de la biblioteca de archivos en Cloudflare R2. Las credenciales de
// R2 viven SOLO aquí (secrets de la función) — nunca en la app, que la usan
// varias personas de la iglesia.
//
// Flujo: la app manda su JWT de Supabase + { libraryId, path, op, size? }.
//   1. Se valida la sesión.
//   2. Se comprueba la MEMBRESÍA en esa librería (y que sea editor si sube/borra).
//   3. Se devuelve una URL PREFIRMADA (SigV4) de R2, válida 10 minutos, para
//      esa clave exacta:  lib/<libraryId>/<path>
//
// ops:
//   get    → URL para bajar.
//   put    → URL para subir. Exige `size` (bytes). ESPACIO: lo que ya ocupan de
//            verdad en R2 todas las librerías del DUEÑO de esta librería, más el
//            archivo nuevo, no puede pasar del límite del plan (Pro 5 GB,
//            Iglesia 20 GB). Se mide listando R2, no fiándose de la app.
//   delete → borra el archivo de R2 (editores; para «Liberar espacio»).
//   usage  → { used, quota, plan, files }: lo que ocupan las librerías de las
//            que eres dueño (para el medidor de «Mi cuenta»). No pide path.
//
// La app sube/baja los bytes DIRECTO a R2 con esa URL (no pasan por aquí), así
// que no hay límite de tamaño de la función ni coste de egress de Supabase.
//
// Secrets necesarios (Supabase → Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   (SUPABASE_SERVICE_ROLE_KEY la pone Supabase.)
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
const GB = 1024 ** 3;
// Espacio en la nube por plan (todas las librerías de un mismo dueño juntas).
const QUOTA: Record<string, number> = { pro: 5 * GB, church: 20 * GB };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Evita que un `path` malicioso se salga de su carpeta (lib/<libraryId>/…).
function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null;
  if (clean.length > 400) return null;
  return clean;
}

const fmt = (b: number) => b >= GB ? `${(b / GB).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ACCOUNT = Deno.env.get('R2_ACCOUNT_ID');
  const KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
  const SECRET = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const BUCKET = Deno.env.get('R2_BUCKET');
  if (!URL_ || !ANON) return json({ error: 'Configuración de Supabase incompleta' }, 500);
  if (!ACCOUNT || !KEY_ID || !SECRET || !BUCKET)
    return json({ error: 'Configuración de R2 incompleta (faltan secrets)' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);

  let body: { libraryId?: string; path?: string; op?: string; contentType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400);
  }

  const op = ['put', 'delete', 'usage'].includes(String(body.op)) ? String(body.op) : 'get';

  // 1) ¿Quién llama?
  const uRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const user = await uRes.json();
  if (!user?.id) return json({ error: 'Usuario no encontrado' }, 401);

  const client = new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: 's3', region: 'auto' });
  const base = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;
  const objUrl = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

  // Bytes reales en R2 bajo un prefijo (ListObjectsV2, 1000 por página).
  const prefixBytes = async (prefix: string) => {
    let bytes = 0, files = 0, token = '';
    for (let page = 0; page < 500; page++) {
      const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token) q.set('continuation-token', token);
      const res = await client.fetch(`${base}?${q}`);
      if (!res.ok) throw new Error(`R2 no respondió al medir el espacio (${res.status})`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); files++; }
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      if (!next || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = next[1].replace(/&amp;/g, '&');
    }
    return { bytes, files };
  };
  // Librerías de un dueño (con la service_role: un editor no ve las demás del dueño).
  const ownerLibraries = async (ownerId: string): Promise<string[]> => {
    if (!SERVICE) return [];
    const r = await fetch(`${URL_}/rest/v1/libraries?owner_id=eq.${ownerId}&select=id`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const rows = r.ok ? await r.json() : [];
    return (rows || []).map((x: any) => x.id).filter((id: string) => UUID_RE.test(id));
  };
  const usageOf = async (ownerId: string) => {
    const libs = await ownerLibraries(ownerId);
    let used = 0, files = 0;
    for (const id of libs) { const u = await prefixBytes(`lib/${id}/`); used += u.bytes; files += u.files; }
    return { used, files, libraries: libs.length };
  };
  const entitlement = async () => {
    const eRes = await fetch(`${URL_}/rest/v1/rpc/lp_entitlement`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return eRes.ok ? await eRes.json() : null;
  };

  // ── usage: el medidor de «Mi cuenta» ──
  if (op === 'usage') {
    try {
      const ent = await entitlement();
      const plan = ent?.plan || 'free';
      const u = await usageOf(user.id);
      return json({ used: u.used, files: u.files, libraries: u.libraries, quota: QUOTA[plan] || 0, plan });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  const libraryId = typeof body.libraryId === 'string' ? body.libraryId : '';
  const path = safePath(body.path);
  if (!libraryId || !path || !UUID_RE.test(libraryId)) return json({ error: 'Parámetros inválidos' }, 400);

  // 2) ¿Es miembro de esa librería? (y editor/dueño si va a SUBIR o BORRAR).
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
  if ((op === 'put' || op === 'delete') && role !== 'owner' && role !== 'editor')
    return json({ error: 'Necesitas permiso de edición para cambiar archivos' }, 403);

  const key = `lib/${libraryId}/${path}`;

  // ── delete: liberar espacio ──
  if (op === 'delete') {
    const res = await client.fetch(objUrl(key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return json({ error: `R2 no pudo borrar el archivo (${res.status})` }, 502);
    return json({ ok: true, key });
  }

  // 2b) Subir a la nube es parte de Pro/Iglesia: se comprueba aquí, en el
  //     servidor (la app también lo bloquea, pero eso se podría saltar).
  //     Bajar sigue abierto a cualquier miembro (apps móviles, cantantes).
  if (op === 'put') {
    const ent = await entitlement();
    if (!ent || ent.plan === 'free')
      return json({ error: 'Subir audios a la nube es parte de LivePads Pro', code: 'plan_required' }, 402);

    // 2c) Espacio: todo lo del dueño de la librería + este archivo ≤ límite del plan.
    const size = Number(body.size);
    if (!(size > 0)) return json({ error: 'Actualiza LivePads para subir archivos a la nube.', code: 'update_required' }, 426);
    const quota = QUOTA[ent.plan] || QUOTA.pro;
    try {
      let ownerId = user.id;
      if (SERVICE) {
        const lr = await fetch(`${URL_}/rest/v1/libraries?id=eq.${libraryId}&select=owner_id`, {
          headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
        });
        const lib = lr.ok ? (await lr.json())[0] : null;
        if (lib?.owner_id) ownerId = lib.owner_id;
      }
      const { used } = await usageOf(ownerId);
      // Si reemplaza un archivo que ya existe, su tamaño anterior no cuenta dos veces.
      const head = await client.fetch(objUrl(key), { method: 'HEAD' });
      const prev = head.ok ? Number(head.headers.get('content-length')) || 0 : 0;
      if (used - prev + size > quota) {
        return json({
          error: `La nube de esta librería está llena: usa ${fmt(used)} de ${fmt(quota)}. Libera espacio en Mi cuenta → Librerías.`,
          code: 'quota', used, quota,
        }, 413);
      }
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // 3) Firmar la URL de R2 (S3-compatible, SigV4).
  const signed = await client.sign(
    new Request(`${objUrl(key)}?X-Amz-Expires=${EXPIRES}`, {
      method: op === 'put' ? 'PUT' : 'GET',
    }),
    { aws: { signQuery: true } }
  );

  return json({ url: signed.url, key, expiresIn: EXPIRES });
});
