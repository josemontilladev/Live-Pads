// Shared inner-HTML builder for a song card. Both the Library
// (renderGiSetlist) and the Service (renderServiceList) renderers use this so
// the visual structure stays identical and edits land in one place.
//
// The builder is pure HTML — the calling render function still wires the
// click handlers afterwards using el.querySelector(...).onclick = ....

import { esc } from '../utils/dom.js';
import { formatLyrics } from './lyricsFormat.js';
import { transposeAll } from './chordTransposer.js';
import { keyDelta, prefersFlats } from '../utils/musicKeys.js';

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
const ICON_MORE   = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const ICON_PLAY   = '<svg class="gi-row-num-play" viewBox="0 0 24 24" fill="var(--blue)" width="12" height="12" style="filter:drop-shadow(0 0 3px var(--blue));margin-right:1px;"><polygon points="5,3 19,12 5,21"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_CHORDS = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_STAR_OUTLINE = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const ICON_STAR_FILLED  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

export const ICON_ADD_CHECK = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
// Icono "+" del botón añadir (exportado para que la biblioteca pueda volver a
// ponerlo al quitar una canción del servicio, sin re-renderizar la card).
export const ICON_ADD_PLUS = ICON_ADD;
// Chip "En servicio" — markup único reutilizado por el render inicial de la card
// y por la actualización en vivo (refreshInServiceState) cuando cambia el set.
export const INSERVICE_BADGE_HTML = '<span class="gi-inservice-badge" title="Esta canción está en el servicio de hoy"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>En servicio</span>';
const ADD_BTN_HTML = `<button class="action-btn btn-add" data-action="add" title="Añadir al servicio">${ICON_ADD}</button>`;
// Botón "+" que pasa a ✓ cuando la canción YA está en la lista activa (evita
// agregarla dos veces; clic igual avisa).
function addBtnHtml(inService) {
  return inService
    ? `<button class="action-btn btn-add is-added" data-action="add" title="Ya está en la lista">${ICON_ADD_CHECK}</button>`
    : ADD_BTN_HTML;
}
// Botones ↑↓ para reordenar el servicio de a un puesto (además del drag).
const MOVE_BTNS_HTML =
  `<button class="action-btn btn-move-up" data-action="move-up" title="Subir en la lista" aria-label="Subir"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="13" height="13"><polyline points="18 15 12 9 6 15"/></svg></button>` +
  `<button class="action-btn btn-move-down" data-action="move-down" title="Bajar en la lista" aria-label="Bajar"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg></button>`;

