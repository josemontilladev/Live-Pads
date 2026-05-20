// Keyboard shortcuts list — rendered inside the sidebar's "Atajos" tab
// so it shares chrome (overlay, blur, tabs) with the rest of the
// settings UI instead of being a separate floating modal.
//
// Trigger paths:
//   • `?` key (Shift+/) anywhere — opens the sidebar on the Atajos tab
//   • The ? icon button in the topbar — same action
//   • Manually clicking the Atajos tab when the sidebar is already open

import { q } from '../utils/dom.js';
import { openSidebarTab } from './overlays.js';

const SECTIONS = [
  {
    title: 'Pads de notas',
    rows: [
      ['1 – = (top row)', 'Tocar C C# D … B'],
      ['Esc',             'Silenciar pad activo'],
    ],
  },
  {
    title: 'Drums',
    rows: [
      ['Q W E R',         'Fila superior de drums (1-4)'],
      ['A S D F',         'Fila inferior de drums (5-8)'],
    ],
  },
  {
    title: 'Master & metrónomo',
    rows: [
      ['Espacio',         'Play / Stop maestro'],
      ['Esc',             'Pánico — detiene todo'],
    ],
  },
  {
    title: 'Setlist (Servicio)',
    rows: [
      ['↑  /  ←',         'Canción anterior'],
      ['↓  /  →',         'Canción siguiente'],
      ['Tab',             'Preparar siguiente canción (sin reproducir)'],
    ],
  },
  {
    title: 'Editor de letras',
    rows: [
      ['Ctrl+S',          'Guardar y cerrar'],
      ['Ctrl+[',          'Envolver selección en [ ]'],
      ['Esc',             'Cerrar (con confirmación si hay cambios)'],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Ctrl+K',          'Búsqueda global (Spotlight)'],
      ['Ctrl+N',          'Nueva canción'],
      ['?',               'Mostrar este panel'],
      ['Esc',             'Cerrar paneles / overlays'],
    ],
  },
  {
    title: 'Companion (móvil)',
    rows: [
      ['Menú ☰',          'Abre el panel del Companion (QR + URL)'],
      ['Spotlight',       'Busca "Companion" en Ctrl+K'],
    ],
  },
];

let rendered = false;

/** Render the shortcuts list into the sidebar tab. Idempotent. */
export function ensureShortcutsRendered() {
  if (rendered) return;
  const host = q('#shortcuts-content');
  if (!host) return;
  host.innerHTML = SECTIONS.map(s => `
    <section class="cs-section">
      <h4>${s.title}</h4>
      <dl>
        ${s.rows.map(([k, v]) => `
          <div class="cs-row">
            <dt><kbd>${k}</kbd></dt>
            <dd>${v}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `).join('');
  rendered = true;
}

/** Open the sidebar on the Atajos tab. Used by the ? key and the topbar
 *  help button. Calling it twice toggles open/close. */
export function openCheatSheet() {
  ensureShortcutsRendered();
  const sidebar = q('#sidebar');
  if (!sidebar) return;
  // If already open on shortcuts tab → close (toggle behaviour for `?`).
  const tabIsActive = q('.stab[data-tab="shortcuts"]')?.classList.contains('active');
  if (sidebar.classList.contains('open') && tabIsActive) {
    sidebar.classList.remove('open');
    return;
  }
  openSidebarTab('shortcuts');
  sidebar.classList.add('open');
}

// Re-exports kept so the old call-sites in app.js / onKey keep compiling.
export function closeCheatSheet() {
  const sidebar = q('#sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

export function isCheatSheetOpen() {
  const sidebar = q('#sidebar');
  if (!sidebar || !sidebar.classList.contains('open')) return false;
  return !!q('.stab[data-tab="shortcuts"]')?.classList.contains('active');
}
