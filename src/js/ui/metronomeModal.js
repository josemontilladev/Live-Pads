// ─────────────────────────────────────────────────────────────────────────
// Metrónomo en vivo (panel flotante MOVIBLE) — herramienta independiente, NO
// usa tracks ni el engine de Pads/Stems, así funciona igual en ambas pantallas.
// Scheduler lookahead (Chris Wilson) con subdivisiones, acentos/silencios por
// tiempo configurables, nombre de tempo y visualización radial.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from './modalStack.js';
import { getClickSounds, loadClickBuffers } from '../stems/clickGenerator.js';

const LS_KEY = 'livepads.metronome';
const LS_POS = 'livepads.metronome.pos';
function saveGeom(panel) {
  try {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(LS_POS, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
  } catch (_) {}
}
function loadGeom() { try { return JSON.parse(localStorage.getItem(LS_POS) || 'null'); } catch (_) { return null; } }
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

// Estados de tiempo: 0 = normal, 1 = acento, 2 = silencio (rest).
const ST_NORMAL = 0, ST_ACCENT = 1, ST_REST = 2;

// ── Estado (persistido) ──
let bpm = 120, beats = 4, subdivision = 1, sound = 'cowbell', volume = 0.9;
let beatStates = [ST_ACCENT, ST_NORMAL, ST_NORMAL, ST_NORMAL];
(() => {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.bpm) bpm = Math.max(30, Math.min(300, s.bpm));
    if (s.beats) beats = Math.max(1, Math.min(12, s.beats));
    if (s.subdivision) subdivision = Math.max(1, Math.min(8, s.subdivision));
    if (typeof s.sound === 'string') sound = s.sound;
    if (typeof s.volume === 'number') volume = s.volume;
    if (Array.isArray(s.beatStates)) beatStates = s.beatStates;
  } catch (_) {}
  syncBeatStates();
})();
function syncBeatStates() {
  // Ajusta el array al número de tiempos; si queda todo "normal", acentúa el 1.
  const next = [];
  for (let i = 0; i < beats; i++) next[i] = beatStates[i] ?? (i === 0 ? ST_ACCENT : ST_NORMAL);
  if (!next.some(s => s === ST_ACCENT) && next.length) next[0] = ST_ACCENT;
  beatStates = next;
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ bpm, beats, subdivision, sound, volume, beatStates })); } catch (_) {}
}

// ── Nombre de tempo (marca musical) ──
function tempoName(b) {
  if (b < 40) return 'Grave';
  if (b < 60) return 'Largo';
  if (b < 66) return 'Larghetto';
  if (b < 76) return 'Adagio';
  if (b < 108) return 'Andante';
  if (b < 120) return 'Moderato';
  if (b < 156) return 'Allegro';
  if (b < 176) return 'Vivace';
  if (b < 200) return 'Presto';
  return 'Prestissimo';
}

// ── Audio ──
let ctx = null, masterGain = null, buffers = null, loadedSound = null;
function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
async function ensureSound() {
  ensureCtx();
  if (loadedSound === sound && buffers) return;
  try { buffers = await loadClickBuffers(ctx, sound); loadedSound = sound; }
  catch (_) { buffers = null; loadedSound = null; }
}

