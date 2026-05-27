// Inline modal dialogs (the #dialog-overlay element in index.html). Two
// flavours sharing the same DOM:
//
//   - showDialog(title, placeholder, onConfirm) — single-input prompt
//     (used by "Nuevo kit", "Guardar set", etc.)
//   - confirmDialog({ title, message, confirmLabel, danger, onConfirm })
//     — yes/no confirmation, replacing the browser-native `confirm()`
//     that looks foreign in the app's themed UI.
//
// The markup lives in the HTML so styling shares the rest of the app's
// modal vocabulary (overlay blur, box border, button row).

import { q } from '../utils/dom.js';

// Cerrar con Escape (se registra una sola vez). Si hay botón Cancelar visible
// con handler, lo dispara (respeta onCancel); si no, solo oculta.
let escWired = false;
function wireDialogEsc() {
  if (escWired) return; escWired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = q('#dialog-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    e.preventDefault();
    const cancelBtn = q('#dialog-cancel');
    if (cancelBtn && typeof cancelBtn.onclick === 'function') cancelBtn.onclick();
    else hideDialog();
  });
}

function resetDialogChrome() {
  const msg   = q('#dialog-message');
  const input = q('#dialog-name');
  const okBtn = q('#dialog-ok');
  if (msg)   { msg.classList.add('hidden'); msg.textContent = ''; }
  if (input) { input.classList.remove('hidden'); input.value = ''; }
  if (okBtn) { okBtn.classList.remove('d-ok--danger'); okBtn.textContent = 'Guardar'; }
  const cancel = q('#dialog-cancel');
  if (cancel) cancel.onclick = hideDialog; // limpia handler previo; confirmDialog lo sobreescribe
}

export function showDialog(title, placeholder = 'Nombre…', onConfirm = null) {
  const titleEl = q('#dialog-title');
  const overlay = q('#dialog-overlay');
  const input = q('#dialog-name');
  if (!titleEl || !overlay || !input) return;

  resetDialogChrome();
  wireDialogEsc();
  titleEl.textContent = title;
  overlay.classList.remove('hidden');
  input.placeholder = placeholder;
  setTimeout(() => input.focus(), 50);

  if (onConfirm) {
    const okBtn = q('#dialog-ok');
    if (okBtn) {
      okBtn.onclick = () => {
        onConfirm(input.value.trim());
        hideDialog();
      };
    }
  }
}

/**
 * Yes/no confirmation modal — drop-in replacement for browser `confirm()`.
 *
 * @param {Object} opts
 *   - title         {string}
 *   - message       {string}  body text shown under the title
 *   - confirmLabel  {string}  optional, defaults to 'Eliminar'
 *   - danger        {boolean} optional, paints OK button red (destructive)
 *   - onConfirm     {Function} fires on OK
 *   - onCancel      {Function} optional, fires on Cancel
 */
export function confirmDialog({ title, message, confirmLabel = 'Eliminar', danger = true, onConfirm, onCancel }) {
  const titleEl  = q('#dialog-title');
  const overlay  = q('#dialog-overlay');
  const msgEl    = q('#dialog-message');
  const input    = q('#dialog-name');
  const okBtn    = q('#dialog-ok');
  const cancelBtn = q('#dialog-cancel');
  if (!titleEl || !overlay || !msgEl || !input || !okBtn || !cancelBtn) return;

  resetDialogChrome();
  wireDialogEsc();
  titleEl.textContent = title;
  msgEl.textContent = message;
  msgEl.classList.remove('hidden');
  input.classList.add('hidden');
  okBtn.textContent = confirmLabel;
  if (danger) okBtn.classList.add('d-ok--danger');

  overlay.classList.remove('hidden');
  setTimeout(() => okBtn.focus(), 50);

  okBtn.onclick = () => {
    if (typeof onConfirm === 'function') onConfirm();
    hideDialog();
  };
  cancelBtn.onclick = () => {
    if (typeof onCancel === 'function') onCancel();
    hideDialog();
  };
}

/** Promise wrapper around confirmDialog — resolves true on OK, false on Cancel. */
export function confirmDialogAsync(opts) {
  return new Promise(resolve => {
    confirmDialog({
      ...opts,
      onConfirm: () => resolve(true),
      onCancel:  () => resolve(false),
    });
  });
}

export function hideDialog() {
  const overlay = q('#dialog-overlay');
  if (overlay) overlay.classList.add('hidden');
}
