// Letra a pantalla completa — para leer en vivo, desde lejos.
//
//   · Fondo sólido; la barra (título, tono, BPM, controles) se oculta sola
//     cuando no se mueve el ratón y vuelve al moverlo o al pulsar una tecla.
//   · "Ajustar": calcula el tamaño de letra para que la canción ENTERA quepa en
//     pantalla (sin desplazarse durante la canción). A+/A− lo desactivan.
//   · 1 o 2 columnas; cada sección (Intro, Verso, Coro…) es un bloque que no
//     se parte entre columnas.
//   · Transponer −/+ (efímero, sobre el tono del servicio) y acordes sí/no.
//   · Cejilla 0–9 (se recuerda por canción en este equipo): la canción suena en el
//     mismo tono, pero los acordes se muestran con las posiciones que toca el
//     guitarrista con la cejilla puesta (tono − cejilla).
//   · Teclas: + / − tamaño · C acordes · F ajustar · 2 columnas ·
//     ↓ / ↑ / Espacio desplazar · Esc cerrar.
//
// Preferencias (localStorage): livepads.lyrics.fs.fontSize · .chords · .cols · .fit

import { esc } from '../utils/dom.js';
import { formatLyrics } from './lyricsFormat.js';
import { transposeAll } from './chordTransposer.js';
import { pushModal } from './modalStack.js';

