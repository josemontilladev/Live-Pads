// ─────────────────────────────────────────────────────────────────────────
// Diálogo de conflictos de sincronización: aparece cuando otro miembro editó
// una canción que TÚ también cambiaste sin subir. Por cada una eliges:
//   · "Usar la de ellos" → aplica la versión de la nube sobre tu copia.
//   · "Mantener la mía"   → sube tu versión, pisando la de la nube.
// Ambas resuelven el conflicto de forma permanente (no reaparece en el próximo
// sync). Cerrar sin decidir → volverá a ofrecerse en la siguiente bajada.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { resolveConflictUseTheirs, resolveConflictKeepMine } from './songSync.js';
import { showToast } from '../ui/toast.js';

let overlay = null, pop = null;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showConflictsModal(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return;
  if (overlay) return; // ya hay uno; el próximo pull re-ofrecerá los que falten
  const items = conflicts.slice();

  overlay = document.createElement('div');
  overlay.id = 'conflict-overlay';
  overlay.innerHTML = `
    <div class="cfl-panel" role="dialog" aria-label="Cambios en conflicto">
      <div class="cfl-head"><h3>Cambios en conflicto</h3></div>
      <p class="cfl-intro">Otro miembro editó estas canciones mientras tú también las cambiaste. Elige qué versión conservar en cada una.</p>
      <div class="cfl-list"></div>
      <div class="cfl-foot"><button class="acc-btn ghost" data-act="close">Cerrar</button></div>
    </div>`;
  document.body.appendChild(overlay);
  pop = pushModal(() => close());

  const list = overlay.querySelector('.cfl-list');
  const render = () => {
    list.innerHTML = items.map((c, i) => `
      <div class="cfl-item">
        <div class="cfl-title">${esc(c.title || 'Canción')}</div>
        <div class="cfl-sub">Editada por ${esc(c.byName || 'otro miembro')}</div>
        <div class="cfl-actions">
          <button class="acc-btn sm" data-act="theirs" data-i="${i}">Usar la de ellos</button>
          <button class="acc-btn ghost sm" data-act="mine" data-i="${i}">Mantener la mía</button>
        </div>
      </div>`).join('');
  };
  render();

  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') return close();
    const i = parseInt(btn.dataset.i, 10);
    const c = items[i];
    if (!c) return;
    overlay.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      if (act === 'theirs') {
        resolveConflictUseTheirs(c.cloudId, c.theirs);
        showToast(`«${c.title}»: usaste la versión de ${c.byName || 'ellos'}.`, 'info');
      } else {
        await resolveConflictKeepMine(c.cloudId);
        showToast(`«${c.title}»: mantuviste tu versión.`, 'success');
      }
      items.splice(i, 1);
      if (!items.length) return close();
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo resolver el conflicto.', 'error');
      overlay.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  });

  requestAnimationFrame(() => overlay.classList.add('open'));
}

function close() {
  if (!overlay) return;
  if (pop) { pop(); pop = null; }
  overlay.classList.remove('open');
  const n = overlay; overlay = null;
  setTimeout(() => n.remove(), 160);
}
