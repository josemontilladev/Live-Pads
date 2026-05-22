// Consolidated mixer bar.
//
// All volume/pan controls used to live scattered across the Pads screen
// (pad tray, drum tray, metronome footer, settings sidebar) plus the track
// player. That made them awkward to reach — and to map to a MIDI controller
// like the Worlde Panda mini, where you want every fader/knob grouped.
//
// This module does NOT re-implement any audio wiring. The original sliders
// remain in the DOM (their host containers are hidden via CSS) and keep
// driving the engine / metronome / track player exactly as before. Each
// mixer-bar control is a thin BRIDGE to its canonical slider:
//
//   mixer slider moves  → set canonical .value + dispatch 'input'
//                         (runs all existing engine wiring + mirrors)
//   canonical slider moves → mirror the value + readout back to the mixer
//
// Because the bridge forwards a real 'input' event, MIDI Learn on the mixer
// slider (generic `slider` action, mapped by id) works end-to-end.

import { q } from '../utils/dom.js';
import { panShort } from '../utils/format.js';
import { syncSlider, syncPanSlider } from '../utils/sliders.js';

// [ mixerId, canonicalId, isPan ]
const BRIDGES = [
  ['mx-pads-vol',   'pad-vol-stage',         false],
  ['mx-pads-pan',   'pad-pan-stage',         true ],
  ['mx-drums-vol',  'drum-master-vol-stage', false],
  ['mx-drums-pan',  'drum-pan-stage',        true ],
  ['mx-click-vol',  'metro-vol-slider',      false],
  ['mx-click-pan',  'metro-pan-slider',      true ],
  ['mx-track-vol',  'tp-vol',                false],
  ['mx-track-pan',  'tp-pan',                true ],
  ['mx-master-vol', 'master-vol',            false],
];

// Persist the whole mixer (vol + pan per channel) so the user's panning /
// levels survive restarts. Stored in localStorage (renderer-persistent in
// Electron) keyed by the canonical slider id.
const STORE_KEY = 'livepads:mixer-state';

function saveMixerState() {
  const state = {};
  for (const [, canonId] of BRIDGES) {
    const c = q('#' + canonId);
    if (c) state[canonId] = c.value;
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

// Apply saved values to the canonical sliders BEFORE bridges are wired, so
// the engine/metro/track player pick them up via their own oninput handlers
// and the mixer then initialises from the restored values.
function loadMixerState() {
  let state;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    state = JSON.parse(raw);
  } catch (e) { return; }
  if (!state) return;
  for (const [, canonId] of BRIDGES) {
    if (state[canonId] == null) continue;
    const c = q('#' + canonId);
    if (!c) continue;
    c.value = state[canonId];
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

let _saveTimer = null;
function queueSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveMixerState, 250);
}

function readout(mixerEl, isPan) {
  const valEl = q('#' + mixerEl.id + '-val');
  if (!valEl) return;
  valEl.textContent = isPan ? panShort(mixerEl.value) : mixerEl.value + '%';
}

function paint(el, isPan) {
  (isPan ? syncPanSlider : syncSlider)(el);
}

// Must run AFTER the canonical sliders are wired (mixerControls,
// metronomeControls, bindTrackPlayerControls) so their oninput handlers
// exist for our dispatched events and their initial values are set.
export function bindMixerBar() {
  // Restore saved levels/pans first (applies to the engine via the canonical
  // sliders' own handlers), then build the bridges off those values.
  loadMixerState();

  for (const [mixerId, canonId, isPan] of BRIDGES) {
    const m = q('#' + mixerId);
    const c = q('#' + canonId);
    if (!m || !c) continue;

    // mixer → canonical (forward a real input event so all existing wiring
    // and the canonical's own stage/sidebar mirrors fire).
    m.oninput = () => {
      c.value = m.value;
      c.dispatchEvent(new Event('input', { bubbles: true }));
      readout(m, isPan);
      paint(m, isPan);
    };

    // canonical → mixer (mirror back; set value WITHOUT dispatching so we
    // don't loop). Covers the case where the user (or MIDI) drives the old
    // hidden slider, or a cross-workspace event moves master volume. This is
    // also the single funnel where we persist — it fires for every path
    // (mixer drag, MIDI, direct canonical change).
    c.addEventListener('input', () => {
      if (m.value !== c.value) m.value = c.value;
      readout(m, isPan);
      paint(m, isPan);
      queueSave();
    });

    // Initialise the mixer control from the canonical's current value.
    m.value = c.value;
    readout(m, isPan);
    paint(m, isPan);
  }
}