// ── Scheduler ──
let running = false, lookaheadTimer = null, nextNoteTime = 0, step = 0;
function scheduleStep(s, time) {
  const k = ((s % subdivision) + subdivision) % subdivision;
  const beatInBar = Math.floor(s / subdivision) % beats;
  const isMain = k === 0;
  const state = beatStates[beatInBar] ?? ST_NORMAL;
  const delay = Math.max(0, (time - ctx.currentTime) * 1000);

  if (state === ST_REST) {                     // tiempo silenciado: nada de audio
    if (isMain) flashBeat(beatInBar, state, delay);
    return;
  }
  const isAccent = isMain && state === ST_ACCENT;
  if (buffers) {
    const src = ctx.createBufferSource();
    src.buffer = isAccent ? buffers.accent : buffers.normal;
    const g = ctx.createGain();
    g.gain.value = isMain ? 1 : 0.38;
    src.connect(g); g.connect(masterGain);
    src.start(time);
  } else {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = isAccent ? 1600 : (isMain ? 1000 : 2000);
    const amp = isMain ? (isAccent ? 0.95 : 0.62) : 0.22;
    g.gain.setValueAtTime(amp, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + (isMain ? 0.05 : 0.03));
    osc.connect(g); g.connect(masterGain);
    osc.start(time); osc.stop(time + 0.06);
  }
  if (isMain) flashBeat(beatInBar, state, delay);
  else pulseSub(delay);
}
function scheduler() {
  const secPerStep = (60 / bpm) / subdivision;
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextNoteTime);
    nextNoteTime += secPerStep;
    step++;
  }
  lookaheadTimer = setTimeout(scheduler, LOOKAHEAD_MS);
}
function start() {
  if (running) return;
  ensureCtx(); ensureSound();
  running = true; step = 0; nextNoteTime = ctx.currentTime + 0.06;
  scheduler(); paintPlay();
}
function stop() {
  running = false;
  if (lookaheadTimer) { clearTimeout(lookaheadTimer); lookaheadTimer = null; }
  paintPlay(); clearViz();
}

// ── Visualización radial ──
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function sectorPath(cx, cy, rIn, rOut, a0, a1) {
  const [x0o, y0o] = polar(cx, cy, rOut, a0);
  const [x1o, y1o] = polar(cx, cy, rOut, a1);
  const [x1i, y1i] = polar(cx, cy, rIn, a1);
  const [x0i, y0i] = polar(cx, cy, rIn, a0);
  const large = (a1 - a0) > 180 ? 1 : 0;
  return `M ${x0o.toFixed(2)} ${y0o.toFixed(2)} A ${rOut} ${rOut} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)} `
       + `L ${x1i.toFixed(2)} ${y1i.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)} Z`;
}
function segClass(i) {
  const st = beatStates[i] ?? ST_NORMAL;
  return st === ST_ACCENT ? 'beat-accent' : st === ST_REST ? 'beat-rest' : '';
}
function renderRadial() {
  const svg = overlay?.querySelector('.mtm-radial');
  if (!svg) return;
  const cx = 100, cy = 100, rIn = 50, rOut = 94, gap = beats > 1 ? 9 : 0;
  let segs = '';
  for (let i = 0; i < beats; i++) {
    const a0 = i * 360 / beats + gap / 2;
    const a1 = (i + 1) * 360 / beats - gap / 2;
    segs += `<path class="mtm-seg ${segClass(i)}" data-beat="${i}" d="${sectorPath(cx, cy, rIn, rOut, a0, a1)}"/>`;
  }
  svg.innerHTML = segs +
    `<circle class="mtm-radial-pulse" cx="100" cy="100" r="46"/>` +
    `<circle class="mtm-radial-center" cx="100" cy="100" r="42"/>` +
    `<text class="mtm-radial-num" x="100" y="101" text-anchor="middle" dominant-baseline="central">${beats}</text>`;
  // Clic en un segmento → cicla normal → acento → silencio.
  svg.querySelectorAll('.mtm-seg').forEach(seg => {
    seg.style.cursor = 'pointer';
    seg.onclick = () => {
      const i = parseInt(seg.dataset.beat, 10);
      beatStates[i] = ((beatStates[i] ?? ST_NORMAL) + 1) % 3;
      seg.className.baseVal = `mtm-seg ${segClass(i)}`;
      persist();
    };
  });
}
function flashBeat(beatInBar, state, delay) {
  setTimeout(() => {
    if (!overlay) return;
    overlay.querySelectorAll('.mtm-seg').forEach(s => {
      const on = parseInt(s.dataset.beat, 10) === beatInBar && state !== ST_REST;
      s.classList.toggle('is-on', on);
      s.classList.toggle('is-accent', on && state === ST_ACCENT);
    });
    const num = overlay.querySelector('.mtm-radial-num');
    if (num) num.textContent = beatInBar + 1;
  }, delay);
}
function pulseSub(delay) {
  setTimeout(() => {
    const p = overlay?.querySelector('.mtm-radial-pulse');
    if (!p) return;
    p.classList.remove('pulsing'); void p.getBoundingClientRect(); p.classList.add('pulsing');
  }, delay);
}
function clearViz() {
  overlay?.querySelectorAll('.mtm-seg').forEach(s => s.classList.remove('is-on', 'is-accent'));
  const num = overlay?.querySelector('.mtm-radial-num');
  if (num) num.textContent = beats;
}

