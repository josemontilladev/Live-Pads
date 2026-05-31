// Shared inner-HTML builder for a song card. Both the Library
// (renderGiSetlist) and the Service (renderServiceList) renderers use this so
// the visual structure stays identical and edits land in one place.
//
// The builder is pure HTML — the calling render function still wires the
// click handlers afterwards using el.querySelector(...).onclick = ....

import { esc } from '../utils/dom.js';
import { formatLyrics } from './lyricsFormat.js';

/**
 * @param {object} song
 * @param {object} opts
 *   - rowNumber:    1-based row number to display when inactive
 *   - isLyricsOpen: whether to render the lyrics accordion expanded
 *   - showChords:   whether to render chord brackets inline (false = "Solo letra")
 *   - includeAdd:   include the "+" add-to-service action (Library only)
 *   - removeBtnClass: 'btn-remove' (Service) or 'btn-remove-lib' (Library)
 *   - removeBtnTitle: tooltip text for the remove button
 */
// Pre-defined SVG icons — module-constant so the strings aren't re-allocated
// on every card render.
const ICON_LYRICS = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
const ICON_SEQ    = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>';
const ICON_ORIG   = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
const ICON_ADD    = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_EDIT   = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const ICON_CLOSE  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const ICON_TRASH  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_PLAY   = '<svg class="gi-row-num-play" viewBox="0 0 24 24" fill="var(--blue)" width="12" height="12" style="filter:drop-shadow(0 0 3px var(--blue));margin-right:1px;"><polygon points="5,3 19,12 5,21"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_STAR_OUTLINE = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const ICON_STAR_FILLED  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

const ADD_BTN_HTML = `<button class="action-btn btn-add" data-action="add" title="Añadir al servicio">${ICON_ADD}</button>`;

// Wrap occurrences of `needle` inside the (already HTML-escaped) `haystack`
// with <mark class="search-hit">. needle is case-insensitive and matches
// as a literal substring (no regex meta-chars). Returns the original
// string when needle is empty or absent.
function highlightMatch(haystackEscaped, needle) {
  if (!needle) return haystackEscaped;
  const trimmed = needle.trim();
  if (!trimmed) return haystackEscaped;
  // Build a case-insensitive regex from the literal needle. Escape regex
  // meta-chars so users typing "?" or "." don't break the search.
  const safe = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return haystackEscaped.replace(new RegExp(safe, 'gi'), m => `<mark class="search-hit">${m}</mark>`);
}

export function songCardInnerHTML(song, opts) {
  const {
    rowNumber,
    isLyricsOpen,
    showChords,
    includeAdd,
    removeBtnClass = 'btn-remove',
    removeBtnTitle = 'Quitar de la lista',
    searchTerm = ''
  } = opts;

  // Highlight applies only to plain text search (not the `tono:G` mode,
  // which the giList passes through as an empty searchTerm).
  const titleHtml  = highlightMatch(esc(song.title), searchTerm);
  const artistHtml = song.artist
    ? highlightMatch(esc(song.artist), searchTerm)
    : 'Sin artista';

  // Static layout has moved to CSS (.gi-song-item-row, .gi-song-actions, etc.)
  // Only the dynamic class toggles stay in the template — every other inline
  // style is gone, which speeds up rendering an 81-card library noticeably.
  const lyricsCls = song.lyrics
    ? (isLyricsOpen ? 'has-lyrics lyrics-open' : 'has-lyrics')
    : 'no-lyrics';
  const seqCls  = (song.audio && song.audio.sequence) ? 'has-audio' : '';
  const origCls = (song.audio && song.audio.original) ? 'has-audio' : '';
  const disabledAttr = song.lyrics ? '' : 'disabled';

  return `
    <div class="gi-song-row">
      <div class="gi-song-row-left">
        <div class="gi-row-num">
          <span class="gi-row-num-text">${rowNumber}</span>
          ${ICON_PLAY}
        </div>
        <div class="gi-song-main">
          <div class="gi-song-title">${titleHtml}</div>
          <div class="gi-song-artist">${artistHtml}</div>
        </div>
      </div>
      <div class="gi-song-meta">
        ${song.bpm   ? `<span class="gi-badge bpm">${esc(song.bpm)}</span>` : ''}
        ${song.key   ? `<span class="gi-badge key">${esc(song.key)}</span>` : ''}
        ${song.genre ? `<span class="gi-badge hidden-genre">${esc(song.genre)}</span>` : ''}
        ${Array.isArray(song.tags) ? song.tags.map(t => `<span class="gi-badge tag">${esc(t)}</span>`).join('') : ''}
      </div>
    </div>
    <div class="gi-song-actions">
      <button class="action-btn btn-favorite ${song.favorite ? 'is-fav' : ''}" data-action="toggle-favorite" title="${song.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}" aria-pressed="${song.favorite ? 'true' : 'false'}">${song.favorite ? ICON_STAR_FILLED : ICON_STAR_OUTLINE}</button>
      <button class="action-btn btn-lyrics ${lyricsCls}" data-action="toggle-lyrics" title="Ver letra y acordes" ${disabledAttr}>${ICON_LYRICS}</button>
      <button class="action-btn btn-seq ${seqCls}" data-action="play-seq" title="Secuencia Split-Track">${ICON_SEQ}</button>
      <button class="action-btn btn-orig ${origCls}" data-action="play-orig" title="Canción Original">${ICON_ORIG}</button>
      ${includeAdd ? ADD_BTN_HTML : ''}
      <button class="action-btn btn-edit" data-action="edit" title="Editar canción">${ICON_EDIT}</button>
      <button class="action-btn ${removeBtnClass}" data-action="remove" title="${removeBtnTitle}">${removeBtnClass === 'btn-remove-lib' ? ICON_TRASH : ICON_CLOSE}</button>
    </div>

    <div class="gi-lyrics-accordion ${isLyricsOpen ? 'open' : ''}">
      <div class="lyrics-accordion-header">
        <button class="lyrics-edit-btn" data-action="edit-lyrics" title="Editar letra y acordes">${ICON_PENCIL}</button>
        <button class="chord-toggle-btn lyrics-chord-pill ${showChords ? 'active' : ''}" data-action="toggle-chords" title="${showChords ? 'Ocultar acordes' : 'Mostrar acordes'}">
          ${showChords ? 'Con acordes' : 'Solo letra'}
        </button>
      </div>
      <div class="lyrics-text-content ${showChords ? '' : 'hide-chords'}">
        ${formatLyrics(song.lyrics)}
      </div>
    </div>
  `;
}