// Transpone la ETIQUETA de tonalidad ("F", "C#m", "Bb") N semitonos para que
// el badge acompañe a los acordes transpuestos.
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT2SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
function transposeKeyLabel(key, semis) {
  if (!key) return '';
  const m = String(key).trim().match(/^([A-G][b#]?)\s*(m|min)?$/i);
  if (!m) return key;
  let root = m[1][0].toUpperCase() + (m[1][1] || '');
  root = FLAT2SHARP[root] || root;
  const idx = SHARP_NOTES.indexOf(root);
  if (idx < 0) return key;
  return SHARP_NOTES[((idx + semis) % 12 + 12) % 12] + (m[2] ? 'm' : '');
}

// Semitonos entre dos tonos, 0 si alguno no se reconoce (nunca lanza: esto se
// abre en vivo, un tono raro no puede impedir ver la letra).
function keyDeltaSafe(from, to) {
  if (!from || !to || from === to) return 0;
  const a = transposeKeyLabel(from, 0), b = transposeKeyLabel(to, 0);
  const idx = (k) => SHARP_NOTES.indexOf(String(k).replace(/m$/i, ''));
  const ia = idx(a), ib = idx(b);
  if (ia < 0 || ib < 0) return 0;
  let d = (ib - ia) % 12;
  if (d > 5) d -= 12;
  return d;
}

const LS_FONT = 'livepads.lyrics.fs.fontSize';
const LS_CHORDS = 'livepads.lyrics.fs.chords';
const LS_COLS = 'livepads.lyrics.fs.cols';
const LS_FIT = 'livepads.lyrics.fs.fit';
// Cejilla por canción: { idCanción: traste }. Preferencia personal del guitarrista
// en este equipo (no viaja a la nube ni cambia la canción del resto del equipo).
const LS_CAPO = 'livepads.lyrics.capo';
const CAPO_MAX = 9;
function readCapos() { try { return JSON.parse(localStorage.getItem(LS_CAPO) || '{}') || {}; } catch (_) { return {}; } }
function capoOf(song) { const n = Number(readCapos()[song && song.id]); return Number.isFinite(n) ? Math.max(0, Math.min(CAPO_MAX, n)) : 0; }
function saveCapo(song, n) {
  if (!song || !song.id) return;
  const m = readCapos();
  if (n > 0) m[song.id] = n; else delete m[song.id];
  try { localStorage.setItem(LS_CAPO, JSON.stringify(m)); } catch (_) {}
}
const FONT_MIN = 18;
const FONT_MAX = 72;
const FONT_STEP = 2;
const FONT_DEFAULT = 32;
// "Ajustar" no baja de aquí: más pequeño ya no se lee desde el escenario. Si la
// canción no cabe ni así, queda en este tamaño y se desplaza.
const FIT_MIN = 26;
const IDLE_MS = 3000;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

let overlay = null;
let popModal = null;
let cleanup = [];

// La salida de formatLyrics es una lista plana de líneas; aquí se agrupa por
// sección (desde cada cabecera hasta la siguiente) para que una sección nunca
// quede partida entre dos columnas.
function groupSections(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const out = document.createElement('div');
  let sec = null;
  const open = () => { sec = document.createElement('section'); sec.className = 'lyr-sec'; out.appendChild(sec); };
  for (const node of [...tmp.childNodes]) {
    if (node.nodeType === 1 && node.classList.contains('section-header-line')) open();
    else if (!sec) open();
    sec.appendChild(node);
  }
  // Los espacios en blanco al final de cada sección no suman altura.
  out.querySelectorAll('.lyr-sec').forEach((s) => {
    while (s.lastElementChild && s.lastElementChild.classList.contains('lyrics-spacer')) s.lastElementChild.remove();
    if (!s.childElementCount) s.remove();
  });
  return out.innerHTML;
}

/**
 * @param {object} song
 * @param {object} [opts]
 *   - key: tono con el que se toca HOY (override del servicio). Abre ya con los
 *     acordes en ese tono; −/+ es un ajuste efímero encima de eso.
 */
export function openLyricsFullscreen(song, opts = {}) {
  if (!song) return;
  close();

  const storedFont = parseInt(ls.get(LS_FONT) || '', 10);
  let fontSize = Number.isFinite(storedFont) && storedFont >= FONT_MIN && storedFont <= FONT_MAX ? storedFont : FONT_DEFAULT;
  const chordsPref = ls.get(LS_CHORDS);
  let showChords = chordsPref === '1' ? true : chordsPref === '0' ? false : !!song.showChords;
  let cols = ls.get(LS_COLS) === '1' ? 1 : ls.get(LS_COLS) === '2' ? 2 : (window.innerWidth >= 1280 ? 2 : 1);
  let fit = ls.get(LS_FIT) !== '0';
  const liveKey = opts.key || song.key || '';
  const baseSemis = keyDeltaSafe(song.key, liveKey);
  let semitones = baseSemis;
  let capo = capoOf(song);

  overlay = document.createElement('div');
  overlay.className = 'lyr-fs';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Letra a pantalla completa');
  overlay.innerHTML = `
    <header class="lyr-bar">
      <div class="lyr-song">
        <div class="lyr-title">${esc(song.title || 'Sin título')}</div>
        ${song.artist ? `<div class="lyr-artist">${esc(song.artist)}</div>` : ''}
      </div>
      <div class="lyr-facts">
        ${song.key ? `<div class="lyr-fact"><span>Tono</span><b data-ref="key">${esc(liveKey || song.key)}</b></div>` : ''}
        ${song.bpm ? `<div class="lyr-fact"><span>BPM</span><b>${esc(song.bpm)}</b></div>` : ''}
      </div>
      <div class="lyr-tools">
        ${song.key ? `<div class="lyr-group" role="group" aria-label="Transponer acordes" title="Transponer acordes (doble clic en el número: volver al tono del servicio)">
          <em>Tono</em>
          <button type="button" data-act="trans-down" aria-label="Bajar un semitono">−</button>
          <span class="lyr-val" data-ref="trans">0</span>
          <button type="button" data-act="trans-up" aria-label="Subir un semitono">+</button>
        </div>
        <div class="lyr-group" role="group" aria-label="Cejilla" title="Cejilla: la canción suena igual; los acordes se muestran con las posiciones que tocas con la cejilla en ese traste. Se recuerda por canción.">
          <em>Cejilla</em>
          <button type="button" data-act="capo-down" aria-label="Cejilla un traste menos">−</button>
          <span class="lyr-val" data-ref="capo">0</span>
          <button type="button" data-act="capo-up" aria-label="Cejilla un traste más">+</button>
        </div>` : ''}
        <div class="lyr-group" role="group" aria-label="Tamaño de letra">
          <em>Tamaño</em>
          <button type="button" data-act="font-down" aria-label="Letra más pequeña" title="Más pequeña (−)">A−</button>
          <span class="lyr-val" data-ref="font">${fontSize}</span>
          <button type="button" data-act="font-up" aria-label="Letra más grande" title="Más grande (+)">A+</button>
        </div>
        <button type="button" class="lyr-toggle" data-act="fit" title="Ajustar: que la canción entera quepa en pantalla (F)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          Ajustar
        </button>
        <button type="button" class="lyr-toggle" data-act="cols" title="Una o dos columnas (2)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/></svg>
          <span data-ref="colsLabel">2 columnas</span>
        </button>
        <button type="button" class="lyr-toggle" data-act="chords" title="Mostrar u ocultar acordes (C)">Acordes</button>
        <button type="button" class="lyr-close ui-close" data-act="close" title="Cerrar (Esc)" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="18" height="18" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </header>
    <main class="lyr-scroll" data-ref="scroll">
      <div class="lyr-content" data-ref="content"></div>
    </main>
    <footer class="lyr-hint">+ / − tamaño · F ajustar · 2 columnas · C acordes · ↓ ↑ desplazar · Esc cerrar</footer>`;
  document.body.appendChild(overlay);
  document.body.classList.add('lyrics-fs-open');

  const ref = (n) => overlay.querySelector(`[data-ref="${n}"]`);
  const scroll = ref('scroll'), content = ref('content');

  // ── Pintado ──
  function renderText() {
    const shown = semitones - capo;   // con cejilla, se escriben las posiciones (tono − cejilla)
    const text = shown === 0 ? song.lyrics : transposeAll(song.lyrics || '', shown);
    content.innerHTML = groupSections(formatLyrics(text));
  }
  function paintState() {
    content.classList.toggle('hide-chords', !showChords);
    content.classList.toggle('is-two-cols', cols === 2);
    content.style.fontSize = `${fontSize}px`;
    ref('font').textContent = fontSize;
    ref('colsLabel').textContent = cols === 2 ? '2 columnas' : '1 columna';
    overlay.querySelector('[data-act="fit"]').classList.toggle('is-on', fit);
    overlay.querySelector('[data-act="cols"]').classList.toggle('is-on', cols === 2);
    overlay.querySelector('[data-act="chords"]').classList.toggle('is-on', showChords);
    const trans = ref('trans');
    if (trans) {
      const rel = semitones - baseSemis;   // 0 = el tono acordado para hoy
      trans.textContent = rel > 0 ? `+${rel}` : String(rel);
      trans.classList.toggle('is-shifted', rel !== 0);
    }
    const key = ref('key');
    if (key && song.key) {
      // El tono que suena; con cejilla se añade en qué posiciones se toca.
      const sounding = transposeKeyLabel(song.key, semitones);
      key.textContent = capo ? `${sounding} · posiciones de ${transposeKeyLabel(song.key, semitones - capo)}` : sounding;
    }
    const capoEl = ref('capo');
    if (capoEl) { capoEl.textContent = String(capo); capoEl.classList.toggle('is-shifted', capo !== 0); }
  }
  // El tamaño más grande con el que todo cabe en el alto visible.
  function fitToScreen() {
    if (!fit) return;
    const cs = getComputedStyle(scroll);
    const avail = scroll.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let lo = FIT_MIN, hi = FONT_MAX, best = FIT_MIN;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      content.style.fontSize = `${mid}px`;
      if (content.scrollHeight <= avail && content.scrollWidth <= content.clientWidth + 1) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    fontSize = best;
    content.style.fontSize = `${fontSize}px`;
    ref('font').textContent = fontSize;
  }
  function refresh({ rerender = false } = {}) {
    if (rerender) renderText();
    paintState();
    fitToScreen();
  }
  const savePrefs = () => {
    ls.set(LS_FONT, String(fontSize)); ls.set(LS_CHORDS, showChords ? '1' : '0');
    ls.set(LS_COLS, String(cols)); ls.set(LS_FIT, fit ? '1' : '0');
  };

  // ── Barra que se oculta sola ──
  let idleTimer = 0;
  const wake = () => {
    if (!overlay) return;
    overlay.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // No esconder mientras el ratón está sobre la barra (usándola).
      if (overlay && !overlay.querySelector('.lyr-bar:hover')) overlay.classList.add('is-idle');
    }, IDLE_MS);
  };
  overlay.addEventListener('mousemove', wake);

  // ── Acciones ──
  function act(name) {
    switch (name) {
      case 'font-up': fit = false; fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP); break;
      case 'font-down': fit = false; fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP); break;
      case 'fit': fit = !fit; break;
      case 'cols': cols = cols === 2 ? 1 : 2; break;
      case 'chords': showChords = !showChords; break;
      case 'trans-up': semitones = Math.min(11, semitones + 1); refresh({ rerender: true }); return;
      case 'trans-down': semitones = Math.max(-11, semitones - 1); refresh({ rerender: true }); return;
      case 'capo-up': capo = Math.min(CAPO_MAX, capo + 1); saveCapo(song, capo); refresh({ rerender: true }); return;
      case 'capo-down': capo = Math.max(0, capo - 1); saveCapo(song, capo); refresh({ rerender: true }); return;
      case 'close': close(); return;
      default: return;
    }
    refresh();
    savePrefs();
  }
  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) act(btn.dataset.act);
  });
  ref('trans')?.addEventListener('dblclick', () => { semitones = baseSemis; refresh({ rerender: true }); });
  ref('capo')?.addEventListener('dblclick', () => { capo = 0; saveCapo(song, 0); refresh({ rerender: true }); });

  // Escape lo gestiona modalStack; aquí el resto de atajos.
  const onKey = (e) => {
    if (!overlay) return;
    wake();
    const page = scroll.clientHeight * 0.8;
    const k = e.key;
    if (k === '+' || k === '=') act('font-up');
    else if (k === '-' || k === '_') act('font-down');
    else if (k === 'c' || k === 'C') act('chords');
    else if (k === 'f' || k === 'F') act('fit');
    else if (k === '2') act('cols');
    else if (k === 'ArrowDown' || k === 'PageDown' || k === ' ') { e.preventDefault(); scroll.scrollBy({ top: page, behavior: 'smooth' }); }
    else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); scroll.scrollBy({ top: -page, behavior: 'smooth' }); }
    else if (k === 'Home') scroll.scrollTo({ top: 0, behavior: 'smooth' });
    else return;
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  let resizeRaf = 0;
  const onResize = () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(() => overlay && fitToScreen()); };
  window.addEventListener('resize', onResize);
  cleanup = [
    () => window.removeEventListener('keydown', onKey, true),
    () => window.removeEventListener('resize', onResize),
    () => clearTimeout(idleTimer),
  ];

  refresh({ rerender: true });
  // Las fuentes pueden terminar de cargar después: reajustar una vez.
  document.fonts?.ready?.then(() => overlay && fitToScreen());
  wake();
  popModal = pushModal(() => close());
}

function close() {
  if (popModal) { popModal(); popModal = null; }
  cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
  cleanup = [];
  if (overlay) { overlay.remove(); overlay = null; }
  document.body.classList.remove('lyrics-fs-open');
}

export function closeLyricsFullscreen() { close(); }
