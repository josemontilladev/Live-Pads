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

import { computePeaksAsync } from '../stems/waveform.js';

// Onda de cada pista, calculada una vez a máxima resolución (sirve para cualquier zoom)
// y guardada: volver a una canción ya no la recalcula.
const PEAK_POINTS = 24000;
const peakCache = new Map();   // clave de pista → Float32Array
const peakKey = (s, type, buf) => `${(s && (s.cloudId || s.id)) || 'x'}|${type || ''}|${buf.length}|${buf.sampleRate}`;
import { getSongs } from '../state/store.js';
import { openCardMoreMenu, openContextMenu } from './cardMoreMenu.js';
import { showDialog, confirmDialogAsync } from './dialog.js';
import { buildAutoMarkers, detectSectionsInBackground, barGridInBackground } from './autoSections.js';
import { maybeStartWaveTour, startWaveTour } from './waveTour.js';
import { parseLyricStructure, keyOffset, labelSegments, refineSectionStarts } from './songStructure.js';
import { loopSection } from './practiceMode.js';
import { canEditActiveLibrary, refreshMyRole, getCachedRole } from '../cloud/libraries.js';
import { analyzeBeats, gridFrom, trackKey, nearestIn, stepIn } from '../analysis/beatGrid.js';
import { initChordLane, laneTrackLoaded, laneCleared, laneTick, render as renderLane, laneSetGrid, laneNeededZoom, laneIsOn } from './chordLane.js';

const COLLAPSE_KEY = 'livepads-seqwave-collapsed';
const AUTO_KEY = 'livepads-autosections';          // '0' = no marcar solas las canciones nuevas
const TRIED_KEY = 'livepads-autosections-tried';   // canciones ya analizadas (no se repite)
const ICO_AUTO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
const QUICK_LABELS = ['Intro', 'Verso 1', 'Verso 2', 'Pre Coro', 'Coro', 'Puente', 'Instrumental', 'Solo', 'Interludio', 'Tag', 'Final', 'Outro'];

