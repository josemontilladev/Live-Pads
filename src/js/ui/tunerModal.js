// ─────────────────────────────────────────────────────────────────────────
// Afinador cromático (panel flotante MOVIBLE) — herramienta independiente que
// escucha el micrófono, detecta el tono y muestra la nota más cercana + la
// desviación en cents (aguja) + la frecuencia. Mismo patrón que el metrónomo:
// AudioContext propio, panel arrastrable, geometría recordada, pushModal.
//
// El micro solo se abre al abrir el afinador y se LIBERA al cerrarlo (no deja
// el micrófono activo en segundo plano).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from './modalStack.js';
import { autoCorrelate, freqToNoteInfo, NOTE_NAMES } from '../audio/pitchDetector.js';

// Presets de cuerdas al aire (MIDI, de grave a agudo). El tono de referencia se
// calcula con la calibración A4 vigente.
//   Guitarra estándar: E2 A2 D3 G3 B3 E4
//   Bajo (4 cuerdas):  E1 A1 D2 G2
//   Ukelele (gCEA):    G4 C4 E4 A4
const PRESETS = {
  guitar:  { label: 'Guitarra', midis: [40, 45, 50, 55, 59, 64] },
  bass:    { label: 'Bajo',     midis: [28, 33, 38, 43] },
  ukulele: { label: 'Ukelele',  midis: [67, 60, 64, 69] },
};
function midiLabel(midi) {
  return { name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1 };
}
function midiToFreq(midi) { return a4 * Math.pow(2, (midi - 69) / 12); }

const LS_KEY = 'livepads.tuner';       // calibración A4
const LS_POS = 'livepads.tuner.pos';   // posición/tamaño del panel

const DETECT_MS = 55;   // cada cuánto corre la autocorrelación (throttle CPU)
const HOLD_MS   = 700;  // mantiene la última nota tras callar, para no parpadear
const IN_TUNE_CENTS = 5; // |cents| <= esto → "afinado" (verde)

let a4 = 440;
let instrument = 'guitar';
(() => {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.a4) a4 = Math.max(430, Math.min(450, s.a4));
    if (s.instrument && PRESETS[s.instrument]) instrument = s.instrument;
  } catch (_) {}
})();
function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify({ a4, instrument })); } catch (_) {} }

function saveGeom(panel) {
  try {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(LS_POS, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }));
  } catch (_) {}
}
function loadGeom() { try { return JSON.parse(localStorage.getItem(LS_POS) || 'null'); } catch (_) { return null; } }

// ── Audio / micrófono ──
let ctx = null, analyser = null, source = null, stream = null, buf = null;
function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
async function startMic() {
  ensureCtx();
  // Pedimos audio "crudo": sin cancelación de eco / AGC / supresión de ruido,
  // que distorsionarían el tono real del instrumento.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
  });
  source = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);        // NO conectamos al destino: nada de monitoreo (evita feedback)
  buf = new Float32Array(analyser.fftSize);
}
function stopMic() {
  try { if (source) source.disconnect(); } catch (_) {}
  try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (_) {}
  source = null; analyser = null; stream = null; buf = null;
}

// ── Tono de referencia (cuerda punteada) ──
// En vez de un oscilador "beep", modelamos una cuerda real: espectro de
// armónicos tipo guitarra (PeriodicWave), transitorio de púa (ruido corto), una
// envolvente que decae como una cuerda y un filtro que apaga el brillo con el
// tiempo. Afinación EXACTA (oscilador a la frecuencia justa). Funciona aunque el
// micro esté bloqueado: solo necesita el AudioContext.
//
// Las cachés (onda + ruido) se cuelgan del propio ctx: al cerrar el afinador se
// destruye el ctx, y al reabrir se regeneran con el nuevo (los nodos de audio
// están ligados a su contexto).
function pluckWave() {
  if (ctx._pluckWave) return ctx._pluckWave;
  const N = 18;
  const real = new Float32Array(N), imag = new Float32Array(N);
  // Armónicos decrecientes (~1/h con caída extra): timbre cálido de cuerda.
  for (let h = 1; h < N; h++) imag[h] = (1 / h) * Math.exp(-h * 0.16);
  ctx._pluckWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  return ctx._pluckWave;
}
function noiseBuffer() {
  if (ctx._noiseBuf) return ctx._noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.1);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  ctx._noiseBuf = b;
  return b;
}

