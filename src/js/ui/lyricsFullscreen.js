// Overlay de pantalla completa para la letra — pensado para uso en vivo
// (legible desde lejos, con A+/A− y toggle de acordes en línea). Una sola
// instancia a la vez; abre/cierra con API explícita y Escape.
//
// Persistencia (localStorage):
//   livepads.lyrics.fs.fontSize  → número 18..56
//   livepads.lyrics.fs.chords    → '1' | '0'  (mostrar acordes por defecto)

import { esc } from '../utils/dom.js';
import { formatLyrics } from './lyricsFormat.js';
import { pushModal } from './modalStack.js';

let popModal = null;

const LS_FONT   = 'livepads.lyrics.fs.fontSize';
const LS_CHORDS = 'livepads.lyrics.fs.chords';
const FONT_MIN = 18;
const FONT_MAX = 56;
const FONT_STEP = 2;
const FONT_DEFAULT = 28;

let overlay = null;

function readFont() {
  const n = parseInt(localStorage.getItem(LS_FONT) || '', 10);
  if (Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX) return n;
  return FONT_DEFAULT;
}
function writeFont(n) { localStorage.setItem(LS_FONT, String(n)); }
function readChords(defaultFromSong) {
  const v = localStorage.getItem(LS_CHORDS);
  if (v === '1') return true;
  if (v === '0') return false;
  return !!defaultFromSong;
}
function writeChords(b) { localStorage.setItem(LS_CHORDS, b ? '1' : '0'); }

export function openLyricsFullscreen(song) {
  if (!song) return;
  close(); // por si ya había uno abierto

  let fontSize = readFont();
  let showChords = readChords(song.showChords);

  overlay = document.createElement('div');
  overlay.className = 'lyrics-fs-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Letra a pantalla completa');
  overlay.innerHTML = `
    <div class="lfs-bar">
      <div class="lfs-meta">
        <div class="lfs-title">${esc(song.title || 'Sin título')}</div>
        <div class="lfs-artist">${esc(song.artist || '')}</div>
      </div>
      <div class="lfs-controls">
        <button type="button" class="lfs-btn" data-act="font-down" title="Letra más pequeña" aria-label="Letra más pequeña">A−</button>
        <span class="lfs-font-val" aria-live="polite">${fontSize}</span>
        <button type="button" class="lfs-btn" data-act="font-up" title="Letra más grande" aria-label="Letra más grande">A+</button>
        <button type="button" class="lfs-btn lfs-chord-toggle ${showChords ? 'active' : ''}" data-act="toggle-chords">${showChords ? 'Con acordes' : 'Solo letra'}</button>
        <button type="button" class="lfs-btn lfs-close" data-act="close" title="Cerrar (Esc)" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="lfs-scroll">
      <div class="lfs-content ${showChords ? '' : 'hide-chords'}" style="font-size:${fontSize}px;">
        ${formatLyrics(song.lyrics)}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('lyrics-fs-open');

  const fontVal   = overlay.querySelector('.lfs-font-val');
  const content   = overlay.querySelector('.lfs-content');
  const chordBtn  = overlay.querySelector('.lfs-chord-toggle');

  const applyFont = () => {
    content.style.fontSize = fontSize + 'px';
    fontVal.textContent = fontSize;
    writeFont(fontSize);
  };
  const applyChords = () => {
    content.classList.toggle('hide-chords', !showChords);
    chordBtn.classList.toggle('active', showChords);
    chordBtn.textContent = showChords ? 'Con acordes' : 'Solo letra';
    writeChords(showChords);
  };

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      // click en backdrop (zona oscura fuera del contenido) → cerrar
      if (e.target === overlay) close();
      return;
    }
    switch (btn.dataset.act) {
      case 'font-up':
        fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP); applyFont(); return;
      case 'font-down':
        fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP); applyFont(); return;
      case 'toggle-chords':
        showChords = !showChords; applyChords(); return;
      case 'close':
        close(); return;
    }
  });

  popModal = pushModal(() => close());
  window.addEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (!overlay) return;
  // Escape lo gestiona modalStack; aquí solo los atajos.
  if (e.key === '+' || e.key === '=') {
    const up = overlay.querySelector('[data-act="font-up"]');
    if (up) up.click();
  } else if (e.key === '-' || e.key === '_') {
    const down = overlay.querySelector('[data-act="font-down"]');
    if (down) down.click();
  } else if (e.key === 'c' || e.key === 'C') {
    const tog = overlay.querySelector('[data-act="toggle-chords"]');
    if (tog) tog.click();
  }
}

function close() {
  if (popModal) { popModal(); popModal = null; }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  document.body.classList.remove('lyrics-fs-open');
  window.removeEventListener('keydown', onKey, true);
}

export function closeLyricsFullscreen() { close(); }
