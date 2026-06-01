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
import { refreshServiceMeta } from './serviceListView.js';
import { isTrackPlaying } from '../audio/trackPlayer.js';
import {
  getSongs as getGiSongsFromStore,
  getActiveSongId,
  getMetroRunning,
  getOpenAccordionSongId, setOpenAccordionSongId,
  getOpenAccordionServiceId, setOpenAccordionServiceId,
} from '../state/store.js';

// ¿Hay algo audible ahora? (secuencia/original sonando, o metrónomo corriendo).
// Distingue "preparada" (seleccionada, nada suena) de "sonando" en el banner.
function isLiveNow() {
  return isTrackPlaying() || getMetroRunning();
}

// Solo actualiza la etiqueta/punto del banner según el estado live, sin tocar
// título/artista. Lo llama el poll de reproducción para reflejar play/pause.
export function refreshNowPlayingLiveState() {
  const banner = q('#now-playing-banner');
  if (!banner || banner.classList.contains('hidden')) return;
  const live = isLiveNow();
  banner.classList.toggle('is-live', live);
  const label = banner.querySelector('.np-label');
  if (label) label.textContent = live ? 'Sonando' : 'Preparada';
}

// ¿La card ya está completamente visible dentro de su contenedor scrolleable?
// Si lo está, no hace falta tironear el scroll (evita saltos al cambiar rápido
// de canción o en auto-avance, sobre todo en cabina táctil).
function isCardInView(card, container) {
  const cr = card.getBoundingClientRect();
  const co = container.getBoundingClientRect();
  return cr.top >= co.top && cr.bottom <= co.bottom;
}

// Targeted highlight update: toggles `.active-song` on at most two cards
// (one in each list) AND refreshes the "now playing" banner above the
// setlist — orders of magnitude cheaper than a full re-render of an
// 80-card library when the user just switches songs in live.
export function refreshActiveSongHighlights() {
  let nowPlayingSong = null;

  const giContainer = q('#gi-songs-container');
  if (giContainer) {
    giContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    const activeId = getActiveSongId();
    if (activeId != null) {
      const match = getGiCardBySongId(activeId);
      if (match) {
        match.classList.add('active-song');
        // Traer la canción activa a la vista — pero solo si NO está ya visible
        // (no tironear el scroll si la card ya se ve) y solo con la Librería
        // visible (no robar scroll mientras el usuario navega en otra pestaña).
        if (giContainer.offsetParent !== null && !isCardInView(match, giContainer)) {
          match.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      // Source the banner data from the library copy so we always show
      // the canonical title (service entries are clones, may have stale).
      nowPlayingSong = getGiSongsFromStore().find(s => s.id === activeId) || null;
    }
  }

  const svcContainer = q('#service-songs-container');
  if (svcContainer) {
    svcContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    const idx = getActiveServiceIndex();
    // Played-song fade: cards BEFORE the active one are dimmed so the user
    // sees set progress at a glance. .played is removed from cards after
    // the active index so going back to an earlier song "un-plays" it.
    svcContainer.querySelectorAll('.gi-song-item').forEach((card, i) => {
      card.classList.toggle('played', idx >= 0 && i < idx);
    });
    if (idx >= 0) {
      const songs = getServiceSongs();
      const target = songs[idx];
      if (target && target.serviceId != null) {
        const sel = `.gi-song-item[data-service-id="${CSS.escape(String(target.serviceId))}"]`;
        const match = svcContainer.querySelector(sel);
        if (match) {
          match.classList.add('active-song');
          // Igual que en la Librería: traer la card a la vista solo si no está
          // ya visible, y solo con el panel Servicio visible.
          if (svcContainer.offsetParent !== null && !isCardInView(match, svcContainer)) {
            match.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        // Service-side fallback when the song isn't in the library (rare —
        // e.g. service entries that were never imported into the GI list).
        if (!nowPlayingSong) nowPlayingSong = target;
      }
    }
  }

  paintNowPlayingBanner(nowPlayingSong);
  // Position indicator ("3 / 8") lives in the service meta — refresh on
  // every active change since surgical updates skip the full render.
  refreshServiceMeta();
}

// Show / hide / populate the "now playing" strip above the setlist tabs.
// Hidden entirely when no song is active.
function paintNowPlayingBanner(song) {
  const banner = q('#now-playing-banner');
  if (!banner) return;
  if (!song) {
    banner.classList.add('hidden');
    return;
  }
  const titleEl  = q('#np-title');
  const artistEl = q('#np-artist');
  if (titleEl)  titleEl.textContent  = song.title || 'Sin título';
  if (artistEl) artistEl.textContent = song.artist || '';
  banner.classList.remove('hidden');
  // "Preparada" (seleccionada, nada suena) vs "Sonando" — coherente con el
  // principio "seleccionar = preparar, nada suena hasta pulsar Play".
  refreshNowPlayingLiveState();
}

// Collapse any open lyrics accordion (across both lists). Called when the
// user switches to a different song so the previous song's lyrics fold away
// instead of cluttering the list.
export function closeAllLyrics() {
  qa('.gi-lyrics-accordion.open').forEach(a => a.classList.remove('open'));
  qa('.action-btn.btn-lyrics.active').forEach(b => b.classList.remove('active'));
  setOpenAccordionSongId(null);
  setOpenAccordionServiceId(null);
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
