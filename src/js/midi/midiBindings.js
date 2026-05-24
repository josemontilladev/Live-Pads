// MIDI input + learn-mode click interceptor.
//
// Two responsibilities, glued together because they share the learn-mode
// state machine:
//
//   1. Listen to incoming MIDI messages (NoteOn / CC). For learn-mode,
//      capture the next event as the mapping for the pending target.
//      Otherwise dispatch through the user's saved mappings (pads,
//      drums, transport, …), or fall back to a hardcoded note→pad map.
//
//   2. Listen to clicks anywhere in the document while learn-mode is
//      active, identify the clicked control, and mark it as the next
//      mapping target.
//
// State (`isMidiLearnMode`, `midiLearnTarget`, `kitBankIdx`, `useFlats`)
// lives in the central store. The app.js-local callbacks we accept as
// deps are the transport functions that haven't been extracted yet.

import { q } from '../utils/dom.js';
import { KIT_BANKS } from '../data/banks.js';
import { addMapping, getMapping, getMidiMap, deleteMapping, getMidiScope, flushMidiSync } from './midiMap.js';

// The Stems workspace registers its own MIDI message handler here. When the
// active scope is 'stems', raw MIDI is delegated to it (Pads logic is skipped
// entirely), so the two workspaces have totally independent mappings.
let stemsMidiHandler = null;
export function setStemsMidiHandler(fn) { stemsMidiHandler = fn; }
import { servicePrevSong, serviceNextSong } from '../data/service.js';
import { resolveDrumPad } from '../ui/drumGrid.js';
import {
  getKitBankIdx,
  getIsMidiLearnMode, setIsMidiLearnMode,
  getMidiLearnTarget, setMidiLearnTarget,
} from '../state/store.js';

/**
 * @param {Object} deps
 *   - getEngine             () => SynthEngine
 *   - onKeyClick            (key) — trigger a pad key (e.g. 'C', 'G#')
 *   - toggleMetro           ()    — toggle metronome run/stop
 *   - triggerMasterPlayPause ()   — master play/pause (track or pad fallback)
 *   - triggerMasterStop      ()   — master stop
 */
