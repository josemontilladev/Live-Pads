// GI library view — renders #gi-songs-container, handles all click/edit
// delegation, and exposes surgical helpers for handlers in app.js. State
// (the songs array, current genre, active song id) lives in app.js; this
// module reads it via the deps getters passed to initGiList().

import { q } from '../utils/dom.js';
import { songCardInnerHTML } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';
import { confirmDialog } from './dialog.js';
import { bindTouchReorder } from '../utils/touchReorder.js';
import {
  getSongs, setSongs,
  getCurrentGenre,
  getActiveSongId,
  getOpenAccordionSongId,
  isRecentSong, songAddedAt,
} from '../state/store.js';

let deps = null;
let renderToken = 0;

const CHUNK_THRESHOLD = 60;
const CHUNK_SIZE = 30;

export function initGiList(_deps) {
  deps = _deps;
  initDelegation();
}

export function renderGiList(filter = '', editSongId = null) {
  const container = q('#gi-songs-container');
  if (!container) return;
  container.innerHTML = '';

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
  const textTerm = (keyPrefix === null && tagPrefix === null) ? lower : '';

  const currentGenre = getCurrentGenre();
  const filtered = songs.filter(s => {
    if (keyPrefix !== null) {
      // Empty key prefix \u2192 show all songs that HAVE a key set.
      if (!s.key) return false;
      if (!s.key.toLowerCase().startsWith(keyPrefix)) return false;
    } else if (tagPrefix !== null) {
      const tags = Array.isArray(s.tags) ? s.tags : [];
      if (!tags.some(t => String(t).toLowerCase().includes(tagPrefix))) return false;
    } else {
      // Global free-text: title, artist, tags AND lyrics (HTML stripped).
      const tagsText = Array.isArray(s.tags) ? s.tags.join(' ').toLowerCase() : '';
      const lyricsText = s.lyrics ? String(s.lyrics).replace(/<[^>]*>/g, ' ').toLowerCase() : '';
      const matchText = s.title.toLowerCase().includes(textTerm) ||
                        (s.artist && s.artist.toLowerCase().includes(textTerm)) ||
                        tagsText.includes(textTerm) ||
                        lyricsText.includes(textTerm);
      if (!matchText) return false;
    }
    if (currentGenre === 'all') return true;
    if (currentGenre === 'favoritos') return !!s.favorite;
    if (currentGenre === 'recientes') return isRecentSong(s);
    const genre = s.genre ? s.genre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
    return genre.includes(currentGenre);
  });

  // Sort the library view. "Recientes" goes newest-first; every other view
  // is alphabetical by title (accent-insensitive, Spanish locale) so songs
  // are easy to scan and find.
  if (currentGenre === 'recientes') {
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
    container.innerHTML = '<div class="setlist-empty">No se encontraron resultados.</div>';
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
      case 'play-seq':  deps.loadAndPlayTrack(song, 'sequence'); return;
      case 'play-orig': deps.loadAndPlayTrack(song, 'original'); return;
      case 'add':       handleAddToService(song, card, actionEl); return;
      case 'toggle-favorite':
        song.favorite = !song.favorite;
        deps.persist();
        deps.updateFilterCounts();
        // If user is currently filtering by favorites and just un-favorited,
        // the card no longer matches the filter → drop it from the DOM.
        if (getCurrentGenre() === 'favoritos' && !song.favorite) {
          card.remove();
          renumberGiCards();
          ensureEmptyState();
        } else {
          repaintGiCard(card, song);
        }
        return;
      case 'toggle-lyrics': deps.toggleLyricsAccordion(song, false); return;
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
        deps.persist();
        deps.updateFilterCounts();
        const sortChanged = oldTitle !== song.title;
        const filterChanged = getCurrentGenre() !== 'all' && oldGenre !== song.genre;
        if (sortChanged || filterChanged) {
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
  popup.textContent = '¡Añadida al servicio!';
  card.classList.add('has-popup');
  card.appendChild(popup);
  setTimeout(() => popup.classList.add('leaving'), 800);
  setTimeout(() => {
    popup.remove();
    card.classList.remove('has-popup');
    btn.style.color = '';
  }, 1200);
}
