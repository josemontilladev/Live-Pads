// GI-library toolbar wiring: search input, add-song button, import/export
// file handling, and the genre-filter dropdown menu.
//
// All callbacks that need state mutation route through the store; the
// only deps from app.js are the side-effectful `updateFilterCounts()`
// callback (refreshes the counts shown in the filter menu).

import { q, qa, debounce } from '../utils/dom.js';
import { showToast } from './toast.js';
import {
  getSongs, setSongs,
  getCurrentGenre, setCurrentGenre,
} from '../state/store.js';
import { exportGiSetlistToFile } from '../data/giSetlistLoader.js';
import { renderGiList } from './giList.js';

/**
 * @param {Object} deps
 *   - updateFilterCounts () — refresh the (N) badges in the filter menu
 */
export function bindGiToolbar(deps) {
  bindImportExport(deps);
  bindSearchAndAdd(deps);
  bindGenreFilter(deps);
}

function bindImportExport(deps) {
  q('#btn-import-gi').onclick = () => q('#gi-file-input').click();

  const btnExportGi = q('#btn-export-gi');
  if (btnExportGi) {
    btnExportGi.onclick = () => {
      const songs = getSongs();
      if (!songs.length) {
        showToast('La librería está vacía — nada que exportar.', 'warning');
        return;
      }
      const n = exportGiSetlistToFile(songs);
      showToast(`Exportadas ${n} canción${n === 1 ? '' : 'es'} a JSON.`, 'success');
    };
  }

  q('#gi-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (json.data && json.data.songs) {
          setSongs(json.data.songs.map((s, idx) => {
            if (!s.id) s.id = 'song_imp_' + idx + '_' + Date.now();
            return s;
          }));
          if (window.electronAPI && window.electronAPI.saveGiSetlist) {
            window.electronAPI.saveGiSetlist(getSongs());
          }
          deps.updateFilterCounts();
          renderGiList();
          // Switch to GI tab automatically
          q('.s-toggle[data-target="gi-setlist-list"]').click();
        } else {
          alert('El archivo no parece ser un export de GI-Setlist válido.');
        }
      } catch (err) {
        alert('Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  };
}

function bindSearchAndAdd(deps) {
  // Search input — debounced re-render of the library so typing doesn't
  // recompile the card list on every keystroke.
  q('#gi-search').oninput = debounce((e) => renderGiList(e.target.value), 180);

  // "+ Nueva canción" — inserts a placeholder song and immediately opens
  // the inline edit form (handled by giList.js via the editSongId param).
  const btnAddGiSong = q('#btn-add-gi-song');
  if (btnAddGiSong) {
    btnAddGiSong.onclick = () => {
      const newSong = {
        id: 'song_' + Date.now(),
        title: 'Nueva Canción',
        artist: '',
        bpm: '',
        key: '',
        genre: 'adoracion',
        audio: { sequence: null, original: null }
      };
      getSongs().push(newSong);
      if (window.electronAPI && window.electronAPI.saveGiSetlist) {
        window.electronAPI.saveGiSetlist(getSongs());
      }
      deps.updateFilterCounts();
      renderGiList(q('#gi-search').value, newSong.id);
    };
  }
}

// Genre filter dropdown — replaces the inline chips with a popover menu
// anchored to the filter icon next to the search input. Keeps the search
// row compact so the first song card sits closer to the header.
function bindGenreFilter(_deps) {
  const filterToggle = q('#btn-gi-filter-toggle');
  const filterMenu   = q('#gi-filter-menu');
  const filterDot    = q('#gi-filter-dot');

  const refreshFilterActiveStates = () => {
    qa('.gi-filter-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.genre === getCurrentGenre());
    });
    const customFilter = getCurrentGenre() !== 'all';
    if (filterToggle) filterToggle.classList.toggle('active', customFilter);
    if (filterDot) filterDot.hidden = !customFilter;
  };
  refreshFilterActiveStates();

  const closeFilterMenu = () => {
    if (!filterMenu) return;
    filterMenu.classList.add('hidden');
    if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
  };

  if (filterToggle && filterMenu) {
    filterToggle.onclick = (e) => {
      e.stopPropagation();
      const willOpen = filterMenu.classList.contains('hidden');
      filterMenu.classList.toggle('hidden');
      filterToggle.setAttribute('aria-expanded', String(willOpen));
    };
    // Click anywhere outside closes the menu.
    document.addEventListener('click', (e) => {
      if (filterMenu.classList.contains('hidden')) return;
      if (filterMenu.contains(e.target) || filterToggle.contains(e.target)) return;
      closeFilterMenu();
    });
  }

  qa('.gi-filter-option').forEach(opt => {
    opt.onclick = (e) => {
      e.stopPropagation();
      setCurrentGenre(opt.dataset.genre);
      refreshFilterActiveStates();
      closeFilterMenu();
      renderGiList(q('#gi-search').value);
    };
  });
}
