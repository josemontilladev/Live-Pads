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
//       storage                                → espacio real en R2: total, por partes, por pack y sobrantes
//       delete_orphans                         → borra los archivos de catalog/ que ya no usa nada (> 1 h)
//       update_loop { loopId, …campos }        → edita título, instrumento, sección, BPM, compases, tono, marca, sensaciones
//       delete_loop { loopId }                 → borra el loop y sus archivos en R2
//       delete_pack { packId }                 → borra el pack, sus loops y sus archivos
//       set_published { packId, published }
//       review { packId, approve, note? }      → aprueba (y publica) o rechaza un envío de la comunidad
//
//   · Comunidad (cualquier cuenta con plan Pro, prueba o cortesía):
//       my_packs                               → mis envíos con su estado y nota
//       c_save_pack { packId?, title, …, cover_path? } → crea/edita mi pack (queda 'pending', sin publicar)
//       c_update_loop { loopId, …campos }      → corrige los datos de un loop de mi envío (sin re-subir)
//       c_delete_loop { loopId }               → quita un loop de mi envío
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
const INSTRUMENTS = ['drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar', 'strings', 'vocals', 'guide', 'click', 'fx', 'other'];
const SECTIONS = ['any', 'intro', 'verse', 'prechorus', 'chorus', 'bridge', 'build', 'outro'];
// audio/mpeg: las pistas largas (canción completa) se suben comprimidas a MP3.
const CONTENT_TYPES = ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mpeg', 'image/jpeg', 'image/png', 'image/webp'];
const PACK_COLUMNS = 'id,slug,title,description,cover_path,genre,mood,tier,published,sort,status,submitted_by,author_name,review_note,submitted_at,artist'; // artist: migración 0023 (aplicarla ANTES de desplegar)
const LOOP_COLUMNS = 'id,pack_id,title,instrument,section,bpm,musical_key,beats_per_bar,bars,tier,audio_path,preview_path,tags,sort';

