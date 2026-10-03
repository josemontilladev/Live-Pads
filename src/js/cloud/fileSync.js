// ─────────────────────────────────────────────────────────────────────────
// Biblioteca de ARCHIVOS en la nube (audio + carátulas) sobre Cloudflare R2.
//
// Las canciones ya sincronizan sus METADATOS por `songs` (songSync.js). Lo que
// faltaba eran los BYTES: sin ellos, iniciar sesión en una PC nueva te daba la
// lista de canciones… mudas. Esto lo cierra:
//
//   · subirBiblioteca()  → sube a R2 los audios/carátulas que aún no están y
//                          los registra en el manifiesto `library_files`.
//   · bajarBiblioteca()  → lee el manifiesto y baja lo que falte en esta PC.
//
// Las credenciales de R2 NO están aquí (la app la usan varias personas): se
// pide una URL prefirmada a la Edge Function `r2-sign`, que valida sesión y
// membresía. La transferencia de bytes ocurre en el proceso main (sin CORS).
//
// Las rutas son las MISMAS que ya usan las canciones ("Sequences/x.mp3"), y los
// nombres llevan el hash del contenido → deduplicación natural entre PCs.
// ─────────────────────────────────────────────────────────────────────────

import { rest, invokeFunction, isLoggedIn, getUser } from './supabase.js';
import { getActiveLibraryId } from './libraries.js';
import { getSongs } from '../state/store.js';

// "livepads://app/Sequences/Mi%20tema__abc.mp3" → "Sequences/Mi tema__abc.mp3"
export function urlToRelPath(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^livepads:\/\/app\/(.+)$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return m[1];
  }
}

// Todas las rutas de archivo que las canciones referencian (audio + carátula).
export function collectReferencedPaths(songs) {
  const set = new Set();
  (songs || getSongs()).forEach((s) => {
    const a = s.audio || {};
    const stemUrls = Array.isArray(a.stems) ? a.stems.map((st) => st && st.url) : [];
    [a.original, a.sequence, s.cover, ...stemUrls].forEach((u) => {
      const rel = urlToRelPath(u);
      if (rel) set.add(rel);
    });
  });
  return [...set];
}

// Samples de los KITS DE BATERÍA personalizados (UserDrums/*.wav). Se suben a
// R2 para que la app web reproduzca los kits del usuario. Best-effort.
export async function collectUserDrumsPaths() {
  const set = new Set();
  try {
    const raw = await window.electronAPI.loadUserDrums();
    const kits = (raw && Array.isArray(raw.kits)) ? raw.kits : [];
    const PADS = ['c_kick', 'c_snare', 'c_hhc', 'c_clap', 'c_perc1', 'c_perc2', 'c_crash', 'c_ride'];
    kits.forEach((k) => {
      PADS.forEach((id) => {
        const rel = urlToRelPath(k[id]);
        if (rel && rel.startsWith('UserDrums/')) set.add(rel);
      });
    });
  } catch (_) { /* sin kits o sin electronAPI: nada que subir */ }
  return [...set];
}

function requireContext() {
  if (!isLoggedIn()) throw new Error('Inicia sesión para usar la nube.');
  const libId = getActiveLibraryId();
  if (!libId) throw new Error('No hay una librería activa.');
  return libId;
}

// Manifiesto: qué archivos hay en la nube para esta librería.
export async function listCloudFiles(libId) {
  const rows = await rest(
    `/library_files?library_id=eq.${libId || getActiveLibraryId()}&select=path,size`
  );
  return Array.isArray(rows) ? rows : [];
}

async function signUrl(libraryId, relPath, op) {
  const r = await invokeFunction('r2-sign', { libraryId, path: relPath, op });
  if (!r || !r.url) throw new Error(r?.error || 'No se pudo firmar la URL.');
  return r.url;
}

