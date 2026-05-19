// Visual beat dots row for the metronome (the small circles above the BPM
// that pulse on each beat and let the user toggle accents per beat).

import { q, qa } from '../utils/dom.js';

let metroRef = null;

// Inject the metronome instance once at boot. Lets the dots stay decoupled
// from app.js's `let metro` global.
export function initMetroBeatDots(metro) {
  metroRef = metro;
}

export function buildMetroBeatDots(n) {
  const c = q('#metro-beat-dots');
  if (!c) return;
  c.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    const isAccent = metroRef && metroRef.accents.includes(i);
    d.className = 'beat-dot' + (isAccent ? ' accent' : '');
    d.dataset.beat = i;
    d.title = isAccent ? 'Acento activo (Click para quitar)' : 'Click para acentuar';
    d.onclick = () => {
      if (!metroRef) return;
      metroRef.toggleAccent(i);
      const nowAccent = metroRef.accents.includes(i);
      d.classList.toggle('accent', nowAccent);
      d.title = nowAccent ? 'Acento activo (Click para quitar)' : 'Click para acentuar';
    };
    c.appendChild(d);
  }
}

// Called by the metronome scheduler on each beat — pulses the matching dot
// and refreshes the live BPM display.
export function onMetroBeat(beat) {
  qa('.beat-dot').forEach(d => {
    d.classList.toggle('on', parseInt(d.dataset.beat) === beat);
  });
  const live = q('#metro-bpm-live');
  if (live && metroRef) live.textContent = metroRef.bpm + ' BPM';
}
