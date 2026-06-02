// GI-library toolbar wiring: search input, add-song button, import/export
// file handling, and the genre-filter dropdown menu.
//
// All callbacks that need state mutation route through the store; the
// only deps from app.js are the side-effectful `updateFilterCounts()`
// callback (refreshes the counts shown in the filter menu).

import { q, qa, debounce } from '../utils/dom.js';
import { showToast } from './toast.js';
import { confirmDialog } from './dialog.js';
import {
  getSongs, setSongs,
  getCurrentGenre, setCurrentGenre,
} from '../state/store.js';
import { exportGiSetlistToFile } from '../data/giSetlistLoader.js';
import { renderGiList, getLibraryScope } from './giList.js';

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
  const btnImportGi = q('#btn-import-gi');
  btnImportGi.onclick = () => q('#gi-file-input').click();

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
    // Loading state: pulse the import button + dim it so the user sees
    // that something's happening, even on tiny files (parse is sync but
    // big libraries can take a couple hundred ms to render afterward).
    btnImportGi.classList.add('is-loading');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const finish = () => {
        btnImportGi.classList.remove('is-loading');
        e.target.value = ''; // Reset so re-importing same file re-fires onchange
      };
      try {
        const json = JSON.parse(ev.target.result);
        if (!json.data || !json.data.songs) {
          showToast('El archivo no parece ser un export válido.', 'warning');
          finish();
          return;
        }
        const imported = json.data.songs.map((s, idx) => {
          if (!s.id) s.id = 'song_imp_' + idx + '_' + Date.now();
          return s;
        });

        const commit = () => {
          setSongs(imported);
          if (window.electronAPI && window.electronAPI.saveGiSetlist) {
            window.electronAPI.saveGiSetlist(getSongs());
          }
          deps.updateFilterCounts();
          renderGiList();
          q('.s-toggle[data-target="gi-setlist-list"]').click();
          showToast(`Importadas ${imported.length} canción${imported.length === 1 ? '' : 'es'}.`, 'success');
          finish();
        };

        // If the user already has a library, the import REPLACES it. That's
        // destructive (no merge / undo), so guard with a confirm dialog when
        // there's anything to lose.
        const currentCount = getSongs().length;
        if (currentCount > 0) {
          confirmDialog({
            title: 'Reemplazar librería',
            message: `Tu librería tiene ${currentCount} ${currentCount === 1 ? 'canción' : 'canciones'}. Importar este archivo las sustituirá por ${imported.length}. ¿Continuar?`,
            confirmLabel: 'Reemplazar',
            danger: true,
            onConfirm: commit,
            onCancel: finish,
          });
        } else {
          commit();
        }
      } catch (err) {
        showToast('Error al leer el archivo JSON.', 'warning');
        finish();
      }
    };
    reader.onerror = () => {
      btnImportGi.classList.remove('is-loading');
      showToast('No se pudo leer el archivo.', 'warning');
    };
    reader.readAsText(file);
  };
}

function bindSearchAndAdd(deps) {
  // Search input — debounced re-render of the library so typing doesn't
  // recompile the card list on every keystroke. The clear-X button shows
  // whenever the input has content and resets the search instantly.
  const searchInput = q('#gi-search');
  const clearBtn = q('#gi-search-clear');
  const debouncedRender = debounce((v) => renderGiList(v), 180);
  const refreshClearBtn = () => {
    if (!clearBtn) return;
    clearBtn.classList.toggle('hidden', !searchInput.value);
  };
  searchInput.oninput = (e) => {
    refreshClearBtn();
    debouncedRender(e.target.value);
  };
  // Enter "commits" the current filter by applying the FIRST card in the
  // filtered library — fast workflow when you're searching for a specific
  // song to load. Shift+Enter is reserved (browser default focuses next
  // form field) so plain Enter is unambiguous here.
  searchInput.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const firstCard = q('#gi-songs-container .gi-song-item[data-song-id]');
    if (firstCard) {
      e.preventDefault();
      firstCard.click();
    }
  };
  if (clearBtn) {
    clearBtn.onclick = () => {
      searchInput.value = '';
      refreshClearBtn();
      renderGiList('');
      searchInput.focus();
    };
  }
  refreshClearBtn();

  // Buscador colapsable — por defecto la fila muestra solo el icono 🔍.
  // Click → expande el input y enfoca. Blur con input vacío → colapsa de nuevo.
  // Si hay texto, se mantiene expandido para que el usuario vea su búsqueda activa.
  const searchToggle = q('#btn-gi-search-toggle');
  const searchRow = searchToggle?.closest('.gi-search-row');
  if (searchToggle && searchRow && searchInput) {
    const expand = () => {
      searchRow.classList.remove('search-collapsed');
      searchToggle.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => searchInput.focus());
    };
    const collapseIfEmpty = () => {
      if (!searchInput.value) {
        searchRow.classList.add('search-collapsed');
        searchToggle.setAttribute('aria-expanded', 'false');
      }
    };
    searchToggle.onclick = expand;
    searchInput.addEventListener('blur', () => {
      // Espera un tick para no colapsar si el blur fue por click en clearBtn.
      setTimeout(collapseIfEmpty, 120);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        refreshClearBtn();
        renderGiList('');
        searchInput.blur();
      }
    });
  }

  // "+ Nueva canción" — inserts a placeholder song and immediately opens
  // the inline edit form (handled by giList.js via the editSongId param).
  const btnAddGiSong = q('#btn-add-gi-song');
  if (btnAddGiSong) {
    btnAddGiSong.onclick = () => {
      const scope = getLibraryScope();
      const genre = getCurrentGenre();
      const newSong = {
        id: 'song_' + Date.now(),
        addedAt: Date.now(),
        title: 'Nueva Canción',
        artist: '',
        bpm: '',
        key: '',
        // Si hay un género filtrado (no especiales), la nueva canción lo hereda
        // para que aparezca en esa vista; si no, default 'adoracion'.
        genre: (genre && !['all', 'favoritos', 'recientes'].includes(genre)) ? genre : 'adoracion',
        tags: [],
        audio: { sequence: null, original: null }
      };
      // La nueva canción debe aparecer SIEMPRE en la vista actual (antes el form
      // quedaba invisible si había un repertorio/filtro/búsqueda activos):
      //  · hereda el ámbito de repertorio (libraryId) si hay uno seleccionado,
      //  · se marca favorita si ese es el filtro.
      if (scope && scope !== 'all' && scope !== 'local') newSong.libraryId = scope;
      if (genre === 'favoritos') newSong.favorite = true;
      getSongs().push(newSong);
      if (window.electronAPI && window.electronAPI.saveGiSetlist) {
        window.electronAPI.saveGiSetlist(getSongs());
      }
      deps.updateFilterCounts();
      // Limpiamos la búsqueda para que el texto no oculte la canción nueva.
      const searchEl = q('#gi-search');
      if (searchEl) searchEl.value = '';
      renderGiList('', newSong.id);
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
      if (!opt.dataset.genre) return; // ignora acciones que no son género (p.ej. eliminar duplicados)
      setCurrentGenre(opt.dataset.genre);
      refreshFilterActiveStates();
      closeFilterMenu();
      renderGiList(q('#gi-search').value);
    };
  });
}