export function bindMidiHandlers(deps) {
  const engine = deps.getEngine();

  // Guarantee the mapping survives an app close: the per-assignment async save
  // can be dropped if the window tears down right after mapping. A synchronous
  // flush on beforeunload writes the final state to disk before exit.
  window.addEventListener('beforeunload', () => { flushMidiSync(); });

  // Render the device-name pill in the topbar. Hidden when no MIDI device
  // is connected (or before MIDI access resolves on app boot).
  const renderDevicePill = (names) => {
    const pill = q('#midi-status-pill');
    if (!pill) return;
    if (!names || names.length === 0) {
      pill.classList.add('hidden');
      pill.textContent = '';
      return;
    }
    const label = names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
    pill.textContent = label;
    pill.title = names.join(' • ');
    pill.classList.remove('hidden');
  };

  // Remove every MIDI mapping that points to the same target so a function
  // can only live on ONE controller key. Drum-aware: legacy entries keyed by
  // type/id that resolve to the same pad are cleared too.
  const clearMidiMappingsForTarget = (target) => {
    const map = getMidiMap();
    const kit = KIT_BANKS[getKitBankIdx()];
    const targetPad = (target.action === 'drum') ? resolveDrumPad(kit, target.id) : null;
    for (const key of Object.keys(map)) {
      if (key.startsWith('kbd_')) continue; // keyboard mappings are separate
      const m = map[key];
      if (!m) continue;
      let same = (m.action === target.action && m.id === target.id);
      if (!same && targetPad && m.action === 'drum') {
        const mPad = resolveDrumPad(kit, m.id);
        if (mPad && mPad.id === targetPad.id) same = true;
      }
      if (same) deleteMapping(key);
    }
  };

  engine.initMIDI(msg => {
    const [cmd, data1, data2] = msg.data;
    const isNoteOn = cmd >= 144 && cmd <= 159;
    const isCC = cmd >= 176 && cmd <= 191;

    if (!isNoteOn && !isCC) return;

    // Stems workspace owns its own (independent) MIDI map + handling.
    if (getMidiScope() === 'stems') {
      if (stemsMidiHandler) stemsMidiHandler(cmd, data1, data2);
      return;
    }
    const mapKey = isCC ? `cc_${data1}` : `note_${data1}`;

    if (getIsMidiLearnMode() && getMidiLearnTarget()) {
      if (data2 > 0) {
        const target = getMidiLearnTarget();
        // STRICT uniqueness, both directions:
        //  • one function = one MIDI control → clear any MIDI key already
        //    pointing to this target (incl. legacy drum entries that resolve
        //    to the same pad).
        //  • one MIDI control = one function → addMapping overwrites whatever
        //    this key previously triggered.
        clearMidiMappingsForTarget(target);
        addMapping(mapKey, target);
        q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado y guardado! Selecciona otro control o sal.`;
        setMidiLearnTarget(null);
      }
      return;
    }

    const mapping = getMapping(mapKey, data1);
    if (mapping) {
      if (mapping.action === 'slider') {
        const sliderEl = q('#' + mapping.id);
        if (sliderEl) {
          const min = parseFloat(sliderEl.min) || 0;
          const max = parseFloat(sliderEl.max) || 100;
          sliderEl.value = min + ((data2 / 127) * (max - min));
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }

      if (data2 > 0) {
        if (mapping.action === 'pad') {
          deps.onKeyClick(mapping.id);
        } else if (mapping.action === 'drum') {
          const kit = KIT_BANKS[getKitBankIdx()];
          if (!kit) return;
          // Resolve by slot (kit-agnostic) with legacy id/type fallback.
          const pad = resolveDrumPad(kit, mapping.id);
          if (pad) {
            const btn = q(`.drum-btn[data-drum="${pad.id}"]`);
            if (btn) btn.classList.add('hit');
            setTimeout(() => { if (btn) btn.classList.remove('hit'); }, 120);
            if (!engine.playCustomDrum(pad.id, pad.id)) engine.playDrum(pad.type, pad.id);
          }
        } else if (mapping.action === 'metro') {
          deps.toggleMetro();
        } else if (mapping.action === 'play_seq') {
          deps.triggerMasterPlayPause();
        } else if (mapping.action === 'stop_seq') {
          deps.triggerMasterStop();
        } else if (mapping.action === 'loop_seq') {
          const btn = q('#tp-loop-btn'); if (btn) btn.click();
        } else if (mapping.action === 'restart_seq') {
          const btn = q('#tp-restart-btn'); if (btn) btn.click();
        } else if (mapping.action === 'autoadvance_seq') {
          const btn = q('#tp-autoadvance-btn'); if (btn) btn.click();
        } else if (mapping.action === 'close_seq') {
          const btn = q('#tp-close-btn'); if (btn) btn.click();
        } else if (mapping.action === 'prev_song') {
          servicePrevSong();
        } else if (mapping.action === 'next_song') {
          serviceNextSong();
        }
      }
      return;
    }

    // No hardcoded/default fallback: an unmapped MIDI control does NOTHING.
    // Only the user's explicit mappings ever trigger anything — no phantom
    // pads/drums from notes the controller happens to emit.
  }, renderDevicePill);

  // Midi Learn click intercept — while learn-mode is on, the first click
  // on any mappable control marks it as the next target; the next MIDI
  // event completes the mapping.
  document.addEventListener('click', (e) => {
    if (!getIsMidiLearnMode()) return;
    // In Stems, the Stems workspace handles its own learn-target capture.
    if (getMidiScope() === 'stems' && !e.target.closest('#midi-learn-overlay')) return;

    if (e.target.closest('#midi-learn-overlay')) {
      setIsMidiLearnMode(false);
      q('#midi-learn-overlay').style.display = 'none';
      setMidiLearnTarget(null);
      document.body.classList.remove('midi-learning');
      e.stopPropagation(); e.preventDefault();
      return;
    }

    const keyBtn    = e.target.closest('.key-btn');
    const drumBtn   = e.target.closest('.drum-btn');
    const metroBtn  = e.target.closest('#btn-metro-main');
    const playSeqBtn = e.target.closest('#tp-play-btn');
    const stopSeqBtn = e.target.closest('#tp-stop-btn');
    const restartBtn = e.target.closest('#tp-restart-btn');
    const loopBtn   = e.target.closest('#tp-loop-btn');
    const autoAdvBtn = e.target.closest('#tp-autoadvance-btn');
    const closeBtn  = e.target.closest('#tp-close-btn');
    const prevBtn   = e.target.closest('#btn-service-prev');
    const nextBtn   = e.target.closest('#btn-service-next');
    const slider    = e.target.closest('input[type="range"]');

    let target = null;
    if (keyBtn)        target = { action: 'pad',       id: keyBtn.dataset.key };
    else if (drumBtn)  target = { action: 'drum',      id: drumBtn.dataset.slot };
    else if (metroBtn) target = { action: 'metro' };
    else if (playSeqBtn) target = { action: 'play_seq' };
    else if (stopSeqBtn) target = { action: 'stop_seq' };
    else if (restartBtn) target = { action: 'restart_seq' };
    else if (loopBtn)  target = { action: 'loop_seq' };
    else if (autoAdvBtn) target = { action: 'autoadvance_seq' };
    else if (closeBtn) target = { action: 'close_seq' };
    else if (prevBtn)  target = { action: 'prev_song' };
    else if (nextBtn)  target = { action: 'next_song' };
    else if (slider && slider.id) target = { action: 'slider', id: slider.id };
    else return; // unmappable

    e.stopPropagation();
    e.preventDefault();
    setMidiLearnTarget(target);
    q('#midi-learn-overlay').innerHTML = `🎹 Esperando MIDI para: <b>${target.action.toUpperCase()} ${target.id || ''}</b>... Toca tu controlador.`;
  }, true);
}
