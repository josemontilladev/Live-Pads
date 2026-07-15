// Visual beat dots row for the metronome (the small circles above the BPM
// that pulse on each beat and let the user toggle accents per beat).

import { q } from '../utils/dom.js';

let metroRef = null;
// Nodos .beat-dot cacheados al construirlos + cuál está "on" ahora. Evita
// re-escanear el DOM (querySelectorAll + forEach sobre TODOS) en cada beat, que
// con BPM alto x2 corre ~6 veces/seg durante toda la sesión.
let dots = [];
let lastOnBeat = -1;
let mainBtn = null; // botón grande de Play (cacheado) para el pulso de tempo

// Inject the metronome instance once at boot. Lets the dots stay decoupled
// from app.js's `let metro` global.
export function initMetroBeatDots(metro) {
  metroRef = metro;
}

export function buildMetroBeatDots(n) {
  const c = q('#metro-beat-dots');
  if (!c) return;
  c.innerHTML = '';
  dots = [];
  lastOnBeat = -1;
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
    dots.push(d);
  }
}

// Called by the metronome scheduler on each beat — pulses the matching dot
// and refreshes the live BPM display.
export function onMetroBeat(beat) {
  // Apagar solo el punto anterior y encender el nuevo (2 toques de clase),
  // usando los nodos cacheados.
  if (lastOnBeat >= 0 && dots[lastOnBeat]) dots[lastOnBeat].classList.remove('on');
  if (dots[beat]) dots[beat].classList.add('on');
  lastOnBeat = beat;
  const live = q('#metro-bpm-live');
  if (live && metroRef) live.textContent = metroRef.bpm + ' BPM';

  // Pulso de tempo en el botón grande de Play: referencia visual del beat en la
  // vista principal (aunque el click esté en silencio). El tiempo 1 (downbeat)
  // late más fuerte con glow. Reflow para reiniciar la animación en cada beat;
  // es UN solo elemento, coste despreciable.
  if (!mainBtn) mainBtn = q('#btn-metro-main');
  if (mainBtn) {
    mainBtn.classList.remove('beat-pulse', 'beat-pulse--down');
    void mainBtn.offsetWidth;
    mainBtn.classList.add(beat === 0 ? 'beat-pulse--down' : 'beat-pulse');
  }
}
