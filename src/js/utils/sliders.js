// Visual fill helpers for the range inputs used across the app.
// Both paint a blue progress portion on the slider track using a linear
// gradient — purely visual, no audio side-effects.

// Linear "0 → value" fill (volume, BPM, master vol, etc.).
export function syncSlider(el) {
  if (!el) return;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  // El tema «Consola» dibuja su propio relleno a partir de este porcentaje.
  el.style.setProperty('--pct', pct + '%');
  if (!el.classList.contains('grey-slider')) {
    el.style.background = `linear-gradient(to right,var(--blue) ${pct}%,color-mix(in srgb, var(--text) 12%, transparent) ${pct}%)`;
  }
}

// Bi-directional fill centered at 50% (used by pan sliders, where the track
// fills outward from center to indicate left/right offset).
export function syncPanSlider(el) {
  if (!el) return;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  const center = 50;
  if (pct === center) {
    el.style.background = `color-mix(in srgb, var(--text) 12%, transparent)`;
  } else if (pct < center) {
    el.style.background = `linear-gradient(to right, color-mix(in srgb, var(--text) 6%, transparent) ${pct}%, var(--blue) ${pct}%, var(--blue) ${center}%, color-mix(in srgb, var(--text) 6%, transparent) ${center}%)`;
  } else {
    el.style.background = `linear-gradient(to right, color-mix(in srgb, var(--text) 6%, transparent) ${center}%, var(--blue) ${center}%, var(--blue) ${pct}%, color-mix(in srgb, var(--text) 6%, transparent) ${pct}%)`;
  }
}

// Generic on/off toggle binding. Adds/removes `.on` class and invokes the
// callback with the new state. Used by LPF and HPF filter switches.
export function bindToggle(el, cb) {
  if (!el) return;
  el.onclick = () => {
    el.classList.toggle('on');
    cb(el.classList.contains('on'));
  };
}
