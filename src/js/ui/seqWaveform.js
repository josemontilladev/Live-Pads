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
import { showDialog, confirmDialogAsync } from './dialog.js';
import { buildAutoMarkers, detectSectionsInBackground } from './autoSections.js';
import { canEditActiveLibrary, refreshMyRole, getCachedRole } from '../cloud/libraries.js';
import { initChordLane, laneTrackLoaded, laneCleared, laneTick, render as renderLane } from './chordLane.js';

const COLLAPSE_KEY = 'livepads-seqwave-collapsed';
const AUTO_KEY = 'livepads-autosections';          // '0' = no marcar solas las canciones nuevas
const TRIED_KEY = 'livepads-autosections-tried';   // canciones ya analizadas (no se repite)
const ICO_AUTO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
const QUICK_LABELS = ['Intro', 'Verso 1', 'Verso 2', 'Pre Coro', 'Coro', 'Puente', 'Instrumental', 'Solo', 'Interludio', 'Tag', 'Final', 'Outro'];

let root, stage, wrap, canvasBase, canvasPlayed, playedClip, regionsEl, markersEl, rulerEl, playheadEl;
let titleEl, nowEl, nextEl, addBtn, collapseBtn;
let audio = null, song = null, peaks = null, duration = 0, raf = 0, lastW = 0;
let scrubbing = false;
let detecting = null;   // canción que se está analizando

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

/** Solo propietarios y editores pueden tocar las secciones (la nube rechaza al resto). */
function guardEdit() {
  if (canEditActiveLibrary()) return true;
  window.showToast?.('Solo los editores pueden cambiar las secciones. Tu rol en esta librería es «Solo ver».', 'info');
  return false;
}
function applyRole() {
  if (!root) return;
  const ok = canEditActiveLibrary();
  root.classList.toggle('is-readonly', !ok);
  if (addBtn) {
    addBtn.disabled = !ok;
    addBtn.title = ok ? 'Marcar una sección en la posición actual (Intro, Verso, Coro…)' : 'Solo los editores pueden marcar secciones';
  }
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
  // La onda puede estar mostrando la copia de la canción dentro de un servicio: las
  // secciones se guardan también en la canción de la librería, que es la que se sincroniza.
  try {
    const lib = getSongs().find((x) => x !== song && ((song.cloudId && x.cloudId === song.cloudId) || (x.id != null && x.id === song.id)));
    if (lib) lib.markers = song.markers.map((m) => ({ ...m }));
  } catch (_) {}
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
  initChordLane(root, (t) => seekTo(t));

  wrap.addEventListener('pointerdown', onWavePointerDown);
  nowEl.addEventListener('click', (e) => { if (e.target.closest('.sw-auto-link')) autoDetect({}); });
  markersEl.addEventListener('contextmenu', (e) => {
    const pill = e.target.closest('.sw-pill'); if (!pill) return;
    e.preventDefault(); openMarkerMenu(e.clientX, e.clientY, pill.dataset.id);
  });
  window.addEventListener('livepads:track-loaded', (e) => onLoaded(e.detail));
  // Secciones que marcó otro editor: llegan con la sincronización y se ven sin recargar la pista.
  window.addEventListener('livepads:library-synced', onLibrarySynced);
  const refreshRole = () => { refreshMyRole().then(applyRole).catch(() => {}); };
  window.addEventListener('livepads:libraries-changed', refreshRole);
  refreshRole(); setTimeout(refreshRole, 4000);
  applyRole();
  window.addEventListener('livepads:track-cleared', onCleared);
  window.addEventListener('livepads:songs-changed', (e) => { if (e.detail && e.detail.markers) return; if (song) renderMarkers(); });
  new ResizeObserver(() => { if (peaks && stage.clientWidth !== lastW) { drawWave(); renderMarkers(); renderLane(); } }).observe(stage);
}

function onLibrarySynced() {
  refreshMyRole().then(applyRole).catch(() => {});
  if (!song || !audio || !duration) return;
  try {
    const lib = getSongs().find((x) => x !== song && ((song.cloudId && x.cloudId === song.cloudId) || (x.id != null && x.id === song.id)));
    if (lib && JSON.stringify(lib.markers || []) !== JSON.stringify(song.markers || [])) {
      song.markers = (lib.markers || []).map((m) => ({ ...m }));
    }
  } catch (_) {}
  drawWave(); renderMarkers();
}

