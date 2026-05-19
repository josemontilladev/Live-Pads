// Setlist panel — tab toggle + service-list navigation buttons.
//
// The 3 tabs (Presets / Librería / Servicio) share `.s-toggle` markup;
// switching tabs (a) hides the previous list, (b) shows the new one, and
// (c) flips a `data-active-tab` attribute on #panel-setlist so the CSS
// can show/hide header actions (Import / Sync / Export / AddPreset).
//
// The service-nav buttons (prev / next / clear) live in the same header
// block, so they're wired here for cohesion.

import { q, qa } from '../utils/dom.js';
import {
  clearServiceList, serviceNextSong, servicePrevSong,
} from '../data/service.js';

export function bindSetlistTabs() {
  const panelSetlist = q('#panel-setlist');

  qa('.s-toggle').forEach(btn => {
    btn.onclick = () => {
      qa('.s-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      q('#setlist-list').classList.add('hidden');
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
}
