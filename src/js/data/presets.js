// Preset store — saved snapshots of (pad bank, kit, key, bpm) the user can
// recall in one click. State is module-private; app.js gathers the current
// snapshot when saving and applies the recalled snapshot via the onApply
// callback injected at boot.

import { q, esc } from '../utils/dom.js';

let presets = [];
let onApplyCb = null;

export function initPresets({ onApply } = {}) {
  onApplyCb = onApply || null;
}

export const getPresets = () => presets;

export async function loadPresets() {
  if (!window.electronAPI || !window.electronAPI.loadPresets) return;
  const p = await window.electronAPI.loadPresets();
  presets = p || [];
  renderPresets();
}

export function addPreset(preset) {
  presets.push(preset);
  renderPresets();
  if (window.electronAPI && window.electronAPI.savePreset) {
    window.electronAPI.savePreset(preset);
  }
}

export function deletePresetById(id) {
  presets = presets.filter(p => p.id !== id);
  renderPresets();
  if (window.electronAPI && window.electronAPI.deletePreset) {
    window.electronAPI.deletePreset(id);
  }
}

const ICON_PLAY   = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5,3 19,12 5,21"/></svg>';
const ICON_TRASH  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14" style="pointer-events:none;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

export function renderPresets() {
  const list = q('#setlist-list');
  if (!list) return;
  list.innerHTML = '';

  if (!presets.length) {
    list.innerHTML = '<div class="setlist-empty">No hay sets guardados</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  presets.forEach(p => {
    const el = document.createElement('div');
    el.className = 'preset-item';
    el.innerHTML = `
      <div class="preset-info">
        <div class="preset-item-name">${esc(p.name)}</div>
        <div class="preset-item-meta">${esc(p.key) || '—'} · ${esc(p.bpm)} BPM</div>
      </div>
      <div class="preset-actions">
        <button class="pi-play">${ICON_PLAY}</button>
        <button class="pi-delete" title="Eliminar">${ICON_TRASH}</button>
      </div>
    `;

    const applyHandler = () => { if (onApplyCb) onApplyCb(p); };
    el.querySelector('.preset-info').onclick = applyHandler;
    el.querySelector('.pi-play').onclick = (e) => { e.stopPropagation(); applyHandler(); };
    el.querySelector('.pi-delete').onclick = (e) => {
      e.stopPropagation();
      if (confirm(`¿Estás seguro de que deseas eliminar el preset "${p.name}"?`)) {
        deletePresetById(p.id);
      }
    };
    fragment.appendChild(el);
  });
  list.appendChild(fragment);
}
