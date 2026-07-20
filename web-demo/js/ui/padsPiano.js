// Piano virtual de la pantalla de PADS. Es solo para TOCAR/escuchar notas o
// sacar una melodía rápida — sin grabación ni pistas (a diferencia del de
// Stems). Reusa el sonido del sampler (pianoSampler) y responde al controlador
// MIDI cuando está visible. Mismo look (clases .pk-* / .stems-piano).

import * as piano from '../stems/pianoSampler.js';
import { setPadsNoteHandler } from '../midi/midiBindings.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
const OCTAVES_VISIBLE = 3;
const MIN_OCTAVE = 0, MAX_OCTAVE = 6;
const KEY_SEMITONE = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23, i: 24,
};
const PC_KEY_BY_OFFSET = {};
for (const [k, off] of Object.entries(KEY_SEMITONE)) PC_KEY_BY_OFFSET[off] = k.toUpperCase();
const heldKeys = new Map();

let panelEl = null, kbEl = null, octLabel = null;
let isOpen = false, mounted = false;
let baseOctave = 3;
let mouseHeldMidi = null;
let onOpenChange = null;

function noteName(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
function noteLabel(midi) { return NOTE_NAMES[midi % 12]; }
function midiForKey(k) { return (baseOctave + 1) * 12 + KEY_SEMITONE[k]; }

// Crea el panel (una vez) y lo deja oculto. onChange(open) refleja el botón.
function ensureMounted(onChange) {
  onOpenChange = onChange || onOpenChange;
  if (mounted) return;
  mounted = true;
  panelEl = document.createElement('section');
  panelEl.className = 'stems-piano';
  panelEl.id = 'pads-piano';
  panelEl.hidden = true;
  panelEl.innerHTML = `
    <div class="pk-bar">
      <span class="pk-title">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>
        Piano
      </span>
      <select class="pk-inst" id="pk-inst-pads" title="Instrumento" aria-label="Instrumento">
        ${piano.INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join('')}
      </select>
      <div class="pk-octave">
        <button class="pk-oct-btn" id="pk-oct-down-pads" type="button" title="Bajar octava" aria-label="Bajar octava">−</button>
        <span class="pk-oct-label" id="pk-oct-label-pads">C3–C6</span>
        <button class="pk-oct-btn" id="pk-oct-up-pads" type="button" title="Subir octava" aria-label="Subir octava">+</button>
      </div>
      <label class="pk-vol">
        <span>VOL</span>
        <input type="range" id="pk-vol-pads" min="0" max="100" value="90" class="stems-range stems-range--fill" aria-label="Volumen del piano">
      </label>
      <button class="pk-reverb" id="pk-reverb-pads" type="button" title="Reverb (más profundidad)" aria-pressed="false">Reverb</button>
      <button class="pk-close" id="pk-close-pads" type="button" title="Cerrar piano" aria-label="Cerrar piano">✕</button>
    </div>
    <div class="pk-keys" id="pk-keys-pads"></div>`;
  document.body.appendChild(panelEl);
  kbEl = panelEl.querySelector('#pk-keys-pads');
  octLabel = panelEl.querySelector('#pk-oct-label-pads');

  panelEl.querySelector('#pk-oct-down-pads').onclick = () => shiftOctave(-1);
  panelEl.querySelector('#pk-oct-up-pads').onclick = () => shiftOctave(1);
  panelEl.querySelector('#pk-close-pads').onclick = () => closePadsPiano();
  panelEl.querySelector('#pk-vol-pads').oninput = (e) => piano.setVolume(parseInt(e.target.value, 10) / 100);
  const instSel = panelEl.querySelector('#pk-inst-pads');
  instSel.value = piano.getInstrument();
  instSel.onchange = (e) => piano.setInstrument(e.target.value);
  const reverbBtn = panelEl.querySelector('#pk-reverb-pads');
  let reverbOn = false;
  try { reverbOn = localStorage.getItem('piano-reverb-deep') === '1'; } catch {}
  const applyReverb = () => {
    piano.setReverbDeep(reverbOn);
    reverbBtn.classList.toggle('is-on', reverbOn);
    reverbBtn.setAttribute('aria-pressed', reverbOn ? 'true' : 'false');
  };
  applyReverb();
  reverbBtn.onclick = () => {
    reverbOn = !reverbOn;
    try { localStorage.setItem('piano-reverb-deep', reverbOn ? '1' : '0'); } catch {}
    applyReverb();
  };

  wireMouse();
  wireComputerKeyboard();
  makeDraggable(panelEl, panelEl.querySelector('.pk-bar'));
  renderKeyboard();
}

function wireComputerKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === '-') { e.preventDefault(); e.stopImmediatePropagation(); shiftOctave(-1); return; }
    if (k === '=' || k === '+') { e.preventDefault(); e.stopImmediatePropagation(); shiftOctave(1); return; }
    if (!(k in KEY_SEMITONE)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat || heldKeys.has(k)) return;
    const midi = midiForKey(k);
    heldKeys.set(k, midi);
    play(midi, 100);
  }, true);
  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (!heldKeys.has(k)) return;
    const midi = heldKeys.get(k);
    heldKeys.delete(k);
    release(midi);
  }, true);
}