let scroller, zoomer, zoom = 1, userScrollAt = 0, progScroll = false, chordFitBtn, zoomLvl, gridPromise = null;
let root, stage, wrap, canvasBase, canvasPlayed, playedClip, regionsEl, markersEl, rulerEl, playheadEl;
let titleEl, nowEl, nextEl, addBtn, collapseBtn, confirmBtn;
let audio = null, song = null, peaks = null, duration = 0, raf = 0, lastW = 0, trackType = '';
let scrubbing = false;
let detecting = null;   // canción que se está analizando
let selectedId = null;  // etiqueta seleccionada (← → la mueven, Supr la quita)
let grid = null;        // { barSec, beatSec, off } rejilla de compases de la pista
let chordTimes = [];    // cambios de acorde detectados (para pegar etiquetas)
// Deshacer / rehacer (Ctrl+Z / Ctrl+Y) de las secciones de la canción cargada.
let undoStack = [], redoStack = [], baseSnap = '[]', restoring = false;

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
  const now = JSON.stringify(song.markers);
  if (!restoring && now !== baseSnap) {
    undoStack.push(baseSnap); if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  baseSnap = now;
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
  scroller = root.querySelector('.sw-scroll'); zoomer = root.querySelector('.sw-zoomer');
  chordFitBtn = root.querySelector('#sw-chordfit'); zoomLvl = root.querySelector('#sw-zoom-fit');
  wireZoom();

  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') root.classList.add('is-collapsed'); } catch (_) {}
  collapseBtn.onclick = () => {
    const c = root.classList.toggle('is-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch (_) {}
    if (!c) requestAnimationFrame(() => { drawWave(); renderMarkers(); });
  };
  addBtn.onclick = () => openAddMenu(addBtn);
  // «Todo bien ✓»: aparece mientras quedan secciones SUPUESTAS (borde punteado).
  confirmBtn = document.createElement('button');
  confirmBtn.type = 'button'; confirmBtn.className = 'sw-btn sw-confirm'; confirmBtn.hidden = true;
  confirmBtn.title = 'Las secciones con borde punteado las puso LivePads. Cuando las hayas revisado, pulsa aquí para darlas por buenas.';
  confirmBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Todo bien';
  confirmBtn.onclick = confirmAll;
  addBtn.parentNode.insertBefore(confirmBtn, addBtn);
  window.addEventListener('keydown', onKey, true);
  // La selección es de corta vida: las flechas también cambian de canción en el
  // servicio, así que se suelta al hacer clic en otra parte o tras unos segundos.
  document.addEventListener('pointerdown', (e) => { if (selectedId && !e.target.closest('.sw-pill')) deselect(); }, true);
  window.addEventListener('livepads:chords-ready', () => loadChordTimes());
  // La franja de acordes avisa cuánto zoom haría falta para leerlos todos.
  window.addEventListener('livepads:chord-lane-rendered', () => paintChordFit());
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
  // Cambio de ancho (zoom, ventana): el tamaño viene en el propio aviso (leer clientWidth
  // aquí forzaba a recalcular la maquetación de toda la página) y se redibuja una vez por cuadro.
  new ResizeObserver((entries) => {
    const w = entries[0] && entries[0].contentRect.width;
    if (peaks && w && Math.round(w) !== Math.round(lastW)) { stageW = w; renderMarkers(); renderLane(); }
  }).observe(stage);
}

function onLibrarySynced() {
  refreshMyRole().then(applyRole).catch(() => {});
  if (!song || !audio || !duration) return;
  try {
    const lib = getSongs().find((x) => x !== song && ((song.cloudId && x.cloudId === song.cloudId) || (x.id != null && x.id === song.id)));
    if (lib && JSON.stringify(lib.markers || []) !== JSON.stringify(song.markers || [])) {
      song.markers = (lib.markers || []).map((m) => ({ ...m }));
      baseSnap = JSON.stringify(sortedMarkers());
    }
  } catch (_) {}
  drawWave(); renderMarkers();
}

function onLoaded({ audio: a, song: s, type }) {
  audio = a; song = s || null; peaks = null; duration = 0; trackType = type || '';
  autoFitDone = false; setZoom(1, null, { silent: true });
  selectedId = null; grid = null; chordTimes = []; undoStack = []; redoStack = [];
  baseSnap = JSON.stringify(sortedMarkers());
  root.classList.remove('hidden', 'is-empty'); root.classList.add('is-loading');
  titleEl.textContent = song ? song.title : '';
  const ready = () => {
    if (audio !== a || !a.buffer) return;
    duration = a.buffer.duration;
    const key = peakKey(s, type, a.buffer);
    const show = (pk) => {
      if (audio !== a || !pk) return;
      peaks = pk;
      root.classList.remove('is-loading');
      drawWave(); renderMarkers(); startLoop();
      laneTrackLoaded({ audio: a, song: s, type });
      maybeAutoDetect();
      loadGrid(a); loadChordTimes();
    };
    if (peakCache.has(key)) { show(peakCache.get(key)); return; }
    computePeaksAsync(a.buffer, PEAK_POINTS, { isCancelled: () => audio !== a }).then((pk) => {
      if (!pk) return;
      peakCache.set(key, pk);
      if (peakCache.size > 40) peakCache.delete(peakCache.keys().next().value);
      show(pk);
    });
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
function drawOn(canvas, fallback, lit, w, h) {
  // Con mucho zoom el lienzo mide miles de píxeles: a densidad 1× (no se nota a ese
  // ancho) cuesta la mitad o menos de dibujar y de memoria gráfica en portátiles.
  const dpr = w > 4000 ? 1 : (window.devicePixelRatio || 1);
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

// La onda se dibuja como mucho una vez por cuadro aunque la pidan varios avisos seguidos
// (pista cargada, secciones, zoom, acordes…): antes cada uno la redibujaba entera.
let drawRaf = 0;
let stageW = 0;            // ancho del escenario conocido (ResizeObserver), para no medir
function drawWave() {
  if (drawRaf) return;
  drawRaf = requestAnimationFrame(() => { drawRaf = 0; drawWaveNow(); });
}
function drawWaveNow() {
  if (!peaks || root.classList.contains('is-collapsed')) return;
  // Todas las medidas primero (una sola maquetación) y después se escribe.
  const w = stage.clientWidth, h = wrap.clientHeight;
  const played = getComputedStyle(root).getPropertyValue('--sw-played').trim() || '#fbae00';
  lastW = stageW = w;
  drawOn(canvasBase, 'rgba(255,255,255,0.32)', false, w, h);
  drawOn(canvasPlayed, played, true, w, h);
  drawRuler(w);
  tick(true);   // cabezal y parte tocada, al nuevo ancho
}

function drawRuler(w = stageW || stage.clientWidth) {
  if (!duration) return;
  const steps = [5, 10, 15, 30, 60, 120];
  const step = steps.find(s => (w / (duration / s)) >= 64) || 120;
  let html = '';
  for (let t = 0; t <= duration; t += step) html += `<span style="left:${(t / duration) * 100}%">${fmt(t)}</span>`;
  rulerEl.innerHTML = html;
}

function renderMarkers() {
  if (!song || !duration) { regionsEl.innerHTML = ''; markersEl.innerHTML = ''; return; }
  const ms = sortedMarkers();
  const edit = canEditActiveLibrary();
  const sw = stageW || stage.clientWidth || 1;
  let reg = '', pills = '';
  ms.forEach((m, i) => {
    const end = i + 1 < ms.length ? ms[i + 1].t : duration;
    const hue = sectionHue(m.label);
    reg += `<div class="sw-region${m.auto ? ' is-auto' : ''}" data-id="${m.id}" style="left:${(m.t / duration) * 100}%;width:${((end - m.t) / duration) * 100}%;--h:${hue}"></div>`;
    // Al pasar el ratón (editores): ▾ = opciones (lo mismo que el clic derecho) y ✕ = quitar.
    const tools = edit ? `<span class="sw-pill-tool sw-pill-menu" role="button" title="Opciones: renombrar, mover, eliminar">▾</span><span class="sw-pill-tool sw-pill-x" role="button" title="Quitar esta sección">✕</span>` : '';
    const tip = (m.auto ? 'Supuesta por LivePads (revísala) · ' : '') + (edit ? 'clic: ir y seleccionar (← → la mueven por compás) · arrastrar: mover · doble clic en la onda: repetir · ▾ o clic derecho: opciones · ✕: quitar' : 'clic: ir a esta sección');
    // Cada píldora cabe en el hueco hasta la siguiente (se recorta con «…»; al pasar el ratón se ve entera).
    const gapPx = Math.max(22, ((end - m.t) / duration) * sw - 4);
    pills += `<button type="button" class="sw-pill${m.auto ? ' is-auto' : ''}${m.id === selectedId ? ' is-selected' : ''}" data-id="${m.id}" style="left:${(m.t / duration) * 100}%;--h:${hue};--gap:${Math.round(gapPx)}px" title="${escapeHtml(m.label)} · ${fmt(m.t)} — ${tip}"><span class="sw-pill-label">${escapeHtml(m.label)}</span>${tools}</button>`;
  });
  regionsEl.innerHTML = reg; markersEl.innerHTML = pills;
  markersEl.querySelectorAll('.sw-pill').forEach(bindPill);
  if (confirmBtn) confirmBtn.hidden = !(edit && ms.some((m) => m.auto));
  if (ms.length && !root.classList.contains('is-collapsed')) maybeStartWaveTour(root, { editable: edit });
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
  // En cada cuadro mientras suena: primero lo que MIDE (seguir el cabezal con zoom) y
  // después lo que escribe. El cabezal y la parte tocada se mueven con transform y
  // clip-path (los mueve la tarjeta gráfica): con left/width la página se volvía a
  // maquetar 60 veces por segundo, en pleno directo.
  followPlayhead(t);
  playheadEl.style.transform = `translateX(${(t / duration) * (stageW || stage.clientWidth)}px)`;
  playedClip.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
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
function seekTo(t) { if (audio && duration) { audio.currentTime = t; userScrollAt = 0; tick(true); startLoop(); } }

// ── Zoom de la onda ───────────────────────────────────────────────────────
// La franja de acordes, las secciones, la onda y la regla viven dentro de
// .sw-zoomer, cuyo ancho es zoom × 100 %: todo escala junto. Con zoom, el
// cabezal se sigue solo mientras suena (salvo si te mueves a mano un momento).
let autoFitDone = false;
// Ancho visible del área de la onda, guardado por un ResizeObserver: medirlo en cada zoom
// (justo después de cambiar el HTML de la onda) obligaba a re-maquetar toda la página.
let scrollerW = 0;
function viewW() {
  if (!scrollerW && scroller) {
    scrollerW = scroller.clientWidth;
    new ResizeObserver((en) => { const w = en[0] && en[0].contentRect.width; if (w) scrollerW = w; }).observe(scroller);
  }
  return scrollerW || 1;
}
function maxZoom() {
  const cw = viewW();
  return Math.max(1, Math.min(14000, Math.max(cw, duration * 60)) / cw);
}
function setZoom(z, anchorClientX, { silent = false } = {}) {
  if (!scroller || !zoomer) return;
  const nz = Math.max(1, Math.min(maxZoom(), Math.round(z * 100) / 100));
  const cw = viewW();
  if (silent) {
    // Reinicio al cargar otra canción: sin anclas ni medidas.
    zoom = nz;
    zoomer.style.width = `${nz * 100}%`;
    root.classList.toggle('is-zoomed', nz > 1.001);
    if (zoomLvl) zoomLvl.textContent = nz > 1.001 ? `${nz < 10 ? String(Math.round(nz * 100) / 100).replace('.', ',') : Math.round(nz)}×` : '1×';
    progScroll = true; scroller.scrollLeft = 0;
    requestAnimationFrame(() => { progScroll = false; });
    return;
  }
  const oldW = cw * zoom;
  // Punto que se queda quieto: el ratón, o el cabezal (si se ve), o el centro.
  let ax = cw / 2;
  if (anchorClientX != null) ax = anchorClientX - scroller.getBoundingClientRect().left;
  else if (audio && duration) {
    const px = ((audio.currentTime || 0) / duration) * oldW - scroller.scrollLeft;
    if (px >= 0 && px <= cw) ax = px;
  }
  const frac = (scroller.scrollLeft + ax) / oldW;
  zoom = nz;
  zoomer.style.width = `${nz * 100}%`;
  root.classList.toggle('is-zoomed', nz > 1.001);
  if (zoomLvl) zoomLvl.textContent = nz > 1.001 ? `${nz < 10 ? String(Math.round(nz * 100) / 100).replace('.', ',') : Math.round(nz)}×` : '1×';
  const newW = cw * nz;
  progScroll = true;
  scroller.scrollLeft = Math.max(0, frac * newW - ax);
  requestAnimationFrame(() => { progScroll = false; });
  // El ResizeObserver de la onda redibuja onda, secciones y acordes al cambiar el ancho.
}
// Escala de zoom gradual para los botones + / − (antes saltaba ×1,6: 1 → 1,6 → 2,6 → 4,1).
const ZOOM_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];
function stepZoom(dir) {
  const cur = zoom;
  let next;
  if (dir > 0) next = ZOOM_STEPS.find((z) => z > cur + 0.01) ?? cur * 1.25;
  else next = [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? 1;
  setZoom(next);
}
function wireZoom() {
  if (!scroller) return;
  root.querySelector('#sw-zoom-in').onclick = () => stepZoom(1);
  root.querySelector('#sw-zoom-out').onclick = () => stepZoom(-1);
  zoomLvl.onclick = () => setZoom(1);
  chordFitBtn.onclick = () => { const z = laneNeededZoom(); if (z > zoom) setZoom(z); };
  // Ctrl/Alt + rueda = zoom (anclado al ratón); la rueda sola deja la página quieta.
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.altKey)) {
      // Con zoom, la rueda vertical desplaza la onda en horizontal.
      if (zoom > 1.001 && Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.shiftKey) { e.preventDefault(); scroller.scrollLeft += e.deltaY; }
      return;
    }
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX);
  }, { passive: false });
  scroller.addEventListener('scroll', () => { if (!progScroll) userScrollAt = performance.now(); }, { passive: true });
}
function followPlayhead(t) {
  if (!scroller || zoom <= 1.001 || !audio || audio.paused || scrubbing) return;
  if (performance.now() - userScrollAt < 3000) return;      // se movió a mano: no le quitamos la vista
  const cw = viewW(), W = cw * zoom;   // anchos guardados: este código corre en cada cuadro
  const x = (t / duration) * W, left = scroller.scrollLeft;
  if (x < left + cw * 0.08 || x > left + cw * 0.85) {
    progScroll = true;
    scroller.scrollLeft = Math.max(0, x - cw * 0.25);
    requestAnimationFrame(() => { progScroll = false; });
  }
}
// «Ver todos los acordes»: aparece si con el zoom actual hay acordes sin nombre.
// La primera vez que se pintan los acordes de una pista, se amplía solo.
function paintChordFit() {
  if (!chordFitBtn) return;
  const need = laneIsOn() ? laneNeededZoom() : 0;
  const show = need > zoom * 1.05;
  chordFitBtn.hidden = !show;
  if (show && !autoFitDone && zoom <= 1.001) { autoFitDone = true; setZoom(need); }
  else if (need) autoFitDone = true;
}

