// Drum-kit CRUD UI bindings: create / edit / delete custom kits.
//
// The three buttons live in the bank-row next to the kit dropdown. Their
// behavior touches:
//   - KIT_BANKS (the live banks array — mutated to add/remove custom kits)
//   - saveCustomKitsToStorage() to persist
//   - Edit mode toggle, which both renames the active kit AND flips the
//     drum-grid pads into a `contentEditable` rename mode (handled by
//     drumGrid.js via getIsEditKitMode() from the store)
//
// The only app.js dependency we accept as deps are the two callbacks that
// rebuild the bank dropdowns + select a new active kit, because those
// touch state (engine.setDrumKit, padBankIdx tracking) that lives in app.js.

import { q } from '../utils/dom.js';
import { KIT_BANKS } from '../data/banks.js';
import { showDialog } from './dialog.js';
import { createEmptyCustomKit, saveCustomKitsToStorage } from '../data/customKits.js';
import {
  getKitBankIdx,
  getIsEditKitMode, setIsEditKitMode,
} from '../state/store.js';

let deps = null;

/**
 * @param {Object} d
 *   - buildBankSelects ()       — rebuild the pad+kit <select> options
 *   - loadKitBank      (idx)    — switch to a kit by index
 */
export function bindKitControls(d) {
  deps = d;

  const btnCreateKit = q('#btn-create-kit');
  if (btnCreateKit) {
    btnCreateKit.onclick = () => {
      // Exit edit mode first so contentEditable pads don't steal focus from the dialog
      if (getIsEditKitMode()) {
        const btnEditKit = q('#btn-edit-kit');
        if (btnEditKit) btnEditKit.click();
      }
      showDialog('Nuevo kit de batería', 'Ej. Worship Acoustic', (name) => {
        if (!name || !name.trim()) return;
        KIT_BANKS.unshift(createEmptyCustomKit(name.trim()));
        saveCustomKitsToStorage();
        deps.buildBankSelects();
        deps.loadKitBank(0);
      });
    };
  }

  const btnDeleteKit = q('#btn-delete-kit');
  if (btnDeleteKit) {
    btnDeleteKit.onclick = () => {
      const currentKit = KIT_BANKS[getKitBankIdx()];
      if (!currentKit || !currentKit.isCustom) return;
      if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el kit "${currentKit.name}"?`)) {
        KIT_BANKS.splice(getKitBankIdx(), 1);
        saveCustomKitsToStorage();
        deps.buildBankSelects();
        deps.loadKitBank(0);
      }
    };
  }

  const btnEditKit = q('#btn-edit-kit');
  if (btnEditKit) {
    btnEditKit.onclick = () => {
      const currentKit = KIT_BANKS[getKitBankIdx()];
      if (!currentKit || !currentKit.isCustom) {
        alert('Selecciona un kit personalizado primero.');
        return;
      }

      setIsEditKitMode(!getIsEditKitMode());
      btnEditKit.style.color = getIsEditKitMode() ? 'var(--blue)' : 'var(--text-muted)';
      btnEditKit.style.borderColor = getIsEditKitMode() ? 'var(--blue)' : 'transparent';
      if (getIsEditKitMode()) {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="18" height="18"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="18" height="18"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      }

      const kitSelect = q('#kit-bank-select');
      const selectWrapper = kitSelect.parentElement;

      if (getIsEditKitMode()) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'edit-kit-name-input';
        input.className = 'metro-dropdown';
        input.style.width = '100%';
        input.style.border = '1px solid var(--blue)';
        input.value = currentKit.name;
        kitSelect.style.display = 'none';
        selectWrapper.insertBefore(input, kitSelect);
        input.focus();
      } else {
        const input = q('#edit-kit-name-input');
        if (input) {
          const newName = input.value.trim() || 'Custom Kit';
          currentKit.name = newName;
          saveCustomKitsToStorage();
          input.remove();
        }
        kitSelect.style.display = 'block';
        deps.buildBankSelects();
        kitSelect.value = getKitBankIdx();
      }

      // Flip the drum pads into rename mode in parallel.
      document.querySelectorAll('.drum-btn').forEach(b => {
        const lbl = b.querySelector('.drum-label');
        if (getIsEditKitMode()) {
          b.classList.add('edit-pulse');
          if (lbl) lbl.contentEditable = true;
        } else {
          b.classList.remove('edit-pulse');
          if (lbl) lbl.contentEditable = false;
        }
      });
    };
  }
}
