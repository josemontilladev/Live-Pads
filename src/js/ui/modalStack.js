// Gestor centralizado de "qué modal está arriba" para que Escape cierre
// SIEMPRE el más reciente (LIFO) sin que cada panel registre su propio
// keydown global.
//
// Reemplaza el patrón `window.__escX = true; addEventListener('keydown', ...)`
// que vivía en companionPanel / mappingsList / preflight: con ese patrón,
// abrir A y luego B dejaba ambos handlers activos compitiendo por Escape.
//
// Uso:
//   import { pushModal } from './modalStack.js';
//   ...
//   const pop = pushModal(() => closeMyModal());
//   // luego, en closeMyModal():
//   pop();
//
// El handler global vive una sola vez en capture phase (gana a listeners
// component-level), no toca el evento si la pila está vacía.

const stack = [];
let installed = false;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusablesIn(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
}

function onKey(e) {
  if (!stack.length) return;
  const top = stack[stack.length - 1];

  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    try { top.onEscape(); } catch (_) {}
    return;
  }

  // Focus-trap: con un modal abierto, Tab cicla SOLO entre sus elementos
  // enfocables (antes el foco se escapaba a la UI de fondo, que seguía siendo
  // enfocable — desorientador para teclado).
  if (e.key === 'Tab' && top.rootEl) {
    const items = focusablesIn(top.rootEl);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !top.rootEl.contains(active);
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKey, true);
}

// onEscape: callback de cierre (LIFO). rootEl (opcional): el elemento raíz del
// modal — si se pasa, Tab queda atrapado dentro de él.
export function pushModal(onEscape, rootEl = null) {
  install();
  const entry = { onEscape, rootEl };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function topModal() { return stack[stack.length - 1] || null; }
export function modalDepth() { return stack.length; }