function sectionIdAt(t) {
  let cur = null;
  for (const m of sortedMarkers()) { if (m.t <= t + 0.05) cur = m; else break; }
  return cur && cur.id;
}
function onWavePointerDown(e) {
  if (!audio || !duration || e.button !== 0) return;
  if (e.target.closest('.sw-ab-h')) return;
  if (selectedId) { selectedId = null; markersEl.querySelectorAll('.sw-pill.is-selected').forEach((p) => p.classList.remove('is-selected')); }
  if (e.detail === 2) { const id = sectionIdAt(timeAtClientX(e.clientX)); if (id) { practiceSection(id); return; } }
  if (e.shiftKey) {
    // Mayús + arrastrar: dibuja el tramo a repetir.
    wrap.setPointerCapture(e.pointerId);
    const t0 = timeAtClientX(e.clientX);
    const move = (ev) => { const t = timeAtClientX(ev.clientX); loopSection(Math.min(t0, t), Math.max(t0, t), null, { preview: true }); };
    const up = (ev) => {
      wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up);
      const t = timeAtClientX(ev.clientX);
      if (Math.abs(t - t0) >= 0.5) loopSection(Math.min(t0, t), Math.max(t0, t), null);
    };
    wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    return;
  }
  scrubbing = true; wrap.setPointerCapture(e.pointerId);
  seekTo(timeAtClientX(e.clientX));
  const move = (ev) => seekTo(timeAtClientX(ev.clientX));
  const up = () => { scrubbing = false; wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); };
  wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
}

