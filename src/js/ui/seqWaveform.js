// Onda + secciones de la pista en reproducción (Pads).
//
// Franja sobre el reproductor inferior que muestra, de un vistazo:
//   · la forma de onda completa de la secuencia/original cargada,
//   · las SECCIONES (Intro, Verso, Coro…) como bloques de color con su nombre,
//   · por dónde va la pista (parte ya tocada resaltada + cabezal),
//   · qué sección suena ahora y cuál viene después (con cuenta atrás).
//
// Interacción: clic/arrastre en la onda = ir a ese punto · clic en el nombre de
// una sección = saltar a ella · arrastrar el nombre = mover el marcador ·
// clic derecho = renombrar/eliminar · «+ Sección» = marcar en la posición actual.
//
// Datos: song.markers = [{ id, label, t }]  (t en segundos). Viajan con la
// canción (Supabase, meta.markers). Stems los guarda al «Asignar a canción».

import { computePeaks } from '../stems/waveform.js';
import { getSongs } from '../state/store.js';
import { openCardMoreMenu, openContextMenu } from './cardMoreMenu.js';
import { showDialog } from './dialog.js';

const COLLAPSE_KEY = 'livepads-seqwave-collapsed';
const QUICK_LABELS = ['Intro', 'Verso 1', 'Verso 2', 'Pre Coro', 'Coro', 'Puente', 'Instrumental', 'Solo', 'Interludio', 'Tag', 'Final', 'Outro'];

let root, stage, wrap, canvasBase, canvasPlayed, playedClip, regionsEl, markersEl, rulerEl, playheadEl;
let titleEl, nowEl, nextEl, addBtn, collapseBtn;
let audio = null, song = null, peaks = null, duration = 0, raf = 0, lastW = 0;
let scrubbing = false;

const $ = (sel) => document.querySelector(sel);
const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Color por tipo de sección (mismo lenguaje visual siempre). */
export function sectionHue(label) {
  const l = String(label || '').toLowerCase();
  if (/intro|inicio/.test(l)) return 210;
  if (/pre/.test(l)) return 265;
  if (/coro|chorus|estribillo/.test(l)) return 38;
  if (/verso|verse|estrofa/.test(l)) return 150;
  if (/puente|bridge/.test(l)) return 330;
  if (/solo|instrumental|interlud/.test(l)) return 190;
  if (/final|outro|ending|tag|vamp/.test(l)) return 0;
  let h = 0; for (const c of l) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function getMarkers() {
  if (!song) return [];
  if (!Array.isArray(song.markers)) song.markers = [];
  return song.markers;
}
function sortedMarkers() { return [...getMarkers()].sort((a, b) => a.t - b.t); }

function persist() {
  if (!song) return;
  song.markers = sortedMarkers();
  try { if (window.electronAPI && window.electronAPI.saveGiSetlist) window.electronAPI.saveGiSetlist(getSongs()); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id, markers: true } }));
}

