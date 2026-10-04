// ─────────────────────────────────────────────────────────────────────────
// Modo práctica (Pads): reproduce la Secuencia o el Original MÁS LENTO sin cambiar
// el tono, y repite un tramo A–B en bucle sin cortes. Vive en la franja de la onda
// (#seq-wave): botón «Práctica» en la cabecera + panel plegable + tramo dibujado
// sobre la onda con dos asas arrastrables.
//
// Atajos (si no estás escribiendo): [ marca A · ] marca B · \ activa/desactiva el bucle.
// El motor está en audio/pitchAudio.js (playbackRate + setLoopRegion).
// ─────────────────────────────────────────────────────────────────────────

import { showToast } from './toast.js';

const OPEN_KEY = 'livepads-practice-open';
const MIN_RATE = 0.25, MAX_RATE = 1.25, MIN_SPAN = 0.5;

let root, panel, btn, stage, wave, overlay, hA, hB;
let audio = null;
let rate = 1, A = null, B = null, loopOn = false;

const $ = (sel, el = document) => el.querySelector(sel);
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const dur = () => (audio && Number.isFinite(audio.duration) ? audio.duration : 0);

export function initPracticeMode() {
  root = $('#seq-wave');
  panel = $('.sw-practice');
  btn = $('#sw-practice');
  if (!root || !panel || !btn || root.dataset.practice) return;
  root.dataset.practice = '1';
  stage = $('.sw-stage', root);
  wave = $('.sw-wave', root);

  // Tramo A–B dibujado sobre la onda.
  overlay = document.createElement('div');
  overlay.className = 'sw-ab hidden';
  overlay.innerHTML = '<div class="sw-ab-fill"></div><div class="sw-ab-h sw-ab-h--a" title="Inicio del tramo (A) — arrastra"><b>A</b></div><div class="sw-ab-h sw-ab-h--b" title="Fin del tramo (B) — arrastra"><b>B</b></div>';
  wave.appendChild(overlay);
  hA = $('.sw-ab-h--a', overlay); hB = $('.sw-ab-h--b', overlay);
  bindHandle(hA, 'A'); bindHandle(hB, 'B');

  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) {}
  setOpen(open);
  btn.onclick = () => { setOpen(!root.classList.contains('is-practice')); };

  // Velocidad
  panel.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => setRate(parseFloat(b.dataset.rate)); });
  $('#sp-slower').onclick = () => setRate(rate - 0.05);
  $('#sp-faster').onclick = () => setRate(rate + 0.05);
  $('#sp-rate').ondblclick = () => setRate(1);

  // Tramo A–B
  $('#sp-a').onclick = markA;
  $('#sp-b').onclick = markB;
  $('#sp-loop').onclick = toggleLoop;
  $('#sp-clear').onclick = clearRegion;

  window.addEventListener('livepads:track-loaded', (e) => { audio = e.detail && e.detail.audio; reset(); });
  window.addEventListener('livepads:track-cleared', () => { audio = null; reset(); });
  document.addEventListener('keydown', onKey);
  new ResizeObserver(paintOverlay).observe(stage);
  paint();
}

function setOpen(v) {
  root.classList.toggle('is-practice', v);
  panel.hidden = !v;
  btn.setAttribute('aria-pressed', v ? 'true' : 'false');
  try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (_) {}
}

function reset() {
  rate = 1; A = B = null; loopOn = false;
  announceRate();
  paint();
}

function announceRate() {
  try { window.dispatchEvent(new CustomEvent('livepads:practice-rate', { detail: { rate } })); } catch (_) {}
}

function need() {
  if (audio) return true;
  showToast('Carga una canción (Sec u Orig) para usar el modo práctica.', 'info');
  return false;
}

// ── Velocidad ──────────────────────────────────────────────────────────────
function setRate(r) {
  if (!need()) return;
  rate = Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(r * 20) / 20));
  try { audio.playbackRate = rate; } catch (_) {}
  announceRate();
  paint();
}

