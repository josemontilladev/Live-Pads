// ─────────────────────────────────────────────────────────────────────────
// Letra de una canción en un panel FLOTANTE (mismo estilo que el Metrónomo y el
// Afinador): se arrastra por la cabecera, se redimensiona desde la esquina y
// recuerda posición y tamaño. Así cada uno la pone donde no le estorbe (el
// baterista sigue viendo sus pads). «Otra pantalla» la abre además en una
// ventana propia para llevarla a una TV o un segundo monitor (lyrics.html).
//
// La lógica de abrir/cerrar sigue siendo la del desplegable de la tarjeta
// (songState.js): al abrirse uno, su contenido (ya formateado y en el tono del
// servicio) se muestra aquí y el desplegable (oculto en Pads) se vuelve a cerrar.
// Con «Seguir canción» cambia sola a la canción que suena.
// ─────────────────────────────────────────────────────────────────────────

import { closeAllLyrics } from './songState.js';
import { isBandFollowing, toggleBandFollow } from '../live/bandFollow.js';
import { pushModal } from './modalStack.js';
import { closeButton } from './components.js';
import { chordNumbersOn, setChordNumbers } from '../utils/chordNumbers.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { ensureCardLyrics } from './songCard.js';
import { lineTimes, lineAt } from './lyricTiming.js';
import { markersFor } from '../data/markers.js';
import { getTrackAudio, getCurrentSong, getCurrentType } from '../audio/trackPlayer.js';
import { getServiceSongs, getActiveServiceIndex, getEffectiveKey } from '../data/service.js';
import { getPendingJump } from '../live/arrange.js';
import { detectSectionHeader } from './lyricsFormat.js';

