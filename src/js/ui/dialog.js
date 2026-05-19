// Inline prompt dialog (the #dialog-overlay element in index.html). Used for
// "Nuevo kit", "Guardar set", and similar single-input prompts.
//
// Plain show/hide helpers — the markup lives in the HTML so the dialog can
// share styling with the rest of the app's modals.

import { q } from '../utils/dom.js';

export function showDialog(title, placeholder = 'Nombre…', onConfirm = null) {
  const titleEl = q('#dialog-title');
  const overlay = q('#dialog-overlay');
  const input = q('#dialog-name');
  if (!titleEl || !overlay || !input) return;

  titleEl.textContent = title;
  overlay.classList.remove('hidden');
  input.value = '';
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

export function hideDialog() {
  const overlay = q('#dialog-overlay');
  if (overlay) overlay.classList.add('hidden');
}
