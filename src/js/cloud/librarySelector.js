// ─────────────────────────────────────────────────────────────────────────
// Selector de repertorio en la cabecera de la pestaña Librería.
//   · Lista las librerías de la nube + "Todas" + "Solo locales".
//   · Arranca en la librería ACTIVA de la configuración del usuario.
//   · Al cambiar, filtra la lista y fija esa librería como activa.
// Solo aparece con la nube activada y sesión iniciada; en modo local se oculta
// y la lista muestra todo (comportamiento de siempre).
// ─────────────────────────────────────────────────────────────────────────

import { q } from '../utils/dom.js';
import { isCloudEnabled, isLoggedIn, onAuthChange } from './supabase.js';
import { listLibraries, getActiveLibraryId, setActiveLibraryId } from './libraries.js';
import { setLibraryScope, renderGiList } from '../ui/giList.js';

let wired = false;

function repaint() {
  renderGiList(q('#gi-search')?.value || '');
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
  sel.add(new Option('Solo locales', 'local'));

  // Selección inicial: conserva la previa si sigue siendo válida; si no, la
  // librería activa; si no, "Todas".
  const valid = (v) => v === 'all' || v === 'local' || libs.some((l) => l.id === v);
  const initial = valid(prev) ? prev : (active && libs.some((l) => l.id === active) ? active : 'all');
  sel.value = initial;
  setLibraryScope(initial);
  row.classList.remove('hidden');

  if (!wired) {
    wired = true;
    sel.addEventListener('change', () => {
      const v = sel.value;
      setLibraryScope(v);
      if (v !== 'all' && v !== 'local') setActiveLibraryId(v);
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