const LS_GEOM = 'livepads-lyricspanel-geom';
const LS_PREFS = 'livepads-lyricspanel-prefs';
let overlay = null, panel = null, popModal = null;
let current = null;   // { title, artist, key, html }
let prefs = { size: 20, chords: true, follow: true, autoLines: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (_) {}
// Acoplada: la letra ocupa exactamente el hueco de la batería y el mezclador
// (columna central) y lo sigue al cambiar el tamaño de la ventana, así nunca
// queda tapando a medias otra cosa. Es lo normal en una instalación nueva; quien
// ya la tenía colocada a mano conserva su sitio (y puede acoplarla con el botón).
if (typeof prefs.docked !== 'boolean') {
  let hadGeom = false;
  try { hadGeom = !!localStorage.getItem(LS_GEOM); } catch (_) {}
  prefs.docked = !hadGeom;
}
const savePrefs = () => { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (_) {} };
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Datos de la letra de una tarjeta de la lista. */
function payloadFrom(card) {
  if (!card) return null;
  ensureCardLyrics(card);
  const content = card.querySelector('.lyrics-text-content');
  const key = (card.querySelector('.gi-key-chip, .gi-chip--key') || {}).textContent || '';
  const box = card.closest('#gi-songs-container, #service-songs-container');
  return {
    title: (card.querySelector('.gi-song-title') || {}).textContent || '',
    artist: (card.querySelector('.gi-song-artist') || {}).textContent || '',
    key: key.trim(),
    html: content ? content.innerHTML : '',
    // De qué tarjeta viene (para «Editar» / «Pantalla completa» y refrescar tras editar).
    ref: box ? (card.dataset.serviceId != null
      ? { box: box.id, attr: 'data-service-id', id: card.dataset.serviceId }
      : { box: box.id, attr: 'data-song-id', id: card.dataset.songId }) : null,
  };
}
function findCard(ref) {
  if (!ref || ref.id == null) return null;
  return document.querySelector(`#${ref.box} .gi-song-item[${ref.attr}="${CSS.escape(String(ref.id))}"]`);
}
// Mientras el panel está abierto, se vigila su tarjeta: al guardar la letra en el editor
// la tarjeta se vuelve a pintar y el panel se actualiza solo.
let cardObs = null;
function watchCard() {
  if (cardObs) { cardObs.disconnect(); cardObs = null; }
  const card = current && findCard(current.ref);
  if (!card || !overlay) return;
  cardObs = new MutationObserver(() => {
    const fresh = payloadFrom(findCard(current && current.ref));
    if (fresh && fresh.html !== current.html) { current = fresh; paint(); }
  });
  cardObs.observe(card, { childList: true, subtree: true, characterData: true });
}
function clickInCard(action) {
  const card = current && findCard(current.ref);
  const b = card && card.querySelector(`[data-action="${action}"]`);
  if (b) b.click();
  else window.showToast?.('Abre la canción desde la lista (Librería o Servicio) para editar su letra.', 'info');
}

// Hueco donde se acopla: de la parte alta de la batería al final del mezclador.
function dockRect() {
  const grid = document.getElementById('drum-grid');
  const mixer = document.getElementById('mixer-bar');
  const vis = (el) => el && el.getClientRects().length && (typeof el.checkVisibility !== 'function' || el.checkVisibility());
  if (!vis(grid)) return null;
  const g = grid.getBoundingClientRect();
  const m = vis(mixer) ? mixer.getBoundingClientRect() : g;
  const left = Math.min(g.left, m.left), right = Math.max(g.right, m.right);
  let top = g.top;
  const bottom = Math.max(g.bottom, m.bottom);
  // Pantallas bajas (portátil): ese hueco da para dos líneas. Se sube hasta cubrir
  // también el metrónomo; el tempo ya lo pone la canción y el click se maneja abajo.
  if (bottom - top < 330) {
    const metro = document.getElementById('panel-metro');
    if (vis(metro)) top = Math.min(top, metro.getBoundingClientRect().top);
  }
  if (right - left < 280 || bottom - top < 160) return null;
  return { left, top, width: right - left, height: bottom - top };
}
let dockSize = null;      // último tamaño puesto por el acople (para distinguir un redimensionado manual)
function fitDock() {
  if (!panel || !prefs.docked) return false;
  const r = dockRect();
  if (!r) return false;
  dockSize = { w: Math.round(r.width), h: Math.round(r.height) };
  panel.style.left = `${Math.round(r.left)}px`; panel.style.top = `${Math.round(r.top)}px`;
  panel.style.width = `${dockSize.w}px`; panel.style.height = `${dockSize.h}px`;
  panel.style.transform = 'none';
  return true;
}
function setDocked(on) {
  prefs.docked = on; savePrefs();
  if (panel) {
    panel.classList.toggle('is-docked', on);
    const b = panel.querySelector('[data-do="dock"]');
    if (b) b.classList.toggle('is-on', on);
  }
  if (on && !fitDock()) window.showToast?.('Aquí no hay hueco para acoplar la letra; queda flotante.', 'info');
}
let dockWatch = null;
function watchDock() {
  if (dockWatch) return;
  let raf = 0;
  const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitDock); };
  const ro = new ResizeObserver(refit);
  for (const id of ['drum-grid', 'mixer-bar']) { const el = document.getElementById(id); if (el) ro.observe(el); }
  window.addEventListener('resize', refit);
  dockWatch = () => { ro.disconnect(); window.removeEventListener('resize', refit); cancelAnimationFrame(raf); dockWatch = null; };
}

