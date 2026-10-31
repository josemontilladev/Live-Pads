// Biblioteca de stems oficial de LivePads (packs de loops para el editor).
//
// Catálogo en Supabase (stem_packs / stem_loops, solo lo publicado) y bytes en
// R2 bajo `catalog/`, firmados por la Edge Function `stem-library-sign`, que es
// la que aplica el plan (packs Pro). La escucha previa es libre.
//
// Caché local: lo que se descarga para el editor queda en la biblioteca de
// audio como `Loops/<pack-slug>/<archivo>` y se reproduce por livepads://app/…,
// así que un proyecto que ya usa un loop sigue sonando sin internet.
//
// Sin conexión: el catálogo (packs + loops publicados) se guarda en este equipo
// cada vez que se baja. Si la red falla se usa esa copia, y la UI marca qué
// loops ya están descargados (se pueden usar) y cuáles no.

import { rest, rpc, invokeFunction, isLoggedIn, onAuthChange } from './supabase.js';

const LOOP_COLUMNS = 'id,pack_id,title,instrument,section,bpm,musical_key,beats_per_bar,beat_value,bars,tier,audio_path,preview_path,duration_sec,tags,sort';
const PACK_COLUMNS = 'id,slug,title,description,cover_path,genre,mood,tier,sort,status,author_name';
const PACK_COLUMNS_OLD = 'id,slug,title,description,cover_path,genre,mood,tier,sort'; // sin la migración 0019

// "Sensaciones": etiquetas (stem_loops.tags) para filtrar por cómo suena.
export const FEELS = {
  intimo: 'Íntimo', ambiente: 'Ambiente', alegre: 'Alegre', intenso: 'Intenso', celebracion: 'Celebración', lento: 'Lento',
};

// El catálogo es pequeño (cientos de loops): se baja entero una vez por sesión
// y se filtra aquí. Así la búsqueda es instantánea y funciona sin conexión.
const CATALOG_KEY = 'stems-library-catalog-v1';
let catalog = null;          // { packs, loops, at }
let catalogPromise = null;
let offline = false;         // true = se está usando la copia guardada
export const isUsingOfflineCopy = () => offline;

function readSavedCatalog() {
  try { const c = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null'); return c && Array.isArray(c.loops) ? c : null; }
  catch (_) { return null; }
}
function saveCatalog(c) {
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify(c)); } catch (_) {}
}

async function fetchCatalog() {
  let packs;
  try { packs = await rest(`/stem_packs?select=${PACK_COLUMNS}&published=is.true&order=sort.asc,title.asc`); }
  catch (e) {
    if (!/column|status|author_name/i.test(e.message)) throw e;
    packs = await rest(`/stem_packs?select=${PACK_COLUMNS_OLD}&published=is.true&order=sort.asc,title.asc`);
  }
  const loops = await rest(`/stem_loops?select=${LOOP_COLUMNS},stem_packs!inner(published)&stem_packs.published=is.true&order=sort.asc,title.asc&limit=5000`);
  (loops || []).forEach((l) => { delete l.stem_packs; });
  return { packs: packs || [], loops: loops || [], at: Date.now() };
}

