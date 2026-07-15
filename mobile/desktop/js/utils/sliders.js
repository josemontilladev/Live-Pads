// Visual fill helpers for the range inputs used across the app.
// Both paint a blue progress portion on the slider track using a linear
// gradient — purely visual, no audio side-effects.

// Linear "0 → value" fill (volume, BPM, master vol, etc.).
export function syncSlider(el) {
  if (!el) return;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  if (!el.classList.contains('grey-slider')) {
    el.style.background = `linear-gradient(to right,var(--blue) ${pct}%,rgba(255,255,255,.12) ${pct}%)`;
  }
}

// Bi-directional fill centered at 50% (used by pan sliders, where the track
// fills outward from center to indicate left/right offset).
export function syncPanSlider(el) {
  if (!el) return;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  const center = 50;
  if (pct === center) {
    el.style.background = `rgba(255,255,255,0.12)`;
  } else if (pct < center) {
    el.style.background = `linear-gradient(to right, rgba(255,255,255,0.06) ${pct}%, var(--blue) ${pct}%, var(--blue) ${center}%, rgba(255,255,255,0.06) ${center}%)`;
  } else {
    el.style.background = `linear-gradient(to right, rgba(255,255,255,0.06) ${center}%, var(--blue) ${center}%, var(--blue) ${pct}%, rgba(255,255,255,0.06) ${pct}%)`;
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