function saveGeom() {
  if (!panel || prefs.docked) return;
  const r = panel.getBoundingClientRect();
  try { localStorage.setItem(LS_GEOM, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })); } catch (_) {}
}
function restoreGeom() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem(LS_GEOM) || 'null'); } catch (_) {}
  if (!g || typeof g.x !== 'number') return;
  const W = Math.min(g.w || 520, Math.round(window.innerWidth * 0.96));
  const H = Math.min(g.h || 560, window.innerHeight - 16);
  panel.style.width = `${W}px`; panel.style.height = `${H}px`;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - W - 8, g.x))}px`;
  panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, g.y))}px`;
  panel.style.transform = 'none';
}
function makeDraggable(handle) {
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label')) return;
    dragging = true;
    if (prefs.docked) setDocked(false);        // arrastrarla la suelta del acople
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
  const end = (e) => { if (!dragging) return; dragging = false; saveGeom(); try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// Redimensionar arrastrando cualquier borde o esquina (antes solo la esquina
// inferior derecha, y nada si estaba acoplada). Igual que al moverla por la
// cabecera, redimensionarla la suelta del acople; el tamaño se recuerda.
const LYP_MIN_W = 320, LYP_MIN_H = 200;
function makeResizable() {
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const h = document.createElement('div');
    h.className = `lyp-rz lyp-rz--${dir}`;
    h.setAttribute('aria-hidden', 'true');
    panel.appendChild(h);
    let start = null;
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (prefs.docked) setDocked(false);
      const r = panel.getBoundingClientRect();
      panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`; panel.style.transform = 'none';
      panel.style.width = `${r.width}px`; panel.style.height = `${r.height}px`;
      start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height };
      panel.classList.add('is-resizing');
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    h.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      let { l, t, w, h: ht } = start;
      const maxR = window.innerWidth - 8, maxB = window.innerHeight - 8;
      if (dir.includes('e')) w = Math.min(maxR - l, Math.max(LYP_MIN_W, start.w + dx));
      if (dir.includes('s')) ht = Math.min(maxB - t, Math.max(LYP_MIN_H, start.h + dy));
      if (dir.includes('w')) { const nl = Math.max(8, Math.min(start.l + start.w - LYP_MIN_W, start.l + dx)); w = start.w + (start.l - nl); l = nl; }
      if (dir.includes('n')) { const nt = Math.max(8, Math.min(start.t + start.h - LYP_MIN_H, start.t + dy)); ht = start.h + (start.t - nt); t = nt; }
      panel.style.left = `${l}px`; panel.style.top = `${t}px`;
      panel.style.width = `${w}px`; panel.style.height = `${ht}px`;
    });
    const end = (e) => {
      if (!start) return;
      start = null; panel.classList.remove('is-resizing'); saveGeom();
      try { h.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }
}

function paint() {
  if (!panel || !current) return;
  panel.querySelector('.lyp-title').textContent = current.title || 'Letra';
  panel.querySelector('.lyp-sub').textContent = [current.artist, current.key ? `Tono ${current.key}` : ''].filter(Boolean).join(' · ');
  const body = panel.querySelector('.lyp-body');
  body.querySelector('.lyp-cols').innerHTML = current.html || '<p class="lyp-empty">Esta canción no tiene letra.</p>';
  lt.key = null; lt.active = -1;
  paintPrefs();
}
function paintPrefs() {
  if (!panel) return;
  const body = panel.querySelector('.lyp-body');
  body.style.setProperty('--lyp-size', `${prefs.size}px`);
  body.classList.toggle('hide-chords', !prefs.chords);
  panel.querySelector('[data-do="chords"]').classList.toggle('is-on', prefs.chords);
  panel.querySelector('[data-do="follow"]').classList.toggle('is-on', prefs.follow);
  panel.querySelector('[data-do="dock"]').classList.toggle('is-on', !!prefs.docked);
  panel.classList.toggle('is-docked', !!prefs.docked);
}

// ⋯ Herramientas: las acciones del panel con su nombre (antes eran 10 iconos
// sueltos). Los botones originales siguen en la cabecera, ocultos: los pedales y
// botones MIDI asignados a «subir / bajar la letra» los siguen pulsando.
function openToolsMenu(anchorBtn) {
  const go = (w) => panel?.querySelector(`.lyp-tools [data-do="${w}"]`)?.click();
  const I = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  openCardMoreMenu(anchorBtn, [
    { icon: I('<polyline points="6 15 12 9 18 15"/>'), label: 'Subir la letra', onSelect: () => go('up') },
    { icon: I('<polyline points="6 9 12 15 18 9"/>'), label: 'Bajar la letra', onSelect: () => go('down') },
    { sep: true },
    { icon: I('<path d="M4 20l6-16 6 16M6.5 14h7"/><path d="M17 8h4M19 6v4"/>'), label: `Letra más grande · ${prefs.size}`, onSelect: () => go('bigger') },
    { icon: I('<path d="M4 20l6-16 6 16M6.5 14h7"/><path d="M17 8h4"/>'), label: 'Letra más pequeña', onSelect: () => go('smaller') },
    { sep: true },
    { icon: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'), label: 'Mostrar acordes', checked: !!prefs.chords, onSelect: () => go('chords') },
    { icon: I('<path d="M4 7h3v10"/><path d="M11 7h5l-4 5a3 3 0 1 1-2 4"/><path d="M19 7v10"/>'), label: 'Acordes como grados (1·4·5)', hint: 'Iguales en cualquier tono: C G Am F en C = 1 5 6m 4', checked: chordNumbersOn(), onSelect: () => setChordNumbers(!chordNumbersOn()) },
    { icon: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v8M12 5v8M17 5v8"/>'), label: 'Notas para improvisar', hint: 'Escala y pentatónica del tono de la canción', onSelect: () => import('./scaleHelper.js').then((m) => m.showScaleHelper(anchorBtn, (current && current.key) || '', (current && current.title) || '')) },
    { icon: I('<path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 14l3 3-3 3"/>'), label: 'La letra avanza sola', hint: 'Resalta la línea que va y la mantiene a la vista mientras suena la pista (también en la TV)', checked: prefs.autoLines !== false, onSelect: () => { prefs.autoLines = prefs.autoLines === false; savePrefs(); lt.key = null; if (!prefs.autoLines) clearLineMarks(); } },
    { icon: I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'), label: 'Seguir la canción que suena', hint: 'Cambia sola al cambiar de canción', checked: !!prefs.follow, onSelect: () => go('follow') },
    { icon: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), label: 'La letra sigue a la banda', hint: 'Sin pista: avanza con los acordes que oye el micrófono', checked: isBandFollowing(), onSelect: () => toggleBandFollow() },
    { icon: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'), label: 'Acoplar al centro', hint: 'Ocupa el hueco de la batería y el mezclador', checked: !!prefs.docked, onSelect: () => go('dock') },
    { sep: true },
    { icon: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'), label: 'Editar letra y acordes', onSelect: () => go('edit') },
    { icon: I('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'), label: 'Pantalla completa', hint: 'Para leer en vivo, desde lejos', onSelect: () => go('fs') },
    { icon: I('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'), label: 'Llevar a otra pantalla', hint: 'TV o segundo monitor', onSelect: () => go('screen') },
    { icon: I('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>'), label: 'Fondo de la pantalla (TV)…', hint: 'Fondos animados, imagen o video detrás de la letra', onSelect: () => import('./lyricsBgDialog.js').then((m) => m.openLyricsBgDialog()) },
  ]);
}

function open(data) {
  current = data;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lyrics-panel-overlay';
    overlay.innerHTML = `
      <div class="lyp-panel" role="dialog" aria-label="Letra">
        <div class="lyp-head" data-drag>
          <span class="mtm-drag-dots" aria-hidden="true">⠿</span>
          <div class="lyp-titles"><b class="lyp-title">Letra</b><span class="lyp-sub"></span></div>
          <div class="lyp-tools">
            <button type="button" class="lyp-btn" data-do="up" title="Subir la letra (asignable a un pedal o botón MIDI)" aria-label="Subir la letra"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg></button>
            <button type="button" class="lyp-btn" data-do="down" title="Bajar la letra (asignable a un pedal o botón MIDI)" aria-label="Bajar la letra"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
            <button type="button" class="lyp-btn lyp-btn--txt" data-do="smaller" title="Letra más pequeña" aria-label="Letra más pequeña"><span class="lyp-a lyp-a--sm">A</span></button>
            <button type="button" class="lyp-btn lyp-btn--txt" data-do="bigger" title="Letra más grande" aria-label="Letra más grande"><span class="lyp-a lyp-a--lg">A</span></button>
            <button type="button" class="lyp-btn" data-do="chords" title="Mostrar u ocultar los acordes" aria-label="Acordes"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></button>
            <button type="button" class="lyp-btn" data-do="follow" title="Seguir la canción que suena (cambia sola)" aria-label="Seguir la canción"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg></button>
            <button type="button" class="lyp-btn" data-do="dock" title="Acoplar la letra al centro de la pantalla (o soltarla para moverla)" aria-label="Acoplar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg></button>
            <button type="button" class="lyp-btn" data-do="edit" title="Editar la letra y los acordes" aria-label="Editar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button type="button" class="lyp-btn" data-do="fs" title="Letra a pantalla completa (uso en vivo)" aria-label="Pantalla completa"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
            <button type="button" class="lyp-btn" data-do="screen" title="Llevar la letra a otra pantalla (TV, segundo monitor)" aria-label="Otra pantalla"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></button>
          </div>
          <button type="button" class="lyp-more" data-do="more" aria-haspopup="menu" title="Herramientas de la letra: tamaño, acordes, seguir la canción, pantalla completa…">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
            <span>Herramientas</span>
          </button>
          ${closeButton({ cls: 'tun-close', attrs: { 'data-do': 'close' } })}
        </div>
        <div class="lyp-body lyrics-text-content"><div class="lyp-cols"></div></div>
        <div class="lyp-next" hidden>
          <div class="lyp-next-sec" hidden><span class="lyp-next-k">Después se canta</span><b data-ref="sec"></b><span class="lyp-next-line" data-ref="line"></span></div>
          <div class="lyp-next-song" hidden><span class="lyp-next-k">Siguiente canción</span><b data-ref="song"></b><span class="lyp-next-key" data-ref="key"></span></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    panel = overlay.querySelector('.lyp-panel');
    makeDraggable(overlay.querySelector('[data-drag]'));
    makeResizable();
    if (!fitDock()) restoreGeom();
    watchDock();
    // Guardar el tamaño al soltar el redimensionado (esquina). Si estaba acoplada
    // y el tamaño ya no es el del acople, es que la redimensionaron a mano: se suelta.
    let rt = 0;
    new ResizeObserver(() => {
      if (prefs.docked && dockSize && panel) {
        if (Math.abs(panel.offsetWidth - dockSize.w) > 3 || Math.abs(panel.offsetHeight - dockSize.h) > 3) setDocked(false);
        return;
      }
      clearTimeout(rt); rt = setTimeout(saveGeom, 300);
    }).observe(panel);
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const w = b.dataset.do;
      if (w === 'close') close();
      else if (w === 'more') openToolsMenu(b);
      else if (w === 'up' || w === 'down') {
        const body = panel.querySelector('.lyp-body');
        body.scrollBy({ top: (w === 'down' ? 1 : -1) * Math.max(80, body.clientHeight * 0.8), behavior: 'smooth' });
      }
      else if (w === 'smaller') { prefs.size = Math.max(12, prefs.size - 2); savePrefs(); paintPrefs(); }
      else if (w === 'bigger') { prefs.size = Math.min(48, prefs.size + 2); savePrefs(); paintPrefs(); }
      else if (w === 'chords') { prefs.chords = !prefs.chords; savePrefs(); paintPrefs(); }
      else if (w === 'dock') setDocked(!prefs.docked);
      else if (w === 'follow') { prefs.follow = !prefs.follow; savePrefs(); paintPrefs(); window.electronAPI?.lyricsWindowSetFollow?.(prefs.follow); }
      else if (w === 'screen') window.electronAPI?.lyricsWindowShow?.(current);
      else if (w === 'edit') clickInCard('edit-lyrics');
      else if (w === 'fs') clickInCard('lyrics-fullscreen');
    });
    popModal = pushModal(() => close());
    requestAnimationFrame(() => overlay && overlay.classList.add('open'));
  }
  paint();
  panel.querySelector('.lyp-body').scrollTop = 0;
  watchCard();
}

