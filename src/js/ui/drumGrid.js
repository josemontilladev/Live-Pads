// Drum pad grid — builds the 8 drum buttons, handles hits, and routes the
// "edit kit" mode flow (open sample pool modal -> assign sample).
//
// State is owned by app.js (engine instance, current kitBankIdx, edit-mode
// flag). drumGrid.js receives those via initDrumGrid({...}) so it stays
// decoupled and easy to test in isolation.

import { q, esc } from '../utils/dom.js';
import { KIT_BANKS } from '../data/banks.js';
import { KEY_MAP_DRUMS } from '../data/musicConstants.js';
import { saveCustomKitsToStorage } from '../data/customKits.js';
import { openSoundPoolModal } from './soundPoolModal.js';

let deps = {
  getEngine:      () => null,
  getKitBankIdx:  () => 0,
  isEditKit:      () => false,
  onAfterBuild:   () => {}
};

export function initDrumGrid(injected) {
  deps = { ...deps, ...injected };
}

// Resolve a drum mapping target id to a pad in the given kit. New mappings
// store the 0-based SLOT (kit-agnostic); legacy mappings stored the pad id or
// type — both still resolve so old maps keep working.
export function resolveDrumPad(kit, mapId) {
  if (!kit || !kit.pads) return null;
  const idx = Number(mapId);
  if (Number.isInteger(idx) && idx >= 0 && idx < kit.pads.length) return kit.pads[idx];
  return kit.pads.find(p => p.id === mapId) || kit.pads.find(p => p.type === mapId) || null;
}

export function buildDrumGrid(pads) {
  const grid = q('#drum-grid');
  if (!grid) return;
  grid.innerHTML = '';

  pads.forEach((pad, i) => {
    const btn = document.createElement('button');
    btn.className = 'drum-btn';
    btn.dataset.drum = pad.id;
    btn.dataset.type = pad.type;
    btn.dataset.slot = String(i); // 0-based slot — MIDI/keyboard map by slot so
                                  // bindings survive kit changes (sound changes,
                                  // mapping stays) and never collide.
    btn.innerHTML = `<span class="drum-label" spellcheck="false">${esc(pad.label)}</span><span class="kbd-hint">${KEY_MAP_DRUMS[i]}</span>`;

    if (pad.sample) btn.classList.add('has-sample');

    const lbl = btn.querySelector('.drum-label');
    lbl.addEventListener('blur', () => {
      const newLabel = lbl.textContent.trim() || 'Pad';
      if (newLabel === pad.label) return;
      pad.label = newLabel;
      const currentKit = KIT_BANKS[deps.getKitBankIdx()];
      if (currentKit && currentKit.isCustom) saveCustomKitsToStorage();
      // Mirror the new label into the volume rows below the pad.
      const mainLabel = q(`#lbl-dvol-text-${pad.id}`);
      if (mainLabel) mainLabel.textContent = pad.label;
      const sbLabel = q(`#sb-lbl-dvol-text-${pad.id}`);
      if (sbLabel) sbLabel.textContent = pad.label;
    });

    btn.onmousedown = (e) => {
      if (deps.isEditKit() && e.target === lbl) return;
      hitDrum(pad.id, pad.type, btn);
    };
    btn.addEventListener('touchstart', (e) => {
      if (deps.isEditKit() && e.target === lbl) return;
      e.preventDefault();
      hitDrum(pad.id, pad.type, btn);
    });
    // Accesibilidad: disparar con teclado al tener el pad enfocado. Usamos Enter
    // (no Espacio) a propósito — Espacio es el Play maestro global y no debe
    // dispararse un drum por tener foco en él.
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (deps.isEditKit() && e.target === lbl) return;
      e.preventDefault();
      hitDrum(pad.id, pad.type, btn);
    });

    grid.appendChild(btn);
  });

  deps.onAfterBuild();
}

export async function hitDrum(id, type, btn) {
  if (deps.isEditKit()) {
    if (!window.electronAPI) return;

    const currentKit = KIT_BANKS[deps.getKitBankIdx()];
    const kitId = currentKit ? currentKit.id : 'unknown';

    const onUploadNew = async () => {
      const fileData = await window.electronAPI.openAudioFile();
      if (!fileData || !fileData.path) return;
      const resPath = await window.electronAPI.assignDrumSample({
        sourcePath: fileData.path,
        padName: id,
        kitId: kitId
      });
      if (resPath) assignSampleToPad(id, resPath, btn);
    };

    const onAssignPool = (resPath) => assignSampleToPad(id, resPath, btn);

    const pad = currentKit ? currentKit.pads.find(p => p.id === id) : null;
    const padLabel = pad ? pad.label : 'Pad';

    openSoundPoolModal(padLabel, onAssignPool, onUploadNew);
    return;
  }

  const engine = deps.getEngine();
  if (!engine) return;
  if (!engine.playCustomDrum(id, id)) engine.playDrum(type, id);
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 120);
}

function assignSampleToPad(id, resPath, btn) {
  const currentKit = KIT_BANKS[deps.getKitBankIdx()];
  if (currentKit && currentKit.isCustom) {
    const pad = currentKit.pads.find(p => p.id === id);
    if (pad) pad.sample = resPath;
    saveCustomKitsToStorage();
  }
  const engine = deps.getEngine();
  if (!engine) return;
  engine.loadSingleDrum(id, resPath).then((success) => {
    if (success) {
      btn.classList.add('has-sample');
      const oldBg = btn.style.background;
      btn.style.background = 'var(--blue)';
      setTimeout(() => { btn.style.background = oldBg; }, 300);
    }
  });
}
