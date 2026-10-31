// ─────────────────────────────────────────────────────────────────────────
// Edge Function: stem-library-sign
//
// PORTERO de la biblioteca de stems oficial (catálogo `catalog/` en R2).
// Hermana de `r2-sign`, pero aquí no hay librerías ni membresías: el catálogo
// es el mismo para todos y lo que decide es el PLAN.
//
// Flujo: la app manda su JWT + { loopId, kind } o { packId, kind: 'cover' }.
//   1. Se valida la sesión.
//   2. Se lee el loop/pack CON EL JWT del usuario: las RLS solo dejan ver lo
//      publicado, así que un id inventado o en borrador da 404 por construcción.
//   3. kind 'preview' y 'cover' → libres para cualquiera con cuenta.
//      kind 'audio' de un pack 'pro' → exige plan distinto de 'free'.
//   4. Se devuelve una URL PREFIRMADA (SigV4) de R2 válida 10 minutos.
//
// Secrets: los mismos de r2-sign (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET).
//
// Desplegar:  supabase functions deploy stem-library-sign
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

const EXPIRES = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Las rutas vienen de la BD (las escribe el panel), pero se validan igual:
// nunca deben salirse de `catalog/`.
function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..') || /^[a-zA-Z]:/.test(clean)) return null;
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

  let body: { loopId?: string; packId?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400);
  }

  const kind = body.kind === 'preview' || body.kind === 'cover' ? body.kind : 'audio';
  const id = kind === 'cover' ? body.packId : body.loopId;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return json({ error: 'Parámetros inválidos' }, 400);

  const asUser = { apikey: ANON, Authorization: `Bearer ${jwt}` };

  // 1) ¿Quién llama?
  const uRes = await fetch(`${URL_}/auth/v1/user`, { headers: asUser });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const user = await uRes.json();
  if (!user?.id) return json({ error: 'Usuario no encontrado' }, 401);

  // 2) ¿Existe y está publicado? (RLS filtra los borradores)
  let rawPath: unknown = null;
  let tier = 'free';
  if (kind === 'cover') {
    const r = await fetch(`${URL_}/rest/v1/stem_packs?id=eq.${id}&select=cover_path`, { headers: asUser });
    if (!r.ok) return json({ error: 'No se pudo leer el catálogo' }, 502);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'Pack no encontrado' }, 404);
    rawPath = rows[0].cover_path;
  } else {
    const r = await fetch(
      `${URL_}/rest/v1/stem_loops?id=eq.${id}&select=audio_path,preview_path,stem_packs(tier)`,
      { headers: asUser }
    );
    if (!r.ok) return json({ error: 'No se pudo leer el catálogo' }, 502);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'Loop no encontrado' }, 404);
    rawPath = kind === 'preview' ? rows[0].preview_path : rows[0].audio_path;
    tier = rows[0].stem_packs?.tier === 'pro' ? 'pro' : 'free';
  }
  const path = safePath(rawPath);
  if (!path) return json({ error: 'Este archivo no está disponible' }, 404);

  // 3) Plan: el audio completo de un pack Pro exige Pro (o prueba/cortesía).
  if (kind === 'audio' && tier === 'pro') {
    const eRes = await fetch(`${URL_}/rest/v1/rpc/lp_entitlement`, {
      method: 'POST',
      headers: { ...asUser, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const ent = eRes.ok ? await eRes.json() : null;
    if (!ent || ent.plan === 'free')
      return json({ error: 'Este pack es parte de LivePads Pro', code: 'plan_required' }, 402);
  }

  // 4) Firmar la URL de R2 (S3-compatible, SigV4).
  const client = new AwsClient({
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    service: 's3',
    region: 'auto',
  });
  const key = `catalog/${path}`;
  const endpoint = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const signed = await client.sign(new Request(`${endpoint}?X-Amz-Expires=${EXPIRES}`, { method: 'GET' }), {
    aws: { signQuery: true },
  });

  return json({ url: signed.url, key, expiresIn: EXPIRES });
});