// Límites de la comunidad (el administrador no los tiene).
const C_MAX_OPEN_PACKS = 5;     // envíos sin aprobar a la vez
const C_MAX_LOOPS = 60;         // loops por pack
const MB = 1024 ** 2;
const C_MAX_PACK_BYTES = 300 * MB;      // peso de un pack de la comunidad
const C_MAX_PENDING_BYTES = 1024 * MB;  // todo lo que tiene sin aprobar una persona
const STALE_DAYS = 30;                  // borradores sin enviar y rechazados: se borran

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
      || !Number.isInteger(bars) || bars < 1 || bars > 1024) return null;
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

  // Bytes reales en R2 bajo un prefijo (ListObjectsV2). Devuelve también cada clave.
  const listPrefix = async (prefix: string) => {
    const { client, url } = r2();
    const base = url('').replace(/\/$/, '');
    const items: { key: string; size: number; at: number }[] = [];
    let token = '';
    for (let page = 0; page < 500; page++) {
      const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token) q.set('continuation-token', token);
      const res = await client.fetch(`${base}?${q}`);
      if (!res.ok) throw new Error(`R2 no respondió al medir el espacio (${res.status})`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const k = m[1].match(/<Key>([^<]+)<\/Key>/), z = m[1].match(/<Size>(\d+)<\/Size>/), t = m[1].match(/<LastModified>([^<]+)<\/LastModified>/);
        if (k) items.push({ key: k[1].replace(/&amp;/g, '&'), size: Number(z?.[1] || 0), at: t ? Date.parse(t[1]) || 0 : 0 });
      }
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      if (!next || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = next[1].replace(/&amp;/g, '&');
    }
    return items;
  };
  const prefixBytes = async (prefix: string) => (await listPrefix(prefix)).reduce((n, it) => n + it.size, 0);

  // Rutas que usa algún pack o loop (sin el prefijo catalog/). Paginado: PostgREST da 1000 filas por vez.
  const usedPaths = async () => {
    const used = new Set<string>();
    for (const p of (await db('/stem_packs?select=cover_path')) || []) if (p.cover_path) used.add(p.cover_path);
    for (let off = 0; off < 200000; off += 1000) {
      const rows = (await db(`/stem_loops?select=audio_path,preview_path&order=id&limit=1000&offset=${off}`)) || [];
      for (const r of rows) { if (r.audio_path) used.add(r.audio_path); if (r.preview_path) used.add(r.preview_path); }
      if (rows.length < 1000) break;
    }
    return used;
  };
  // Un archivo de menos de una hora puede ser de una subida que aún no terminó.
  const ORPHAN_GRACE_MS = 60 * 60 * 1000;
  const isOrphan = (it: { key: string; at: number }, used: Set<string>) =>
    !used.has(it.key.replace(/^catalog\//, '')) && Date.now() - (it.at || 0) > ORPHAN_GRACE_MS;
  const fmtB = (b: number) => b >= 1024 * MB ? `${(b / (1024 * MB)).toFixed(2)} GB` : `${Math.round(b / MB)} MB`;

  // Limpieza: borradores que nunca se enviaron y envíos rechazados, tras 30 días.
  const cleanupStale = async (submitter?: string) => {
    const since = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
    const who = submitter ? `&submitted_by=eq.${submitter}` : '';
    const stale = await db(`/stem_packs?select=${PACK_COLUMNS},updated_at&updated_at=lt.${since}${who}&or=(status.eq.rejected,and(status.eq.pending,submitted_at.is.null))`).catch(() => []);
    for (const p of stale || []) { try { await deletePackFully(p); } catch (_) { /* sigue con el resto */ } }
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
  // Se reconoce por el nombre SIN extensión: re-subir «Bajo.wav» como «Bajo.mp3»
  // actualiza el mismo loop (no lo duplica) y borra el archivo viejo de R2.
  const baseKey = (p: string) => String(p || '').replace(/\.[^./]+$/, '');
  const existingLoops = async (packId: string) => {
    const rows = (await db(`/stem_loops?pack_id=eq.${packId}&select=id,audio_path,preview_path,tier`)) || [];
    return new Map<string, any>(rows.map((r: any) => [baseKey(r.audio_path), r]));
  };
  const upsertLoops = async (rows: any[], prev: Map<string, any>) => {
    let updated = 0;
    const ids: string[] = [], fresh: any[] = [], stale: (string | null)[] = [];
    for (const r of rows) {
      const old = prev.get(baseKey(r.audio_path));
      if (!old) { fresh.push(r); continue; }
      r.tier = old.tier; updated++;
      if (old.audio_path !== r.audio_path) stale.push(old.audio_path);
      if (old.preview_path && old.preview_path !== r.preview_path) stale.push(old.preview_path);
      const [saved] = await db(`/stem_loops?id=eq.${old.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(r) });
      if (saved) ids.push(saved.id);
    }
    if (fresh.length) {
      const saved = await db('/stem_loops?on_conflict=pack_id,audio_path', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(fresh),
      });
      ids.push(...saved.map((r: any) => r.id));
    }
    if (stale.length) await removeFiles(stale);
    return { ids, updated, added: rows.length - updated };
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

  // Cambios permitidos en un loop (validados). `tier` solo lo toca el administrador.
  const loopPatch = (allowTier: boolean): { patch: Record<string, unknown> } | { error: string } => {
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const t = str(body.title, 120);
      if (!t) return { error: 'El loop necesita un título' };
      patch.title = t;
    }
    if (body.instrument !== undefined) {
      if (!INSTRUMENTS.includes(body.instrument as string)) return { error: 'Instrumento inválido' };
      patch.instrument = body.instrument;
    }
    if (body.section !== undefined) patch.section = SECTIONS.includes(body.section as string) ? body.section : 'any';
    if (body.bpm !== undefined) {
      const b = Number(body.bpm);
      if (!(b >= 20 && b <= 300)) return { error: 'BPM fuera de rango (20–300)' };
      patch.bpm = b;
    }
    if (body.bars !== undefined) {
      const b = Number(body.bars);
      if (!Number.isInteger(b) || b < 1 || b > 1024) return { error: 'Compases fuera de rango (1–1024)' };
      patch.bars = b;
    }
    if (body.musical_key !== undefined) patch.musical_key = str(body.musical_key, 6) || null;
    if (allowTier && body.tier !== undefined) patch.tier = body.tier === 'free' ? 'free' : 'pro';
    if (body.tags !== undefined) patch.tags = tagList(body.tags);
    if (!Object.keys(patch).length) return { error: 'Nada que cambiar' };
    return { patch };
  };

  // Loop de un envío propio y aún editable (no aprobado).
  const ownLoop = async () => {
    const loopId = str(body.loopId, 40);
    if (!UUID_RE.test(loopId)) return null;
    const [loop] = await db(`/stem_loops?id=eq.${loopId}&select=id,pack_id,audio_path,preview_path`);
    if (!loop) return null;
    const pack = await getPack(loop.pack_id);
    return pack && pack.submitted_by === user.id && pack.status !== 'approved' ? loop : null;
  };

  const withCount = (packs: any[]) => packs.map((p: any) => ({ ...p, loops: p.stem_loops?.[0]?.count ?? 0, stem_loops: undefined }));

  try {
    switch (action) {
      // ════════════════ Administrador ════════════════
      // Espacio que ocupa la biblioteca en R2 (suma de lo subido: audio + escucha previa).
      // Lo que ocupa de verdad el bucket, por partes: tu Biblioteca, la comunidad
      // y las librerías de los usuarios.
      // También: lo que ocupa cada pack y los archivos SOBRANTES (en R2 pero sin
      // ningún loop ni portada que los use: restos de subidas cortadas, archivos
      // reemplazados, packs borrados a medias). Esos se pueden borrar sin perder nada.
      case 'storage': {
        const [catalog, libs, packs, used] = await Promise.all([
          listPrefix('catalog/'), listPrefix('lib/'), db('/stem_packs?select=id,slug,title,status,published'), usedPaths(),
        ]);
        const community = new Set((packs || []).filter((p: any) => p.status && p.status !== 'official').map((p: any) => p.slug));
        const bySlug = new Map<string, any>();
        for (const p of packs || []) bySlug.set(p.slug, { id: p.id, slug: p.slug, title: p.title, status: p.status || 'official', published: !!p.published, bytes: 0, files: 0, orphanBytes: 0, orphanFiles: 0 });
        let official = 0, comm = 0, orphanBytes = 0, orphanFiles = 0;
        for (const it of catalog) {
          const slug = it.key.split('/')[1] || '';
          if (community.has(slug)) comm += it.size; else official += it.size;
          const g = bySlug.get(slug);
          if (g) { g.bytes += it.size; g.files++; }
          if (isOrphan(it, used)) {
            orphanBytes += it.size; orphanFiles++;
            if (g) { g.orphanBytes += it.size; g.orphanFiles++; }
          }
        }
        const users = libs.reduce((n, it) => n + it.size, 0);
        return json({
          bytes: official + comm + users, official, community: comm, libraries: users, files: catalog.length + libs.length,
          packs: [...bySlug.values()].sort((a, b) => b.bytes - a.bytes),
          orphans: { bytes: orphanBytes, files: orphanFiles },
        });
      }

      // Borra los archivos sobrantes (se recalculan aquí; nunca los de la última hora,
      // que pueden ser de una subida en curso).
      case 'delete_orphans': {
        const [catalog, used] = await Promise.all([listPrefix('catalog/'), usedPaths()]);
        const doomed = catalog.filter((it) => isOrphan(it, used)).slice(0, 3000);
        const { client, url } = r2();
        let freed = 0, deleted = 0;
        for (let i = 0; i < doomed.length; i += 25) {
          await Promise.all(doomed.slice(i, i + 25).map(async (it) => {
            const res = await client.fetch(url(it.key), { method: 'DELETE' }).catch(() => null);
            if (res && (res.ok || res.status === 404)) { freed += it.size; deleted++; }
          }));
        }
        return json({ deleted, freed });
      }

      case 'list':
        await cleanupStale();
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
        // Solo si viene (columna de la migración 0023): las apps antiguas no lo mandan.
        if (body.artist !== undefined) row.artist = str(body.artist, 80) || null;
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
        if (body.artist !== undefined) patch.artist = str(body.artist, 80) || null;
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
        const built = loopPatch(true);
        if ('error' in built) return json({ error: built.error }, 400);
        const [saved] = await db(`/stem_loops?id=eq.${loopId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(built.patch) });
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
        // Rechazado: sus audios se borran ya (no ocupan espacio). Queda el pack con
        // la nota para quien lo envió; a los 30 días se borra del todo.
        if (!approve) {
          const loops = await db(`/stem_loops?pack_id=eq.${pack.id}&select=audio_path,preview_path`);
          await removeFiles((loops || []).flatMap((l: any) => [l.audio_path, l.preview_path]));
          await db(`/stem_loops?pack_id=eq.${pack.id}`, { method: 'DELETE' });
        }
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
        await cleanupStale(user.id);
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
          ...(body.artist !== undefined ? { artist: str(body.artist, 80) || null } : {}),
          updated_at: new Date().toISOString(),
        };
        if (body.packId) {
          const pack = await ownPack();
          if (!pack) return json({ error: 'Pack no encontrado' }, 404);
          if (pack.status === 'approved') return json({ error: 'Ya está aprobado; pide al administrador cualquier cambio' }, 409);
          const patch: Record<string, unknown> = { ...fields };
          if (body.cover_path !== undefined) {
            const cover = body.cover_path ? safePath(body.cover_path) : null;
            if (cover && !cover.startsWith(`${pack.slug}/`)) return json({ error: 'Portada fuera de la carpeta del pack' }, 400);
            patch.cover_path = cover;
          }
          const [saved] = await db(`/stem_packs?id=eq.${pack.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
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

      case 'c_update_loop': {
        const loop = await ownLoop();
        if (!loop) return json({ error: 'Loop no encontrado' }, 404);
        const built = loopPatch(false);
        if ('error' in built) return json({ error: built.error }, 400);
        const [saved] = await db(`/stem_loops?id=eq.${loop.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(built.patch) });
        return json({ loop: saved });
      }

      case 'c_delete_loop': {
        const loop = await ownLoop();
        if (!loop) return json({ error: 'Loop no encontrado' }, 404);
        await removeFiles([loop.audio_path, loop.preview_path]);
        await db(`/stem_loops?id=eq.${loop.id}`, { method: 'DELETE' });
        return json({ ok: true });
      }

      case 'c_sign_put': {
        const pack = await ownPack();
        if (!pack || pack.status === 'approved') return json({ error: 'Pack no encontrado' }, 404);
        const name = safePath(body.name);
        const contentType = str(body.contentType, 60);
        if (!name || !CONTENT_TYPES.includes(contentType)) return json({ error: 'Ruta o tipo de archivo inválido' }, 400);
        // Espacio: el pack ≤ 300 MB y todo lo pendiente de esta persona ≤ 1 GB.
        const size = Number(body.size);
        if (!(size > 0)) return json({ error: 'Actualiza LivePads para enviar packs.', code: 'update_required' }, 426);
        const items = await listPrefix(`catalog/${pack.slug}/`);
        const prev = items.find((it) => it.key === `catalog/${pack.slug}/${name}`)?.size || 0;
        const packBytes = items.reduce((n, it) => n + it.size, 0) - prev + size;
        if (packBytes > C_MAX_PACK_BYTES) {
          return json({ error: `Un pack de la comunidad puede ocupar hasta ${fmtB(C_MAX_PACK_BYTES)} (este llegaría a ${fmtB(packBytes)}).`, code: 'quota' }, 413);
        }
        const mine = await db(`/stem_packs?submitted_by=eq.${user.id}&status=neq.approved&select=slug`);
        let pending = 0;
        for (const p of mine || []) if (p.slug !== pack.slug) pending += await prefixBytes(`catalog/${p.slug}/`);
        if (pending + packBytes > C_MAX_PENDING_BYTES) {
          return json({ error: `Tus envíos sin aprobar ocuparían ${fmtB(pending + packBytes)}; el máximo es ${fmtB(C_MAX_PENDING_BYTES)}. Espera a que se revisen o retira alguno.`, code: 'quota' }, 413);
        }
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
        const fresh = parsed.rows!.filter((r) => !tierOf.has(baseKey(r.audio_path))).length;
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