let activeSources = [], activeGain = null, toneMidi = null;
function playTone(midi) {
  ensureCtx();
  stopTone();                              // corta lo anterior (cada clic re-puntea)
  const freq = midiToFreq(midi);
  const t = ctx.currentTime;

  // Cuerda: oscilador (onda tipo guitarra) → lowpass que se cierra → envolvente.
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(pluckWave());
  osc.frequency.value = freq;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(freq * 10, 12000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2.2, 400), t + 1.4); // el brillo se apaga

  const g = ctx.createGain();
  const peak = 0.24;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);        // ataque de púa (rápido)
  g.gain.exponentialRampToValueAtTime(peak * 0.32, t + 0.7);   // caída inicial
  g.gain.exponentialRampToValueAtTime(0.0008, t + 3.6);        // cola larga que se extingue
  osc.connect(lp); lp.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 3.7);

  // Transitorio de púa: un chasquido de ruido muy corto, filtrado por la zona
  // media-aguda del tono. Le da el "ataque" físico de la cuerda.
  const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer();
  const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = Math.min(freq * 3, 6000); nbp.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.10, t);
  ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.06);
  ns.connect(nbp); nbp.connect(ng); ng.connect(ctx.destination);
  ns.start(t); ns.stop(t + 0.09);

  activeSources = [osc, ns]; activeGain = g; toneMidi = midi;
  // Al extinguirse la cuerda, apaga el resaltado — pero solo si ESTE oscilador
  // sigue siendo el activo (si re-puntearon, otro tomó su lugar y no debe tocarlo).
  osc.onended = () => {
    if (activeSources[0] === osc) { toneMidi = null; activeSources = []; activeGain = null; paintStrings(); }
    try { osc.disconnect(); lp.disconnect(); g.disconnect(); } catch (_) {}
  };
  paintStrings();
}
function stopTone() {
  if (activeGain && ctx) {
    const t = ctx.currentTime;
    try {
      activeGain.gain.cancelScheduledValues(t);
      activeGain.gain.setValueAtTime(activeGain.gain.value, t);
      activeGain.gain.exponentialRampToValueAtTime(0.0004, t + 0.05); // release (sin clic)
    } catch (_) {}
    activeSources.forEach(s => { try { s.stop(t + 0.06); } catch (_) {} });
  }
  activeSources = []; activeGain = null; toneMidi = null;
  paintStrings();
}

// ── Bucle de detección ──
let running = false, rafId = null, lastDetect = 0, lastGood = 0, smoothFreq = -1;
function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastDetect < DETECT_MS) return;
  lastDetect = now;
  if (!analyser) return;

  analyser.getFloatTimeDomainData(buf);
  const freq = autoCorrelate(buf, ctx.sampleRate);
  if (freq > 0) {
    // Suavizado: sigue la frecuencia salvo saltos grandes (nota nueva → snap).
    if (smoothFreq <= 0 || Math.abs(freq - smoothFreq) > smoothFreq * 0.06) smoothFreq = freq;
    else smoothFreq += 0.35 * (freq - smoothFreq);
    lastGood = now;
    renderPitch(smoothFreq);
  } else if (now - lastGood > HOLD_MS) {
    smoothFreq = -1;
    renderIdle();
  }
}
function startLoop() { if (!running) { running = true; lastDetect = 0; lastGood = 0; loop(); } }
function stopLoop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