// ── Montaje ────────────────────────────────────────────────────────────────
export function initSeqWaveform() {
  root = $('#seq-wave');
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';
  titleEl = root.querySelector('.sw-title'); nowEl = root.querySelector('.sw-now'); nextEl = root.querySelector('.sw-next');
  stage = root.querySelector('.sw-stage'); wrap = root.querySelector('.sw-wave');
  canvasBase = root.querySelector('#sw-canvas'); canvasPlayed = root.querySelector('#sw-canvas-played');
  playedClip = root.querySelector('.sw-played'); regionsEl = root.querySelector('.sw-regions');
  markersEl = root.querySelector('.sw-markers'); rulerEl = root.querySelector('.sw-ruler'); playheadEl = root.querySelector('.sw-playhead');
  addBtn = root.querySelector('#sw-add'); collapseBtn = root.querySelector('#sw-collapse');

  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') root.classList.add('is-collapsed'); } catch (_) {}
  collapseBtn.onclick = () => {
    const c = root.classList.toggle('is-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch (_) {}
    if (!c) requestAnimationFrame(() => { drawWave(); renderMarkers(); });
  };
  addBtn.onclick = () => openAddMenu(addBtn);

  wrap.addEventListener('pointerdown', onWavePointerDown);
  markersEl.addEventListener('contextmenu', (e) => {
    const pill = e.target.closest('.sw-pill'); if (!pill) return;
    e.preventDefault(); openMarkerMenu(e.clientX, e.clientY, pill.dataset.id);
  });
  window.addEventListener('livepads:track-loaded', (e) => onLoaded(e.detail));
  window.addEventListener('livepads:track-cleared', onCleared);
  window.addEventListener('livepads:songs-changed', (e) => { if (e.detail && e.detail.markers) return; if (song) renderMarkers(); });
  new ResizeObserver(() => { if (peaks && stage.clientWidth !== lastW) { drawWave(); renderMarkers(); } }).observe(stage);
}

function onLoaded({ audio: a, song: s }) {
  audio = a; song = s || null; peaks = null; duration = 0;
  root.classList.remove('hidden', 'is-empty'); root.classList.add('is-loading');
  titleEl.textContent = song ? song.title : '';
  const ready = () => {
    if (audio !== a || !a.buffer) return;
    duration = a.buffer.duration;
    peaks = computePeaks(a.buffer, 2400);
    root.classList.remove('is-loading');
    drawWave(); renderMarkers(); startLoop();
  };
  if (a.buffer) ready(); else a.addEventListener('loadedmetadata', ready, { once: true });
  a.addEventListener('play', startLoop);
  // Si el audio no carga (archivo movido/dañado) la franja no debe quedarse en «Analizando…».
  a.addEventListener('error', () => { if (audio === a) onCleared(); }, { once: true });
}

function onCleared() {
  audio = null; song = null; peaks = null; duration = 0;
  cancelAnimationFrame(raf); raf = 0;
  root.classList.add('is-empty'); root.classList.remove('is-loading');
  titleEl.textContent = ''; nowEl.textContent = ''; nextEl.textContent = '';
}

// ── Dibujo ─────────────────────────────────────────────────────────────────
function drawOn(canvas, color, dim) {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth, h = wrap.clientHeight;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length / 2, mid = h / 2, amp = mid - 3;
  const bar = 2, gap = 1, step = bar + gap, cols = Math.floor(w / step);
  ctx.fillStyle = color;
  for (let i = 0; i < cols; i++) {
    const a = Math.floor((i / cols) * n), b = Math.max(a + 1, Math.floor(((i + 1) / cols) * n));
    let mn = 0, mx = 0;
    for (let j = a; j < b && j < n; j++) { if (peaks[j * 2] < mn) mn = peaks[j * 2]; if (peaks[j * 2 + 1] > mx) mx = peaks[j * 2 + 1]; }
    const top = Math.max(1, Math.max(Math.abs(mn), mx) * amp * (dim ? 1 : 1));
    ctx.fillRect(i * step, mid - top, bar, top * 2);
  }
}

function drawWave() {
  if (!peaks || root.classList.contains('is-collapsed')) return;
  lastW = stage.clientWidth;
  const cs = getComputedStyle(root);
  drawOn(canvasBase, 'rgba(255,255,255,0.32)', true);
  drawOn(canvasPlayed, cs.getPropertyValue('--sw-played').trim() || '#fbae00', false);
  playedClip.style.width = '0%';
  drawRuler();
}

function drawRuler() {
  if (!duration) return;
  const steps = [5, 10, 15, 30, 60, 120]; const w = stage.clientWidth;
  const step = steps.find(s => (w / (duration / s)) >= 64) || 120;
  let html = '';
  for (let t = 0; t <= duration; t += step) html += `<span style="left:${(t / duration) * 100}%">${fmt(t)}</span>`;
  rulerEl.innerHTML = html;
}

function renderMarkers() {
  if (!song || !duration) { regionsEl.innerHTML = ''; markersEl.innerHTML = ''; return; }
  const ms = sortedMarkers();
  let reg = '', pills = '';
  ms.forEach((m, i) => {
    const end = i + 1 < ms.length ? ms[i + 1].t : duration;
    const hue = sectionHue(m.label);
    reg += `<div class="sw-region" data-id="${m.id}" style="left:${(m.t / duration) * 100}%;width:${((end - m.t) / duration) * 100}%;--h:${hue}"></div>`;
    pills += `<button type="button" class="sw-pill" data-id="${m.id}" style="left:${(m.t / duration) * 100}%;--h:${hue}" title="${escapeHtml(m.label)} · ${fmt(m.t)} — clic: ir · arrastrar: mover · clic derecho: opciones">${escapeHtml(m.label)}</button>`;
  });
  regionsEl.innerHTML = reg; markersEl.innerHTML = pills;
  markersEl.querySelectorAll('.sw-pill').forEach(bindPill);
  tick(true);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── Animación del cabezal ──────────────────────────────────────────────────
function startLoop() {
  if (raf || !audio) return;
  const frame = () => {
    raf = 0;
    if (!audio || !duration) return;
    tick(false);
    if (!audio.paused || scrubbing) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

let lastCur = -1;
function tick(force) {
  if (!audio || !duration) return;
  const t = Math.min(duration, audio.currentTime || 0);
  const pct = (t / duration) * 100;
  playheadEl.style.left = pct + '%';
  playedClip.style.width = pct + '%';
  // Sección actual / siguiente (solo si cambió el segundo, para no tocar el DOM en cada frame).
  const sec = Math.floor(t);
  if (!force && sec === lastCur) return;
  lastCur = sec;
  const ms = sortedMarkers();
  let cur = null, next = null;
  for (let i = 0; i < ms.length; i++) { if (ms[i].t <= t + 0.05) cur = ms[i]; else { next = ms[i]; break; } }
  regionsEl.querySelectorAll('.sw-region').forEach(r => r.classList.toggle('is-current', !!cur && r.dataset.id === cur.id));
  markersEl.querySelectorAll('.sw-pill').forEach(p => p.classList.toggle('is-current', !!cur && p.dataset.id === cur.id));
  nowEl.innerHTML = cur ? `<i style="--h:${sectionHue(cur.label)}"></i>${escapeHtml(cur.label)}` : (ms.length ? 'Antes de la 1.ª sección' : 'Sin secciones · usa «+ Sección»');
  nextEl.textContent = next ? `Siguiente: ${next.label} en ${fmt(next.t - t)}` : (ms.length ? 'Última sección' : '');
}

// ── Interacción ────────────────────────────────────────────────────────────
function timeAtClientX(x) {
  const r = stage.getBoundingClientRect();
  return Math.min(duration, Math.max(0, ((x - r.left) / r.width) * duration));
}
function seekTo(t) { if (audio && duration) { audio.currentTime = t; tick(true); startLoop(); } }

function onWavePointerDown(e) {
  if (!audio || !duration || e.button !== 0) return;
  scrubbing = true; wrap.setPointerCapture(e.pointerId);
  seekTo(timeAtClientX(e.clientX));
  const move = (ev) => seekTo(timeAtClientX(ev.clientX));
  const up = () => { scrubbing = false; wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); };
  wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
}

function bindPill(pill) {
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const m = getMarkers().find(x => x.id === pill.dataset.id); if (!m) return;
    const startX = e.clientX; let moved = false;
    pill.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return;
      moved = true; pill.classList.add('is-drag');
      m.t = Math.round(timeAtClientX(ev.clientX) * 10) / 10;
      pill.style.left = (m.t / duration) * 100 + '%';
      const reg = regionsEl.querySelector(`.sw-region[data-id="${m.id}"]`);
      if (reg) reg.style.left = pill.style.left;
    };
    const up = () => {
      pill.removeEventListener('pointermove', move); pill.removeEventListener('pointerup', up); pill.removeEventListener('pointercancel', up);
      pill.classList.remove('is-drag');
      if (moved) { persist(); renderMarkers(); } else seekTo(m.t);
    };
    pill.addEventListener('pointermove', move); pill.addEventListener('pointerup', up); pill.addEventListener('pointercancel', up);
  });
}