function close() {
  if (!overlay) return;
  saveGeom();
  if (cardObs) { cardObs.disconnect(); cardObs = null; }
  if (dockWatch) dockWatch();
  if (popModal) { popModal(); popModal = null; }
  overlay.classList.remove('open');
  const node = overlay; overlay = null; panel = null;
  setTimeout(() => node.remove(), 180);
}

export function initLyricsOverlay() {
  // «Letra» pulsado en una tarjeta de Pads → panel flotante.
  window.addEventListener('livepads:lyrics-panel', () => {
    const acc = document.querySelector('#panel-setlist .gi-song-item .gi-lyrics-accordion.open');
    if (!acc) return;
    open(payloadFrom(acc.closest('.gi-song-item')));
    closeAllLyrics();   // el desplegable (oculto en Pads) no se queda «abierto»
  });
  // «Letra» de la barra del espectro (liveLyrics.js) → la canción activa, en el panel.
  window.addEventListener('livepads:open-lyrics', (e) => {
    if (!e.detail) return;
    // Para «Editar»: la tarjeta de la canción activa, si está en la lista.
    const card = document.querySelector('#panel-setlist .gi-song-item.active-song');
    const fromCard = card && payloadFrom(card);
    open({ ...e.detail, ref: fromCard ? fromCard.ref : null });
  });
  // La tarjeta se volvió a pintar (otro tono del día, letra editada…): el panel
  // abierto toma la versión nueva (el observador quedó en la tarjeta vieja).
  const refreshFromCard = () => requestAnimationFrame(() => {
    if (!overlay || !current || !current.ref) return;
    const fresh = payloadFrom(findCard(current.ref));
    if (fresh && (fresh.html !== current.html || fresh.key !== current.key)) {
      current = fresh; paint(); watchCard();
      window.electronAPI?.lyricsWindowFollow?.(fresh);
    }
  });
  window.addEventListener('livepads:songs-changed', refreshFromCard);
  window.addEventListener('livepads:service-changed', refreshFromCard);
  // Cambia la canción que suena → el panel (y la ventana de otra pantalla) la siguen.
  let lastId = null;
  window.addEventListener('livepads:song-state', () => {
    requestAnimationFrame(() => {
      const card = document.querySelector('#panel-setlist .gi-song-item.active-song');
      const id = card && (card.dataset.serviceId || card.dataset.songId);
      if (!card || id === lastId) return;
      lastId = id;
      if (!prefs.follow) return;
      const data = payloadFrom(card);
      if (overlay) { current = data; paint(); panel.querySelector('.lyp-body').scrollTop = 0; watchCard(); }
      window.electronAPI?.lyricsWindowFollow?.(data);
    });
  });
  window.electronAPI?.lyricsWindowSetFollow?.(prefs.follow);
  setInterval(lineTick, 150);
  setInterval(nextTick, 400);
}


