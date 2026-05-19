// Mixer-row wiring: pad volume/pan, drum master volume/pan, LPF filter,
// and the master volume. Each control has both a "stage" (visible on the
// main UI) and a "sidebar" (mirror inside the settings drawer) version;
// changing either updates engine state AND syncs the other view.
//
// Only dependency from app.js is the audio engine, exposed via getEngine().

import { q } from '../utils/dom.js';
import { panShort } from '../utils/format.js';
import { syncSlider, syncPanSlider, bindToggle } from '../utils/sliders.js';

export function bindMixerControls(deps) {
  const engine = deps.getEngine();

  // Pad volume (stage + sidebar mirror)
  const pvolStage = q('#pad-vol-stage'), pvolValStage = q('#pad-vol-val-stage');
  const pvol = q('#pad-vol'), pvolVal = q('#pad-vol-val');
  const updatePadVol = val => {
    engine.setPadVolume(val / 100);
    if (pvol) { pvol.value = val; pvolVal.textContent = val + '%'; syncSlider(pvol); }
    if (pvolStage) { pvolStage.value = val; pvolValStage.textContent = val + '%'; syncSlider(pvolStage); }
  };
  if (pvolStage) pvolStage.oninput = () => updatePadVol(pvolStage.value);
  if (pvol) pvol.oninput = () => updatePadVol(pvol.value);
  if (pvol) syncSlider(pvol);
  if (pvolStage) syncSlider(pvolStage);

  // Pad pan
  const ppanStage = q('#pad-pan-stage'), ppanValStage = q('#pad-pan-val-stage');
  const ppan = q('#pad-pan'), ppanVal = q('#pad-pan-val');
  const updatePadPan = val => {
    engine.setPadPan(val / 100);
    if (ppan) { ppan.value = val; ppanVal.textContent = panShort(val); syncPanSlider(ppan); }
    if (ppanStage) { ppanStage.value = val; ppanValStage.textContent = panShort(val); syncPanSlider(ppanStage); }
  };
  if (ppanStage) ppanStage.oninput = () => updatePadPan(ppanStage.value);
  if (ppan) ppan.oninput = () => updatePadPan(ppan.value);
  if (ppanStage) updatePadPan(ppanStage.value);

  // Drum master volume (drumGain node — all pads together)
  const drumMasterVolStage    = q('#drum-master-vol-stage');
  const drumMasterVolValStage = q('#drum-master-vol-val-stage');
  const drumMasterVol         = q('#drum-master-vol');
  const drumMasterVolVal      = q('#drum-master-vol-val');
  const updateDrumMasterVol = val => {
    engine.setDrumVolume(val / 100);
    if (drumMasterVolStage) { drumMasterVolStage.value = val; drumMasterVolValStage.textContent = val + '%'; syncSlider(drumMasterVolStage); }
    if (drumMasterVol)      { drumMasterVol.value = val;      drumMasterVolVal.textContent      = val + '%'; syncSlider(drumMasterVol); }
  };
  if (drumMasterVolStage) drumMasterVolStage.oninput = () => updateDrumMasterVol(drumMasterVolStage.value);
  if (drumMasterVol)      drumMasterVol.oninput      = () => updateDrumMasterVol(drumMasterVol.value);
  updateDrumMasterVol(80); // matches engine default

  // Drum pan
  const drumPanStage = q('#drum-pan-stage'), drumPanVal = q('#drum-pan-val-stage');
  const updateDrumPan = () => {
    engine.setDrumPan(drumPanStage.value / 100);
    drumPanVal.textContent = panShort(drumPanStage.value);
    syncPanSlider(drumPanStage);
  };
  drumPanStage.oninput = updateDrumPan;
  updateDrumPan();

  // LPF on the pad bus
  const lpfStage = q('#pad-lpf-stage'), lpfToggleStage = q('#lpf-toggle-stage');
  const lpf = q('#pad-lpf'), lpfToggle = q('#lpf-toggle');
  const updateLPF = (val, on) => {
    engine.setLPF(parseInt(val), on);
    if (lpf) {
      lpf.value = val;
      lpfToggle.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpf);
    }
    if (lpfStage) {
      lpfStage.value = val;
      lpfToggleStage.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpfStage);
    }
  };
  if (lpfStage) {
    lpfStage.oninput = () => updateLPF(lpfStage.value, lpfToggleStage.classList.contains('on'));
    bindToggle(lpfToggleStage, on => updateLPF(lpfStage.value, on));
  }
  if (lpf) {
    lpf.oninput = () => updateLPF(lpf.value, lpfToggle.classList.contains('on'));
    bindToggle(lpfToggle, on => updateLPF(lpf.value, on));
    syncSlider(lpf);
  }
  if (lpfStage) syncSlider(lpfStage);

  // Master volume (final stage)
  const mvol = q('#master-vol'), mvolVal = q('#master-vol-val');
  mvol.oninput = () => {
    engine.setMasterVolume(mvol.value / 100);
    mvolVal.textContent = mvol.value + '%';
    syncSlider(mvol);
  };
  syncSlider(mvol);
}