async function loadCatalog(refresh = false) {
  if (!isLoggedIn()) return { packs: [], loops: [] };
  if (catalog && !refresh) return catalog;
  if (!catalogPromise) {
    catalogPromise = fetchCatalog().then((c) => {
      catalog = c; offline = false; saveCatalog(c); return c;
    }).catch((e) => {
      const saved = readSavedCatalog();
      if (!saved) throw e;
      catalog = saved; offline = true; return saved;
    }).finally(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

export async function listPacks({ refresh = false } = {}) {
  return (await loadCatalog(refresh)).packs;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Busca loops. Todos los filtros son opcionales:
 *   packId, instrument, section, text (título, etiquetas o pack), feel, bpmMin/bpmMax, tag
 */
export async function listLoops(filters = {}, { refresh = false } = {}) {
  const { loops, packs } = await loadCatalog(refresh);
  const packTitle = new Map(packs.map((p) => [p.id, norm(p.title)]));
  const words = norm(filters.text).split(/\s+/).filter(Boolean);
  return loops.filter((l) => {
    if (filters.packId && l.pack_id !== filters.packId) return false;
    if (filters.instrument && l.instrument !== filters.instrument) return false;
    if (filters.section && l.section !== filters.section && l.section !== 'any') return false;
    if (filters.bpmMin && Number(l.bpm) < Number(filters.bpmMin)) return false;
    if (filters.bpmMax && Number(l.bpm) > Number(filters.bpmMax)) return false;
    const tags = Array.isArray(l.tags) ? l.tags : [];
    if (filters.tag && !tags.includes(filters.tag)) return false;
    if (filters.feel && !tags.includes(filters.feel)) return false;
    if (words.length) {
      const hay = `${norm(l.title)} ${tags.map(norm).join(' ')} ${packTitle.get(l.pack_id) || ''}`;
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Ids de los loops cuyo audio completo ya está en este equipo (usables sin conexión). */
export async function localLoopIds(loops) {
  if (!loops?.length) return new Set();
  const byPath = new Map(loops.map((l) => [localPathFor(l, 'audio'), l.id]));
  try {
    const { present } = await window.electronAPI.libraryFilesStat([...byPath.keys()]);
    return new Set((present || []).map((p) => byPath.get(typeof p === 'string' ? p : p.path)).filter(Boolean));
  } catch (_) { return new Set(); }
}

/**
 * Baja a este equipo todos los loops de un pack que la cuenta puede usar, para
 * tenerlos sin conexión. onProgress(hechos, total). Los PRO sin plan se saltan.
 */
export async function downloadPackOffline(packId, { canUsePro = false, onProgress } = {}) {
  const loops = (await listLoops({ packId })).filter((l) => canUsePro || l.tier === 'free');
  const have = await localLoopIds(loops);
  const todo = loops.filter((l) => !have.has(l.id));
  let done = 0, failed = 0;
  onProgress?.(done, todo.length);
  for (const l of todo) {
    try { await ensureLoopLocal(l); } catch (_) { failed++; }
    onProgress?.(++done, todo.length);
  }
  return { total: loops.length, downloaded: todo.length - failed, already: have.size, failed };
}

// ── Administración: marcar cada loop como gratis o Pro ──────────────────────
// La app solo decide si MUESTRA el botón; el servidor (stem_loop_set_tier)
// rechaza a quien no esté en stem_library_admins.
let adminCache = null;
onAuthChange(() => { adminCache = null; catalog = null; });
export async function isLibraryAdmin() {
  if (!isLoggedIn()) return false;
  if (adminCache == null) {
    try { adminCache = (await rpc('stem_library_is_admin')) === true; }
    catch (_) { adminCache = false; }
  }
  return adminCache;
}

export async function setLoopTier(loopId, tier) {
  return await rpc('stem_loop_set_tier', { p_loop_id: loopId, p_tier: tier });
}

// ── Métricas de uso (tabla stem_loop_events) ────────────────────────────────
// Se anota sin esperar y sin molestar: si falla (sin red, migración sin
// aplicar), el editor sigue igual. La escucha previa cuenta una vez por loop y
// sesión, para que repetirla no infle los números.
const previewed = new Set();
export function trackLoopEvent(loopId, event) {
  if (!isLoggedIn() || !loopId) return;
  if (event === 'preview') {
    if (previewed.has(loopId)) return;
    previewed.add(loopId);
  }
  rest('/stem_loop_events', { method: 'POST', body: { loop_id: loopId, event }, prefer: 'return=minimal' }).catch(() => {});
}

// ── Reportes (migración 0020): cualquiera reporta un loop; solo el admin los ve ──
export const REPORT_REASONS = {
  copyright: 'Derechos de autor', quality: 'Mala calidad', inappropriate: 'Contenido inapropiado', other: 'Otro',
};
/** Reporta un loop. Devuelve 'ok' o 'already' (ya lo habías reportado). */
export async function reportLoop(loopId, reason, note = '') {
  try {
    await rest('/stem_loop_reports', { method: 'POST', body: { loop_id: loopId, reason, note: note.trim().slice(0, 500) || null }, prefer: 'return=minimal' });
    return 'ok';
  } catch (e) {
    if (/duplicate|unique|23505/i.test(e.message)) return 'already';
    throw e;
  }
}
export const adminReports = () => rpc('stem_library_reports');
export const adminDismissReports = (loopId) => rpc('stem_library_dismiss_reports', { p_loop_id: loopId });

/** Administrador: loops más usados en los últimos `days` días. */
export const adminStats = (days = 30) => rpc('stem_library_stats', { p_days: days });
/** Administrador: uso de TODOS los loops publicables, también los que nadie usó (migración 0019). */
export const adminOverview = (days = 30) => rpc('stem_library_overview', { p_days: days });

// Subir y publicar packs desde la app (Edge Function stem-library-admin, que
// vuelve a comprobar que quien llama es administrador).
async function admin(action, payload = {}) {
  const r = await invokeFunction('stem-library-admin', { action, ...payload });
  if (!r || r.error) throw new Error(r?.error || 'Error de administración');
  return r;
}
export const adminListPacks = async () => (await admin('list')).packs;
export const adminListLoops = async (packId) => (await admin('list_loops', { packId })).loops;
export const adminSavePack = async (pack) => (await admin('save_pack', pack)).pack;
export const adminUpdatePack = async (packId, patch) => (await admin('update_pack', { packId, ...patch })).pack;
/** Inserta o actualiza por archivo → { ids, added, updated }. */
export const adminAddLoops = (packId, loops) => admin('add_loops', { packId, loops });
export const adminUpdateLoop = async (loopId, patch) => (await admin('update_loop', { loopId, ...patch })).loop;
export const adminDeleteLoop = (loopId) => admin('delete_loop', { loopId });
export const adminDeletePack = (packId) => admin('delete_pack', { packId });
export const adminSetPublished = (packId, published) => admin('set_published', { packId, published });
export const adminReview = (packId, approve, note = '') => admin('review', { packId, approve, note });

/** Sube bytes a catalog/<path> (firma en la función, PUT desde el proceso principal). */
export async function adminUpload(path, bytes, contentType) {
  const { url } = await admin('sign_put', { path, contentType });
  return window.electronAPI.r2PutBytes({ url, bytes, contentType });
}

// ── Comunidad: packs enviados por usuarios Pro, que modera el administrador ──
/** Loops de un envío propio (las RLS dejan ver a quien lo envió). */
export const listOwnPackLoops = (packId) =>
  rest(`/stem_loops?select=${LOOP_COLUMNS}&pack_id=eq.${encodeURIComponent(packId)}&order=sort.asc,title.asc`);
export const myCommunityPacks = async () => (await admin('my_packs')).packs;
export const communitySavePack = async (pack) => (await admin('c_save_pack', pack)).pack;
export const communityAddLoops = (packId, loops, extra = {}) => admin('c_add_loops', { packId, loops, ...extra });
export const communitySubmit = (packId) => admin('c_submit', { packId, rights: true });
export const communityUpdateLoop = async (loopId, patch) => (await admin('c_update_loop', { loopId, ...patch })).loop;
export const communityDeleteLoop = (loopId) => admin('c_delete_loop', { loopId });
export const communityDelete = (packId) => admin('c_delete', { packId });
/** Sube a catalog/<slug del pack>/<name>; devuelve la ruta dentro del catálogo. */
export async function communityUpload(packId, name, bytes, contentType) {
  const { url, key } = await admin('c_sign_put', { packId, name, contentType });
  await window.electronAPI.r2PutBytes({ url, bytes, contentType });
  return key.replace(/^catalog\//, '');
}

/** Portada del pack en caché local (Loops/<cover_path>) → URL livepads://, o null. */
export async function ensureCoverLocal(pack) {
  if (!pack?.cover_path) return null;
  const p = String(pack.cover_path).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.includes('..')) return null;
  const rel = `Loops/${p}`;
  const api = window.electronAPI;
  const { present } = await api.libraryFilesStat([rel]);
  if (!present.length) {
    const r = await invokeFunction('stem-library-sign', { packId: pack.id, kind: 'cover' });
    if (!r?.url) return null;
    await api.r2DownloadFile({ url: r.url, relPath: rel });
  }
  return `livepads://app/${rel.split('/').map(encodeURIComponent).join('/')}`;
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
