// Modal de "Setlists guardados": guardar el servicio actual con un nombre + fecha
// (ej. "Servicio Domingo 10/11/26") y cargar/eliminar los guardados. Solo locales.

import { q, esc } from '../utils/dom.js';
import { showDialog } from './dialog.js';
import {
  listSavedSetlists, saveCurrentAsSetlist, loadSavedSetlist, deleteSavedSetlist,
  getServiceSongs,
} from '../data/service.js';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function fmtDate(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${DAYS[d.getDay()]} ${dd}/${mm}/${yy}`;
}
// Nombre sugerido al guardar: "Servicio <Día> <dd/mm/yy>".
function suggestedName() {
  return `Servicio ${fmtDate(Date.now())}`;
}

export function openSetlistsModal() {
  document.getElementById('setlists-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'setlists-overlay';
  overlay.className = 'setlists-overlay';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  function render() {
    const list = listSavedSetlists();
    overlay.innerHTML = `
      <div class="setlists-modal">
        <div class="setlists-head">
          <h3>📋 Setlists guardados</h3>
          <button class="setlists-x" data-act="close" aria-label="Cerrar">×</button>
        </div>
        <button class="setlists-save" data-act="save">＋ Guardar el servicio actual…</button>
        <div class="setlists-list">
          ${list.length ? list.map(s => `
            <div class="setlists-row" data-id="${esc(s.id)}">
              <div class="setlists-row-info">
                <span class="setlists-row-name">${esc(s.name)}</span>
                <span class="setlists-row-meta">${fmtDate(s.savedAt)} · ${(s.songs || []).length} canción(es)</span>
              </div>
              <button class="setlists-load" data-act="load">Cargar</button>
              <button class="setlists-del" data-act="del" title="Eliminar">×</button>
            </div>`).join('')
            : `<p class="setlists-empty">Todavía no guardaste setlists. Armá tu servicio (abajo) y guardalo acá con un nombre.</p>`}
        </div>
      </div>`;
  }
  render();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') { close(); return; }
    if (act === 'save') {
      if (!getServiceSongs().length) {
        window.showToast?.('El servicio está vacío: agregá canciones antes de guardar el setlist.', 'info');
        return;
      }
      showDialog('Guardar setlist', 'Ej. Servicio Domingo 10/11/26', (name) => {
        const entry = saveCurrentAsSetlist(name || suggestedName());
        if (entry) window.showToast?.(`✓ Setlist "${entry.name}" guardado.`, 'success');
        render();
      });
      // Pre-rellenar con el nombre sugerido (fecha de hoy) para que lo edite.
      const input = q('#dialog-name');
      if (input) { input.value = suggestedName(); setTimeout(() => input.select(), 60); }
      return;
    }
    const row = e.target.closest('.setlists-row');
    const id = row?.dataset.id;
    if (!id) return;
    if (act === 'load') {
      if (loadSavedSetlist(id)) {
        window.showToast?.('✓ Setlist cargado en el servicio.', 'success');
        close();
      }
    } else if (act === 'del') {
      deleteSavedSetlist(id);
      render();
    }
  });

  // Esc cierra.
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); window.removeEventListener('keydown', onKey, true); } };
  window.addEventListener('keydown', onKey, true);
}
