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

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (!stack.length) return;
  const top = stack[stack.length - 1];
  e.stopPropagation();
  e.preventDefault();
  try { top.onEscape(); } catch (_) {}
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKey, true);
}

export function pushModal(onEscape) {
  install();
  const entry = { onEscape };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function topModal() { return stack[stack.length - 1] || null; }
export function modalDepth() { return stack.length; }
