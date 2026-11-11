// Tiny undo/redo stack for the Stems workspace. Each entry carries an
// explicit undo + redo function so we don't have to snapshot the full
// project state (which would be expensive with marker arrays + tracks).
//
// The workspace calls pushHistory(label, undoFn, redoFn) AFTER applying
// a change. Pressing Ctrl+Z pops the top of the undo stack, runs its
// `undo`, and moves it to the redo stack; Ctrl+Y / Ctrl+Shift+Z reverses.

const MAX_HISTORY = 200;
const undoStack = [];
const redoStack = [];

// Avisos de cambio (para los botones Deshacer/Rehacer y la lista de pasos).
const listeners = new Set();
function changed() { for (const fn of listeners) { try { fn(); } catch (_) {} } }
/** Suscribe a los cambios del historial. Devuelve la función para darse de baja. */
export function onHistoryChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Pasos que se pueden deshacer, del más reciente al más antiguo. */
export function undoLabels() { return undoStack.map((e) => e.label).reverse(); }
/** Pasos que se pueden rehacer, del próximo en adelante. */
export function redoLabels() { return redoStack.map((e) => e.label).reverse(); }

export function pushHistory(label, undoFn, redoFn) {
  if (typeof undoFn !== 'function' || typeof redoFn !== 'function') return;
  undoStack.push({ label, undo: undoFn, redo: redoFn });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  // Any new action invalidates the forward history.
  redoStack.length = 0;
  changed();
}

export function undo() {
  if (!undoStack.length) return null;
  const entry = undoStack.pop();
  try { entry.undo(); } catch (e) { console.warn('Undo failed:', e); }
  redoStack.push(entry);
  changed();
  return entry.label;
}

export function redo() {
  if (!redoStack.length) return null;
  const entry = redoStack.pop();
  try { entry.redo(); } catch (e) { console.warn('Redo failed:', e); }
  undoStack.push(entry);
  changed();
  return entry.label;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  changed();
}
