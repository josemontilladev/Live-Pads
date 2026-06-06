// GI library view — renders #gi-songs-container, handles all click/edit
// delegation, and exposes surgical helpers for handlers in app.js. State
// (the songs array, current genre, active song id) lives in app.js; this
// module reads it via the deps getters passed to initGiList().

import { q } from '../utils/dom.js';
import { songCardInnerHTML } from './songCard.js';
import { songEditFormHTML, applyLibrarySelection } from './songEditForm.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { showLoadAudioMenu, assignFromYoutube } from './audioLoadMenu.js';
import { audioMenuItems } from './songMenu.js';
import { openLyricsFullscreen } from './lyricsFullscreen.js';
import { confirmDialog } from './dialog.js';
import { bindTouchReorder } from '../utils/touchReorder.js';
import { getCurrentSetlistName } from '../data/service.js';
import {
  getSongs, setSongs,
  getCurrentGenre,
  getActiveSongId,
  getOpenAccordionSongId,
  isRecentSong, songAddedAt,
} from '../state/store.js';

let deps = null;
let renderToken = 0;

// Ámbito de repertorio (librería de la nube) por el que se filtra la lista:
//   'all'  → todas · 'local' → solo canciones sin librería · <uuid> → esa librería
let libraryScope = 'all';
export function setLibraryScope(scope) { libraryScope = scope || 'all'; }
export function getLibraryScope() { return libraryScope; }
function matchesLibraryScope(s) {
  if (libraryScope === 'all') return true;
  if (libraryScope === 'local') return !s.libraryId;
  return s.libraryId === libraryScope;
}

const CHUNK_THRESHOLD = 60;
const CHUNK_SIZE = 30;

export function initGiList(_deps) {
  deps = _deps;
  initDelegation();
  wireDedupe();
}

// Quita canciones repetidas (mismo título + artista + tono, normalizados).
// Conserva una por grupo, prefiriendo la vinculada a la nube (cloudId). Los
// duplicados intencionales en OTRA tonalidad NO se tocan. No muta; devuelve el
// resultado para que el handler confirme antes de aplicar.
function computeDedupe() {
  const norm = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nkey = (s) => `${norm(s.title)}|${norm(s.artist)}|${norm(s.key)}`;
  const seen = new Map();
  const keep = [];
  let removed = 0;
  for (const s of getSongs()) {
    const k = nkey(s);
    const prev = seen.get(k);
    if (!prev) { seen.set(k, s); keep.push(s); continue; }
    // Duplicado: si el que teníamos no está vinculado y este sí, conserva este.
    if (!prev.cloudId && s.cloudId) {
      const idx = keep.indexOf(prev);
      if (idx >= 0) keep[idx] = s;
      seen.set(k, s);
    }
    removed++;
  }
  return { removed, kept: keep };
}

function wireDedupe() {
  const btn = q('#gi-dedupe-btn');
  if (!btn) return;
  btn.onclick = () => {
    q('#gi-filter-menu')?.classList.add('hidden');
    const { removed, kept } = computeDedupe();
    if (!removed) { window.showToast?.('No hay canciones duplicadas.', 'info'); return; }
    confirmDialog({
      title: 'Eliminar duplicados',
      message: `Se encontraron ${removed} canción(es) repetida(s) (mismo título, artista y tono). ¿Dejar solo una de cada una? Los duplicados a propósito en otra tonalidad se conservan.`,
      confirmLabel: 'Eliminar', danger: true,
      onConfirm: () => {
        setSongs(kept);
        deps.persist();
        deps.updateFilterCounts();
        renderGiList(q('#gi-search')?.value || '');
        window.showToast?.(`${removed} duplicado(s) eliminado(s).`, 'success');
      },
    });
  };
}

// (assignFromYoutube + showLoadAudioMenu se movieron a ./audioLoadMenu.js para
//  compartirlos con el Servicio.)

