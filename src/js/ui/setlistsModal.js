// Modal de "Setlists guardados": guardar el servicio actual con TÍTULO + FECHA
// (con calendario) y cargar/eliminar los guardados. Solo locales.

import { esc } from '../utils/dom.js';
import {
  listSavedSetlists, saveCurrentAsSetlist, loadSavedSetlist, deleteSavedSetlist,
  getServiceSongs,
} from '../data/service.js';
import { isLoggedIn } from '../cloud/supabase.js';
import { upsertSharedSetlist, deleteSharedSetlistByName } from '../cloud/setlistSync.js';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Fecha del servicio (YYYY-MM-DD) → "Día dd/mm/yy".
function fmtDateStr(dateStr) {
  if (!dateStr) return '';
  const [y, m, dd] = dateStr.split('-').map(Number);
  if (!y || !m || !dd) return dateStr;
  const d = new Date(y, m - 1, dd);
  return `${DAYS[d.getDay()]} ${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`;
}
// Fallback: fecha de guardado (timestamp).
function fmtSavedAt(ts) {
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

export function openSetlistsModal() {
  document.getElementById('setlists-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'setlists-overlay';
  overlay.className = 'setlists-overlay';
  document.body.appendChild(overlay);

  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const close = () => { window.removeEventListener('keydown', onKey, true); overlay.remove(); };
  window.addEventListener('keydown', onKey, true);

  function render() {
    const list = listSavedSetlists();
    overlay.innerHTML = `
      <div class="setlists-modal">
        <div class="setlists-head">
          <h3>📋 Setlists guardados</h3>
          <button class="setlists-x" data-act="close" aria-label="Cerrar">×</button>
        </div>
        <div class="setlists-save-form">
          <div class="sl-field sl-field--title">
            <label>Título</label>
            <input type="text" class="sl-title" placeholder="Ej. Servicio Domingo" value="Servicio">
          </div>
          <div class="sl-field sl-field--date">
            <label>Fecha</label>
            <input type="date" class="sl-date" value="${todayISO()}">
          </div>
          <button class="sl-save-btn" data-act="save">Guardar</button>
        </div>
        <div class="setlists-list">
          ${list.length ? list.map(s => `
            <div class="setlists-row" data-id="${esc(s.id)}">
              <div class="setlists-row-info">
                <span class="setlists-row-name">${esc(s.name)}</span>
                <span class="setlists-row-meta">${s.date ? fmtDateStr(s.date) : fmtSavedAt(s.savedAt)} · ${(s.songs || []).length} canción(es)</span>
              </div>
              <button class="setlists-load" data-act="load">Cargar</button>
              <button class="setlists-del" data-act="del" title="Eliminar">×</button>
            </div>`).join('')
            : `<p class="setlists-empty">Todavía no guardaste setlists. Armá tu servicio (abajo) y guardalo acá con su título y fecha.</p>`}
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
      const title = overlay.querySelector('.sl-title')?.value.trim() || 'Servicio';
      const date = overlay.querySelector('.sl-date')?.value || '';
      const entry = saveCurrentAsSetlist(title, date);
      if (entry) window.showToast?.(`✓ Setlist "${entry.name}" guardado.`, 'success');
      // Además, compartirlo a la nube → aparece en las vistas web de Cantantes
      // y Producción (misma tabla `setlists`), con su fecha para el badge HOY.
      if (entry && isLoggedIn()) {
        upsertSharedSetlist(title, date)
          .then((r) => {
            const extra = r.skipped ? ` (${r.skipped} sin subir aún — sube tu librería)` : '';
            window.showToast?.(`☁ "${title}" disponible para Cantantes y Producción${extra}.`, 'success');
          })
          .catch((err) => window.showToast?.(err.message || 'No se pudo compartir el setlist.', 'info'));
      }
      render();
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
      const entry = listSavedSetlists().find(s => s.id === id);
      deleteSavedSetlist(id);
      // Quitarlo también de la nube (por nombre) para no dejarlo huérfano en
      // las vistas web del equipo.
      if (entry?.name && isLoggedIn()) {
        deleteSharedSetlistByName(entry.name).catch(() => {});
      }
      render();
    }
  });
}
