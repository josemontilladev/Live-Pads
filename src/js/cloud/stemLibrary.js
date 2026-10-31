// Biblioteca de stems oficial de LivePads (packs de loops para el editor).
//
// Catálogo en Supabase (stem_packs / stem_loops, solo lo publicado) y bytes en
// R2 bajo `catalog/`, firmados por la Edge Function `stem-library-sign`, que es
// la que aplica el plan (packs Pro). La escucha previa es libre.
//
// Caché local: lo que se descarga para el editor queda en la biblioteca de
// audio como `Loops/<pack-slug>/<archivo>` y se reproduce por livepads://app/…,
// así que un proyecto que ya usa un loop sigue sonando sin internet.

import { rest, invokeFunction, isLoggedIn } from './supabase.js';

const LOOP_COLUMNS = 'id,pack_id,title,instrument,section,bpm,musical_key,beats_per_bar,beat_value,bars,audio_path,preview_path,duration_sec,tags,sort';
const PACK_COLUMNS = 'id,slug,title,description,cover_path,genre,mood,tier,sort';

let packsCache = null;   // la lista de packs cambia poco: una vez por sesión

export async function listPacks({ refresh = false } = {}) {
  if (!isLoggedIn()) return [];
  if (packsCache && !refresh) return packsCache;
  packsCache = await rest(`/stem_packs?select=${PACK_COLUMNS}&order=sort.asc,title.asc`);
  return packsCache;
}

/**
 * Busca loops. Todos los filtros son opcionales:
 *   packId, instrument, section, text (título), bpmMin/bpmMax, tag
 */
export async function listLoops(filters = {}) {
  if (!isLoggedIn()) return [];
  const q = [`select=${LOOP_COLUMNS}`, 'order=sort.asc,title.asc', 'limit=500'];
  if (filters.packId) q.push(`pack_id=eq.${encodeURIComponent(filters.packId)}`);
  if (filters.instrument) q.push(`instrument=eq.${encodeURIComponent(filters.instrument)}`);
  if (filters.section) q.push(`section=in.(${encodeURIComponent(filters.section)},any)`);
  if (filters.bpmMin) q.push(`bpm=gte.${Number(filters.bpmMin)}`);
  if (filters.bpmMax) q.push(`bpm=lte.${Number(filters.bpmMax)}`);
  if (filters.tag) q.push(`tags=cs.{${encodeURIComponent(filters.tag)}}`);
  if (filters.text) {
    // PostgREST: * es el comodín de ilike en la URL.
    const t = String(filters.text).replace(/[*,()]/g, ' ').trim();
    if (t) q.push(`title=ilike.*${encodeURIComponent(t)}*`);
  }
  return await rest(`/stem_loops?${q.join('&')}`);
}

async function signLoop(loopId, kind) {
  const r = await invokeFunction('stem-library-sign', { loopId, kind });
  if (!r || !r.url) throw new Error(r?.error || 'No se pudo firmar la URL.');
  return r.url;
}

export async function coverUrl(packId) {
  const r = await invokeFunction('stem-library-sign', { packId, kind: 'cover' });
  return r?.url || null;
}

// Ruta en la caché local: Loops/<ruta del catálogo>. audio_path ya viene como
// "<pack-slug>/<archivo>" (y preview_path como "<pack-slug>/preview/<archivo>"),
// así que se reutiliza tal cual; si un día el panel guarda otra forma, se cae
// al id del loop.
export function localPathFor(loop, kind = 'audio') {
  const raw = kind === 'preview' ? loop.preview_path : loop.audio_path;
  const p = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const safe = p && !p.includes('..') ? p : `${loop.id}${kind === 'preview' ? '-preview' : ''}`;
  return `Loops/${safe}`;
}

// Baja a la caché (si falta) y devuelve la URL livepads://. Se descarga desde
// el proceso principal (r2DownloadFile), así que no depende del CORS de R2.
async function ensureLocal(loop, kind) {
  const rel = localPathFor(loop, kind);
  const api = window.electronAPI;
  const { present } = await api.libraryFilesStat([rel]);
  if (!present.length) {
    let url;
    try {
      url = await signLoop(loop.id, kind);
    } catch (e) {
      if (/Pro/.test(e.message)) e.code = 'plan_required';
      throw e;
    }
    await api.r2DownloadFile({ url, relPath: rel });
  }
  return `livepads://app/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * URL livepads:// del audio completo, bajándolo a la caché si no está. Lanza un
 * Error con code 'plan_required' si el pack es Pro y la cuenta no.
 */
export function ensureLoopLocal(loop) {
  return ensureLocal(loop, 'audio');
}

/** Escucha previa (libre). Sin preview propia, cae al audio completo. */
export function ensurePreviewLocal(loop) {
  return ensureLocal(loop, loop.preview_path ? 'preview' : 'audio');
}
