// ─────────────────────────────────────────────────────────────────────────
// Selector de repertorio en la cabecera de la pestaña Librería.
//   · Lista "Todas las canciones" + las librerías de la nube + "+ Crear librería…".
//   · Arranca en la librería ACTIVA de la configuración del usuario.
//   · Al cambiar, filtra la lista y fija esa librería como activa.
// Solo aparece con la nube activada y sesión iniciada; en modo local se oculta
// y la lista muestra todo (comportamiento de siempre).
// ─────────────────────────────────────────────────────────────────────────

import { q } from '../utils/dom.js';
import { isCloudEnabled, isLoggedIn, onAuthChange } from './supabase.js';
import { listLibraries, getCachedLibraries, getActiveLibraryId, setActiveLibraryId, createLibrary } from './libraries.js';
import { setLibraryScope, renderGiList } from '../ui/giList.js';

let wired = false;
let activeScope = 'all';   // última opción válida (para revertir si se elige "Crear")

function repaint() {
  renderGiList(q('#gi-search')?.value || '');
}

// Crea una librería nueva con un formulario INLINE dentro del contenedor de la
// Librería (no un modal centrado). La deja activa al crearla.
function promptCreateLibrary() {
  const container = q('#gi-songs-container');
  if (!container) return;
  container.innerHTML = `
    <div class="gi-create-lib">
      <h4>Nueva librería</h4>
      <input type="text" class="gi-create-lib-name" placeholder="Nombre de la librería…" spellcheck="false">
      <div class="gi-create-lib-actions">
        <button class="nsl-btn" data-act="cancel">Cancelar</button>
        <button class="nsl-btn nsl-btn--primary" data-act="create">Crear</button>
      </div>
    </div>`;
  const input = container.querySelector('.gi-create-lib-name');
  setTimeout(() => input?.focus(), 50);
  const restore = () => {
    const sel = q('#gi-lib-select');
    if (sel) sel.value = activeScope;
    repaint();
  };
  const create = async () => {
    const n = (input.value || '').trim();
    if (!n) { input.focus(); return; }
    try {
      const lib = await createLibrary(n);
      if (lib && lib.id) setActiveLibraryId(lib.id);
      window.dispatchEvent(new CustomEvent('livepads:libraries-changed'));
      window.showToast?.(`Librería "${n}" creada.`, 'success');
    } catch (e) {
      window.showToast?.('No se pudo crear la librería: ' + (e.message || e), 'error');
      restore();
    }
  };
  container.querySelector('[data-act="cancel"]').onclick = restore;
  container.querySelector('[data-act="create"]').onclick = create;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); create(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
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

  // Online: lista fresca de Supabase (se cachea en disco). Offline / sin red:
  // caemos a la última lista cacheada para que el desplegable SIGA disponible
  // (antes desaparecía al fallar el fetch, aunque las canciones sí cargaban).
  let libs = [];
  try {
    libs = (await listLibraries()) || [];
  } catch (_) {
    libs = getCachedLibraries() || [];
  }
  // Por si el fetch devolvió vacío por un hipo de red pero hay caché previa.
  if (!libs.length) {
    const cached = getCachedLibraries();
    if (cached && cached.length) libs = cached;
  }
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
