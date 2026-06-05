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

// El piano virtual de Stems registra aquí un handler de NOTAS (on/off). Cuando
// está activo y el scope es 'stems', las notas se enrutan al piano (tocar +
// grabar) en vez del learn/mapeo; los CC (faders, etc.) siguen su curso normal.
let stemsNoteHandler = null;
export function setStemsNoteHandler(fn) { stemsNoteHandler = fn; }

// Igual pero para el piano de la pantalla de PADS: cuando está abierto, las
// notas (y el sustain CC64) del controlador van al piano en vez de a los
// pads/mapeos. null = piano cerrado.
let padsNoteHandler = null;
export function setPadsNoteHandler(fn) { padsNoteHandler = fn; }
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
  const renderDevicePill = (names, evt) => {
    const pill = q('#midi-status-pill');
    // Aviso de conexión/desconexión de un controlador (no en el arranque, solo
    // en cambios reales mientras se usa la app).
    const port = evt && evt.port;
    if (port && port.type === 'input') {
      if (port.state === 'disconnected') window.showToast?.(`⚠️ MIDI desconectado: ${port.name || 'controlador'}`, 'warning');
      else if (port.state === 'connected') window.showToast?.(`🎹 MIDI conectado: ${port.name || 'controlador'}`, 'success');
    }
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
    const isNoteOff = cmd >= 128 && cmd <= 143;
    const isCC = cmd >= 176 && cmd <= 191;

    // Stems workspace owns its own (independent) MIDI map + handling.
    if (getMidiScope() === 'stems') {
      // Piano activo: pedal de sustain (CC64) → al piano antes que el learn.
      if (isCC && data1 === 64 && stemsNoteHandler) {
        stemsNoteHandler('sustain', 64, data2);
        return;
      }
      // Piano activo: las notas (on/off, o noteOn velocity 0 = off) van al piano.
      if ((isNoteOn || isNoteOff) && stemsNoteHandler) {
        const type = (isNoteOn && data2 > 0) ? 'on' : 'off';
        stemsNoteHandler(type, data1, data2);
        return;
      }
      // Resto (CC para faders/mapeos, o notas para learn) → handler de Stems.
      if (isNoteOn || isCC) {
        if (stemsMidiHandler) stemsMidiHandler(cmd, data1, data2);
      }
      return;
    }

    // Piano de Pads abierto (y NO en modo learn): las notas y el sustain van al
    // piano. Excepción: el control mapeado a "mostrar/ocultar piano" cae al flujo
    // de mapeo (así una nota/botón asignada para abrir el piano también lo cierra
    // estando abierto, en vez de tocar una nota).
    if (padsNoteHandler && !getIsMidiLearnMode()) {
      const mk = isCC ? `cc_${data1}` : `note_${data1}`;
      const isToggle = (() => { const m = getMapping(mk, data1); return m && m.action === 'toggle_piano'; })();
      if (!isToggle) {
        if (isCC && data1 === 64) { padsNoteHandler('sustain', 64, data2); return; }
        if (isNoteOn || isNoteOff) {
          padsNoteHandler((isNoteOn && data2 > 0) ? 'on' : 'off', data1, data2);
          return;
        }
      }
    }

    if (!isNoteOn && !isCC) return;
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
            // Audio FIRST (zero added latency), then the visual feedback.
            if (!engine.playCustomDrum(pad.id, pad.id)) engine.playDrum(pad.type, pad.id);
            const btn = q(`.drum-btn[data-drum="${pad.id}"]`);
            if (btn) { btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 120); }
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
        } else if (mapping.action === 'source') {
          // Selector de fuente del banner: sequence / click / reference.
          if (deps.selectSource) deps.selectSource(mapping.id);
        } else if (mapping.action === 'toggle_piano') {
          deps.togglePadsPiano?.();
        } else if (mapping.action === 'pitch_up') {
          q('#tp-pitch-up')?.click();   // transponer la pista +1 semitono
        } else if (mapping.action === 'pitch_down') {
          q('#tp-pitch-down')?.click(); // transponer la pista −1 semitono
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
    const sourceBtn = e.target.closest('.source-seg-btn');
    const pianoBtn  = e.target.closest('#btn-piano-pads');
    const pitchUpBtn   = e.target.closest('#tp-pitch-up');
    const pitchDownBtn = e.target.closest('#tp-pitch-down');
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
    else if (sourceBtn) target = { action: 'source', id: sourceBtn.dataset.source };
    else if (pianoBtn) target = { action: 'toggle_piano' };
    else if (pitchUpBtn) target = { action: 'pitch_up' };
    else if (pitchDownBtn) target = { action: 'pitch_down' };
    else if (slider && slider.id) target = { action: 'slider', id: slider.id };
    else return; // unmappable

    e.stopPropagation();
    e.preventDefault();
    setMidiLearnTarget(target);
    q('#midi-learn-overlay').innerHTML = `🎹 Esperando MIDI para: <b>${target.action.toUpperCase()} ${target.id || ''}</b>... Toca tu controlador.`;
  }, true);
}
