// Setlist panel — tab toggle + service-list navigation buttons.
//
// The 2 tabs (Librería / Servicio) share `.s-toggle` markup; switching
// tabs (a) hides the previous list, (b) shows the new one, and (c) flips
// a `data-active-tab` attribute on #panel-setlist so the CSS can show/hide
// header actions.
//
// The service-nav buttons (prev / next / clear) live in the same header
// block, so they're wired here for cohesion.

import { q, qa } from '../utils/dom.js';
import {
  clearServiceList, serviceNextSong, servicePrevSong,
} from '../data/service.js';
import { showDialog } from './dialog.js';
import { isLoggedIn } from '../cloud/supabase.js';

export function bindSetlistTabs() {
  const panelSetlist = q('#panel-setlist');

  qa('.s-toggle').forEach(btn => {
    btn.onclick = () => {
      qa('.s-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      q('#gi-setlist-list').classList.add('hidden');
      q('#service-setlist-list').classList.add('hidden');
      q('#' + btn.dataset.target).classList.remove('hidden');
      if (panelSetlist) panelSetlist.dataset.activeTab = btn.dataset.target;
    };
  });

  // Initial sync of header-button visibility — fires the active tab's
  // click so the data-active-tab attribute lands on first paint.
  const activeToggle = q('.s-toggle.active');
  if (activeToggle) activeToggle.click();

  // Service-list navigation
  const btnClear = q('#btn-clear-service');
  if (btnClear) btnClear.onclick = clearServiceList;

  const btnPrev = q('#btn-service-prev');
  if (btnPrev) btnPrev.onclick = servicePrevSong;

  const btnNext = q('#btn-service-next');
  if (btnNext) btnNext.onclick = serviceNextSong;

  // Empty-state CTA — switches to the Library tab so the user can add songs.
  const btnGoLib = q('#btn-service-go-library');
  if (btnGoLib) {
    btnGoLib.onclick = () => q('.s-toggle[data-target="gi-setlist-list"]')?.click();
  }

  // Compartir servicio: guarda el orden actual como setlist de la librería
  // activa, para que el equipo lo cargue.
  const btnShare = q('#btn-service-share');
  if (btnShare) {
    btnShare.onclick = async () => {
      if (!isLoggedIn()) {
        window.showToast?.('Inicia sesión para compartir el servicio con tu equipo.', 'warning');
        return;
      }
      showDialog('Compartir servicio', 'Nombre del servicio…', async (name) => {
        if (!name || !name.trim()) return;
        try {
          const { saveServiceAsSetlist } = await import('../cloud/setlistSync.js');
          const r = await saveServiceAsSetlist(name);
          window.showToast?.(`Servicio compartido (${r.saved} canciones${r.skipped ? `, ${r.skipped} omitidas por no estar en la nube` : ''}).`, 'success');
        } catch (e2) {
          window.showToast?.(e2.message || 'No se pudo compartir el servicio.', 'error');
        }
      });
    };
  }

  // Búsqueda dentro del servicio
  const svcSearch = q('#svc-search');
  const svcSearchClear = q('#svc-search-clear');
  if (svcSearch) {
    const updateClearVisibility = () => {
      if (svcSearchClear) svcSearchClear.classList.toggle('hidden', !svcSearch.value);
    };
    svcSearch.oninput = () => {
      updateClearVisibility();
      window.dispatchEvent(new CustomEvent('livepads:service-search', { detail: { q: svcSearch.value } }));
    };
    if (svcSearchClear) svcSearchClear.onclick = () => {
      svcSearch.value = '';
      updateClearVisibility();
      window.dispatchEvent(new CustomEvent('livepads:service-search', { detail: { q: '' } }));
      svcSearch.focus();
    };
  }
}
