// ─────────────────────────────────────────────────────────────────────────
// Selector de repertorio en la cabecera de la pestaña Librería.
//   · Lista "Todas las canciones" + las librerías de la nube + "+ Crear librería…".
//   · Arranca en la librería ACTIVA de la configuración del usuario.
//   · Al cambiar, filtra la lista y fija esa librería como activa.
// Solo aparece con la nube activada y sesión iniciada; en modo local se oculta
// y la lista muestra todo (comportamiento de siempre).
// ─────────────────────────────────────────────────────────────────────────

import { q } from '../utils/dom.js';
import { showDialog } from '../ui/dialog.js';
import { isCloudEnabled, isLoggedIn, onAuthChange } from './supabase.js';
import { listLibraries, getActiveLibraryId, setActiveLibraryId, createLibrary } from './libraries.js';
import { setLibraryScope, renderGiList } from '../ui/giList.js';

let wired = false;
let activeScope = 'all';   // última opción válida (para revertir si se elige "Crear")

function repaint() {
  renderGiList(q('#gi-search')?.value || '');
}

// Abre el diálogo para crear una librería nueva y la deja activa. Pensado para
// quien instala limpio: arranca con "Mi librería" y desde acá crea las que
// quiera.
function promptCreateLibrary() {
  showDialog('Nueva librería', 'Nombre de la librería…', async (name) => {
    const n = (name || '').trim();
    if (!n) return;
    try {
      const lib = await createLibrary(n);
      if (lib && lib.id) setActiveLibraryId(lib.id);
      window.dispatchEvent(new CustomEvent('livepads:libraries-changed'));
      window.showToast?.(`Librería "${n}" creada.`, 'success');
    } catch (e) {
      window.showToast?.('No se pudo crear la librería: ' + (e.message || e), 'error');
    }
  });
}

export async function refreshLibrarySelector() {
  const row = q('#gi-lib-row');
  const sel = q('#gi-lib-select');
  if (!row || !sel) return;

  // Sin nube o sin sesión → ocultar y mostrar todo.
  if (!isCloudEnabled() || !isLoggedIn()) {
    row.classList.add('hidden');
    setLibraryScope('all');
    return;
  }

  let libs = [];
  try { libs = (await listLibraries()) || []; } catch (_) { libs = []; }
  if (!libs.length) { row.classList.add('hidden'); setLibraryScope('all'); return; }

  const active = getActiveLibraryId();
  const prev = sel.value;
  sel.innerHTML = '';
  sel.add(new Option('Todas las canciones', 'all'));
  libs.forEach((l) => sel.add(new Option(l.name, l.id)));
  // "Solo locales" se quitó a propósito. La última opción es la acción de crear.
  sel.add(new Option('+ Crear librería…', '__create'));

  // Selección inicial: conserva la previa si sigue siendo válida; si no, la
  // librería activa; si no, "Todas".
  const valid = (v) => v === 'all' || libs.some((l) => l.id === v);
  const initial = valid(prev) ? prev : (active && libs.some((l) => l.id === active) ? active : 'all');
  sel.value = initial;
  activeScope = initial;
  setLibraryScope(initial);
  row.classList.remove('hidden');

  if (!wired) {
    wired = true;
    sel.addEventListener('change', () => {
      const v = sel.value;
      // "Crear librería…" no es un ámbito: revierte la selección y abre el diálogo.
      if (v === '__create') { sel.value = activeScope; promptCreateLibrary(); return; }
      activeScope = v;
      setLibraryScope(v);
      if (v !== 'all') setActiveLibraryId(v);
      repaint();
    });
  }
  repaint();
}

export function initLibrarySelector() {
  refreshLibrarySelector();
  window.addEventListener('livepads:libraries-changed', refreshLibrarySelector);
  window.addEventListener('livepads:library-synced', refreshLibrarySelector);
  onAuthChange(() => refreshLibrarySelector());
}