function makeDraggable(panel, handle) {
  if (!handle) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label, .stems-range')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`;
    panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.transform = 'none';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let nx = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, ox + (e.clientX - sx)));
    let ny = Math.max(52, Math.min(window.innerHeight - 60, oy + (e.clientY - sy)));
    panel.style.left = `${nx}px`; panel.style.top = `${ny}px`;
  });
  const end = (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function renderKeyboard() {
  const low = (baseOctave + 1) * 12;
  const high = low + OCTAVES_VISIBLE * 12;
  const whites = [], blacks = [];
  for (let m = low; m <= high; m++) (WHITE_PC.has(m % 12) ? whites : blacks).push(m);
  const whiteIndex = new Map(whites.map((m, i) => [m, i]));
  const n = whites.length;
  const pcKey = (m) => PC_KEY_BY_OFFSET[m - low] || '';
  const whiteHtml = whites.map(m => {
    const pk = pcKey(m);
    return `<div class="pk-key pk-white" data-midi="${m}">` +
      (pk ? `<span class="pk-pckey">${pk}</span>` : '') +
      `<span class="pk-name">${noteLabel(m)}</span></div>`;
  }).join('');
  const blackHtml = blacks.map(m => {
    const leftPct = ((whiteIndex.get(m - 1) + 1) / n) * 100;
    const pk = pcKey(m);
    return `<div class="pk-key pk-black" data-midi="${m}" style="left:${leftPct.toFixed(4)}%">` +
      (pk ? `<span class="pk-pckey">${pk}</span>` : '') + `</div>`;
  }).join('');
  kbEl.style.setProperty('--pk-nwhite', n);
  kbEl.innerHTML = `<div class="pk-whites">${whiteHtml}</div><div class="pk-blacks">${blackHtml}</div>`;
  octLabel.textContent = `${noteName(low)}–${noteName(high)}`;
}

function shiftOctave(dir) {
  const next = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, baseOctave + dir));
  if (next === baseOctave) return;
  baseOctave = next;
  renderKeyboard();
}

function keyEl(midi) { return kbEl?.querySelector(`.pk-key[data-midi="${midi}"]`); }
function highlight(midi, on) { keyEl(midi)?.classList.toggle('is-active', on); }

function play(midi, velocity) { piano.noteOn(midi, velocity); highlight(midi, true); }
function release(midi) { piano.noteOff(midi); highlight(midi, false); }

function handleMidiNote(type, midi, velocity) {
  if (type === 'sustain') { piano.setSustain(velocity >= 64); return; }
  if (type === 'on') play(midi, velocity);
  else release(midi);
}

function wireMouse() {
  kbEl.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.pk-key');
    if (!k) return;
    e.preventDefault();
    const midi = parseInt(k.dataset.midi, 10);
    mouseHeldMidi = midi;
    play(midi, 100);
  });
  document.addEventListener('pointerup', () => {
    if (mouseHeldMidi != null) { release(mouseHeldMidi); mouseHeldMidi = null; }
  });
}

// ── API pública ───────────────────────────────────────────────────
export function mountPadsPiano(onChange) { ensureMounted(onChange); }
export function isPadsPianoOpen() { return isOpen; }
export function togglePadsPiano(onChange) { return isOpen ? closePadsPiano() : openPadsPiano(onChange); }

export async function openPadsPiano(onChange) {
  ensureMounted(onChange);
  if (isOpen) return;
  isOpen = true;
  panelEl.hidden = false;
  setPadsNoteHandler(handleMidiNote); // las notas del controlador van al piano
  onOpenChange?.(true);
  if (!piano.isLoaded()) {
    try { await piano.loadSamples(); } catch (e) { console.warn('piano load failed', e); }
  }
}

export function closePadsPiano() {
  if (!isOpen) return;
  isOpen = false;
  setPadsNoteHandler(null);
  piano.panic();
  heldKeys.clear();
  if (mouseHeldMidi != null) { highlight(mouseHeldMidi, false); mouseHeldMidi = null; }
  if (panelEl) panelEl.hidden = true;
  onOpenChange?.(false);
}

// Corte de pánico (Esc global): suelta todo.
export function padsPianoPanic() {
  piano.panic();
  heldKeys.clear();
  kbEl?.querySelectorAll('.pk-key.is-active').forEach(k => k.classList.remove('is-active'));
}