// ── SUBIR: lo que está en esta PC y todavía no en la nube ──────────────────
export async function subirBiblioteca(onProgress) {
  const libId = requireContext();
  const referenced = collectReferencedPaths();
  // + los samples de los kits de batería personalizados (UserDrums).
  const drums = await collectUserDrumsPaths();
  drums.forEach((p) => referenced.push(p));
  if (!referenced.length) return { uploaded: 0, skipped: 0, failed: 0, total: 0 };

  // Solo podemos subir lo que exista físicamente aquí.
  const { present } = await window.electronAPI.libraryFilesStat(referenced);
  const cloud = new Set((await listCloudFiles(libId)).map((r) => r.path));
  const pending = present.filter((f) => !cloud.has(f.path));

  let uploaded = 0;
  let failed = 0;
  const userId = getUser()?.id || null;

  for (let i = 0; i < pending.length; i++) {
    const f = pending[i];
    onProgress?.({ phase: 'upload', done: i, total: pending.length, file: f.path });
    try {
      const url = await signUrl(libId, f.path, 'put');
      const { size, contentType } = await window.electronAPI.r2UploadFile({
        url,
        relPath: f.path,
      });
      // Registrar en el manifiesto (así las otras PCs saben que existe).
      await rest('/library_files', {
        method: 'POST',
        body: {
          library_id: libId,
          path: f.path,
          size,
          content_type: contentType,
          updated_by: userId,
        },
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      uploaded++;
    } catch (err) {
      console.warn('[fileSync] no se pudo subir', f.path, err?.message || err);
      failed++;
    }
  }
  onProgress?.({ phase: 'upload', done: pending.length, total: pending.length });
  return {
    uploaded,
    failed,
    skipped: present.length - pending.length,
    total: pending.length,
  };
}

// ── BAJAR: lo que está en la nube y falta en esta PC ───────────────────────
export async function bajarBiblioteca(onProgress) {
  const libId = requireContext();
  const cloud = await listCloudFiles(libId);
  if (!cloud.length) return { downloaded: 0, failed: 0, total: 0 };

  const { missing } = await window.electronAPI.libraryFilesStat(cloud.map((r) => r.path));
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const rel = missing[i];
    onProgress?.({ phase: 'download', done: i, total: missing.length, file: rel });
    try {
      const url = await signUrl(libId, rel, 'get');
      await window.electronAPI.r2DownloadFile({ url, relPath: rel });
      downloaded++;
    } catch (err) {
      console.warn('[fileSync] no se pudo bajar', rel, err?.message || err);
      failed++;
    }
  }
  onProgress?.({ phase: 'download', done: missing.length, total: missing.length });
  return { downloaded, failed, total: missing.length };
}

const IMG_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

// Bajada AUTOMÁTICA de lo que falte en esta PC (la usa libraryLive al arrancar y
// en cada ronda). Carátulas primero (son pequeñas y se ven al instante), luego el
// audio. `shouldStop()` permite abortar (sin red, cambio de librería…).
// `onImages()` se llama al terminar las carátulas para refrescar la lista.
export async function bajarFaltantesAuto({ onProgress, onImages, shouldStop, imagesOnly = false } = {}) {
  const libId = requireContext();
  const cloud = await listCloudFiles(libId);
  if (!cloud.length) return { downloaded: 0, failed: 0, total: 0 };
  const { missing } = await window.electronAPI.libraryFilesStat(cloud.map((r) => r.path));
  if (!missing.length) return { downloaded: 0, failed: 0, total: 0 };
  const ordered = imagesOnly
    ? missing.filter((p) => IMG_RE.test(p))
    : [...missing.filter((p) => IMG_RE.test(p)), ...missing.filter((p) => !IMG_RE.test(p))];
  if (!ordered.length) return { downloaded: 0, failed: 0, total: 0 };
  const nImg = missing.filter((p) => IMG_RE.test(p)).length;
  let downloaded = 0, failed = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (shouldStop && shouldStop()) break;
    onProgress?.({ done: i, total: ordered.length, file: ordered[i] });
    try {
      const url = await signUrl(libId, ordered[i], 'get');
      await window.electronAPI.r2DownloadFile({ url, relPath: ordered[i] });
      downloaded++;
    } catch (err) {
      console.warn('[fileSync] auto: no se pudo bajar', ordered[i], err?.message || err);
      failed++;
    }
    if (i + 1 === nImg && nImg > 0) onImages?.();
  }
  if (nImg === 0 || ordered.length === nImg) onImages?.();
  onProgress?.({ done: ordered.length, total: ordered.length });
  return { downloaded, failed, total: ordered.length };
}

// Baja solo estas rutas (las que falten en esta PC). Devuelve { downloaded, failed }.
export async function bajarRutas(paths, onProgress) {
  const libId = requireContext();
  const { missing } = await window.electronAPI.libraryFilesStat(paths);
  let downloaded = 0, failed = 0;
  for (let i = 0; i < missing.length; i++) {
    onProgress?.({ done: i, total: missing.length, file: missing[i] });
    try {
      const url = await signUrl(libId, missing[i], 'get');
      await window.electronAPI.r2DownloadFile({ url, relPath: missing[i] });
      downloaded++;
    } catch (err) {
      console.warn('[fileSync] no se pudo bajar', missing[i], err?.message || err);
      failed++;
    }
  }
  return { downloaded, failed, total: missing.length };
}

// ── Estado: para pintar "142/169 en la nube · faltan 3 aquí" ───────────────
export async function estadoBiblioteca() {
  const libId = requireContext();
  const referenced = collectReferencedPaths();
  const { present, missing } = await window.electronAPI.libraryFilesStat(referenced);
  const cloud = await listCloudFiles(libId);
  const cloudSet = new Set(cloud.map((r) => r.path));
  const bytes = cloud.reduce((a, r) => a + (Number(r.size) || 0), 0);
  return {
    referenced: referenced.length,
    localPresent: present.length,
    localMissing: missing.length, // están en canciones pero no en esta PC
    inCloud: cloud.length,
    cloudBytes: bytes,
    pendingUpload: present.filter((f) => !cloudSet.has(f.path)).length,
    pendingDownload: missing.filter((p) => cloudSet.has(p)).length,
  };
}