// ── Render de la UI ──
let overlay = null, popModal = null;
function renderPitch(freq) {
  if (!overlay) return;
  const { name, octave, cents, targetFreq } = freqToNoteInfo(freq, a4);
  const inTune = Math.abs(cents) <= IN_TUNE_CENTS;

  overlay.querySelector('.tun-note-name').textContent = name;
  overlay.querySelector('.tun-note-oct').textContent = octave;
  overlay.querySelector('.tun-hz').textContent = `${freq.toFixed(1)} Hz`;
  const centsEl = overlay.querySelector('.tun-cents-label');
  centsEl.textContent = inTune ? 'Afinado' : `${cents > 0 ? '+' : ''}${cents} cents · ${cents > 0 ? '♯ alto' : '♭ bajo'}`;

  const needle = overlay.querySelector('.tun-needle');
  const clamped = Math.max(-50, Math.min(50, cents));
  needle.style.left = `${50 + clamped}%`;

  const panel = overlay.querySelector('.tun-panel');
  panel.classList.toggle('in-tune', inTune);
  panel.classList.remove('is-idle');
  // Guarda la frecuencia objetivo por si luego añadimos tono de referencia.
  panel.dataset.target = targetFreq.toFixed(2);
}
function renderIdle() {
  if (!overlay) return;
  overlay.querySelector('.tun-note-name').textContent = '—';
  overlay.querySelector('.tun-note-oct').textContent = '';
  overlay.querySelector('.tun-hz').textContent = '— Hz';
  overlay.querySelector('.tun-cents-label').textContent = 'Toca una nota…';
  overlay.querySelector('.tun-needle').style.left = '50%';
  const panel = overlay.querySelector('.tun-panel');
  panel.classList.remove('in-tune');
  panel.classList.add('is-idle');
}
function setStatus(text, kind) {
  const el = overlay?.querySelector('.tun-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `tun-status${kind ? ' ' + kind : ''}${text ? '' : ' hidden'}`;
}
function paintCal() {
  const el = overlay?.querySelector('.tun-cal-val'); if (el) el.textContent = a4;
}
// Pinta la fila de cuerdas del instrumento activo.
function renderStrings() {
  const box = overlay?.querySelector('.tun-strings');
  if (!box) return;
  const midis = (PRESETS[instrument] || PRESETS.guitar).midis;
  box.innerHTML = midis.map(m => {
    const { name, octave } = midiLabel(m);
    return `<button class="tun-string" type="button" data-midi="${m}" aria-label="Tono ${name}${octave}"><span class="ts-name">${name}</span><sub class="ts-oct">${octave}</sub></button>`;
  }).join('');
  paintStrings();
}
// Resalta la cuerda que está sonando.
function paintStrings() {
  overlay?.querySelectorAll('.tun-string').forEach(b => {
    b.classList.toggle('is-playing', parseInt(b.dataset.midi, 10) === toneMidi);
  });
}

function makeDraggable(panel, handle) {
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`; panel.style.transform = 'none';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, ox + (e.clientX - sx)));
    const ny = Math.max(8, Math.min(window.innerHeight - 60, oy + (e.clientY - sy)));
    panel.style.left = `${nx}px`; panel.style.top = `${ny}px`;
  });
  const end = (e) => { dragging = false; saveGeom(panel); try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

async function initMic() {
  setStatus('Pidiendo micrófono…');
  try {
    await startMic();
    setStatus('');
    startLoop();
  } catch (err) {
    stopMic();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(denied
      ? 'Micrófono bloqueado. Permítelo en la privacidad de Windows y pulsa Reintentar.'
      : 'No se pudo abrir el micrófono. Revisa que haya uno conectado y pulsa Reintentar.', 'error');
    const btn = overlay?.querySelector('.tun-retry');
    if (btn) btn.classList.remove('hidden');
  }
}

export function openTunerModal() {
  if (overlay) { ensureCtx(); return; }
  overlay = document.createElement('div');
  overlay.id = 'tuner-overlay';
  overlay.innerHTML = `
    <div class="tun-panel is-idle" role="dialog" aria-label="Afinador">
      <div class="tun-head" data-drag>
        <span class="mtm-drag-dots" aria-hidden="true">⠿</span>
        <h3>Afinador</h3>
        <button class="tun-close" type="button" aria-label="Cerrar">✕</button>
      </div>

      <div class="tun-display">
        <div class="tun-note">
          <span class="tun-note-name">—</span><sub class="tun-note-oct"></sub>
        </div>
        <div class="tun-cents-label">Toca una nota…</div>
      </div>

      <div class="tun-meter" aria-hidden="true">
        <div class="tun-meter-track"></div>
        <div class="tun-center"></div>
        <div class="tun-needle" style="left:50%"></div>
      </div>
      <div class="tun-legend"><span>♭ bajo</span><span>· afinado ·</span><span>alto ♯</span></div>

      <div class="tun-readout"><span class="tun-hz">— Hz</span></div>

      <div class="tun-strings-wrap">
        <div class="tun-strings-head">
          <span class="tun-strings-lbl">CUERDAS AL AIRE</span>
          <select class="tun-instrument" aria-label="Instrumento">
            ${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === instrument ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="tun-strings"></div>
      </div>

      <div class="tun-cal">
        <span class="tun-cal-lbl">Referencia A4</span>
        <button class="tun-cal-btn" data-cal="-1" type="button" aria-label="Bajar referencia">−</button>
        <span class="tun-cal-val">${a4}</span>
        <button class="tun-cal-btn" data-cal="1" type="button" aria-label="Subir referencia">+</button>
        <span class="tun-cal-unit">Hz</span>
      </div>

      <div class="tun-status hidden"></div>
      <button class="tun-retry acc-btn hidden" type="button">Reintentar micrófono</button>
    </div>
  `;
  document.body.appendChild(overlay);
  popModal = pushModal(() => closeTunerModal());
  const panel = overlay.querySelector('.tun-panel');
  makeDraggable(panel, overlay.querySelector('[data-drag]'));
  overlay.querySelector('.tun-close').onclick = closeTunerModal;

  // Restaurar posición/tamaño.
  const geom = loadGeom();
  if (geom && typeof geom.x === 'number') {
    if (geom.w) panel.style.width = `${Math.min(geom.w, Math.round(window.innerWidth * 0.96))}px`;
    const W = geom.w || 300;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - W - 8, geom.x))}px`;
    panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, geom.y))}px`;
    panel.style.transform = 'none';
  }

  overlay.querySelectorAll('.tun-cal-btn').forEach(b => b.onclick = () => {
    a4 = Math.max(430, Math.min(450, a4 + parseInt(b.dataset.cal, 10)));
    paintCal(); persist();
  });

  // Cuerdas al aire: tono de referencia (clic = suena/para). Delegado.
  renderStrings();
  overlay.querySelector('.tun-strings').addEventListener('click', (e) => {
    const b = e.target.closest('.tun-string');
    if (b) playTone(parseInt(b.dataset.midi, 10));
  });
  overlay.querySelector('.tun-instrument').onchange = (e) => {
    instrument = PRESETS[e.target.value] ? e.target.value : 'guitar';
    stopTone(); renderStrings(); persist();
  };
  overlay.querySelector('.tun-retry').onclick = () => {
    overlay.querySelector('.tun-retry').classList.add('hidden');
    initMic();
  };

  requestAnimationFrame(() => overlay.classList.add('open'));
  initMic();
}

export function closeTunerModal() {
  if (!overlay) return;
  const panel = overlay.querySelector('.tun-panel');
  if (panel) saveGeom(panel);
  stopLoop();
  stopTone();
  stopMic();
  // Libera el AudioContext (no dejar un hilo de audio del sistema vivo).
  try { if (ctx) ctx.close(); } catch (_) {}
  ctx = null;
  if (popModal) { popModal(); popModal = null; }
  overlay.classList.remove('open');
  const node = overlay; overlay = null;
  setTimeout(() => node.remove(), 180);
}

export function isTunerModalOpen() { return overlay !== null; }