// ── Lo que viene: la sección siguiente (con su primera línea) y la canción siguiente ──
// Si hay un salto preparado con «Arreglo» (repetir coro…), dice ese destino.
// (La firma de lo pintado vive en el propio pie: el panel se vuelve a crear al reabrirlo.)
function firstLineOf(label) {
  const cols = panel?.querySelector('.lyp-cols');
  const want = detectSectionHeader(label || '');
  if (!cols || !want) return '';
  let pick = null, loose = null;
  for (const h of cols.querySelectorAll('.section-header-line')) {
    const got = detectSectionHeader(h.textContent || '');
    if (!got || got.canon !== want.canon) continue;
    if (!loose) loose = h;
    if (String(got.num || '') === String(want.num || '')) { pick = h; break; }
  }
  let el = (pick || loose)?.nextElementSibling;
  while (el && !el.classList.contains('lyric-line')) { if (el.classList.contains('section-header-line')) return ''; el = el.nextElementSibling; }
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.inline-chord, .chord-line').forEach((n) => n.remove());
  return (c.textContent || '').replace(/\s+/g, ' ').trim();
}
function nextTick() {
  if (!overlay || overlay.hidden || !panel || !current) return;
  const box = panel.querySelector('.lyp-next');
  if (!box) return;
  // Sección siguiente: solo si el panel muestra la canción que suena.
  let sec = null;
  const audio = getTrackAudio(), song = getCurrentSong();
  if (audio && song && String(song.title || '').trim() === String(current.title || '').trim()) {
    const t = audio.currentTime || 0;
    const j = getPendingJump();
    if (j && j.label && j.at > t) sec = j.label;
    else {
      const m = markersFor(song, getCurrentType()).slice().sort((a, b) => a.t - b.t).find((x) => x.t > t + 0.4 && x.label);
      if (m) sec = m.label;
    }
  }
  // Canción siguiente del servicio (la última no tiene siguiente).
  let nextSong = null;
  try { const list = getServiceSongs(), i = getActiveServiceIndex(); if (i >= 0 && i + 1 < list.length) nextSong = list[i + 1]; } catch (_) {}
  const sig = JSON.stringify([sec, nextSong && nextSong.id, nextSong && getEffectiveKey(nextSong), (current.html || '').length]);
  if (sig === box.dataset.sig) return;
  box.dataset.sig = sig;
  const secRow = box.querySelector('.lyp-next-sec'), songRow = box.querySelector('.lyp-next-song');
  secRow.hidden = !sec;
  if (sec) {
    box.querySelector('[data-ref="sec"]').textContent = sec;
    box.querySelector('[data-ref="line"]').textContent = firstLineOf(sec);
  }
  songRow.hidden = !nextSong;
  if (nextSong) {
    box.querySelector('[data-ref="song"]').textContent = nextSong.title || 'Sin título';
    const k = getEffectiveKey(nextSong) || nextSong.key || '';
    box.querySelector('[data-ref="key"]').textContent = k ? `Tono ${k}` : '';
  }
  box.hidden = !sec && !nextSong;
}