// Normaliza texto para búsqueda: minúsculas + sin acentos/diacríticos. Así
// "Alabaré" y "alabare" matchean igual.
function normText(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Puntúa cuán "fuerte" matchea una canción contra el término libre (normalizado).
// Mayor score = más arriba en la lista. Coincidencia exacta de título gana
// siempre; luego prefijo de título, luego substring de título, artista,
// tags y por último letra (que es la fuente de más ruido).
function matchScore(s, term) {
  const t = normText(s.title);
  if (t === term) return 100;
  if (t.startsWith(term)) return 90;
  // Match de inicio de palabra dentro del título (ej. "Cristo" en "Aleluya Cristo Vive").
  if (new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) return 75;
  if (t.includes(term)) return 60;
  const ar = normText(s.artist);
  if (ar.includes(term)) return 45;
  const tags = normText(Array.isArray(s.tags) ? s.tags.join(' ') : '');
  if (tags.includes(term)) return 30;
  return 10; // solo letra
}

export function renderGiList(filter = '', editSongId = null) {
  const container = q('#gi-songs-container');
  if (!container) return;
  container.innerHTML = '';
  // Invalida CUALQUIER render por chunks en vuelo. Sin esto, si un render largo
  // (scope "Todas") seguía agregando tarjetas por idle-callback y luego se
  // cambiaba a un repertorio sin canciones (que muestra el CTA "Bajar canciones"
  // y retorna sin tocar el token), las tarjetas viejas se colaban DEBAJO del CTA.
  ++renderToken;

  const songs = getSongs();
  if (!songs.length) {
    container.innerHTML = `
      <div class="setlist-empty setlist-empty--cta">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="42" height="42"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <h4>Tu librería está vacía</h4>
        <p>Trae tus canciones desde MongoDB, importa un .json o crea una manualmente.</p>
        <div class="empty-cta-row">
          <button type="button" class="empty-cta" data-empty-action="sync">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Sincronizar
          </button>
          <button type="button" class="empty-cta" data-empty-action="import">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Importar .json
          </button>
          <button type="button" class="empty-cta empty-cta--primary" data-empty-action="new">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva canción
          </button>
        </div>
      </div>`;
    // Wire the 3 CTAs through to the existing buttons in the header so we
    // don't duplicate logic. They live as buttons, not real-action handlers.
    container.querySelector('[data-empty-action="sync"]').onclick   = () => q('#btn-sync-gi')?.click();
    container.querySelector('[data-empty-action="import"]').onclick = () => q('#btn-import-gi')?.click();
    container.querySelector('[data-empty-action="new"]').onclick    = () => q('#btn-add-gi-song')?.click();
    return;
  }

  // Search supports two modes:
  //   - free text: matches title / artist (case-insensitive substring)
  //   - "tono:X" or "key:X" prefix: filters by song.key starting with X
  //     (e.g. "tono:g" matches G, Gm, G#, Gb \u2014 useful for finding songs
  //     compatible with the current key on the fly)
  const lower = filter.trim().toLowerCase();
  const keyPrefix = (lower.startsWith('tono:') || lower.startsWith('key:'))
    ? lower.replace(/^(tono|key):\s*/, '').trim()
    : null;
  const tagPrefix = (keyPrefix === null && (lower.startsWith('tag:') || lower.startsWith('etiqueta:')))
    ? lower.replace(/^(tag|etiqueta):\s*/, '').trim()
    : null;
  const textTerm = (keyPrefix === null && tagPrefix === null) ? normText(filter) : '';

  const currentGenre = getCurrentGenre() || 'all';
  const filtered = songs.filter(s => {
    if (!matchesLibraryScope(s)) return false;
    if (keyPrefix !== null) {
      // Empty key prefix \u2192 show all songs that HAVE a key set.
      if (!s.key) return false;
      if (!s.key.toLowerCase().startsWith(keyPrefix)) return false;
    } else if (tagPrefix !== null) {
      const tags = Array.isArray(s.tags) ? s.tags : [];
      if (!tags.some(t => String(t).toLowerCase().includes(tagPrefix))) return false;
    } else {
      // Búsqueda libre tolerante: normaliza acentos/mayúsculas y exige que TODAS
      // las palabras del término aparezcan (en cualquier orden) en título /
      // artista / tags / letra. Así "alabare" encuentra "Alabaré" y
      // "santo siempre" encuentra "Santo Por Siempre".
      const hay = normText([
        s.title,
        s.artist || '',
        Array.isArray(s.tags) ? s.tags.join(' ') : '',
        s.lyrics ? String(s.lyrics).replace(/<[^>]*>/g, ' ') : '',
      ].join(' · '));
      const words = textTerm.split(/\s+/).filter(Boolean);
      if (!words.every(w => hay.includes(w))) return false;
    }
    if (currentGenre === 'all') return true;
    if (currentGenre === 'favoritos') return !!s.favorite;
    if (currentGenre === 'recientes') return isRecentSong(s);
    const genre = s.genre ? s.genre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
    return genre.includes(currentGenre);
  });

  // Sort the library view:
  //   · Búsqueda libre activa → ranking por relevancia (título > artista >
  //     tags > letra), desempate alfabético. Así "Cristo" trae primero las
  //     canciones cuyo TÍTULO empieza por "Cristo" en vez de mezclarlas con
  //     decenas de canciones que mencionan "Cristo" en la letra.
  //   · "Recientes" → más nuevas primero.
  //   · Resto → alfabético por título (accent-insensitive, locale ES).
  if (textTerm) {
    filtered.sort((a, b) => {
      const sb = matchScore(b, textTerm);
      const sa = matchScore(a, textTerm);
      if (sb !== sa) return sb - sa;
      return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
    });
  } else if (currentGenre === 'recientes') {
    filtered.sort((a, b) => songAddedAt(b) - songAddedAt(a));
  } else {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' }));
  }

  // editSongId override — when the user just added a new song, we pin it to
  // the top so the inline edit form is visible without scrolling.
  if (editSongId) {
    filtered.sort((a, b) => {
      if (a.id === editSongId) return -1;
      if (b.id === editSongId) return 1;
      return 0;
    });
  }

  if (!filtered.length) {
    // Si el filtro de búsqueda/género está activo → resultado vacío normal.
    // Si es un repertorio de la nube sin canciones locales → invita a bajarlas.
    const scopedLib = libraryScope !== 'all' && libraryScope !== 'local';
    const noFilters = !filter.trim() && getCurrentGenre() === 'all';
    if (scopedLib && noFilters) {
      container.innerHTML = `
        <div class="setlist-empty setlist-empty--cta">
          <p>Este repertorio aún no está en este equipo.</p>
          <div class="empty-cta-row">
            <button type="button" class="empty-cta empty-cta--primary" data-empty-action="pull">⬇ Bajar canciones</button>
          </div>
        </div>`;
      const b = container.querySelector('[data-empty-action="pull"]');
      if (b) b.onclick = () => import('../cloud/songSync.js')
        .then(m => m.pullLibrarySongs()).catch(() => {});
    } else {
      container.innerHTML = '<div class="setlist-empty">No se encontraron resultados.</div>';
    }
    return;
  }

  // Small libraries render synchronously (single paint, optimal). Large
  // libraries render in chunks via requestIdleCallback so the main thread
  // stays responsive — first chunk paints immediately, the rest stream in
  // during idle frames. Surgical-update call sites all check `if (match)`
  // before touching the DOM, so unmounted cards are harmless no-ops.
  // Only the plain-text search term gets highlighted — the "tono:G"
  // mode filters by key, which doesn't map to a substring in title/artist.
  const highlightTerm = keyPrefix === null ? textTerm : '';

  if (filtered.length <= CHUNK_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    filtered.forEach((song, idx) => fragment.appendChild(buildCard(song, idx, editSongId, highlightTerm)));
    container.appendChild(fragment);
    return;
  }

  const firstChunk = document.createDocumentFragment();
  const firstCount = Math.min(CHUNK_SIZE, filtered.length);
  for (let i = 0; i < firstCount; i++) firstChunk.appendChild(buildCard(filtered[i], i, editSongId, highlightTerm));
  container.appendChild(firstChunk);

  const token = ++renderToken;
  let cursor = firstCount;
  const schedule = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 8 }), 16));

  const streamNext = () => {
    if (token !== renderToken) return; // aborted by a newer render
    if (cursor >= filtered.length) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(cursor + CHUNK_SIZE, filtered.length);
    for (let i = cursor; i < end; i++) frag.appendChild(buildCard(filtered[i], i, editSongId, highlightTerm));
    container.appendChild(frag);
    cursor = end;
    if (cursor < filtered.length) schedule(streamNext);
  };
  schedule(streamNext);
}

