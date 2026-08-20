import { esc } from '../utils/dom.js';
import { getCachedLibraries, getActiveLibraryId } from '../cloud/libraries.js';
import { isCloudEnabled, isLoggedIn } from '../cloud/supabase.js';

// Fila "Guardar en [biblioteca]" para el form. Solo con nube + sesión + al menos
// una librería conocida. Para canción nueva sin libraryId, preselecciona la
// activa; al editar, preselecciona la suya (así no se mueve sola).
function libraryRowHTML(song, placeholderForNewSong) {
  if (!isCloudEnabled() || !isLoggedIn()) return '';
  const libs = getCachedLibraries();
  if (!libs || !libs.length) return '';
  const current = song.libraryId
    ? song.libraryId
    : (placeholderForNewSong ? (getActiveLibraryId() || 'all') : 'all');
  const opts = [`<option value="all" ${current === 'all' ? 'selected' : ''}>Todas (sin librería)</option>`]
    .concat(libs.map(l =>
      `<option value="${esc(l.id)}" ${l.id === current ? 'selected' : ''}>${esc(l.name)}</option>`
    )).join('');
  return `
      <div class="gi-edit-lib-row">
        <span class="gi-edit-lib-label">Guardar en</span>
        <select class="gi-edit-input edit-library">${opts}</select>
      </div>`;
}

// Lee el selector de biblioteca de un form ya renderizado y lo aplica a la
// canción. Si no hay selector (sin nube/sesión), no toca libraryId (preserva el
// existente). "Todas" = quitar de toda librería.
export function applyLibrarySelection(formEl, song) {
  const sel = formEl && formEl.querySelector('.edit-library');
  if (!sel) return false;
  const prev = song.libraryId || null;
  if (!sel.value || sel.value === 'all') delete song.libraryId;
  else song.libraryId = sel.value;
  return (song.libraryId || null) !== prev; // ¿cambió?
}

// Compases disponibles (clave del metrónomo). El metrónomo cuenta `beats` =
// numerador (4/4→4, 6/8→6, 12/8→12), igual que el dropdown #metro-sig-select.
export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '6/8', '12/8'];
export const TIME_SIG_BEATS = { '2/4': 2, '3/4': 3, '4/4': 4, '6/8': 6, '12/8': 12 };

const KEYS_WITH_LABELS = [
  ['C', 'C (Do)'], ['C#', 'C# (Do#)'], ['Db', 'Db (Reb)'],
  ['D', 'D (Re)'], ['D#', 'D# (Re#)'], ['Eb', 'Eb (Mib)'],
  ['E', 'E (Mi)'], ['F', 'F (Fa)'], ['F#', 'F# (Fa#)'],
  ['Gb', 'Gb (Solb)'], ['G', 'G (Sol)'], ['G#', 'G# (Sol#)'],
  ['Ab', 'Ab (Lab)'], ['A', 'A (La)'], ['A#', 'A# (La#)'],
  ['Bb', 'Bb (Sib)'], ['B', 'B (Si)']
];