function bindPill(pill) {
  pill.addEventListener('click', (e) => {
    const tool = e.target.closest('.sw-pill-tool'); if (!tool) return;
    e.stopPropagation();
    if (tool.classList.contains('sw-pill-x')) removeMarker(pill.dataset.id);
    else { const r = pill.getBoundingClientRect(); openMarkerMenu(r.left, r.bottom + 4, pill.dataset.id); }
  });
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const m = getMarkers().find(x => x.id === pill.dataset.id); if (!m) return;
    if (!canEditActiveLibrary()) { seekTo(m.t); return; }   // solo lectura: el clic salta a la sección
    if (e.target.closest('.sw-pill-tool')) return;          // ▾ / ✕: se resuelven en el clic
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
    const up = (ev) => {
      pill.removeEventListener('pointermove', move); pill.removeEventListener('pointerup', up); pill.removeEventListener('pointercancel', up);
      pill.classList.remove('is-drag');
      select(m.id);
      if (moved) {
        // Al soltar se pega al compás (o al cambio de acorde) más cercano. Alt = sin pegar.
        if (!(ev && ev.altKey)) m.t = snapTime(m.t);
        delete m.auto;
        persist(); renderMarkers();
      } else { seekTo(m.t); renderMarkers(); }
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
    const lyr = parseLyricStructure(s.lyrics);
    // La letra trae sus secciones: se analizan también los acordes de la pista para
    // saber qué tramo es cada sección (verso, coro…) comparando acordes.
    const chordsP = lyr.length >= 2 ? trackChordsFor(s, a).catch(() => null) : Promise.resolve(null);
    const [raw, ch] = await Promise.all([detectSectionsInBackground(a.buffer, { bpm, beatsPerBar }), chordsP]);
    const dur = a.buffer.duration;
    if (lyr.length >= 2 && raw.length >= 2) {
      const det = (ch && ch.seg) || [];
      const segs = raw.map((x, i) => ({ s: x.atSec, e: i + 1 < raw.length ? raw[i + 1].atSec : dur, cueId: x.cueId }));
      const k = keyOffset(lyr, det, (s.audio && s.audio.pitch) || 0).k;
      // La rejilla de compases (si llega a tiempo) para ajustar cada inicio al compás.
      const g = grid || await Promise.race([gridPromise || Promise.resolve(null), new Promise((r) => setTimeout(() => r(null), 15000))]);
      // Cada sección empieza donde entra su primer acorde de la letra (a menos de un compás).
      found = refineSectionStarts(labelSegments(segs, lyr, det, k), lyr, det, k, g, dur)
        .filter((m) => m.t < dur - 1).map((m) => ({ label: m.label, t: Math.round(m.t * 1000) / 1000 }));
    } else {
      found = buildAutoMarkers(raw, s.lyrics, dur);
    }
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
  s.markers = found.map((m) => ({ id: uid(), label: m.label, t: m.t, auto: true }));
  persist(); renderMarkers();
  window.showToast?.(`${found.length} secciones marcadas automáticamente. Arrastra o renombra las que no cuadren.`, 'success', {
    action: { label: 'Deshacer', onClick: () => { if (song !== s) return; s.markers = prev; persist(); renderMarkers(); } },
    ttl: 10000,
  });
}

// ── Rejilla, pegado al compás y flechas ───────────────────────────────────
function loadGrid(a) {
  const s = song; if (!s || !a || !a.buffer) return;
  const bpm = parseFloat(s.bpm) || 0;
  const beatsPerBar = parseInt(String(s.timeSig || '4/4').split('/')[0], 10) || 4;
  // Primero el modelo de pulsos (Beat This!, en local): pulsos y compases reales.
  // Sin el modelo, el detector anterior (tempo fijo + desfase).
  const fallback = () => barGridInBackground(a.buffer, { bpm, beatsPerBar }).then((g) => {
    if (!g || !(g.bpm > 0)) return null;
    return { beatSec: 60 / g.bpm, barSec: (60 / g.bpm) * (g.beatsPerBar || 4), off: g.offsetSec || 0 };
  });
  gridPromise = analyzeBeats(a.buffer, trackKey(s, trackType, a.buffer))
    .then((r) => gridFrom(r) || fallback())
    .then((g) => {
      if (audio !== a || !g) return null;
      grid = g;
      laneSetGrid(grid);
      return grid;
    }).catch(() => null);
}
async function loadChordTimes() {
  if (!song || !audio || !audio.buffer) return;
  try {
    const T = await import('../chords/trackChords.js');
    const c = T.cacheGet(T.trackChordId(song, trackType, audio.buffer));
    if (c && Array.isArray(c.seg)) chordTimes = c.seg.filter((x) => x.r >= 0).map((x) => x.s);
  } catch (_) {}
}
let selTimer = 0, selHinted = false;
function select(id) {
  selectedId = id;
  armSelTimer();
  if (id && !selHinted && canEditActiveLibrary()) {
    selHinted = true;
    window.showToast?.('Sección seleccionada: ← → la mueven por compás · Supr la quita · Esc la suelta.', 'info');
  }
}
function armSelTimer() { clearTimeout(selTimer); if (selectedId) selTimer = setTimeout(deselect, 8000); }
function deselect() {
  clearTimeout(selTimer);
  if (!selectedId) return;
  selectedId = null;
  markersEl?.querySelectorAll('.sw-pill.is-selected').forEach((p) => p.classList.remove('is-selected'));
}
function snapTime(t) {
  const clamp = (v) => Math.max(0, Math.min(duration - 0.5, Math.round(v * 100) / 100));
  if (grid && grid.downbeats) {
    const bar = nearestIn(grid.downbeats, t, grid.barSec * 0.35);
    if (bar != null) return clamp(bar);
  } else if (grid) {
    const bar = grid.off + Math.round((t - grid.off) / grid.barSec) * grid.barSec;
    if (Math.abs(bar - t) <= grid.barSec * 0.35) return clamp(bar);
  }
  let best = null;
  for (const c of chordTimes) if (Math.abs(c - t) <= 0.6 && (best == null || Math.abs(c - t) < Math.abs(best - t))) best = c;
  return best != null ? clamp(best) : clamp(t);
}
function nudge(m, dir, unit) {
  let t;
  if (unit === 'fine') t = m.t + dir * 0.1;
  else if (grid && grid.beats && (unit === 'beat' || grid.downbeats)) {
    // Pulsos / compases reales de la pista.
    t = stepIn(unit === 'beat' ? grid.beats : grid.downbeats, m.t, dir);
    if (t == null) t = m.t;
  } else if (grid) {
    const step = unit === 'beat' ? grid.beatSec : grid.barSec;
    const k = (m.t - grid.off) / step;
    t = grid.off + (dir > 0 ? Math.floor(k + 1e-3) + 1 : Math.ceil(k - 1e-3) - 1) * step;
  } else t = m.t + dir * (unit === 'beat' ? 0.5 : 1);
  m.t = Math.max(0, Math.min(duration - 0.5, Math.round(t * 100) / 100));
  delete m.auto;
  persist(); renderMarkers();
  if (audio && audio.paused) seekTo(m.t);
}
function confirmAll() {
  if (!song || !guardEdit()) return;
  let n = 0;
  getMarkers().forEach((m) => { if (m.auto) { delete m.auto; n++; } });
  if (!n) return;
  persist(); renderMarkers();
  window.showToast?.('Secciones revisadas: ya no se marcan como suposición.', 'success');
}
function restoreSnap(str) {
  restoring = true;
  try { song.markers = JSON.parse(str); persist(); } finally { restoring = false; }
  selectedId = null; renderMarkers();
}
function undo() {
  if (!song || !undoStack.length) return false;
  redoStack.push(baseSnap); restoreSnap(undoStack.pop());
  window.showToast?.('Deshecho · Ctrl+Y para rehacer', 'info');
  return true;
}
function redo() {
  if (!song || !redoStack.length) return false;
  undoStack.push(baseSnap); restoreSnap(redoStack.pop());
  window.showToast?.('Rehecho', 'info');
  return true;
}
function onKey(e) {
  if (!song || !audio || !duration) return;
  if (document.body.dataset.workspace === 'stems') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('[aria-modal="true"], .lyrics-modal-overlay, .card-more-menu')) return;
  const mod = e.ctrlKey || e.metaKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { if (canEditActiveLibrary() && (e.shiftKey ? redo() : undo())) handled(); return; }
  if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) { if (canEditActiveLibrary() && redo()) handled(); return; }
  if (!selectedId || mod) return;
  const m = getMarkers().find((x) => x.id === selectedId);
  if (!m) { selectedId = null; return; }
  if (e.key === 'Escape') { deselect(); handled(); return; }
  if (!canEditActiveLibrary()) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { handled(); armSelTimer(); nudge(m, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey ? 'beat' : e.altKey ? 'fine' : 'bar'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { handled(); const id = m.id; selectedId = null; removeMarker(id); }
}

// Acordes de la pista para ubicar las secciones de la letra: se esperan los del modelo
// (BTC, unos segundos) porque aciertan bastante más que los rápidos, también el tono
// letra → audio; si no llegan en 30 s (o no hay modelo), se usan los rápidos.
async function trackChordsFor(s, a) {
  const T = await import('../chords/trackChords.js');
  const id = T.trackChordId(s, trackType, a.buffer);
  const r = T.cacheGet(id) || await T.analyzeBufferCached(id, a.buffer);
  const better = await Promise.race([
    T.refineChords(id, a.buffer).catch(() => null),
    new Promise((res) => setTimeout(() => res(null), 30000)),
  ]);
  return better || T.cacheGet(id) || r;
}

/** Tramo de la sección (de su marcador al siguiente). */
function sectionRange(id) {
  const ms = sortedMarkers();
  const i = ms.findIndex((m) => m.id === id);
  if (i < 0) return null;
  return { m: ms[i], a: ms[i].t, b: i + 1 < ms.length ? ms[i + 1].t : duration };
}
function practiceSection(id) {
  const r = sectionRange(id);
  if (r && audio) loopSection(r.a, r.b, r.m.label);
}

function openAddMenu(anchor) {
  if (!song || !audio || !guardEdit()) return;
  const items = [{ label: getMarkers().length ? 'Volver a detectar secciones…' : 'Detectar secciones automáticamente', icon: ICO_AUTO, onSelect: () => autoDetect({}) }];
  items.push(...QUICK_LABELS.map(label => ({ label, onSelect: () => addMarker(label) })));
  items.push({ label: 'Otro nombre…', onSelect: () => showDialog('Nombre de la sección', 'Ej. Coda, Tag 2…', (v) => { v = (v || '').trim(); if (v) addMarker(v); }) });
  items.push({ label: 'Ver la guía de la onda', onSelect: () => startWaveTour(root, { editable: canEditActiveLibrary() }) });
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

function removeMarker(id) {
  if (!song || !guardEdit()) return;
  const s = song, m = getMarkers().find((v) => v.id === id); if (!m) return;
  const prev = getMarkers().map((v) => ({ ...v }));
  s.markers = getMarkers().filter((v) => v.id !== id);
  persist(); renderMarkers();
  window.showToast?.(`Sección «${m.label}» quitada`, 'info', {
    action: { label: 'Deshacer', onClick: () => { if (song !== s) return; s.markers = prev; persist(); renderMarkers(); } },
  });
}

function openMarkerMenu(x, y, id) {
  const m = getMarkers().find(v => v.id === id); if (!m) return;
  const loopItem = { label: 'Practicar esta sección en bucle', onSelect: () => practiceSection(id) };
  if (!canEditActiveLibrary()) { openContextMenu(x, y, [{ label: 'Ir a esta sección', onSelect: () => seekTo(m.t) }, loopItem]); return; }
  openContextMenu(x, y, [
    { label: 'Ir a esta sección', onSelect: () => seekTo(m.t) },
    loopItem,
    ...(m.auto ? [{ label: 'Está bien (confirmar)', onSelect: () => { delete m.auto; persist(); renderMarkers(); } }] : []),
    { label: 'Renombrar…', onSelect: () => showDialog('Renombrar sección', m.label, (v) => { v = (v || '').trim(); if (v) { m.label = v; delete m.auto; persist(); renderMarkers(); } }) },
    { label: 'Mover al cabezal', onSelect: () => { m.t = Math.round((audio.currentTime || 0) * 10) / 10; delete m.auto; persist(); renderMarkers(); } },
    { label: 'Eliminar', danger: true, onSelect: () => removeMarker(id) },
  ]);
}