// ── La letra avanza sola ─────────────────────────────────────────────────
// Si el panel muestra la canción que suena, la línea actual se resalta (las cantadas,
// atenuadas) y se mantiene a la vista; la TV recibe la misma línea. Tiempos: ver
// lyricTiming.js (a mano si se sincronizó; si no, por las secciones del espectro).
const lt = { key: null, lines: [], active: -1, userUntil: 0 };
function clearLineMarks() {
  panel?.querySelectorAll('.lyp-now, .lyp-past').forEach((e) => e.classList.remove('lyp-now', 'lyp-past'));
  lt.active = -1;
  window.electronAPI?.lyricsWindowLine?.(-1);
}
function lineTick() {
  if (!overlay || !panel || prefs.autoLines === false || !current) return;
  const audio = getTrackAudio(), song = getCurrentSong();
  if (!audio || !song || audio.paused) return;
  if (String(song.title || '').trim() !== String(current.title || '').trim()) return;   // el panel muestra otra canción
  const body = panel.querySelector('.lyp-body'), cols = panel.querySelector('.lyp-cols');
  if (!body.dataset.ltBound) {
    body.dataset.ltBound = '1';
    const pause = () => { lt.userUntil = Date.now() + 6000; };
    body.addEventListener('wheel', pause, { passive: true });
    body.addEventListener('pointerdown', pause);
  }
  const type = getCurrentType();
  const ms = markersFor(song, type);
  const key = [song.id, type, (current.html || '').length, ms.length && ms[ms.length - 1].t, Math.round(audio.duration || 0)].join('|');
  if (lt.key !== key) { lt.key = key; lt.lines = lineTimes(cols, { song, markers: ms, dur: audio.duration || 0 }).lines; lt.active = -1; }
  if (!lt.lines.length) return;
  const idx = lineAt(lt.lines, audio.currentTime || 0);
  if (idx === lt.active) return;
  lt.active = idx;
  const now = idx >= 0 ? lt.lines[idx].el : null;
  lt.lines.forEach((l, i) => { l.el.classList.toggle('lyp-now', l.el === now); l.el.classList.toggle('lyp-past', i < idx && l.el !== now); });
  if (now && Date.now() > lt.userUntil) {
    const top = now.offsetTop - body.clientHeight * 0.3;
    body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  // La TV: el número de línea dentro de la letra (misma letra que el panel).
  if (now) window.electronAPI?.lyricsWindowLine?.([...cols.querySelectorAll('.lyric-line')].indexOf(now));
}
