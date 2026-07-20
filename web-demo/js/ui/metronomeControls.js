// Metronome control wiring: play/stop, BPM (slider + numeric + tap + click-to-
// edit inline input), time signature, multiplier (1x/2x), click-sound select,
// volume/pan sliders, and the notation (sharps/flats) dropdown.
//
// Depends on `metro` (the Metronome instance) and `engine` for the click-sound
// decoder. Both come in via getters. The notation toggle also calls back into
// app.js's buildKeyGrid because the key row needs a redraw to reflect the new
// label set.

import { q } from '../utils/dom.js';
import { panShort } from '../utils/format.js';
import { syncSlider, syncPanSlider } from '../utils/sliders.js';
import { buildMetroBeatDots } from './metroBeatDots.js';
import { setUseFlats } from '../state/store.js';

/**
 * @param {Object} deps
 *   - getEngine     () => SynthEngine
 *   - getMetro      () => Metronome
 *   - toggleMetro   ()                  — play/stop callback (lives in app.js)
 *   - applyBpm      (n)                 — BPM apply callback (lives in app.js)
 *   - buildKeyGrid  ()                  — re-render the key row after notation change
 */
export function bindMetronomeControls(deps) {
  const engine = deps.getEngine();
  const metro = deps.getMetro();

  // Start/Stop
  q('#btn-metro-main').onclick = deps.toggleMetro;

  // BPM controls — all delegate to the app.js-level applyBpm() helper.
  const bpmSlider = q('#bpm-slider'), bpmDisp = q('#bpm-display');
  bpmSlider.oninput = () => deps.applyBpm(parseInt(bpmSlider.value));
  q('#bpm-minus').onclick = () => deps.applyBpm(metro.bpm - 1);
  q('#bpm-plus').onclick  = () => deps.applyBpm(metro.bpm + 1);
  q('#tap-tempo').onclick = () => deps.applyBpm(metro.tap());
  syncSlider(bpmSlider);
  q('#metro-bpm-live').textContent = metro.bpm + ' BPM';

  // Click-to-edit inline BPM. Replaces the visible number with an <input>
  // bound to commit on blur/Enter, cancel on Escape.
  bpmDisp.style.cursor = 'pointer';
  bpmDisp.title = 'Hacer clic para editar BPM';
  bpmDisp.onclick = () => {
    if (q('#bpm-inline-input')) return; // already editing

    const currentBpm = metro.bpm;
    const input = document.createElement('input');
    input.id = 'bpm-inline-input';
    input.type = 'text';
    input.value = currentBpm;

    bpmDisp.innerHTML = '';
    bpmDisp.appendChild(input);
    input.focus();
    input.select();

    const commitChange = () => {
      let val = parseInt(input.value);
      if (isNaN(val) || val < 30) val = 30;
      if (val > 300) val = 300;
      deps.applyBpm(val);
    };

    input.onblur = commitChange;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        commitChange();
      } else if (e.key === 'Escape') {
        bpmDisp.textContent = currentBpm;
      } else if (e.key.length === 1 && (e.key < '0' || e.key > '9')) {
        // Block non-digit keys (Backspace/arrows/etc fall through naturally).
        e.preventDefault();
      }
    };
  };

  // Time signature
  const sigSelect = q('#metro-sig-select');
  if (sigSelect) {
    sigSelect.value = '4'; // 4/4 default
    sigSelect.onchange = (e) => {
      const n = parseInt(e.target.value);
      metro.setBeats(n);
      buildMetroBeatDots(n);
    };
  }
  metro.setBeats(4);
  buildMetroBeatDots(4);

  // Multiplier (1x / 2x — half/double beat density without changing BPM)
  q('#btn-mult-1').onclick = () => {
    metro.multiplier = 1;
    q('#btn-mult-1').classList.add('active');
    q('#btn-mult-2').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };
  q('#btn-mult-2').onclick = () => {
    metro.multiplier = 2;
    q('#btn-mult-2').classList.add('active');
    q('#btn-mult-1').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };

  // Click sound — Select dropdown. Decodes the chosen mp3 pair on demand.
  metro.sound = 'cowbell'; // default
  const soundSelect = q('#metro-sound-select');
  if (soundSelect) {
    soundSelect.value = 'cowbell';
    soundSelect.onchange = (e) => {
      const newSound = e.target.value;
      // Fire-and-forget — by the next beat the buffers are ready.
      engine.ensureClickSound(newSound);
      metro.sound = newSound;
    };
  }

  // Metro volume
  const metroVolSlider = q('#metro-vol-slider'), metroVolVal = q('#metro-vol-val');
  metroVolSlider.oninput = () => {
    metro.volume = metroVolSlider.value / 100;
    metroVolVal.textContent = metroVolSlider.value + '%';
    syncSlider(metroVolSlider);
  };
  syncSlider(metroVolSlider);

  // Metro pan
  const metroPanSlider = q('#metro-pan-slider'), metroPanVal = q('#metro-pan-val');
  const updateMetroPan = () => {
    metro.pan = metroPanSlider.value / 100;
    metroPanVal.textContent = panShort(metroPanSlider.value);
    syncPanSlider(metroPanSlider);
  };
  metroPanSlider.oninput = updateMetroPan;
  updateMetroPan();

  // Notation (sharps / flats) — also triggers a key-grid rebuild because
  // the labels (C# vs Db, etc.) change.
  const notSelect = q('#metro-notation-select');
  if (notSelect) {
    notSelect.addEventListener('change', (e) => {
      setUseFlats(e.target.value === 'flats');
      deps.buildKeyGrid();
    });
  }
}