function onLoaded({ audio: a, song: s, type }) {
  audio = a; song = s || null; peaks = null; duration = 0;
  root.classList.remove('hidden', 'is-empty'); root.classList.add('is-loading');
  titleEl.textContent = song ? song.title : '';
  const ready = () => {
    if (audio !== a || !a.buffer) return;
    duration = a.buffer.duration;
    peaks = computePeaks(a.buffer, 2400);
    root.classList.remove('is-loading');
    drawWave(); renderMarkers(); startLoop();
    laneTrackLoaded({ audio: a, song: s, type });
    maybeAutoDetect();
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
  laneCleared();
}

// ── Dibujo ─────────────────────────────────────────────────────────────────
function hueAt(t, ms) {
  let cur = null;
  for (let i = 0; i < ms.length; i++) { if (ms[i].t <= t + 0.001) cur = ms[i]; else break; }
  return cur ? sectionHue(cur.label) : null;
}

// Dibuja las barras de la onda. Con secciones, CADA barra toma el color de su sección
// (no es una capa encima: el propio espectro cambia de color). `lit` = parte ya tocada.
function drawOn(canvas, fallback, lit) {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth, h = wrap.clientHeight;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length / 2, mid = h / 2, amp = mid - 3;
  const bar = 2, gap = 1, step = bar + gap, cols = Math.floor(w / step);
  const ms = duration ? sortedMarkers() : [];
  let lastHue = -2;
  for (let i = 0; i < cols; i++) {
    const a = Math.floor((i / cols) * n), b = Math.max(a + 1, Math.floor(((i + 1) / cols) * n));
    let mn = 0, mx = 0;
    for (let j = a; j < b && j < n; j++) { if (peaks[j * 2] < mn) mn = peaks[j * 2]; if (peaks[j * 2 + 1] > mx) mx = peaks[j * 2 + 1]; }
    const top = Math.max(1, Math.max(Math.abs(mn), mx) * amp);
    const hue = ms.length ? hueAt((i / cols) * duration, ms) : null;
    if (hue !== lastHue) {
      lastHue = hue;
      ctx.fillStyle = hue == null ? fallback : (lit ? `hsl(${hue} 78% 60%)` : `hsl(${hue} 62% 56% / .62)`);
    }
    ctx.fillRect(i * step, mid - top, bar, top * 2);
  }
}

function drawWave() {
  if (!peaks || root.classList.contains('is-collapsed')) return;
  lastW = stage.clientWidth;
  const cs = getComputedStyle(root);
  drawOn(canvasBase, 'rgba(255,255,255,0.32)', false);
  drawOn(canvasPlayed, cs.getPropertyValue('--sw-played').trim() || '#fbae00', true);
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
  if (peaks) drawWave();      // el espectro toma el color de cada sección
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
  laneTick(t);
  // Sección actual / siguiente (solo si cambió el segundo, para no tocar el DOM en cada frame).
  const sec = Math.floor(t);
  if (!force && sec === lastCur) return;
  lastCur = sec;
  const ms = sortedMarkers();
  let cur = null, next = null;
  for (let i = 0; i < ms.length; i++) { if (ms[i].t <= t + 0.05) cur = ms[i]; else { next = ms[i]; break; } }
  regionsEl.querySelectorAll('.sw-region').forEach(r => r.classList.toggle('is-current', !!cur && r.dataset.id === cur.id));
  markersEl.querySelectorAll('.sw-pill').forEach(p => p.classList.toggle('is-current', !!cur && p.dataset.id === cur.id));
  nowEl.innerHTML = cur ? `<i style="--h:${sectionHue(cur.label)}"></i>${escapeHtml(cur.label)}`
    : ms.length ? 'Antes de la 1.ª sección'
    : detecting === song ? '<span class="sw-detecting">Detectando secciones…</span>'
    : canEditActiveLibrary() ? `Sin secciones · <button type="button" class="sw-auto-link">${ICO_AUTO}Detectar automáticamente</button>`
    : 'Sin secciones';
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
    if (!canEditActiveLibrary()) { seekTo(m.t); return; }   // solo lectura: el clic salta a la sección
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
  if (!song || !audio || !guardEdit()) return;
  const t = Math.round((audio.currentTime || 0) * 10) / 10;
  getMarkers().push({ id: uid(), label, t });
  persist(); renderMarkers();
  window.showToast?.(`Sección «${label}» en ${fmt(t)}`, 'success');
}

// ── Secciones automáticas ─────────────────────────────────────────────────
// Analiza la pista (en un Worker, sin congelar nada) y pone los marcadores; el
// usuario solo arrastra o renombra lo que no cuadre. Al abrir una canción SIN
// secciones se hace solo (una vez por canción, si eres editor); también a mano
// desde «+ Sección» o el enlace «Detectar automáticamente».
const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { return true; } };
const songKey = (s) => String((s && (s.cloudId || s.id)) || '');
function triedSet() { try { return JSON.parse(localStorage.getItem(TRIED_KEY) || '[]'); } catch (_) { return []; } }
function markTried(s) {
  const k = songKey(s); if (!k) return;
  const arr = triedSet().filter((x) => x !== k); arr.push(k);
  try { localStorage.setItem(TRIED_KEY, JSON.stringify(arr.slice(-800))); } catch (_) {}
}
function maybeAutoDetect() {
  if (!song || !audio || !autoOn() || getMarkers().length || !canEditActiveLibrary()) return;
  if (triedSet().includes(songKey(song))) return;
  autoDetect({ auto: true });
}

