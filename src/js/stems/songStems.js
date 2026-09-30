// Pistas POR CANCIÓN (stems para practicar).
//
// Además de la Secuencia y el Original (una mezcla cada uno), una canción puede
// guardar N pistas independientes: voz, batería, bajo, teclas, guía… Así quien
// quiera practicar elige QUÉ oír (por ejemplo, todo menos su instrumento) sin
// depender de la mezcla completa.
//
// Datos:  song.audio.stems = [{ id, name, kind, color, url }]
//   · url  → livepads://app/Stems/<slug-canción>/<nombre>__<hash>.<ext>
//            (carpeta de audios de la librería: sincroniza por OneDrive y sube
//            a R2 con subirBiblioteca() como cualquier otro archivo).
//   · kind → rol detectado por el nombre (vocals, drums, bass, other, stem…).
// Los metadatos viajan dentro de `audio` a Supabase (songSync), así que la
// otra PC y las apps móviles ven la lista aunque aún no tengan los bytes.

import { detectStemRole, STEM_ROLE_COLORS, STEM_KIND_BADGE } from './stemRole.js';
import { getSongs } from '../state/store.js';
import { pushModal } from '../ui/modalStack.js';
import { confirmDialogAsync } from '../ui/dialog.js';
import { showToast } from '../ui/toast.js';
import { esc } from '../utils/dom.js';
import { shouldCompress, compressToMp3, baseName, fmtMB } from '../audio/mp3Encode.js';
import { createZip } from '../utils/zip.js';

const FALLBACK_COLORS = ['#f59e0b', '#22c55e', '#06b6d4', '#e11d48', '#84cc16', '#8b5cf6', '#f97316', '#14b8a6'];

export function songSlug(song) {
  return String(song?.title || song?.id || 'cancion');
}

/** Lista normalizada de stems de una canción (siempre array). */
export function getSongStems(song) {
  const list = song?.audio && Array.isArray(song.audio.stems) ? song.audio.stems : [];
  return list.filter(s => s && typeof s.url === 'string' && s.url);
}

export function hasSongStems(song) { return getSongStems(song).length > 0; }

function colorFor(kind, index) {
  return STEM_ROLE_COLORS[kind] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function persistSong(song) { persist(song); }

function persist(song) {
  if (window.electronAPI?.saveGiSetlist) window.electronAPI.saveGiSetlist(getSongs());
  window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song?.id, stems: true } }));
}

/** Añade una pista ya guardada (url) a la canción. Devuelve el stem creado. */
export function attachStem(song, { url, name, kind, color }) {
  if (!song.audio) song.audio = {};
  if (!Array.isArray(song.audio.stems)) song.audio.stems = [];
  // Mismo archivo (mismo hash) → no duplicar.
  const dup = song.audio.stems.find(s => s && s.url === url);
  if (dup) return dup;
  const role = detectStemRole(name || 'pista');
  const stem = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name && name.replace(/\.[^.]+$/, '')) || role.name || 'Pista',
    kind: kind || role.kind || 'stem',
    color: color || colorFor(kind || role.kind, song.audio.stems.length),
    url,
  };
  song.audio.stems.push(stem);
  return stem;
}

/** Abre el selector de archivos y copia cada uno como stem de la canción. */
export async function addStemFilesToSong(song) {
  if (!window.electronAPI?.openAudioFiles || !window.electronAPI?.assignSongStem) {
    showToast('Esta versión de la app no puede guardar pistas por canción.', 'error');
    return [];
  }
  const files = await window.electronAPI.openAudioFiles();
  if (!files || !files.length) return [];
  const added = [];
  let savedBytes = 0, compressed = 0;
  for (const f of files) {
    try {
      const role = detectStemRole(f.name);
      let url;
      if (shouldCompress(f.name) && f.buffer && window.electronAPI.saveSongStem) {
        // WAV/AIFF/FLAC → MP3 192 kbps antes de guardar: la app y la nube pesan mucho menos.
        showToast(`Comprimiendo «${f.name}» a MP3…`, 'info');
        const { buffer, before, after } = await compressToMp3(f.buffer);
        url = await window.electronAPI.saveSongStem({ buffer, songSlug: songSlug(song), name: baseName(f.name), ext: 'mp3' });
        savedBytes += before - after;
        compressed++;
      } else {
        url = await window.electronAPI.assignSongStem({ sourcePath: f.path, songSlug: songSlug(song) });
      }
      added.push(attachStem(song, { url, name: role.name || baseName(f.name), kind: role.kind }));
    } catch (e) {
      console.error('No se pudo añadir el stem', f.name, e);
      showToast(`No se pudo añadir «${f.name}»: ${e.message || e}`, 'error');
    }
  }
  if (added.length) {
    persist(song);
    const extra = compressed ? ` · ${compressed} ${compressed === 1 ? 'archivo comprimido' : 'archivos comprimidos'} a MP3 (−${fmtMB(savedBytes)})` : '';
    showToast(`✓ ${added.length} ${added.length === 1 ? 'pista añadida' : 'pistas añadidas'} a «${song.title}»${extra}.`, 'success');
  }
  return added;
}

