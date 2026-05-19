// Service-list view — renders #service-songs-container, handles all
// click/edit/drag delegation, and exposes surgical helpers. State (the
// current service songs array, active index, open-accordion id) lives
// in app.js (and partially in data/service.js); we read it via the deps
// getters passed to initServiceList().

import { q } from '../utils/dom.js';
import { songCardInnerHTML } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';
import { getOpenAccordionServiceId } from '../state/store.js';
import { bindTouchReorder } from '../utils/touchReorder.js';

let deps = null;

export function initServiceList(_deps) {
  deps = _deps;
  initDelegation();
}

export function renderServiceList() {
  const container = q('#service-songs-container');
  const emptyMsg = q('#service-empty-msg');
  if (!container) return;

  container.innerHTML = '';

  const songs = deps.getSongs();
  const activeIdx = deps.getActiveIndex();
  updateServiceMeta(songs);

  if (songs.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    return;
  }

  if (emptyMsg) emptyMsg.classList.add('hidden');

  const fragment = document.createDocumentFragment();
  songs.forEach((song, index) => fragment.appendChild(buildCard(song, index, activeIdx)));
  container.appendChild(fragment);
}

// Update the "X canciones · ~Y min" subtitle next to "Tu lista de hoy".
// When a song is currently active in the service, also prepend the
// position cue ("3 / 8 ·") so the leader sees at a glance how far into
// the set they are. 4 min/song is a worship-service heuristic; swap for
// a real sum once duration becomes a per-song stored field.
export function refreshServiceMeta() {
  if (deps) updateServiceMeta(deps.getSongs());
}

function updateServiceMeta(songs) {
  const el = q('#service-meta');
  if (!el) return;
  const n = songs.length;
  if (n === 0) { el.textContent = ''; return; }

  // Sum durationSec when known (cached on first play by trackPlayer);
  // fall back to 240s (4 min) per unknown song. The ~ prefix signals
  // "still estimating" when at least one song hasn't been timed yet.
  let totalSec = 0;
  let unknownCount = 0;
  for (const s of songs) {
    if (typeof s.durationSec === 'number' && s.durationSec > 0) {
      totalSec += s.durationSec;
    } else {
      totalSec += 240;
      unknownCount++;
    }
  }
  const minutes = Math.max(1, Math.round(totalSec / 60));
  const prefix = unknownCount > 0 ? '~' : '';

  const songLabel = n === 1 ? 'canción' : 'canciones';
  const activeIdx = deps.getActiveIndex();
  const positionPart = (activeIdx >= 0 && activeIdx < n)
    ? `${activeIdx + 1} / ${n} · `
    : '';
  el.textContent = `${positionPart}${n} ${songLabel} · ${prefix}${minutes} min`;
}

function buildCard(song, index, activeIdx) {
  const el = document.createElement('div');
  el.className = 'gi-song-item';
  if (song.serviceId != null) el.dataset.serviceId = String(song.serviceId);
  el.dataset.index = String(index);
  el.draggable = true;

  const isActive = index === activeIdx;
  const isLyricsOpen = song.serviceId && (song.serviceId === getOpenAccordionServiceId());
  if (isActive) el.classList.add('active-song');

  el.innerHTML = songCardInnerHTML(song, {
    rowNumber: index + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: false,
    removeBtnClass: 'btn-remove',
    removeBtnTitle: 'Quitar de la lista'
  });
  return el;
}

// Repaint one service card in place using the song's current state.
export function repaintServiceCard(card, song) {
  if (!card) return;
  const idx = Array.prototype.indexOf.call(card.parentNode.children, card);
  const isActive = idx === deps.getActiveIndex();
  const isLyricsOpen = song.serviceId && (song.serviceId === getOpenAccordionServiceId());
  card.classList.toggle('active-song', !!isActive);
  card.innerHTML = songCardInnerHTML(song, {
    rowNumber: idx + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: false,
    removeBtnClass: 'btn-remove',
    removeBtnTitle: 'Quitar de la lista'
  });
}

function findSong(serviceId) {
  return deps.getSongs().find(s => String(s.serviceId) === serviceId);
}

// ── Delegation ────────────────────────────────────────────────────────

function initDelegation() {
  const container = q('#service-songs-container');
  if (!container) return;

  // Touch reorder — mirrors the native drag handlers below for finger users.
  bindTouchReorder('#service-songs-container', '.gi-song-item', 'index', (fromIdx, toIdx) => {
    deps.reorderService(fromIdx, toIdx);
    renderServiceList();
  });

  container.addEventListener('click', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    const song = findSong(card.dataset.serviceId);
    if (!song) return;

    const actionEl = e.target.closest('[data-action]');
    const action = actionEl && card.contains(actionEl) ? actionEl.dataset.action : null;

    switch (action) {
      case 'play-seq':  deps.loadAndPlayTrack(song, 'sequence'); return;
      case 'play-orig': deps.loadAndPlayTrack(song, 'original'); return;
      case 'remove':    deps.removeFromService(song.serviceId); return;
      case 'toggle-favorite':
        song.favorite = !song.favorite;
        // Mirror onto the matching library song so the star sticks.
        deps.syncFavoriteToLibrary(song);
        deps.persistServiceSongs();
        repaintServiceCard(card, song);
        return;
      case 'toggle-lyrics': deps.toggleLyricsAccordion(song, true); return;
      case 'toggle-chords': deps.toggleChordVisibility(song, true, true); return;
      case 'edit-lyrics':
        deps.openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          // Mirror the change onto the matching library song (matched by
          // title+artist) and surgically repaint its card if mounted.
          deps.syncLyricsToLibrary(song);
          deps.persistServiceSongs();
          repaintServiceCard(card, song);
        });
        return;
      case 'edit':
        card.innerHTML = songEditFormHTML(song);
        return;
      case 'edit-save': {
        // The library is matched by title+artist; if either was renamed in
        // this edit, look up by the *previous* identity.
        const oldKey = song.title + '\x00' + song.artist;
        song.title = card.querySelector('.edit-title').value;
        song.artist = card.querySelector('.edit-artist').value;
        song.bpm = card.querySelector('.edit-bpm').value;
        song.key = card.querySelector('.edit-key').value;
        song.genre = card.querySelector('.edit-genre').value;
        deps.syncMetaToLibrary(oldKey, song);
        deps.persistServiceSongs();
        repaintServiceCard(card, song);
        return;
      }
      case 'edit-cancel':
        repaintServiceCard(card, song);
        return;
      case 'edit-form-shell':
        return;
    }

    deps.onApplySong(song);
  });

  // Drag-and-drop is delegated too. dataTransfer.setData carries the
  // origin index in `text/plain`; the drop target reads its own index.
  container.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.index || '');
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
    const toIndex = parseInt(card.dataset.index, 10);
    if (fromIndex !== toIndex && Number.isFinite(fromIndex) && Number.isFinite(toIndex)) {
      deps.reorderService(fromIndex, toIndex);
      renderServiceList();
    }
  });
}