async function autoDetect({ auto = false } = {}) {
  const s = song, a = audio;
  if (!s || !a || !a.buffer || detecting) return;
  if (!auto && !guardEdit()) return;
  markTried(s);
  if (!auto && getMarkers().length) {
    const ok = await confirmDialogAsync({
      title: 'Detectar secciones', confirmLabel: 'Reemplazar', danger: true,
      message: 'La canción ya tiene secciones marcadas. ¿Reemplazarlas por las que detecte LivePads? Podrás deshacerlo.',
    });
    if (!ok || song !== s) return;
  }
  detecting = s; root.classList.add('is-detecting'); tick(true);
  let found = [];
  try {
    const bpm = parseFloat(s.bpm) || 0;
    const beatsPerBar = parseInt(String(s.timeSig || '4/4').split('/')[0], 10) || 4;
    const raw = await detectSectionsInBackground(a.buffer, { bpm, beatsPerBar });
    found = buildAutoMarkers(raw, s.lyrics, a.buffer.duration);
  } catch (e) { console.warn('[LivePads] detección de secciones:', e); }
  detecting = null; root.classList.remove('is-detecting');
  if (song !== s) return;                       // cambió de canción mientras analizaba
  if (found.length < 2) {
    tick(true);
    if (!auto) window.showToast?.('No se encontraron cambios de sección claros en esta pista. Márcalas con «+ Sección».', 'info');
    return;
  }
  if (auto && getMarkers().length) return;      // alguien las marcó mientras tanto
  const prev = getMarkers().map((m) => ({ ...m }));
  s.markers = found.map((m) => ({ id: uid(), label: m.label, t: m.t }));
  persist(); renderMarkers();
  window.showToast?.(`${found.length} secciones marcadas automáticamente. Arrastra o renombra las que no cuadren.`, 'success', {
    action: { label: 'Deshacer', onClick: () => { if (song !== s) return; s.markers = prev; persist(); renderMarkers(); } },
    ttl: 10000,
  });
}

function openAddMenu(anchor) {
  if (!song || !audio || !guardEdit()) return;
  const items = [{ label: getMarkers().length ? 'Volver a detectar secciones…' : 'Detectar secciones automáticamente', icon: ICO_AUTO, onSelect: () => autoDetect({}) }];
  items.push(...QUICK_LABELS.map(label => ({ label, onSelect: () => addMarker(label) })));
  items.push({ label: 'Otro nombre…', onSelect: () => showDialog('Nombre de la sección', 'Ej. Coda, Tag 2…', (v) => { v = (v || '').trim(); if (v) addMarker(v); }) });
  items.push({
    label: autoOn() ? 'Marcar solas las canciones nuevas: Sí' : 'Marcar solas las canciones nuevas: No',
    onSelect: () => {
      const on = !autoOn();
      try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (_) {}
      window.showToast?.(on ? 'Las canciones sin secciones se marcarán solas al abrirlas.' : 'Ya no se marcarán solas; usa «Detectar secciones automáticamente».', 'info');
    },
  });
  openCardMoreMenu(anchor, items);
}

function openMarkerMenu(x, y, id) {
  const m = getMarkers().find(v => v.id === id); if (!m) return;
  if (!canEditActiveLibrary()) { openContextMenu(x, y, [{ label: 'Ir a esta sección', onSelect: () => seekTo(m.t) }]); return; }
  openContextMenu(x, y, [
    { label: 'Ir a esta sección', onSelect: () => seekTo(m.t) },
    { label: 'Renombrar…', onSelect: () => showDialog('Renombrar sección', m.label, (v) => { v = (v || '').trim(); if (v) { m.label = v; persist(); renderMarkers(); } }) },
    { label: 'Mover al cabezal', onSelect: () => { m.t = Math.round((audio.currentTime || 0) * 10) / 10; persist(); renderMarkers(); } },
    { label: 'Eliminar', danger: true, onSelect: () => { song.markers = getMarkers().filter(v => v.id !== id); persist(); renderMarkers(); } },
  ]);
}