// ── UI ──
let overlay = null, popModal = null;
const SUBDIVS = [
  { v: 1, label: 'Sin subdivisión' }, { v: 2, label: 'Corcheas · 2' },
  { v: 3, label: 'Tresillos · 3' },   { v: 4, label: 'Semicorcheas · 4' },
  { v: 6, label: 'Sextillos · 6' },   { v: 8, label: '8 notas' },
];
function paintPlay() {
  const btn = overlay?.querySelector('.mtm-play');
  if (!btn) return;
  btn.classList.toggle('is-playing', running);
  btn.innerHTML = running
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="7,5 19,12 7,19"/></svg>';
}
function paintTempoName() {
  const el = overlay?.querySelector('.mtm-tempo-name');
  if (el) el.textContent = tempoName(bpm);
}
function setBpm(v) {
  bpm = Math.max(30, Math.min(300, Math.round(v) || 120));
  const inp = overlay?.querySelector('.mtm-bpm-input'); if (inp && document.activeElement !== inp) inp.value = bpm;
  const sl = overlay?.querySelector('.mtm-bpm-slider'); if (sl) sl.value = bpm;
  paintTempoName(); persist();
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

export function openMetronomeModal() {
  if (overlay) { ensureCtx(); return; }
  ensureSound();
  overlay = document.createElement('div');
  overlay.id = 'metronome-overlay';
  overlay.innerHTML = `
    <div class="mtm-panel" role="dialog" aria-label="Metrónomo">
      <div class="mtm-head" data-drag>
        <span class="mtm-drag-dots" aria-hidden="true">⠿</span>
        <h3>Metrónomo</h3>
        <button class="mtm-close" type="button" aria-label="Cerrar">✕</button>
      </div>

      <div class="mtm-bpm">
        <button class="mtm-step" data-bpm="-1" type="button" aria-label="Menos BPM">−</button>
        <div class="mtm-bpm-main">
          <input class="mtm-bpm-input" type="number" min="30" max="300" value="${bpm}" inputmode="numeric" aria-label="BPM (tipea para fijar)">
          <span class="mtm-tempo-name">${tempoName(bpm)}</span>
        </div>
        <button class="mtm-step" data-bpm="1" type="button" aria-label="Más BPM">+</button>
      </div>
      <input type="range" class="mtm-bpm-slider" min="30" max="300" value="${bpm}" aria-label="BPM">
      <button class="mtm-tap" type="button">TAP</button>

      <svg class="mtm-radial" viewBox="0 0 200 200" role="img" aria-label="Compás (toca un segmento: normal · acento · silencio)"></svg>
      <p class="mtm-radial-hint">Tocá un segmento para alternar <b>normal → acento → silencio</b></p>

      <div class="mtm-grid">
        <label class="mtm-field">
          <span>COMPÁS</span>
          <select class="mtm-beats">
            ${[2,3,4,5,6,7,8,9,12].map(n => `<option value="${n}" ${n===beats?'selected':''}>${n}/4</option>`).join('')}
          </select>
        </label>
        <label class="mtm-field">
          <span>SONIDO</span>
          <select class="mtm-sound">
            ${getClickSounds().map(s => `<option value="${s.id}" ${s.id===sound?'selected':''}>${s.label}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="mtm-sub">
        <span class="mtm-sub-label">SUBDIVISIÓN</span>
        <div class="mtm-sub-opts">
          ${SUBDIVS.map(s => `<button class="mtm-sub-btn ${s.v===subdivision?'is-on':''}" data-sub="${s.v}" type="button">${s.v===1?'1':s.v}</button>`).join('')}
        </div>
        <span class="mtm-sub-name">${SUBDIVS.find(s => s.v===subdivision)?.label || ''}</span>
      </div>

      <div class="mtm-vol">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
        <input type="range" class="mtm-vol-slider" min="0" max="100" value="${Math.round(volume*100)}" aria-label="Volumen">
      </div>

      <button class="mtm-play" type="button" aria-label="Reproducir / Detener"></button>
    </div>
  `;
  document.body.appendChild(overlay);
  popModal = pushModal(() => closeMetronomeModal());
  const panel = overlay.querySelector('.mtm-panel');
  makeDraggable(panel, overlay.querySelector('[data-drag]'));
  overlay.querySelector('.mtm-close').onclick = closeMetronomeModal;

  // Restaurar la última posición y tamaño donde el usuario lo dejó (si los hay).
  const geom = loadGeom();
  if (geom && typeof geom.x === 'number') {
    if (geom.w) panel.style.width = `${Math.min(geom.w, Math.round(window.innerWidth * 0.96))}px`;
    if (geom.h) panel.style.height = `${Math.min(geom.h, window.innerHeight - 16)}px`;
    const W = geom.w || 340;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - W - 8, geom.x))}px`;
    panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, geom.y))}px`;
    panel.style.transform = 'none';
  }

  renderRadial(); paintPlay();

  overlay.querySelectorAll('.mtm-step').forEach(b => b.onclick = () => setBpm(bpm + parseInt(b.dataset.bpm, 10)));
  const bpmInput = overlay.querySelector('.mtm-bpm-input');
  const commitBpm = () => { setBpm(parseInt(bpmInput.value, 10)); bpmInput.value = bpm; };
  bpmInput.onchange = commitBpm;
  bpmInput.onkeydown = (e) => { if (e.key === 'Enter') { commitBpm(); bpmInput.blur(); } };
  overlay.querySelector('.mtm-bpm-slider').oninput = (e) => {
    bpm = parseInt(e.target.value, 10) || 120;
    if (document.activeElement !== bpmInput) bpmInput.value = bpm;
    paintTempoName(); persist();
  };
  let taps = [];
  overlay.querySelector('.mtm-tap').onclick = () => {
    const now = performance.now();
    taps = taps.filter(t => now - t < 2000); taps.push(now);
    if (taps.length >= 2) {
      const it = [];
      for (let i = 1; i < taps.length; i++) it.push(taps[i] - taps[i-1]);
      setBpm(60000 / (it.reduce((a, b) => a + b, 0) / it.length));
    }
  };
  overlay.querySelector('.mtm-beats').onchange = (e) => { beats = parseInt(e.target.value, 10) || 4; syncBeatStates(); renderRadial(); persist(); };
  overlay.querySelector('.mtm-sound').onchange = async (e) => { sound = e.target.value; loadedSound = null; await ensureSound(); persist(); };
  overlay.querySelectorAll('.mtm-sub-btn').forEach(b => b.onclick = () => {
    subdivision = parseInt(b.dataset.sub, 10) || 1;
    overlay.querySelectorAll('.mtm-sub-btn').forEach(o => o.classList.toggle('is-on', o === b));
    const nm = overlay.querySelector('.mtm-sub-name');
    if (nm) nm.textContent = SUBDIVS.find(s => s.v === subdivision)?.label || '';
    persist();
  });
  overlay.querySelector('.mtm-vol-slider').oninput = (e) => {
    volume = (parseInt(e.target.value, 10) || 0) / 100;
    if (masterGain) masterGain.gain.value = volume; persist();
  };
  overlay.querySelector('.mtm-play').onclick = () => running ? stop() : start();

  requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closeMetronomeModal() {
  if (!overlay) return;
  const panel = overlay.querySelector('.mtm-panel');
  if (panel) saveGeom(panel);          // captura tamaño/posición final (incl. redimensionado)
  stop();
  if (popModal) { popModal(); popModal = null; }
  overlay.classList.remove('open');
  const node = overlay; overlay = null;
  setTimeout(() => node.remove(), 180);
}

export function isMetronomeModalOpen() { return overlay !== null; }