// ── Tramo A–B ──────────────────────────────────────────────────────────────
function markA() {
  if (!need()) return;
  A = Math.round((audio.currentTime || 0) * 10) / 10;
  if (B != null && B - A < MIN_SPAN) B = null;
  afterMark();
}
function markB() {
  if (!need()) return;
  if (A == null) A = 0;
  const t = Math.round((audio.currentTime || 0) * 10) / 10;
  if (t - A < MIN_SPAN) { showToast('B debe estar después de A: avanza la canción y vuelve a marcar.', 'info'); return; }
  B = t;
  afterMark();
}
function afterMark() {
  loopOn = A != null && B != null;
  apply();
}
function toggleLoop() {
  if (!need()) return;
  if (A == null || B == null) { showToast('Marca el punto A y el punto B para repetir ese tramo.', 'info'); return; }
  loopOn = !loopOn;
  if (loopOn && (audio.currentTime < A || audio.currentTime > B)) audio.currentTime = A;
  apply();
}
function clearRegion() {
  A = B = null; loopOn = false;
  apply();
}
function apply() {
  if (audio) {
    try {
      if (loopOn && A != null && B != null) audio.setLoopRegion(A, B); else audio.clearLoopRegion();
    } catch (_) {}
  }
  paint();
}

// ── Pintado ────────────────────────────────────────────────────────────────
function paint() {
  const rr = Math.round(rate * 100);
  $('#sp-rate').textContent = rr + '%';
  panel.querySelectorAll('[data-rate]').forEach((b) => b.classList.toggle('is-on', Math.abs(parseFloat(b.dataset.rate) - rate) < 0.001));
  $('#sp-a').classList.toggle('is-set', A != null);
  $('#sp-b').classList.toggle('is-set', B != null);
  $('#sp-read').textContent = A == null && B == null ? 'Sin tramo' : `${A != null ? fmt(A) : '—'} → ${B != null ? fmt(B) : '—'}${A != null && B != null ? ` · ${Math.round(B - A)} s` : ''}`;
  const lp = $('#sp-loop');
  lp.classList.toggle('is-on', loopOn);
  lp.setAttribute('aria-pressed', loopOn ? 'true' : 'false');
  $('#sp-clear').disabled = A == null && B == null;
  panel.classList.toggle('has-slow', rate !== 1);
  const bpm = parseInt((document.getElementById('bpm-display') || {}).textContent, 10);
  const clk = $('#sp-click');
  if (clk) clk.textContent = Number.isFinite(bpm) ? `Click a ${Math.round(bpm * rate)} BPM (${bpm} × ${Math.round(rate * 100)} %)` : 'El click sigue la velocidad';
  // El botón de la cabecera avisa si hay algo activo aunque el panel esté cerrado.
  btn.classList.toggle('is-active', rate !== 1 || loopOn);
  btn.querySelector('.sw-practice-state').textContent = rate !== 1 ? rr + '%' : (loopOn ? 'A–B' : '');
  paintOverlay();
}

function paintOverlay() {
  if (!overlay) return;
  const d = dur();
  const show = d > 0 && (A != null || B != null);
  overlay.classList.toggle('hidden', !show);
  overlay.classList.toggle('is-looping', loopOn);
  if (!show) return;
  const a = A != null ? (A / d) * 100 : 0;
  const b = B != null ? (B / d) * 100 : (A != null ? a : 100);
  const fill = $('.sw-ab-fill', overlay);
  fill.style.left = a + '%';
  fill.style.width = Math.max(0, b - a) + '%';
  hA.style.display = A != null ? '' : 'none';
  hB.style.display = B != null ? '' : 'none';
  hA.style.left = a + '%';
  hB.style.left = b + '%';
}

// ── Asas arrastrables ──────────────────────────────────────────────────────
function timeAtX(x) {
  const r = stage.getBoundingClientRect();
  return Math.min(dur(), Math.max(0, ((x - r.left) / r.width) * dur()));
}
function bindHandle(h, which) {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !dur()) return;
    e.preventDefault(); e.stopPropagation();           // no mover la reproducción
    h.setPointerCapture(e.pointerId);
    const move = (ev) => {
      let t = Math.round(timeAtX(ev.clientX) * 10) / 10;
      if (which === 'A') A = B != null ? Math.min(t, B - MIN_SPAN) : t;
      else B = A != null ? Math.max(t, A + MIN_SPAN) : t;
      if (A != null && A < 0) A = 0;
      if (loopOn && A != null && B != null && audio) { try { audio.setLoopRegion(A, B); } catch (_) {} }
      paint();
    };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); apply(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  h.addEventListener('click', (e) => e.stopPropagation());
}

// ── Atajos ─────────────────────────────────────────────────────────────────
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (!audio) return;
  if (e.key === '[') { e.preventDefault(); markA(); }
  else if (e.key === ']') { e.preventDefault(); markB(); }
  else if (e.key === '\\') { e.preventDefault(); toggleLoop(); }
}
