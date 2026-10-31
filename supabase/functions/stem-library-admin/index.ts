// ─────────────────────────────────────────────────────────────────────────
// Edge Function: stem-library-admin
//
// Escrituras de la biblioteca de stems DESDE LA APP. Dos tipos de llamada:
//
//   · Administrador (stem_library_admins, comprobado con la RPC
//     stem_library_is_admin usando el JWT de quien llama):
//       list                                   → todos los packs (borradores y envíos) con nº de loops
//       list_loops { packId }                  → loops de un pack (también sin publicar)
//       sign_put { path, contentType }         → URL prefirmada PUT a R2 catalog/<path> (10 min)
//       save_pack { slug, title, … }           → crea/actualiza un pack por slug → fila
//       update_pack { packId, …campos }        → edita nombre, descripción, género, sensación, portada
//       add_loops { packId, loops: [...] }     → inserta o ACTUALIZA por archivo (conserva id y marca)
//       update_loop { loopId, …campos }        → edita título, instrumento, sección, BPM, compases, tono, marca, sensaciones
//       delete_loop { loopId }                 → borra el loop y sus archivos en R2
//       delete_pack { packId }                 → borra el pack, sus loops y sus archivos
//       set_published { packId, published }
//       review { packId, approve, note? }      → aprueba (y publica) o rechaza un envío de la comunidad
//
//   · Comunidad (cualquier cuenta con plan Pro, prueba o cortesía):
//       my_packs                               → mis envíos con su estado y nota
//       c_save_pack { packId?, title, … }      → crea/edita mi pack (queda 'pending', sin publicar)
//       c_sign_put { packId, name, contentType } → PUT a R2 dentro de la carpeta de MI pack
//       c_add_loops { packId, loops, cover_path? } → como add_loops, solo en mi pack y sin publicar
//       c_submit { packId, rights: true }      → lo manda a revisión (confirma que tiene los derechos)
//       c_delete { packId }                    → retira mi envío (si aún no está aprobado)
//
// Las escrituras usan la service_role (inyectada por Supabase), nunca la app.
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
const PACK_COLUMNS = 'id,slug,title,description,cover_path,genre,mood,tier,published,sort,status,submitted_by,author_name,review_note,submitted_at';
const LOOP_COLUMNS = 'id,pack_id,title,instrument,section,bpm,musical_key,beats_per_bar,bars,tier,audio_path,preview_path,tags,sort';

// Límites de la comunidad (el administrador no los tiene).
const C_MAX_OPEN_PACKS = 5;     // envíos sin aprobar a la vez
const C_MAX_LOOPS = 60;         // loops por pack

function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..') || /^[a-zA-Z]:/.test(clean) || clean.length > 300) return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(clean)) return null;
  return clean;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const tagList = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.slice(0, 10).map((t) => str(t, 30).toLowerCase()).filter(Boolean))] : [];

