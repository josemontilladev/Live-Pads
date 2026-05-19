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

  // Audio status section — hidden for the "Nueva Canción" placeholder
  // (no point showing audio slots before the song exists). For existing
  // songs, shows a row per track type with a status pill + clear button
  // when the path is set, or "Asignar archivo" when empty. Assign goes
  // through the existing seq/orig play buttons (which already prompt for
  // a file when the song has no audio).
  const seqPath = song.audio && song.audio.sequence;
  const origPath = song.audio && song.audio.original;
  const audioSection = placeholderForNewSong ? '' : `
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
            : `<button class="gi-edit-audio-assign" data-action="assign-audio-orig" type="button">Asignar archivo</button>`}
        </div>
      </div>
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
      ${audioSection}
      <div class="gi-edit-actions">
        <button class="gi-edit-btn save" data-action="edit-save">Guardar</button>
        <button class="gi-edit-btn cancel" data-action="edit-cancel">Cancelar</button>
      </div>
    </div>
  `;
}