// Tono de acento estable por canción (barrita lateral de la carátula). Hash
// determinista del id/título — mismo color en cada render y entre máquinas.
function songAccentHue(song) {
  const s = String(song.id || song.title || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Carátula del card. Usa song.cover (livepads:// de la miniatura de YouTube, o
// una URL manual) si existe; si no, un placeholder con la inicial del título
// sobre un tinte del color de acento. Mantener el markup en sync con el panel
// de Stems (renderSetlistPanel en stems/workspace.js).
export function songCoverHtml(song) {
  const hue = songAccentHue(song);
  const initial = esc((String(song.title || '?').trim().charAt(0) || '?').toUpperCase());
  if (song.cover) {
    return `<div class="gi-song-cover" style="--song-accent:hsl(${hue} 60% 55%)">
      <img src="${esc(song.cover)}" alt="" loading="lazy">
    </div>`;
  }
  return `<div class="gi-song-cover no-cover" style="--song-accent:hsl(${hue} 60% 55%);--song-tint:hsl(${hue} 40% 24%)">
    <span class="gi-cover-fallback">${initial}</span>
  </div>`;
}

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
    includeReorder,
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
  // Sin letra el botón NO se deshabilita: hay que poder agregarla. Clic con
  // letra → abre el acordeón; sin letra → abre el editor directo (ver giList).
  const lyricsTitle = song.lyrics ? 'Ver letra y acordes' : 'Agregar letra';

  // Línea de metadatos estilo PlayWorship: tono · BPM · género. El número de
  // fila se eliminó del modelo (la carátula + la barra de acento del activo
  // dan el anclaje visual). `rowNumber` se conserva en la firma por compat.
  // El compás (clave del metrónomo) se muestra SIEMPRE en la card, incluso 4/4.
  const sigMeta = esc(song.timeSig || '4/4');
  // Tono. En el Servicio es interactivo: se puede cambiar SOLO para ese día sin
  // tocar el tono oficial de la librería (opts.keyEditable). Cuando hay
  // override, el chip muestra el salto — "Mi → G" — para que nadie toque en el
  // tono equivocado por leer la card de pasada.
  const baseKey = song.key || '';
  const liveKey = opts.serviceKey || baseKey;
  const overridden = !!(opts.serviceKey && baseKey && opts.serviceKey !== baseKey);
  let keyMeta = '';
  if (opts.keyEditable) {
    const label = overridden ? `${esc(baseKey)} → ${esc(liveKey)}` : (esc(liveKey) || 'Tono');
    const title = overridden
      ? `Hoy en ${liveKey} (en la librería está en ${baseKey}). Clic para cambiar.`
      : 'Tono de la canción. Clic para tocarla en otro tono solo en este servicio.';
    keyMeta = `<button type="button" class="gi-key-chip${overridden ? ' is-overridden' : ''}" data-action="key" title="${esc(title)}">${label}</button>`;
  } else if (baseKey) {
    keyMeta = esc(baseKey);
  }
  const metaLine = [
    keyMeta,
    song.bpm   ? `${esc(song.bpm)} BPM`   : '',
    sigMeta,
    song.genre ? esc(song.genre)          : ''
  ].filter(Boolean).join(' · ');

  // Los acordes de la letra siguen al tono del servicio: si hoy se toca en G, el
  // acordeón muestra los acordes en G. La letra guardada no se toca.
  const semis = overridden ? keyDelta(baseKey, liveKey) : 0;
  const lyricsText = (semis) ? transposeAll(song.lyrics || '', semis, prefersFlats(liveKey)) : song.lyrics;

  // El texto (carátula + título/artista/meta) ocupa TODO el ancho arriba para
  // que nada se corte en la barra angosta de Pads. Los iconos van en una tira
  // compacta debajo: solo los 3 de uso en vivo (letra/secuencia/original) + ⋮.
  // "Añadir al servicio" y "Quitar de la lista" se movieron al menú ⋮.
  return `
    <div class="gi-song-row">
      ${songCoverHtml(song)}
      <div class="gi-song-main">
        <div class="gi-song-title">${titleHtml}</div>
        <div class="gi-song-artist">${artistHtml}</div>
        ${metaLine ? `<div class="gi-song-meta-line">${metaLine}</div>` : ''}
        ${(includeAdd && opts.inService) ? INSERVICE_BADGE_HTML : ''}
      </div>
    </div>
    <div class="gi-song-actions">
      ${includeReorder ? MOVE_BTNS_HTML : ''}
      <button class="action-btn btn-lyrics ${lyricsCls}" data-action="toggle-lyrics" title="${lyricsTitle}">${ICON_LYRICS}</button>
      <button class="action-btn btn-seq ${seqCls}" data-action="play-seq" title="Secuencia Split-Track">${ICON_SEQ}</button>
      <button class="action-btn btn-orig ${origCls}" data-action="play-orig" title="Canción Original">${ICON_ORIG}</button>
      ${includeAdd ? addBtnHtml(opts.inService) : ''}
    </div>

    <div class="gi-lyrics-accordion ${isLyricsOpen ? 'open' : ''}">
      <div class="lyrics-accordion-header">
        <button class="lyrics-edit-btn" data-action="edit-lyrics" title="Editar letra y acordes">${ICON_PENCIL}</button>
        <button class="chord-toggle-btn ${showChords ? 'active' : ''}" data-action="toggle-chords" title="${showChords ? 'Ocultar acordes' : 'Mostrar acordes'}" aria-label="Mostrar u ocultar acordes">${ICON_CHORDS}</button>
        <button class="lyrics-fs-btn" data-action="lyrics-fullscreen" title="Pantalla completa (uso en vivo)" aria-label="Pantalla completa">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="4 14 4 20 10 20"/><polyline points="20 10 20 4 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
      </div>
      <div class="lyrics-text-content ${showChords ? '' : 'hide-chords'}">
        ${formatLyrics(lyricsText)}
      </div>
    </div>
  `;
}