// Valida y normaliza un loop recibido de la app. null = inválido.
function loopRow(l: any, packId: string) {
  const audio = safePath(l?.audio_path), preview = l?.preview_path ? safePath(l.preview_path) : null;
  const bpm = Number(l?.bpm), bars = Number(l?.bars);
  if (!audio || !str(l?.title) || !INSTRUMENTS.includes(l?.instrument) || !(bpm >= 20 && bpm <= 300)
      || !Number.isInteger(bars) || bars < 1 || bars > 64) return null;
  return {
    pack_id: packId, title: str(l.title, 120), instrument: l.instrument,
    section: SECTIONS.includes(l.section) ? l.section : 'any',
    bpm, bars, musical_key: str(l.musical_key, 6) || null,
    beats_per_bar: Number(l.beats_per_bar) || 4, beat_value: 4,
    tier: l.tier === 'free' ? 'free' : 'pro',
    audio_path: audio, preview_path: preview,
    size: Number(l.size) || null, duration_sec: Number(l.duration_sec) || null,
    tags: tagList(l.tags),
    sort: Number(l.sort) || 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!URL_ || !ANON || !SERVICE) return json({ error: 'Configuración de Supabase incompleta' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autenticado' }, 401);
  const asUser = { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }
  const action = String(body.action || '');
  const community = action === 'my_packs' || action.startsWith('c_');

  // ¿Quién llama?
  const uRes = await fetch(`${URL_}/auth/v1/user`, { headers: asUser });
  if (!uRes.ok) return json({ error: 'Sesión inválida' }, 401);
  const user = await uRes.json();
  if (!user?.id) return json({ error: 'Sesión inválida' }, 401);

  if (community) {
    // Comunidad: hace falta Pro (o prueba/cortesía), como para importar audio propio.
    const eRes = await fetch(`${URL_}/rest/v1/rpc/lp_entitlement`, { method: 'POST', headers: asUser, body: '{}' });
    const ent = eRes.ok ? await eRes.json() : null;
    if (!ent || ent.plan === 'free') return json({ error: 'Compartir packs con la comunidad es parte de LivePads Pro', code: 'plan_required' }, 402);
  } else {
    const aRes = await fetch(`${URL_}/rest/v1/rpc/stem_library_is_admin`, { method: 'POST', headers: asUser, body: '{}' });
    if (!aRes.ok) return json({ error: 'Sesión inválida' }, 401);
    if ((await aRes.json()) !== true) return json({ error: 'Solo el administrador de la biblioteca' }, 403);
  }

  const db = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${URL_}/rest/v1${path}`, {
      ...init,
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`BD ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };

  // ── R2 ──
  const r2 = () => {
    const ACCOUNT = Deno.env.get('R2_ACCOUNT_ID'), KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
    const SECRET = Deno.env.get('R2_SECRET_ACCESS_KEY'), BUCKET = Deno.env.get('R2_BUCKET');
    if (!ACCOUNT || !KEY_ID || !SECRET || !BUCKET) throw new Error('Configuración de R2 incompleta');
    const client = new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: 's3', region: 'auto' });
    const url = (key: string) => `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
    return { client, url };
  };
  const signPut = async (path: string) => {
    const { client, url } = r2();
    const key = `catalog/${path}`;
    const signed = await client.sign(new Request(`${url(key)}?X-Amz-Expires=600`, { method: 'PUT' }), { aws: { signQuery: true } });
    return { url: signed.url, key };
  };
  // Borrado best-effort: un archivo que ya no está no impide borrar la fila.
  const removeFiles = async (paths: (string | null)[]) => {
    const { client, url } = r2();
    const keys = paths.map((p) => safePath(p)).filter((p): p is string => !!p);
    await Promise.all(keys.map((p) => client.fetch(url(`catalog/${p}`), { method: 'DELETE' }).catch(() => null)));
  };

  const getPack = async (packId: string) => {
    if (!UUID_RE.test(packId)) return null;
    const rows = await db(`/stem_packs?id=eq.${packId}&select=${PACK_COLUMNS}`);
    return rows?.[0] || null;
  };
  const ownPack = async () => {
    const pack = await getPack(str(body.packId, 40));
    return pack && pack.submitted_by === user.id ? pack : null;
  };

  // Inserta o actualiza por (pack, archivo). Un archivo que ya existía conserva
  // su id (métricas, favoritos) y la marca GRATIS/PRO que se le puso a mano.
  const existingLoops = async (packId: string) =>
    new Map<string, string>(((await db(`/stem_loops?pack_id=eq.${packId}&select=audio_path,tier`)) || []).map((r: any) => [r.audio_path, r.tier]));
  const upsertLoops = async (rows: any[], tierOf: Map<string, string>) => {
    let updated = 0;
    for (const r of rows) if (tierOf.has(r.audio_path)) { r.tier = tierOf.get(r.audio_path); updated++; }
    const saved = await db('/stem_loops?on_conflict=pack_id,audio_path', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows),
    });
    return { ids: saved.map((r: any) => r.id), updated, added: rows.length - updated };
  };

  const parseLoops = (packId: string, max: number): { rows?: any[]; error?: string } => {
    const loops = Array.isArray(body.loops) ? body.loops : [];
    if (!loops.length || loops.length > max) return { error: 'Parámetros inválidos' };
    const rows = [];
    for (const l of loops as any[]) {
      const row = loopRow(l, packId);
      if (!row) return { error: `Loop inválido: ${str(l?.title) || '(sin título)'}` };
      rows.push(row);
    }
    return { rows };
  };

  const deletePackFully = async (pack: any) => {
    const loops = await db(`/stem_loops?pack_id=eq.${pack.id}&select=audio_path,preview_path`);
    await removeFiles([pack.cover_path, ...(loops || []).flatMap((l: any) => [l.audio_path, l.preview_path])]);
    await db(`/stem_packs?id=eq.${pack.id}`, { method: 'DELETE' }); // los loops caen en cascada
  };

  const withCount = (packs: any[]) => packs.map((p: any) => ({ ...p, loops: p.stem_loops?.[0]?.count ?? 0, stem_loops: undefined }));

  try {
    switch (action) {
      // ════════════════ Administrador ════════════════
      case 'list':
        return json({ packs: withCount(await db(`/stem_packs?select=${PACK_COLUMNS},stem_loops(count)&order=sort.asc,title.asc`)) });

      case 'list_loops': {
        const packId = str(body.packId, 40);
        if (!UUID_RE.test(packId)) return json({ error: 'Parámetros inválidos' }, 400);
        return json({ loops: await db(`/stem_loops?pack_id=eq.${packId}&select=${LOOP_COLUMNS}&order=sort.asc,title.asc`) });
      }

      case 'sign_put': {
        const path = safePath(body.path);
        const contentType = str(body.contentType, 60);
        if (!path || !CONTENT_TYPES.includes(contentType)) return json({ error: 'Ruta o tipo de archivo inválido' }, 400);
        return json(await signPut(path));
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

      case 'update_pack': {
        const pack = await getPack(str(body.packId, 40));
        if (!pack) return json({ error: 'Pack no encontrado' }, 404);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) {
          const t = str(body.title, 120);
          if (!t) return json({ error: 'El pack necesita un nombre' }, 400);
          patch.title = t;
        }
        if (body.description !== undefined) patch.description = str(body.description, 500) || null;
        if (body.genre !== undefined) patch.genre = str(body.genre, 60) || null;
        if (body.mood !== undefined) patch.mood = str(body.mood, 60) || null;
        if (body.tier !== undefined) patch.tier = body.tier === 'free' ? 'free' : 'pro';
        if (body.sort !== undefined) patch.sort = Number(body.sort) || 0;
        if (body.cover_path !== undefined) patch.cover_path = body.cover_path ? safePath(body.cover_path) : null;
        const [saved] = await db(`/stem_packs?id=eq.${pack.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        return json({ pack: saved });
      }

      case 'add_loops': {
        const packId = str(body.packId, 40);
        if (!UUID_RE.test(packId)) return json({ error: 'Parámetros inválidos' }, 400);
        const parsed = parseLoops(packId, 100);
        if (parsed.error) return json({ error: parsed.error }, 400);
        return json(await upsertLoops(parsed.rows!, await existingLoops(packId)));
      }

      case 'update_loop': {
        const loopId = str(body.loopId, 40);
        if (!UUID_RE.test(loopId)) return json({ error: 'Parámetros inválidos' }, 400);
        const patch: Record<string, unknown> = {};
        if (body.title !== undefined) {
          const t = str(body.title, 120);
          if (!t) return json({ error: 'El loop necesita un título' }, 400);
          patch.title = t;
        }
        if (body.instrument !== undefined) {
          if (!INSTRUMENTS.includes(body.instrument as string)) return json({ error: 'Instrumento inválido' }, 400);
          patch.instrument = body.instrument;
        }
        if (body.section !== undefined) patch.section = SECTIONS.includes(body.section as string) ? body.section : 'any';
        if (body.bpm !== undefined) {
          const b = Number(body.bpm);
          if (!(b >= 20 && b <= 300)) return json({ error: 'BPM fuera de rango (20–300)' }, 400);
          patch.bpm = b;
        }
        if (body.bars !== undefined) {
          const b = Number(body.bars);
          if (!Number.isInteger(b) || b < 1 || b > 64) return json({ error: 'Compases fuera de rango (1–64)' }, 400);
          patch.bars = b;
        }
        if (body.musical_key !== undefined) patch.musical_key = str(body.musical_key, 6) || null;
        if (body.tier !== undefined) patch.tier = body.tier === 'free' ? 'free' : 'pro';
        if (body.tags !== undefined) patch.tags = tagList(body.tags);
        if (!Object.keys(patch).length) return json({ error: 'Nada que cambiar' }, 400);
        const [saved] = await db(`/stem_loops?id=eq.${loopId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        if (!saved) return json({ error: 'Loop no encontrado' }, 404);
        return json({ loop: saved });
      }

      case 'delete_loop': {
        const loopId = str(body.loopId, 40);
        if (!UUID_RE.test(loopId)) return json({ error: 'Parámetros inválidos' }, 400);
        const [loop] = await db(`/stem_loops?id=eq.${loopId}&select=audio_path,preview_path`);
        if (!loop) return json({ error: 'Loop no encontrado' }, 404);
        await removeFiles([loop.audio_path, loop.preview_path]);
        await db(`/stem_loops?id=eq.${loopId}`, { method: 'DELETE' });
        return json({ ok: true });
      }

      case 'delete_pack': {
        const pack = await getPack(str(body.packId, 40));
        if (!pack) return json({ error: 'Pack no encontrado' }, 404);
        await deletePackFully(pack);
        return json({ ok: true });
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

      case 'review': {
        const pack = await getPack(str(body.packId, 40));
        if (!pack || pack.status === 'official') return json({ error: 'Envío no encontrado' }, 404);
        const approve = body.approve === true;
        await db(`/stem_packs?id=eq.${pack.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: approve ? 'approved' : 'rejected', published: approve,
            review_note: str(body.note, 500) || null, updated_at: new Date().toISOString(),
          }),
        });
        return json({ ok: true });
      }

      // ════════════════ Comunidad ════════════════
      case 'my_packs':
        return json({ packs: withCount(await db(`/stem_packs?submitted_by=eq.${user.id}&select=${PACK_COLUMNS},stem_loops(count)&order=updated_at.desc`)) });

      case 'c_save_pack': {
        const title = str(body.title, 120);
        if (!title) return json({ error: 'El pack necesita un nombre' }, 400);
        const fields = {
          title,
          description: str(body.description, 500) || null,
          genre: str(body.genre, 60) || null,
          mood: str(body.mood, 60) || null,
          author_name: str(body.author_name, 80) || null,
          updated_at: new Date().toISOString(),
        };
        if (body.packId) {
          const pack = await ownPack();
          if (!pack) return json({ error: 'Pack no encontrado' }, 404);
          if (pack.status === 'approved') return json({ error: 'Ya está aprobado; pide al administrador cualquier cambio' }, 409);
          const [saved] = await db(`/stem_packs?id=eq.${pack.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields) });
          return json({ pack: saved });
        }
        const open = await db(`/stem_packs?submitted_by=eq.${user.id}&status=in.(pending,rejected)&select=id`);
        if ((open || []).length >= C_MAX_OPEN_PACKS) return json({ error: `Puedes tener hasta ${C_MAX_OPEN_PACKS} envíos sin aprobar a la vez` }, 409);
        // Slug propio: c-<8 del usuario>-<nombre>, con sufijo si ya existe.
        const name = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pack';
        const base = `c-${user.id.slice(0, 8)}-${name}`;
        let slug = base;
        for (let n = 2; (await db(`/stem_packs?slug=eq.${slug}&select=id`)).length; n++) slug = `${base}-${n}`;
        const [saved] = await db('/stem_packs', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...fields, slug, tier: 'free', published: false, status: 'pending', submitted_by: user.id }),
        });
        return json({ pack: saved });
      }

      case 'c_sign_put': {
        const pack = await ownPack();
        if (!pack || pack.status === 'approved') return json({ error: 'Pack no encontrado' }, 404);
        const name = safePath(body.name);
        const contentType = str(body.contentType, 60);
        if (!name || !CONTENT_TYPES.includes(contentType)) return json({ error: 'Ruta o tipo de archivo inválido' }, 400);
        // Siempre dentro de la carpeta del pack: <slug>/<name>
        return json(await signPut(`${pack.slug}/${name}`));
      }

      case 'c_add_loops': {
        const pack = await ownPack();
        if (!pack || pack.status === 'approved') return json({ error: 'Pack no encontrado' }, 404);
        const parsed = parseLoops(pack.id, C_MAX_LOOPS);
        if (parsed.error) return json({ error: parsed.error }, 400);
        const inPack = (p: string | null) => !p || p.startsWith(`${pack.slug}/`);
        for (const r of parsed.rows!) {
          if (!inPack(r.audio_path) || !inPack(r.preview_path)) return json({ error: 'Archivo fuera de la carpeta del pack' }, 400);
          r.tier = 'free';  // la marca la decide el administrador al aprobar
        }
        const tierOf = await existingLoops(pack.id);
        const fresh = parsed.rows!.filter((r) => !tierOf.has(r.audio_path)).length;
        if (tierOf.size + fresh > C_MAX_LOOPS) return json({ error: `Un pack de la comunidad admite hasta ${C_MAX_LOOPS} loops` }, 409);
        if (body.cover_path !== undefined) {
          const cover = body.cover_path ? safePath(body.cover_path) : null;
          if (cover && !inPack(cover)) return json({ error: 'Portada fuera de la carpeta del pack' }, 400);
          await db(`/stem_packs?id=eq.${pack.id}`, { method: 'PATCH', body: JSON.stringify({ cover_path: cover }) });
        }
        return json(await upsertLoops(parsed.rows!, tierOf));
      }

      case 'c_submit': {
        const pack = await ownPack();
        if (!pack) return json({ error: 'Pack no encontrado' }, 404);
        if (pack.status === 'approved') return json({ error: 'Ya está aprobado' }, 409);
        if (body.rights !== true) return json({ error: 'Confirma que tienes los derechos de estos audios' }, 400);
        const loops = await db(`/stem_loops?pack_id=eq.${pack.id}&select=id`);
        if (!loops?.length) return json({ error: 'El pack no tiene loops' }, 400);
        const now = new Date().toISOString();
        await db(`/stem_packs?id=eq.${pack.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'pending', published: false, review_note: null, submitted_at: now, rights_confirmed_at: now, updated_at: now }),
        });
        return json({ ok: true });
      }

      case 'c_delete': {
        const pack = await ownPack();
        if (!pack) return json({ error: 'Pack no encontrado' }, 404);
        if (pack.status === 'approved') return json({ error: 'Ya está publicado; pide al administrador que lo retire' }, 409);
        await deletePackFully(pack);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
