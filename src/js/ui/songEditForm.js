import { esc } from '../utils/dom.js';

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
export function songEditFormHTML(song, { placeholderForNewSong = false } = {}) {
  const titleValue = placeholderForNewSong && song.title === 'Nueva Canción' ? '' : (song.title || '');
  const titlePlaceholder = placeholderForNewSong ? 'Título (Requerido)' : 'Título';

  const keyOptions = ['<option value="" ' + (!song.key ? 'selected' : '') + '>-- Tono --</option>']
    .concat(KEYS_WITH_LABELS.map(([k, label]) =>
      `<option value="${k}" ${song.key === k ? 'selected' : ''}>${label}</option>`
    )).join('');

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

  return `
    <div class="gi-edit-form" data-action="edit-form-shell">
      <input type="text" class="gi-edit-input gi-edit-input--title edit-title" value="${esc(titleValue)}" placeholder="${titlePlaceholder}">
      <input type="text" class="gi-edit-input edit-artist" value="${esc(song.artist || '')}" placeholder="Artista">
      <div class="gi-edit-row">
        <input type="text" class="gi-edit-input gi-edit-input--small edit-bpm" value="${esc(song.bpm || '')}" placeholder="BPM">
        <select class="gi-edit-input gi-edit-input--small edit-key">${keyOptions}</select>
        <select class="gi-edit-input gi-edit-input--small edit-genre">
          <option value="alabanza" ${song.genre === 'alabanza' ? 'selected' : ''}>Alabanza</option>
          <option value="adoracion" ${song.genre === 'adoracion' ? 'selected' : ''}>Adoración</option>
        </select>
      </div>
      <input type="text" class="gi-edit-input edit-tags" value="${esc(Array.isArray(song.tags) ? song.tags.join(', ') : '')}" placeholder="Etiquetas (separadas por comas: rápida, navidad…)">
      ${audioSection}
      <div class="gi-edit-actions">
        <button class="gi-edit-btn save" data-action="edit-save">Guardar</button>
        <button class="gi-edit-btn cancel" data-action="edit-cancel">Cancelar</button>
      </div>
    </div>
  `;
}