// Returns the inline edit form HTML for a song card. `placeholderForNewSong`
// blanks out the title field when the song is the special "Nueva Canción"
// placeholder so the user starts with an empty input. Styling lives in
// _setlist.css (.gi-edit-form, .gi-edit-input, .gi-edit-btn).
export function songEditFormHTML(song, { placeholderForNewSong = false, showLibrary = true, showLyrics = false } = {}) {
  const titleValue = placeholderForNewSong && song.title === 'Nueva Canción' ? '' : (song.title || '');
  const titlePlaceholder = placeholderForNewSong ? 'Título (Requerido)' : 'Título';
  const libraryRow = showLibrary ? libraryRowHTML(song, placeholderForNewSong) : '';

  const keyOptions = ['<option value="" ' + (!song.key ? 'selected' : '') + '>-- Tono --</option>']
    .concat(KEYS_WITH_LABELS.map(([k, label]) =>
      `<option value="${k}" ${song.key === k ? 'selected' : ''}>${label}</option>`
    )).join('');

  // Compás (clave del metrónomo): se aplica al metrónomo al lanzar la canción.
  const curSig = song.timeSig || '4/4';
  const sigOptions = TIME_SIGNATURES
    .map(s => `<option value="${s}" ${s === curSig ? 'selected' : ''}>${s}</option>`)
    .join('');

  // Audio section — collapsible to reduce visual weight. Auto-expands
  // when at least one slot has audio assigned (so the user sees the
  // status + clear option immediately); otherwise stays closed behind
  // a "Audio (Secuencia + Original)" summary line that the user can
  // expand if they want to attach files.
  const seqPath = song.audio && song.audio.sequence;
  const origPath = song.audio && song.audio.original;
  const hasAnyAudio = !!(seqPath || origPath);
  const audioSection = placeholderForNewSong ? '' : `
      <details class="gi-edit-audio-details" open>
        <summary class="gi-edit-audio-summary">
          Audio
          ${hasAnyAudio
            ? `<span class="gi-edit-audio-summary-badge">${(seqPath ? 1 : 0) + (origPath ? 1 : 0)}/2 asignados</span>`
            : `<span class="gi-edit-audio-summary-badge">sin archivos</span>`}
        </summary>
        <div class="gi-edit-audio">
          <div class="gi-edit-audio-row">
            <span class="gi-edit-audio-label">Secuencia</span>
            ${seqPath
              ? `<span class="gi-edit-audio-status has">✓ asignado</span>
                 <button class="gi-edit-audio-clear" data-action="clear-audio-seq" type="button" title="Quitar audio de secuencia">×</button>`
              : `<button class="gi-edit-audio-assign" data-action="assign-audio-seq" type="button">Asignar archivo</button>`}
          </div>
          <div class="gi-edit-audio-row">
            <span class="gi-edit-audio-label">Original</span>
            ${origPath
              ? `<span class="gi-edit-audio-status has">✓ asignado</span>
                 <button class="gi-edit-audio-clear" data-action="clear-audio-orig" type="button" title="Quitar audio original">×</button>`
              : ''}
            <button class="gi-edit-audio-assign" data-action="assign-audio-orig" type="button">${origPath ? 'Reemplazar' : 'Asignar archivo'}</button>
            <button class="gi-edit-audio-assign gi-edit-audio-yt" data-action="yt-audio-orig" type="button" title="Descargar el audio desde un enlace de YouTube (requiere internet)">▶ Desde YouTube</button>
          </div>
        </div>
      </details>
  `;

  // Letra y acordes DENTRO del formulario. Se activa en el modal de crear:
  // antes había que guardar la canción y abrir OTRA ventana solo para pegar
  // la letra, que es justo lo que se hace al dar de alta una canción.
  const lyricsSection = showLyrics ? `
      <label class="gi-edit-lyrics-label">Letra y acordes <span>opcional</span></label>
      <textarea class="gi-edit-input gi-edit-lyrics edit-lyrics" rows="6" spellcheck="false"
        placeholder="Pega aquí la letra (o usa el enlace de arriba). Se limpia sola al pegar.">${esc(song.lyrics || '')}</textarea>` : '';

  return `
    <div class="gi-edit-form" data-action="edit-form-shell">
      ${libraryRow}
      <input type="text" class="gi-edit-input gi-edit-input--title edit-title" value="${esc(titleValue)}" placeholder="${titlePlaceholder}">
      <input type="text" class="gi-edit-input edit-artist" value="${esc(song.artist || '')}" placeholder="Artista">
      <div class="gi-edit-row">
        <input type="text" class="gi-edit-input gi-edit-input--small edit-bpm" value="${esc(song.bpm || '')}" placeholder="BPM">
        <select class="gi-edit-input gi-edit-input--small edit-timesig" title="Compás (clave del metrónomo)">${sigOptions}</select>
        <select class="gi-edit-input gi-edit-input--small edit-key">${keyOptions}</select>
        <select class="gi-edit-input gi-edit-input--small edit-genre">
          <option value="alabanza" ${song.genre === 'alabanza' ? 'selected' : ''}>Alabanza</option>
          <option value="adoracion" ${song.genre === 'adoracion' ? 'selected' : ''}>Adoración</option>
        </select>
      </div>
      <input type="text" class="gi-edit-input edit-tags" value="${esc(Array.isArray(song.tags) ? song.tags.join(', ') : '')}" placeholder="Etiquetas (separadas por comas: rápida, navidad…)">
      ${audioSection}
      ${lyricsSection}
      <div class="gi-edit-actions">
        <button class="gi-edit-btn save" data-action="edit-save">Guardar</button>
        <button class="gi-edit-btn cancel" data-action="edit-cancel">Cancelar</button>
      </div>
    </div>
  `;
}