function buildCard(song, idx, editSongId, searchTerm = '') {
  const el = document.createElement('div');
  el.className = 'gi-song-item';
  if (song.id != null) el.dataset.songId = String(song.id);
  el.dataset.libIndex = String(idx);
  // Editing → no drag (the textarea/inputs need to keep focus + cursor).
  el.draggable = editSongId !== song.id;
  const activeId = getActiveSongId();
  const openAccId = getOpenAccordionSongId();
  const isActive = song.id && activeId && (song.id === activeId);
  const isLyricsOpen = song.id && (song.id === openAccId);

  if (isActive) el.classList.add('active-song');

  el.innerHTML = songCardInnerHTML(song, {
    rowNumber: idx + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: true,
    removeBtnClass: 'btn-remove-lib',
    removeBtnTitle: 'Eliminar de la librería',
    searchTerm
  });

  if (editSongId === song.id) {
    el.innerHTML = songEditFormHTML(song, { placeholderForNewSong: true });
  }
  return el;
}

// ── Surgical helpers ──────────────────────────────────────────────────

// Repaint one card in place using the song's current state. ~50× cheaper
// than a full re-render of the library.
export function repaintGiCard(card, song) {
  if (!card) return;
  // Prefer the cached row index (kept current by renumberGiCards); fall back
  // to an O(N) DOM scan only if it's missing/stale.
  let idx = parseInt(card.dataset.libIndex, 10);
  if (!Number.isFinite(idx)) idx = Array.prototype.indexOf.call(card.parentNode.children, card);
  const activeId = getActiveSongId();
  const openAccId = getOpenAccordionSongId();
  const isActive = song.id && activeId && (song.id === activeId);
  const isLyricsOpen = song.id && (song.id === openAccId);
  card.classList.toggle('active-song', !!isActive);
  card.innerHTML = songCardInnerHTML(song, {
    rowNumber: idx + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: true,
    removeBtnClass: 'btn-remove-lib',
    removeBtnTitle: 'Eliminar de la librería'
  });
}

