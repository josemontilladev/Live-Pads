// ─────────────────────────────────────────────────────────────────────────
// Edge Function: stem-library-admin
//
// Administración de la biblioteca de stems DESDE LA APP (antes solo con el
// script scripts/stem-library/upload-pack.mjs). Solo para quien esté en
// stem_library_admins: se comprueba con la RPC stem_library_is_admin usando el
// JWT de quien llama. Las escrituras usan la service_role (inyectada por
// Supabase en todas las funciones), nunca la app.
//
// { action, ... }:
//   list                              → todos los packs (también borradores) con nº de loops
//   sign_put { path, contentType }    → URL prefirmada PUT a R2 catalog/<path> (10 min)
//   save_pack { slug, title, … }      → crea/actualiza un pack por slug → fila
//   add_loops { packId, loops: [...] } → inserta loops → ids
//   set_published { packId, published }
//
// Secrets: los de R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET). SUPABASE_SERVICE_ROLE_KEY la pone Supabase.
// Desplegar:  supabase functions deploy stem-library-admin
// ─────────────────────────────────────────────────────────────────────────

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const INSTRUMENTS = ['drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar', 'strings', 'vocals', 'fx', 'other'];
const SECTIONS = ['any', 'intro', 'verse', 'prechorus', 'chorus', 'bridge', 'build', 'outro'];
const CONTENT_TYPES = ['audio/wav', 'audio/x-wav', 'audio/flac', 'image/jpeg', 'image/png', 'image/webp'];

function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..') || /^[a-zA-Z]:/.test(clean) || clean.length > 300) return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(clean)) return null;
  return clean;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!URL_ || !ANON || !SERVICE) return json({ error: 'Configuración de Supabase incompleta' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);

  // ¿Es administrador de la biblioteca? (con SU JWT; la RPC mira auth.uid())
  const aRes = await fetch(`${URL_}/rest/v1/rpc/stem_library_is_admin`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!aRes.ok) return json({ error: 'Sesión inválida' }, 401);
  if ((await aRes.json()) !== true) return json({ error: 'Solo el administrador de la biblioteca' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }

  const db = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${URL_}/rest/v1${path}`, {
      ...init,
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`BD ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };

  try {
    switch (body.action) {
      case 'list': {
        const packs = await db('/stem_packs?select=id,slug,title,description,cover_path,genre,mood,tier,published,sort,stem_loops(count)&order=sort.asc,title.asc');
        return json({ packs: packs.map((p: any) => ({ ...p, loops: p.stem_loops?.[0]?.count ?? 0, stem_loops: undefined })) });
      }

      case 'sign_put': {
        const path = safePath(body.path);
        const contentType = str(body.contentType, 60);
        if (!path || !CONTENT_TYPES.includes(contentType)) return json({ error: 'Ruta o tipo de archivo inválido' }, 400);
        const ACCOUNT = Deno.env.get('R2_ACCOUNT_ID'), KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
        const SECRET = Deno.env.get('R2_SECRET_ACCESS_KEY'), BUCKET = Deno.env.get('R2_BUCKET');
        if (!ACCOUNT || !KEY_ID || !SECRET || !BUCKET) return json({ error: 'Configuración de R2 incompleta' }, 500);
        const client = new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: 's3', region: 'auto' });
        const key = `catalog/${path}`;
        const endpoint = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
        const signed = await client.sign(new Request(`${endpoint}?X-Amz-Expires=600`, { method: 'PUT' }), { aws: { signQuery: true } });
        return json({ url: signed.url, key });
      }

      case 'save_pack': {
        const slug = str(body.slug, 61);
        const title = str(body.title, 120);
        const tier = body.tier === 'free' ? 'free' : 'pro';
        if (!SLUG_RE.test(slug) || !title) return json({ error: 'Nombre o identificador del pack inválido' }, 400);
        const row: Record<string, unknown> = {
          slug, title, tier,
          description: str(body.description, 500) || null,
          genre: str(body.genre, 60) || null,
          mood: str(body.mood, 60) || null,
          published: body.published === true,
          updated_at: new Date().toISOString(),
        };
        if (body.cover_path !== undefined) row.cover_path = body.cover_path ? safePath(body.cover_path) : null;
        const [saved] = await db('/stem_packs?on_conflict=slug', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(row),
        });
        return json({ pack: saved });
      }

      case 'add_loops': {
        const packId = str(body.packId, 40);
        const loops = Array.isArray(body.loops) ? body.loops : [];
        if (!UUID_RE.test(packId) || !loops.length || loops.length > 100) return json({ error: 'Parámetros inválidos' }, 400);
        const rows = [];
        for (const l of loops as any[]) {
          const audio = safePath(l.audio_path), preview = l.preview_path ? safePath(l.preview_path) : null;
          const bpm = Number(l.bpm), bars = Number(l.bars);
          if (!audio || !str(l.title) || !INSTRUMENTS.includes(l.instrument) || !(bpm >= 20 && bpm <= 300)
              || !Number.isInteger(bars) || bars < 1 || bars > 64) {
            return json({ error: `Loop inválido: ${str(l.title) || '(sin título)'}` }, 400);
          }
          rows.push({
            pack_id: packId, title: str(l.title, 120), instrument: l.instrument,
            section: SECTIONS.includes(l.section) ? l.section : 'any',
            bpm, bars, musical_key: str(l.musical_key, 6) || null,
            beats_per_bar: Number(l.beats_per_bar) || 4, beat_value: 4,
            tier: l.tier === 'free' ? 'free' : 'pro',
            audio_path: audio, preview_path: preview,
            size: Number(l.size) || null, duration_sec: Number(l.duration_sec) || null,
            tags: Array.isArray(l.tags) ? l.tags.slice(0, 10).map((t: unknown) => str(t, 30)).filter(Boolean) : [],
            sort: Number(l.sort) || 0,
          });
        }
        const saved = await db('/stem_loops', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) });
        return json({ ids: saved.map((r: any) => r.id) });
      }

      case 'set_published': {
        const packId = str(body.packId, 40);
        if (!UUID_RE.test(packId)) return json({ error: 'Parámetros inválidos' }, 400);
        await db(`/stem_packs?id=eq.${packId}`, {
          method: 'PATCH',
          body: JSON.stringify({ published: body.published === true, updated_at: new Date().toISOString() }),
        });
        return json({ ok: true });
      }

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
