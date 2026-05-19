// GI library view — renders #gi-songs-container, handles all click/edit
// delegation, and exposes surgical helpers for handlers in app.js. State
// (the songs array, current genre, active song id) lives in app.js; this
// module reads it via the deps getters passed to initGiList().

import { q } from '../utils/dom.js';
import { songCardInnerHTML } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';

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

  const songs = deps.getSongs();
  if (!songs.length) {
    container.innerHTML = '<div class="setlist-empty">No hay canciones importadas. Usa el botón de importar arriba.</div>';
    return;
  }

  const term = filter.toLowerCase();
  const currentGenre = deps.getCurrentGenre();
  const filtered = songs.filter(s => {
    const matchText = s.title.toLowerCase().includes(term) ||
                      (s.artist && s.artist.toLowerCase().includes(term));
    if (!matchText) return false;
    if (currentGenre === 'all') return true;
    const genre = s.genre ? s.genre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
    return genre.includes(currentGenre);
  });

  filtered.sort((a, b) => {
    if (a.id === editSongId) return -1;
    if (b.id === editSongId) return 1;
    return a.title.localeCompare(b.title);
  });

  if (!filtered.length) {
    container.innerHTML = '<div class="setlist-empty">No se encontraron resultados.</div>';
    return;
  }

  // Small libraries render synchronously (single paint, optimal). Large
  // libraries render in chunks via requestIdleCallback so the main thread
  // stays responsive — first chunk paints immediately, the rest stream in
  // during idle frames. Surgical-update call sites all check `if (match)`
  // before touching the DOM, so unmounted cards are harmless no-ops.
  if (filtered.length <= CHUNK_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    filtered.forEach((song, idx) => fragment.appendChild(buildCard(song, idx, editSongId)));
    container.appendChild(fragment);
    return;
  }

  const firstChunk = document.createDocumentFragment();
  const firstCount = Math.min(CHUNK_SIZE, filtered.length);
  for (let i = 0; i < firstCount; i++) firstChunk.appendChild(buildCard(filtered[i], i, editSongId));
  container.appendChild(firstChunk);

  const token = ++renderToken;
  let cursor = firstCount;
  const schedule = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 8 }), 16));

  const streamNext = () => {
    if (token !== renderToken) return; // aborted by a newer render
    if (cursor >= filtered.length) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(cursor + CHUNK_SIZE, filtered.length);
    for (let i = cursor; i < end; i++) frag.appendChild(buildCard(filtered[i], i, editSongId));
    container.appendChild(frag);
    cursor = end;
    if (cursor < filtered.length) schedule(streamNext);
  };
  schedule(streamNext);
}

function buildCard(song, idx, editSongId) {
  const el = document.createElement('div');
  el.className = 'gi-song-item';
  if (song.id != null) el.dataset.songId = String(song.id);
  const activeId = deps.getActiveSongId();
  const openAccId = deps.getOpenAccordionId();
  const isActive = song.id && activeId && (song.id === activeId);
  const isLyricsOpen = song.id && (song.id === openAccId);

  if (isActive) el.classList.add('active-song');

  el.innerHTML = songCardInnerHTML(song, {
    rowNumber: idx + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: true,
    removeBtnClass: 'btn-remove-lib',
    removeBtnTitle: 'Eliminar de la librería'
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
  const idx = Array.prototype.indexOf.call(card.parentNode.children, card);
  const activeId = deps.getActiveSongId();
  const openAccId = deps.getOpenAccordionId();
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
  return deps.getSongs().find(s => String(s.id) === songId);
}

// ── Delegation ────────────────────────────────────────────────────────
// One click listener per container instead of 8 per card. Dispatch is via
// [data-action] on the target button, walked up with closest(). The card
// itself is identified by data-song-id.

function initDelegation() {
  const container = q('#gi-songs-container');
  if (!container) return;

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
      case 'toggle-lyrics': deps.toggleLyricsAccordion(song, false); return;
      case 'toggle-chords': deps.toggleChordVisibility(song, false); return;
      case 'edit-lyrics':
        deps.openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          deps.persist();
          repaintGiCard(card, song);
        });
        return;
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
        deps.persist();
        deps.updateFilterCounts();
        const sortChanged = oldTitle !== song.title;
        const filterChanged = deps.getCurrentGenre() !== 'all' && oldGenre !== song.genre;
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
          deps.setSongs(deps.getSongs().filter(s => s.id !== song.id));
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
        if (confirm('¿Estás seguro de eliminar esta canción de la librería?')) {
          deps.setSongs(deps.getSongs().filter(s => s.id !== song.id));
          deps.persist();
          deps.updateFilterCounts();
          card.remove();
          renumberGiCards();
          ensureEmptyState();
        }
        return;
      case 'edit-form-shell':
        // Wrapper exists only to swallow row-body clicks while editing.
        return;
    }

    // No action button matched — clicked on row body (title/artist/badges)
    deps.onApplySong(song);
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