// Rewrite the 1-based position badge of every mounted card. Used after a
// surgical removal so the remaining cards renumber correctly.
export function renumberGiCards() {
  const container = q('#gi-songs-container');
  if (!container) return;
  container.querySelectorAll('.gi-song-item').forEach((card, i) => {
    card.dataset.libIndex = String(i); // keep cached index current for repaintGiCard
    const numEl = card.querySelector('.gi-row-num-text');
    if (numEl) numEl.textContent = String(i + 1);
  });
}

// Locate a mounted card by song id. Returns null if not rendered.
export function getGiCardBySongId(songId) {
  const container = q('#gi-songs-container');
  if (!container || songId == null) return null;
  return container.querySelector(`.gi-song-item[data-song-id="${CSS.escape(String(songId))}"]`);
}

function ensureEmptyState() {
  const container = q('#gi-songs-container');
  if (!container) return;
  if (!container.querySelector('.gi-song-item')) {
    const searchInput = q('#gi-search');
    renderGiList(searchInput ? searchInput.value : '');
  }
}

function findSong(songId) {
  return getSongs().find(s => String(s.id) === songId);
}

// Menú completo de una card de Librería: opciones de AUDIO/carátula (módulo
// compartido songMenu.js, iguales a las de Stems) + acciones (añadir al
// servicio, favorito, editar, eliminar). Lo abren el botón ⋮ y el clic derecho.
function openGiCardMenu(anchorEl, song, card) {
  const ICON_EDIT_SM   = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_TRASH_SM  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const ICON_STAR_OUT  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const ICON_STAR_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const ICON_ADD_SM    = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const onAssigned = (s) => { deps.persist(); repaintGiCard(card, s); };
  openCardMoreMenu(anchorEl, [
    ...audioMenuItems(song, onAssigned),
    {
      label: 'Añadir al servicio',
      icon: ICON_ADD_SM,
      onSelect: () => handleAddToService(song, card, anchorEl)
    },
    {
      label: song.favorite ? 'Quitar de favoritos' : 'Marcar favorito',
      icon: song.favorite ? ICON_STAR_FILL : ICON_STAR_OUT,
      onSelect: () => {
        song.favorite = !song.favorite;
        deps.persist();
        deps.updateFilterCounts();
        if (getCurrentGenre() === 'favoritos' && !song.favorite) {
          card.remove(); renumberGiCards(); ensureEmptyState();
        } else {
          repaintGiCard(card, song);
        }
      }
    },
    {
      label: 'Editar',
      icon: ICON_EDIT_SM,
      onSelect: () => {
        card.innerHTML = songEditFormHTML(song, { placeholderForNewSong: true });
        const firstInput = card.querySelector('.edit-title');
        if (firstInput) firstInput.focus();
      }
    },
    {
      label: 'Eliminar',
      icon: ICON_TRASH_SM,
      danger: true,
      onSelect: () => {
        confirmDialog({
          title: 'Eliminar canción',
          message: `¿Eliminar "${song.title}" de la librería? Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar',
          danger: true,
          onConfirm: () => {
            setSongs(getSongs().filter(s => s.id !== song.id));
            deps.persist();
            deps.updateFilterCounts();
            card.remove();
            renumberGiCards();
            ensureEmptyState();
          }
        });
      }
    }
  ]);
}

// ── Delegation ────────────────────────────────────────────────────────
// One click listener per container instead of 8 per card. Dispatch is via
// [data-action] on the target button, walked up with closest(). The card
// itself is identified by data-song-id.

function initDelegation() {
  const container = q('#gi-songs-container');
  if (!container) return;

  // Touch reorder (pairs with the native HTML5 drag below for mouse users).
  bindTouchReorder('#gi-songs-container', '.gi-song-item', 'libIndex', (fromIdx, toIdx) => {
    const arr = getSongs();
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    deps.persist();
    const searchInput = q('#gi-search');
    renderGiList(searchInput ? searchInput.value : '');
  });

  container.addEventListener('click', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    const song = findSong(card.dataset.songId);
    if (!song) return;

    const actionEl = e.target.closest('[data-action]');
    const action = actionEl && card.contains(actionEl) ? actionEl.dataset.action : null;

    switch (action) {
      case 'play-seq':
        // Con audio → reproduce; sin audio → menú "Cargar audio" (sube
        // archivo o, si hay original, extrae del original vía Stems).
        if (song.audio && song.audio.sequence) deps.loadAndPlayTrack(song, 'sequence');
        else showLoadAudioMenu({ anchor: e.target.closest('.action-btn'), song, type: 'sequence',
          loadAndPlayTrack: deps.loadAndPlayTrack, onAssigned: (s) => { deps.persist(); repaintGiCard(card, s); } });
        return;
      case 'play-orig':
        // Con audio → reproduce; sin audio → menú (Subir archivo / YouTube).
        if (song.audio && song.audio.original) deps.loadAndPlayTrack(song, 'original');
        else showLoadAudioMenu({ anchor: e.target.closest('.action-btn'), song, type: 'original',
          loadAndPlayTrack: deps.loadAndPlayTrack, onAssigned: (s) => { deps.persist(); repaintGiCard(card, s); } });
        return;
      case 'add':       handleAddToService(song, card, actionEl); return;
      case 'toggle-lyrics':
        // Sin letra → abre el editor directo para agregarla; con letra → acordeón.
        if (!song.lyrics) {
          deps.openLyricsEditorModal(song, (newLyrics) => {
            song.lyrics = newLyrics;
            deps.persist();
            repaintGiCard(card, song);
          });
        } else {
          deps.toggleLyricsAccordion(song, false);
        }
        return;
      case 'lyrics-fullscreen': e.stopPropagation(); openLyricsFullscreen(song); return;
      case 'toggle-chords': deps.toggleChordVisibility(song, false); return;
      case 'edit-lyrics':
        deps.openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          deps.persist();
          repaintGiCard(card, song);
        });
        return;
      case 'assign-audio-seq':  deps.loadAndPlayTrack(song, 'sequence'); return;
      case 'assign-audio-orig': deps.loadAndPlayTrack(song, 'original'); return;
      case 'yt-audio-orig':
        assignFromYoutube(song, () => { deps.persist(); card.innerHTML = songEditFormHTML(song); });
        return;
      case 'clear-audio-seq':
      case 'clear-audio-orig': {
        const slot = action === 'clear-audio-seq' ? 'sequence' : 'original';
        if (song.audio) song.audio[slot] = null;
        deps.persist();
        // Re-render the inline edit form so the status pill flips
        // from "✓ asignado" back to the "Asignar archivo" button.
        card.innerHTML = songEditFormHTML(song);
        return;
      }
      case 'more': {
        e.stopPropagation();
        openGiCardMenu(actionEl, song, card);
        return;
      }
      case 'edit': {
        card.innerHTML = songEditFormHTML(song, { placeholderForNewSong: true });
        const firstInput = card.querySelector('.edit-title');
        if (firstInput) firstInput.focus();
        return;
      }
      case 'edit-save': {
        const oldTitle = song.title;
        const oldGenre = song.genre;
        const valTitle = card.querySelector('.edit-title').value.trim();
        song.title = valTitle || 'Nueva Canción';
        song.artist = card.querySelector('.edit-artist').value.trim();
        song.bpm = card.querySelector('.edit-bpm').value.trim();
        song.key = card.querySelector('.edit-key').value;
        song.genre = card.querySelector('.edit-genre').value;
        const tagsEl = card.querySelector('.edit-tags');
        if (tagsEl) {
          song.tags = tagsEl.value.split(',').map(t => t.trim()).filter(Boolean);
        }
        const libChanged = applyLibrarySelection(card, song);
        deps.persist();
        deps.updateFilterCounts();
        // Toda edición guardada → sincronizar a la nube (sin re-render extra).
        window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
        const sortChanged = oldTitle !== song.title;
        const filterChanged = getCurrentGenre() !== 'all' && oldGenre !== song.genre;
        if (libChanged) {
          // La canción pudo cambiar de repertorio: re-render acá (para que salga
          // o desaparezca del filtro actual) y avisar a Stems para que se sincronice.
          const searchInput = q('#gi-search');
          renderGiList(searchInput ? searchInput.value : '');
          window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
        } else if (sortChanged || filterChanged) {
          const searchInput = q('#gi-search');
          renderGiList(searchInput ? searchInput.value : '');
        } else {
          repaintGiCard(card, song);
        }
        return;
      }
      case 'edit-cancel':
        if (song.title === 'Nueva Canción' && !song.artist && !song.bpm && !song.key) {
          setSongs(getSongs().filter(s => s.id !== song.id));
          deps.persist();
          deps.updateFilterCounts();
          card.remove();
          renumberGiCards();
          ensureEmptyState();
        } else {
          repaintGiCard(card, song);
        }
        return;
      case 'remove':
        confirmDialog({
          title: 'Eliminar canción',
          message: `¿Eliminar "${song.title}" de la librería? Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar',
          danger: true,
          onConfirm: () => {
            setSongs(getSongs().filter(s => s.id !== song.id));
            deps.persist();
            deps.updateFilterCounts();
            card.remove();
            renumberGiCards();
            ensureEmptyState();
            // Si la canción está en la nube, propaga el borrado a la librería
            // (offline-first: el módulo de nube lo ignora sin red o sin permiso).
            if (song.cloudId) {
              try { window.dispatchEvent(new CustomEvent('livepads:song-deleted', { detail: { cloudId: song.cloudId } })); } catch (_) {}
            }
          }
        });
        return;
      case 'edit-form-shell':
        // Wrapper exists only to swallow row-body clicks while editing.
        return;
    }

    // No action button matched — clicked on row body (title/artist/badges)
    deps.onApplySong(song);
  });

  // Clic derecho sobre una card → mismo menú completo que el botón ⋮ (como en
  // Stems): opciones de audio/carátula + acciones.
  container.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    if (card.querySelector('.gi-edit-form')) return; // editando → sin menú
    const song = findSong(card.dataset.songId);
    if (!song) return;
    e.preventDefault();
    openGiCardMenu(card.querySelector('.btn-more') || card, song, card);
  });

  // Drag-and-drop reorder. Same delegation pattern as the service list:
  // dragstart fades the dragged row, dragover highlights the drop target,
  // drop swaps positions in the songs[] array via setSongs() then refresh.
  // We disable native-drag while editing (handled in buildCard via
  // `draggable = false` on the editing card) so input cursors aren't
  // hijacked by drag.
  container.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.libIndex || '');
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (card) card.classList.remove('dragging');
  });
  container.addEventListener('dragover', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    e.preventDefault();
    card.classList.add('drag-over');
  });
  container.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (card) card.classList.remove('drag-over');
  });
  container.addEventListener('drop', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    e.preventDefault();
    card.classList.remove('drag-over');
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex   = parseInt(card.dataset.libIndex, 10);
    if (fromIndex === toIndex || !Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;
    // Mutate in place to preserve the array reference (other modules
    // hold the same one via getSongs()).
    const arr = getSongs();
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    deps.persist();
    const searchInput = q('#gi-search');
    renderGiList(searchInput ? searchInput.value : '');
  });
}

function handleAddToService(song, card, btn) {
  deps.addToService(song);
  btn.style.color = '#4ade80';
  const popup = document.createElement('div');
  popup.className = 'added-popup';
  const name = getCurrentSetlistName();
  popup.textContent = name ? `Añadida a “${name}”` : 'Añadida a tu lista de hoy';
  card.classList.add('has-popup');
  card.appendChild(popup);
  setTimeout(() => popup.classList.add('leaving'), 800);
  setTimeout(() => {
    popup.remove();
    card.classList.remove('has-popup');
    btn.style.color = '';
  }, 1200);
}