function addMarker(label) {
  if (!song || !audio) return;
  const t = Math.round((audio.currentTime || 0) * 10) / 10;
  getMarkers().push({ id: uid(), label, t });
  persist(); renderMarkers();
  window.showToast?.(`Sección «${label}» en ${fmt(t)}`, 'success');
}

function openAddMenu(anchor) {
  if (!song || !audio) return;
  const items = QUICK_LABELS.map(label => ({ label, onSelect: () => addMarker(label) }));
  items.push({ label: 'Otro nombre…', onSelect: () => showDialog('Nombre de la sección', 'Ej. Coda, Tag 2…', (v) => { v = (v || '').trim(); if (v) addMarker(v); }) });
  openCardMoreMenu(anchor, items);
}

function openMarkerMenu(x, y, id) {
  const m = getMarkers().find(v => v.id === id); if (!m) return;
  openContextMenu(x, y, [
    { label: 'Ir a esta sección', onSelect: () => seekTo(m.t) },
    { label: 'Renombrar…', onSelect: () => showDialog('Renombrar sección', m.label, (v) => { v = (v || '').trim(); if (v) { m.label = v; persist(); renderMarkers(); } }) },
    { label: 'Mover al cabezal', onSelect: () => { m.t = Math.round((audio.currentTime || 0) * 10) / 10; persist(); renderMarkers(); } },
    { label: 'Eliminar', danger: true, onSelect: () => { song.markers = getMarkers().filter(v => v.id !== id); persist(); renderMarkers(); } },
  ]);
}
