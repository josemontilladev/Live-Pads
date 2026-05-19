// Per-pad drum volume sliders. Each drum pad gets two mirrored sliders:
// one in the main stage (#drum-volumes) and one in the sidebar
// (#sidebar-drum-volumes). Sliders stay in sync with each other.
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

export function buildDrumVolumes(pads) {
  const container = q('#drum-volumes');
  const sbContainer = q('#sidebar-drum-volumes');
  if (!container || !sbContainer) return;
  container.innerHTML = '';
  sbContainer.innerHTML = '';

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

    const sbItem = document.createElement('div');
    sbItem.className = 'sb-row';
    sbItem.style.padding = '0';
    sbItem.innerHTML = `<span class="sr-label" id="sb-lbl-dvol-text-${pad.id}" style="min-width:70px;">${esc(pad.label)}</span>
      <input type="range" min="0" max="100" value="80" id="sb-dvol-${pad.id}" class="blue-slider">
      <span class="sr-val" id="sb-dpct-${pad.id}">80%</span>`;
    sbContainer.appendChild(sbItem);

    const slider   = item.querySelector('input');
    const sbSlider = sbItem.querySelector('input');
    const pctEl    = item.querySelector('.drum-vol-pct');
    const sbPctEl  = sbItem.querySelector('.sr-val');

    // Pre-cache refs so each oninput tick avoids re-querying the DOM.
    const writeBoth = (val) => {
      const engine = deps.getEngine();
      if (engine) engine.setDrumPadVolume(pad.id, val / 100);
      pctEl.textContent = val + '%';
      sbPctEl.textContent = val + '%';
    };

    slider.oninput = function () {
      writeBoth(this.value);
      sbSlider.value = this.value;
      deps.syncSlider(this);
      deps.syncSlider(sbSlider);
    };
    sbSlider.oninput = function () {
      writeBoth(this.value);
      slider.value = this.value;
      deps.syncSlider(this);
      deps.syncSlider(slider);
    };

    deps.syncSlider(slider);
    deps.syncSlider(sbSlider);
  }
}
