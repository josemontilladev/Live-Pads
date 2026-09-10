// Per-pad drum volume. The canonical slider lives in the (hidden) #drum-volumes
// tray — MIDI mappings and the engine hook onto it by id — and each drum tile
// carries a mirrored slider the user actually touches. Both stay in sync.
//
// Decoupled from app.js's `engine`/`syncSlider` globals via initDrumVolumes().

import { q, esc } from '../utils/dom.js';

let deps = {
  getEngine:  () => null,
  syncSlider: () => {}
};

export function initDrumVolumes(injected) {
  deps = { ...deps, ...injected };
}

// Must run after buildDrumGrid(): it looks up the tile sliders it mirrors.
export function buildDrumVolumes(pads) {
  const container = q('#drum-volumes');
  if (!container) return;
  container.innerHTML = '';

  for (const pad of pads) {
    const item = document.createElement('div');
    item.className = 'drum-vol-item';
    item.innerHTML = `
      <div class="drum-vol-header">
        <label id="lbl-dvol-text-${pad.id}">${esc(pad.label)}</label>
        <span class="drum-vol-pct" id="dpct-${pad.id}">80%</span>
      </div>
      <input type="range" min="0" max="100" value="80" id="dvol-${pad.id}">`;
    container.appendChild(item);

    const slider = item.querySelector('input');
    const pctEl  = item.querySelector('.drum-vol-pct');
    const tile   = q(`#drum-grid .drum-btn[data-drum="${pad.id}"]`);
    const tileSlider = tile ? tile.querySelector('.drum-tile-slider') : null;
    const tilePct    = tile ? tile.querySelector('.drum-tile-pct') : null;

    const writeAll = (val) => {
      const engine = deps.getEngine();
      if (engine) engine.setDrumPadVolume(pad.id, val / 100);
      pctEl.textContent = val + '%';
      if (tilePct) tilePct.textContent = val + '%';
    };

    slider.oninput = function () {
      writeAll(this.value);
      deps.syncSlider(this);
      if (tileSlider) { tileSlider.value = this.value; deps.syncSlider(tileSlider); }
    };
    if (tileSlider) {
      tileSlider.oninput = function () {
        writeAll(this.value);
        slider.value = this.value;
        deps.syncSlider(this);
        deps.syncSlider(slider);
      };
      deps.syncSlider(tileSlider);
    }
    deps.syncSlider(slider);
  }
}
