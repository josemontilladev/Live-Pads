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
    title: 'General',
    rows: [
      ['Tab',             'Alternar workspace Pads ↔ Stems'],
      ['Ctrl+K',          'Búsqueda global (Spotlight)'],
      ['Ctrl+N',          'Nueva canción'],
      ['?',               'Mostrar / cerrar este panel'],
      ['Esc',             'Cerrar el panel/modal más reciente'],
    ],
  },
  {
    title: 'Master & metrónomo (Pads)',
    rows: [
      ['Espacio',         'Play / Stop maestro'],
      ['Esc',             'Pánico — detiene todo'],
    ],
  },
  {
    title: 'Pads de notas',
    rows: [
      ['1 – = (fila superior)', 'Tocar C, C#, D … B'],
      ['Esc',             'Silenciar pad activo'],
    ],
  },
  {
    title: 'Drums',
    rows: [
      ['Q W E R',         'Drums fila superior (1-4)'],
      ['A S D F',         'Drums fila inferior (5-8)'],
    ],
  },
  {
    title: 'Setlist (Servicio)',
    rows: [
      ['↑  /  ←',         'Canción anterior'],
      ['↓  /  →',         'Canción siguiente'],
      ['N',               'Preparar siguiente canción (sin reproducir)'],
      ['Click en 🔍',     'Expandir buscador de la Librería'],
      ['Esc en buscador', 'Limpiar texto y colapsar el buscador'],
    ],
  },
  {
    title: 'Card de canción (Librería / Servicio)',
    rows: [
      ['Botón ⛶',         'Abrir letra a pantalla completa'],
      ['Botón "..."',     'Editar · eliminar · marcar favorito'],
    ],
  },
  {
    title: 'Letra a pantalla completa',
    rows: [
      ['+  /  =',         'Aumentar tamaño de letra'],
      ['−  /  _',         'Reducir tamaño de letra'],
      ['C',               'Toggle acordes (Con/Sin acordes)'],
      ['Esc',             'Cerrar overlay'],
    ],
  },
  {
    title: 'Editor de letras',
    rows: [
      ['Ctrl+S',          'Guardar y cerrar'],
      ['Ctrl+[',          'Envolver selección en [ ]'],
      ['Esc',             'Cerrar (confirma si hay cambios sin guardar)'],
    ],
  },
  {
    title: 'Stems (workspace de edición)',
    rows: [
      ['Espacio',         'Play / Pausa (mantiene la posición)'],
      ['M',               'Soltar marcador de sección en el tiempo actual'],
      ['Ctrl+Z',          'Deshacer'],
      ['Ctrl+Shift+Z / Ctrl+Y', 'Rehacer'],
      ['Ctrl + rueda',    'Zoom in / out del timeline'],
      ['Alt + rueda',     'Scroll horizontal del timeline'],
      ['Click derecho en marcador', 'Renombrar · cambiar tipo · loop · eliminar'],
      ['Arrastrar marcador', 'Reposicionar (snap a beat si activo)'],
      ['Click en timeline',  'Saltar a ese punto'],
      ['Doble clic en TRANSPONER', 'Resetear transpose master a 0 semitonos'],
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
