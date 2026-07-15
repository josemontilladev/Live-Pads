// Mixer-row wiring: pad volume/pan, drum master volume/pan, LPF filter,
// and the master volume. Each control has both a "stage" (visible on the
// main UI) and a "sidebar" (mirror inside the settings drawer) version;
// changing either updates engine state AND syncs the other view.
//
// Only dependency from app.js is the audio engine, exposed via getEngine().

import { q } from '../utils/dom.js';
import { panShort } from '../utils/format.js';
import { syncSlider, syncPanSlider, bindToggle } from '../utils/sliders.js';
import { setTrackMasterVolume } from '../audio/trackPlayer.js';

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

  // Master volume (final stage). Synced cross-workspace via the
  // `livepads:master-vol-change` event so Stems' master slider mirrors
  // this one and vice versa.
  const mvol = q('#master-vol'), mvolVal = q('#master-vol-val');
  // "Maestro" = master REAL sobre TODO: el SynthEngine (pads/batería/click) Y la
  // Pista (que vive en su propio AudioContext). Antes solo tocaba el SynthEngine,
  // así que con la Pista sonando el fader/mute no hacían nada.
  const setMaster = (v) => { engine.setMasterVolume(v); setTrackMasterVolume(v); };
  // Mute maestro: corta TODO el audio sin perder la posición del fader. Vive en
  // ambos controles (sidebar + mixer); arrastrar el fader lo des-mutea solo.
  const muteBtns = Array.from(document.querySelectorAll('.master-mute-btn'));
  let masterMuted = false;
  const applyMasterMute = (on) => {
    masterMuted = on;
    setMaster(on ? 0 : (mvol.value / 100));
    mvol.classList.toggle('is-muted', on);
    muteBtns.forEach(b => { b.classList.toggle('is-muted', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  };
  muteBtns.forEach(b => b.addEventListener('click', () => applyMasterMute(!masterMuted)));
  mvol.oninput = () => {
    if (masterMuted) applyMasterMute(false);   // mover el fader restaura el sonido
    setMaster(mvol.value / 100);
    mvolVal.textContent = mvol.value + '%';
    syncSlider(mvol);
    document.dispatchEvent(new CustomEvent('livepads:master-vol-change', {
      detail: { value: mvol.value / 100, source: 'pads' }
    }));
  };
  syncSlider(mvol);
  document.addEventListener('livepads:master-vol-change', (e) => {
    if (e.detail.source === 'pads') return; // avoid echo
    const pct = Math.round(e.detail.value * 100);
    mvol.value = pct;
    mvolVal.textContent = pct + '%';
    if (masterMuted) applyMasterMute(false);
    setMaster(e.detail.value);
    syncSlider(mvol);
  });

  // Crossfade de pads: el slider guarda décimas de segundo (5..40 → 0.5..4.0s).
  // Persistido en localStorage para que la preferencia sobreviva reinicios.
  const xf = q('#pad-crossfade'), xfVal = q('#pad-crossfade-val');
  if (xf) {
    const XF_KEY = 'livepads:pad-crossfade';
    const applyXf = (tenths, persist) => {
      const secs = tenths / 10;
      engine.setCrossfade(secs);
      xf.value = tenths;
      if (xfVal) xfVal.textContent = secs.toFixed(1) + ' s';
      syncSlider(xf);
      if (persist) { try { localStorage.setItem(XF_KEY, String(tenths)); } catch (_) {} }
    };
    let saved = 20;
    try { const v = parseInt(localStorage.getItem(XF_KEY), 10); if (Number.isFinite(v)) saved = Math.max(5, Math.min(40, v)); } catch (_) {}
    applyXf(saved, false);
    xf.oninput = () => applyXf(parseInt(xf.value, 10) || 20, true);
  }
}
