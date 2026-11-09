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
import { pushModal } from './modalStack.js';

const LS_GEOM = 'livepads-lyricspanel-geom';
const LS_PREFS = 'livepads-lyricspanel-prefs';
let overlay = null, panel = null, popModal = null;
let current = null;   // { title, artist, key, html }
let prefs = { size: 20, chords: true, follow: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (_) {}
const savePrefs = () => { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (_) {} };
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Datos de la letra de una tarjeta de la lista. */
function payloadFrom(card) {
  if (!card) return null;
  const content = card.querySelector('.lyrics-text-content');
  const key = (card.querySelector('.gi-key-chip, .gi-chip--key') || {}).textContent || '';
  return {
    title: (card.querySelector('.gi-song-title') || {}).textContent || '',
    artist: (card.querySelector('.gi-song-artist') || {}).textContent || '',
    key: key.trim(),
    html: content ? content.innerHTML : '',
  };
}

function saveGeom() {
  if (!panel) return;
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

function paint() {
  if (!panel || !current) return;
  panel.querySelector('.lyp-title').textContent = current.title || 'Letra';
  panel.querySelector('.lyp-sub').textContent = [current.artist, current.key ? `Tono ${current.key}` : ''].filter(Boolean).join(' · ');
  const body = panel.querySelector('.lyp-body');
  body.querySelector('.lyp-cols').innerHTML = current.html || '<p class="lyp-empty">Esta canción no tiene letra.</p>';
  paintPrefs();
}
function paintPrefs() {
  if (!panel) return;
  const body = panel.querySelector('.lyp-body');
  body.style.setProperty('--lyp-size', `${prefs.size}px`);
  body.classList.toggle('hide-chords', !prefs.chords);
  panel.querySelector('[data-do="chords"]').classList.toggle('is-on', prefs.chords);
  panel.querySelector('[data-do="follow"]').classList.toggle('is-on', prefs.follow);
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
            <button type="button" class="lyp-btn" data-do="smaller" title="Letra más pequeña" aria-label="Letra más pequeña">A−</button>
            <button type="button" class="lyp-btn" data-do="bigger" title="Letra más grande" aria-label="Letra más grande">A+</button>
            <button type="button" class="lyp-btn" data-do="chords" title="Mostrar u ocultar los acordes">Acordes</button>
            <button type="button" class="lyp-btn" data-do="follow" title="Cambiar sola a la canción que suena">Seguir</button>
            <button type="button" class="lyp-btn" data-do="screen" title="Abrir también en una ventana aparte, para llevarla a otra pantalla (TV, segundo monitor)">Otra pantalla</button>
          </div>
          <button class="tun-close" type="button" data-do="close" aria-label="Cerrar">✕</button>
        </div>
        <div class="lyp-body lyrics-text-content"><div class="lyp-cols"></div></div>
      </div>`;
    document.body.appendChild(overlay);
    panel = overlay.querySelector('.lyp-panel');
    makeDraggable(overlay.querySelector('[data-drag]'));
    restoreGeom();
    // Guardar el tamaño al soltar el redimensionado (esquina).
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(saveGeom, 300); }).observe(panel);
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const w = b.dataset.do;
      if (w === 'close') close();
      else if (w === 'smaller') { prefs.size = Math.max(12, prefs.size - 2); savePrefs(); paintPrefs(); }
      else if (w === 'bigger') { prefs.size = Math.min(48, prefs.size + 2); savePrefs(); paintPrefs(); }
      else if (w === 'chords') { prefs.chords = !prefs.chords; savePrefs(); paintPrefs(); }
      else if (w === 'follow') { prefs.follow = !prefs.follow; savePrefs(); paintPrefs(); window.electronAPI?.lyricsWindowSetFollow?.(prefs.follow); }
      else if (w === 'screen') window.electronAPI?.lyricsWindowShow?.(current);
    });
    popModal = pushModal(() => close());
    requestAnimationFrame(() => overlay && overlay.classList.add('open'));
  }
  paint();
  panel.querySelector('.lyp-body').scrollTop = 0;
}

function close() {
  if (!overlay) return;
  saveGeom();
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
  window.addEventListener('livepads:open-lyrics', (e) => { if (e.detail) open(e.detail); });
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
      if (overlay) { current = data; paint(); panel.querySelector('.lyp-body').scrollTop = 0; }
      window.electronAPI?.lyricsWindowFollow?.(data);
    });
  });
  window.electronAPI?.lyricsWindowSetFollow?.(prefs.follow);
}