// ── Descarga completa (ZIP) ────────────────────────────────────────────────
const safeFile = (s) => String(s || 'audio').normalize('NFC').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'audio';
const extOf = (url) => { const m = String(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i); return m ? m[1].toLowerCase() : 'mp3'; };

/** Todos los audios de la canción (pistas + secuencia + original) listos para empaquetar. */
export function collectSongAudioEntries(song) {
  const out = [];
  const stems = getSongStems(song);
  stems.forEach((st, i) => out.push({ folder: 'Pistas', name: `${String(i + 1).padStart(2, '0')} - ${safeFile(st.name)}.${extOf(st.url)}`, url: st.url, rel: livepadsRel(st.url) }));
  if (song.audio?.sequence) out.push({ folder: '', name: `Secuencia.${extOf(song.audio.sequence)}`, url: song.audio.sequence, rel: livepadsRel(song.audio.sequence) });
  if (song.audio?.original) out.push({ folder: '', name: `Original.${extOf(song.audio.original)}`, url: song.audio.original, rel: livepadsRel(song.audio.original) });
  return out;
}

function livepadsRel(url) {
  const m = String(url || '').match(/^livepads:\/\/app\/(.+)$/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

/**
 * Empaqueta TODOS los audios de la canción en un ZIP (carpeta con Pistas/,
 * Secuencia y Original) y pide dónde guardarlo. Si a esta PC le faltan
 * archivos, los baja antes de la nube (mismo repertorio compartido).
 * `onProgress(texto)` es opcional (para el diálogo).
 */
export async function downloadSongAudioZip(song, onProgress = () => {}) {
  const entries = collectSongAudioEntries(song);
  if (!entries.length) { showToast('Esta canción no tiene audios para descargar.', 'info'); return false; }
  if (!window.electronAPI?.saveZipFile || !window.electronAPI?.readAudioFile) {
    showToast('Esta versión de la app no puede guardar ZIP.', 'error');
    return false;
  }
  // 1) Traer de la nube lo que falte en este equipo.
  const rels = entries.map(e => e.rel).filter(Boolean);
  if (rels.length) {
    try {
      const { present, missing } = await window.electronAPI.libraryFilesStat(rels);
      if (missing?.length) {
        onProgress(`Descargando ${missing.length} ${missing.length === 1 ? 'archivo' : 'archivos'} de la nube…`);
        const { bajarRutas } = await import('../cloud/fileSync.js');
        await bajarRutas(missing, (p) => onProgress(`Descargando ${p.done + 1}/${p.total}…`));
      }
    } catch (e) { console.warn('[songStems] sin nube:', e?.message || e); }
  }
  // 2) Leer y empaquetar.
  const root = safeFile(`${song.title || 'Cancion'}${song.artist ? ' - ' + song.artist : ''}`);
  const zip = createZip();
  let n = 0, skipped = [];
  for (const e of entries) {
    try {
      onProgress(`Empaquetando ${n + 1}/${entries.length}: ${e.name}`);
      const ab = await window.electronAPI.readAudioFile(e.url);
      if (!ab) throw new Error('vacío');
      zip.add(`${root}/${e.folder ? e.folder + '/' : ''}${e.name}`, ab);
      n++;
    } catch (err) {
      skipped.push(e.name);
    }
  }
  if (!n) { showToast('No se pudo leer ningún audio (¿falta sincronizar la biblioteca?).', 'error'); return false; }
  const bytes = zip.finish();
  onProgress('Guardando…');
  const saved = await window.electronAPI.saveZipFile({ suggestedName: root, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  if (!saved) return false;
  showToast(`✓ ${n} ${n === 1 ? 'audio guardado' : 'audios guardados'} en ZIP (${fmtMB(bytes.length)})${skipped.length ? ` · ${skipped.length} no disponibles: ${skipped.join(', ')}` : ''}.`, skipped.length ? 'warning' : 'success');
  return true;
}

export function removeStem(song, stemId) {
  if (!song?.audio?.stems) return;
  song.audio.stems = song.audio.stems.filter(s => s.id !== stemId);
  persist(song);
}

export function renameStem(song, stemId, name) {
  const st = getSongStems(song).find(s => s.id === stemId);
  if (!st || !name.trim()) return;
  st.name = name.trim();
  persist(song);
}

/**
 * Diálogo "Pistas de la canción": lista con casillas (elige qué practicar),
 * renombrar, borrar, añadir más y cargar al timeline.
 *   onLoad(song, stemsSeleccionados)  → lo implementa el workspace.
 */
export function openSongStemsDialog(song, { onLoad } = {}) {
  document.querySelector('.stems-assign-overlay.sst-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'stems-assign-overlay sst-overlay';
  overlay.innerHTML = `
    <div class="stems-assign-modal sst-modal" role="dialog" aria-modal="true" aria-label="Pistas de la canción">
      <div class="sam-head">
        <span class="sam-title">Pistas de «${esc(song.title || 'Canción')}»</span>
        <button class="sam-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="sst-sub">Marca las pistas que quieres oír y cárgalas al timeline. Ahí puedes silenciar, poner en solo o ajustar el volumen de cada una mientras practicas.</div>
      <div class="sst-list"></div>
      <div class="sst-foot">
        <button class="stems-btn stems-btn--ghost" data-act="add">+ Añadir pistas…</button>
        <button class="stems-btn stems-btn--ghost" data-act="zip" title="Descarga un ZIP con todas las pistas, la secuencia y el original de esta canción">⬇ Descargar todo (.zip)</button>
        <span class="sst-count"></span>
        <span class="spacer"></span>
        <button class="stems-btn stems-btn--ghost" data-act="all">Todas</button>
        <button class="stems-btn stems-btn--ghost" data-act="none">Ninguna</button>
        <button class="stems-btn stems-btn--primary" data-act="load">Cargar seleccionadas</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.sst-modal');
  const listEl = overlay.querySelector('.sst-list');
  const countEl = overlay.querySelector('.sst-count');
  const loadBtn = overlay.querySelector('[data-act="load"]');
  const selected = new Set(getSongStems(song).map(s => s.id));

  const pop = pushModal(() => close(), modal);
  const close = () => { try { pop(); } catch (_) {} overlay.remove(); };

  const render = () => {
    const stems = getSongStems(song);
    for (const id of [...selected]) if (!stems.some(s => s.id === id)) selected.delete(id);
    if (!stems.length) {
      listEl.innerHTML = `<div class="sst-empty">Esta canción aún no tiene pistas separadas.<br>Añade los archivos de cada instrumento (voz, batería, bajo, teclas…) o guarda las pistas del timeline con «Guardar pistas en canción».</div>`;
    } else {
      listEl.innerHTML = stems.map((st, i) => `
        <label class="sst-row ${selected.has(st.id) ? '' : 'is-off'}" data-id="${esc(st.id)}" style="--sst-color:${esc(st.color || colorFor(st.kind, i))}">
          <input type="checkbox" ${selected.has(st.id) ? 'checked' : ''} aria-label="Incluir ${esc(st.name)}">
          <span class="sst-dot"></span>
          <span class="sst-name">
            <input type="text" value="${esc(st.name)}" data-rename spellcheck="false" title="Clic para renombrar">
            <span class="sst-kind">${esc(STEM_KIND_BADGE[st.kind] || 'PISTA')}</span>
          </span>
          <button type="button" class="sst-del" data-del title="Quitar esta pista de la canción">&times;</button>
        </label>`).join('');
    }
    countEl.textContent = stems.length ? `${selected.size} de ${stems.length} seleccionadas` : '';
    loadBtn.disabled = selected.size === 0 || typeof onLoad !== 'function';
  };
  render();

  overlay.querySelector('.sam-close').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  listEl.onchange = (e) => {
    const row = e.target.closest('.sst-row');
    if (!row) return;
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.checked ? selected.add(row.dataset.id) : selected.delete(row.dataset.id);
      render();
    }
  };
  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.sst-row');
    if (!row) return;
    if (e.target.closest('[data-del]')) {
      e.preventDefault();
      const st = getSongStems(song).find(s => s.id === row.dataset.id);
      const ok = await confirmDialogAsync({
        title: 'Quitar pista',
        message: `¿Quitar «${st?.name || 'pista'}» de las pistas de «${song.title}»? El archivo queda en la librería; solo deja de aparecer aquí.`,
        confirmLabel: 'Quitar', danger: true,
      });
      if (ok) { removeStem(song, row.dataset.id); render(); }
      return;
    }
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-rename]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  listEl.addEventListener('focusout', (e) => {
    if (!e.target.matches('[data-rename]')) return;
    const row = e.target.closest('.sst-row');
    if (row) renameStem(song, row.dataset.id, e.target.value);
  });

  overlay.querySelector('[data-act="add"]').onclick = async () => {
    const added = await addStemFilesToSong(song);
    added.forEach(s => selected.add(s.id));
    render();
  };
  const zipBtn = overlay.querySelector('[data-act="zip"]');
  zipBtn.onclick = async () => {
    const label = zipBtn.textContent;
    zipBtn.disabled = true;
    try { await downloadSongAudioZip(song, (t) => { zipBtn.textContent = t; }); }
    finally { zipBtn.disabled = false; zipBtn.textContent = label; }
  };
  overlay.querySelector('[data-act="all"]').onclick = () => { getSongStems(song).forEach(s => selected.add(s.id)); render(); };
  overlay.querySelector('[data-act="none"]').onclick = () => { selected.clear(); render(); };
  loadBtn.onclick = () => {
    const chosen = getSongStems(song).filter(s => selected.has(s.id));
    if (!chosen.length) return;
    close();
    onLoad?.(song, chosen);
  };
}
