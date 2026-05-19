// Song-card state primitives shared by the GI library + Service list:
//
//   - Active-song highlight (only one card highlighted across both lists)
//   - Lyrics-accordion exclusivity (only one accordion open at a time,
//     across both lists)
//   - Chord-visibility flip (with optional library mirror)
//
// State (the active-song id, the open-accordion ids) lives in app.js;
// this module reads/writes via the deps injected to initSongState().
// Card lookups go through the helpers exported by giList.js so we don't
// re-implement the CSS-escape querySelector dance.

import { q, qa } from '../utils/dom.js';
import { getGiCardBySongId } from './giList.js';
import { getActiveServiceIndex, getServiceSongs } from '../data/service.js';
import {
  getSongs as getGiSongsFromStore,
  getActiveSongId,
  getOpenAccordionSongId, setOpenAccordionSongId,
  getOpenAccordionServiceId, setOpenAccordionServiceId,
} from '../state/store.js';

// Targeted highlight update: toggles `.active-song` on at most two cards
// (one in each list) — orders of magnitude cheaper than a full re-render
// of an 80-card library when the user just switches songs in live.
export function refreshActiveSongHighlights() {
  const giContainer = q('#gi-songs-container');
  if (giContainer) {
    giContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    const activeId = getActiveSongId();
    if (activeId != null) {
      const match = getGiCardBySongId(activeId);
      if (match) match.classList.add('active-song');
    }
  }

  const svcContainer = q('#service-songs-container');
  if (svcContainer) {
    svcContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    const idx = getActiveServiceIndex();
    if (idx >= 0) {
      const songs = getServiceSongs();
      const target = songs[idx];
      if (target && target.serviceId != null) {
        const sel = `.gi-song-item[data-service-id="${CSS.escape(String(target.serviceId))}"]`;
        const match = svcContainer.querySelector(sel);
        if (match) match.classList.add('active-song');
      }
    }
  }
}

// Toggle a song's lyrics accordion open/closed WITHOUT a full re-render.
// Closes any other accordion (across either list) first — global rule:
// only one accordion open at a time.
export function toggleLyricsAccordion(song, isService) {
  const id = isService ? song.serviceId : song.id;
  const wasOpen = isService
    ? (getOpenAccordionServiceId() === id)
    : (getOpenAccordionSongId() === id);

  qa('.gi-lyrics-accordion.open').forEach(a => a.classList.remove('open'));
  qa('.action-btn.btn-lyrics.active').forEach(b => b.classList.remove('active'));

  if (wasOpen) {
    setOpenAccordionSongId(null);
    setOpenAccordionServiceId(null);
    return;
  }

  if (isService) {
    setOpenAccordionServiceId(id);
    setOpenAccordionSongId(null);
  } else {
    setOpenAccordionSongId(id);
    setOpenAccordionServiceId(null);
  }

  const containerSel = isService ? '#service-songs-container' : '#gi-songs-container';
  const attr = isService ? 'data-service-id' : 'data-song-id';
  const card = q(`${containerSel} .gi-song-item[${attr}="${CSS.escape(String(id))}"]`);
  if (card) {
    const accordion = card.querySelector('.gi-lyrics-accordion');
    const btn = card.querySelector('.btn-lyrics');
    if (accordion) accordion.classList.add('open');
    if (btn) btn.classList.add('active');
  }
}

// Apply the chord-visibility state to a single song card (whichever
// container it lives in). Only touches 2 DOM elements per card.
export function paintChordVisibility(card, showChords) {
  if (!card) return;
  const textContent = card.querySelector('.lyrics-text-content');
  const toggleBtn = card.querySelector('.chord-toggle-btn');
  if (textContent) textContent.classList.toggle('hide-chords', !showChords);
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', showChords);
    toggleBtn.textContent = showChords ? 'Con acordes' : 'Solo letra';
    toggleBtn.title = showChords ? 'Ocultar acordes' : 'Mostrar acordes';
  }
}

// Flip a song's `showChords` flag and update the visible cards in place —
// no full re-render. When `syncToLibrary` is true, mirrors the change onto
// the matching library song so both lists stay aligned.
export function toggleChordVisibility(song, isService, syncToLibrary = false) {
  song.showChords = !song.showChords;

  const ownContainerSel = isService ? '#service-songs-container' : '#gi-songs-container';
  const ownAttr = isService ? 'data-service-id' : 'data-song-id';
  const ownId = isService ? song.serviceId : song.id;
  paintChordVisibility(
    q(`${ownContainerSel} .gi-song-item[${ownAttr}="${CSS.escape(String(ownId))}"]`),
    song.showChords
  );

  if (syncToLibrary && isService) {
    const giSong = getGiSongsFromStore().find(s => s.title === song.title && s.artist === song.artist);
    if (giSong) {
      giSong.showChords = song.showChords;
      paintChordVisibility(getGiCardBySongId(giSong.id), giSong.showChords);
    }
  }
}
