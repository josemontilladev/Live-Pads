// Panel del piano virtual dentro de Stems.
//
// Teclado DOM tocable con mouse y con controlador MIDI. Suena por el sampler
// (pianoSampler.js) a través del master del engine. Permite GRABAR una melodía
// en sincronía con el transporte: arranca la reproducción para tocar encima de
// las pistas y, al parar, bouncea los eventos a un AudioBuffer que el workspace
// vuelca como una pista de audio normal del timeline.

import * as engine from './engine.js';
import * as piano from './pianoSampler.js';
import { setStemsNoteHandler } from '../midi/midiBindings.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
const OCTAVES_VISIBLE = 3;
const MIN_OCTAVE = 0, MAX_OCTAVE = 6;

// Teclado de la PC, layout de 2 octavas (tipo FL Studio). El semitono es
// relativo a la C más grave visible, así que sigue el desplazamiento de octava.
//   Octava base  (fila inferior):  Z S X D C V G B H N J M
//   Octava +1    (fila QWERTY/nº): Q 2 W 3 E R 5 T 6 Y 7 U  (+ I = C de la +2)
// Las octavas se cambian con los botones − / + del panel.
const KEY_SEMITONE = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23, i: 24,
};
// Reverso: semitono (desde la C más grave visible) → letra de la PC, para
// rotular cada tecla con su atajo del teclado.
const PC_KEY_BY_OFFSET = {};
for (const [k, off] of Object.entries(KEY_SEMITONE)) PC_KEY_BY_OFFSET[off] = k.toUpperCase();
const heldKeys = new Map();   // tecla PC → midi en curso (para soltar la nota correcta)

let panelEl = null;
let kbEl = null;
let recBtn = null, octLabel = null, statusEl = null;
let deps = {};
let isOpen = false;
let baseOctave = 3;           // C(baseOctave) es la nota más grave visible
let mouseHeldMidi = null;     // nota sostenida con el mouse

// Grabación
let recording = false;
const pending = new Map();    // midi → { startSec, velocity } mientras se sostiene
let recStartCtx = 0;          // ctx.currentTime al iniciar la grabación
let recStartTransport = 0;    // posición del transporte al iniciar

// El editor (piano roll) captura la grabación. Mientras haya un controlador,
// Grabar NO crea una pista ni toca el timeline: reproduce el EDITOR y las notas
// van ahí. ctl: { addNote, startClock, stopClock, time }.
let liveRec = null;
export function setLiveNoteSink(ctl) { liveRec = ctl; }

// Fija el instrumento activo y refleja el selector (lo usa el editor al abrir
// una pista MIDI con su instrumento).
export function setInstrumentUI(id) {
  piano.setInstrument(id);
  const sel = panelEl?.querySelector('#pk-inst');
  if (sel) sel.value = piano.getInstrument();
}

// Tiempo de grabación = posición del transporte al empezar + lo transcurrido
// según el reloj de audio. Se mantiene alineado con el transporte y además
// avanza aunque no haya pistas de fondo (play() es no-op sin pistas).
function recTime() {
  if (liveRec) return liveRec.time();   // tiempo del editor
  return recStartTransport + (engine.getAudioContext().currentTime - recStartCtx);
}

function noteName(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
function noteLabel(midi) { return NOTE_NAMES[midi % 12]; }

export function mountPianoPanel(container, depsIn) {
  deps = depsIn || {};
  panelEl = container;
  panelEl.innerHTML = `
    <div class="pk-bar">
      <span class="pk-title">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>
        Piano
      </span>
      <select class="pk-inst" id="pk-inst" title="Instrumento" aria-label="Instrumento">
        ${piano.INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join('')}
      </select>
      <div class="pk-octave">
        <button class="pk-oct-btn" id="pk-oct-down" type="button" title="Bajar octava" aria-label="Bajar octava">−</button>
        <span class="pk-oct-label" id="pk-oct-label">C3–C6</span>
        <button class="pk-oct-btn" id="pk-oct-up" type="button" title="Subir octava" aria-label="Subir octava">+</button>
      </div>
      <label class="pk-vol">
        <span>VOL</span>
        <input type="range" id="pk-vol" min="0" max="100" value="90" class="stems-range stems-range--fill" aria-label="Volumen del piano">
      </label>
      <button class="pk-reverb" id="pk-reverb" type="button" title="Reverb (más profundidad)" aria-pressed="false">Reverb</button>
      <button class="pk-rec" id="pk-rec" type="button" title="Grabar la melodía en sincronía con el transporte">
        <span class="pk-rec-dot" aria-hidden="true"></span>
        <span class="pk-rec-label">Grabar</span>
      </button>
      <span class="pk-status" id="pk-status"></span>
      <button class="pk-close" id="pk-close" type="button" title="Cerrar piano" aria-label="Cerrar piano">✕</button>
    </div>
    <div class="pk-keys" id="pk-keys"></div>
  `;
  kbEl = panelEl.querySelector('#pk-keys');
  recBtn = panelEl.querySelector('#pk-rec');
  octLabel = panelEl.querySelector('#pk-oct-label');
  statusEl = panelEl.querySelector('#pk-status');

  panelEl.querySelector('#pk-oct-down').onclick = () => shiftOctave(-1);
  panelEl.querySelector('#pk-oct-up').onclick = () => shiftOctave(1);
  panelEl.querySelector('#pk-close').onclick = () => closePiano();
  panelEl.querySelector('#pk-vol').oninput = (e) => piano.setVolume(parseInt(e.target.value, 10) / 100);
  recBtn.onclick = () => recording ? stopRecording() : startRecording();
  const instSel = panelEl.querySelector('#pk-inst');
  instSel.value = piano.getInstrument();
  instSel.onchange = (e) => piano.setInstrument(e.target.value);
  // Toggle de reverb (más profundidad), recordado entre sesiones.
  const reverbBtn = panelEl.querySelector('#pk-reverb');
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

function midiForKey(k) { return (baseOctave + 1) * 12 + KEY_SEMITONE[k]; }

// Tocar con el teclado de la PC mientras el panel está abierto. Se registra en
// captura y bloquea (stopImmediatePropagation) SOLO las teclas que usa el piano,
// para no romper los atajos del workspace (Espacio, Supr, Esc, etc.).
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

// Hace el panel arrastrable por su barra superior (excepto sobre los controles).
function makeDraggable(panel, handle) {
  if (!handle) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label, .stems-range')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    // Pasa a posicionamiento absoluto por left/top (quita el centrado por transform).
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    nx = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, nx));
    ny = Math.max(52, Math.min(window.innerHeight - 60, ny));
    panel.style.left = `${nx}px`;
    panel.style.top = `${ny}px`;
  });
  const end = (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ── Teclado ───────────────────────────────────────────────────────
function renderKeyboard() {
  const low = (baseOctave + 1) * 12;          // C de baseOctave
  const high = low + OCTAVES_VISIBLE * 12;     // + C superior
  const whites = [];
  const blacks = [];
  for (let m = low; m <= high; m++) {
    (WHITE_PC.has(m % 12) ? whites : blacks).push(m);
  }
  const whiteIndex = new Map(whites.map((m, i) => [m, i]));
  const n = whites.length;

  // Letra del teclado de la PC que dispara cada nota (solo la octava base).
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

// ── Tocar / soltar ────────────────────────────────────────────────
function play(midi, velocity) {
  piano.noteOn(midi, velocity);
  highlight(midi, true);
  if (recording) pending.set(midi, { startSec: recTime(), velocity });
}
function release(midi) {
  piano.noteOff(midi);
  highlight(midi, false);
  if (recording && pending.has(midi)) {
    const p = pending.get(midi); pending.delete(midi);
    const durationSec = Math.max(0.02, recTime() - p.startSec);
    emitNote({ midi, velocity: p.velocity, startSec: p.startSec, durationSec });
  }
}

// Si el editor (piano roll) está abierto, las notas grabadas van AHÍ en vivo;
// si no, al flujo normal del workspace (crear/llenar la pista).
function emitNote(note) {
  if (liveRec) liveRec.addNote(note);
  else deps.onRecordNote?.(note);
}

// Handler de notas MIDI (registrado mientras el panel está abierto).
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
  // Soltar en cualquier parte termina la nota del mouse.
  document.addEventListener('pointerup', () => {
    if (mouseHeldMidi != null) { release(mouseHeldMidi); mouseHeldMidi = null; }
  });
}

// ── Abrir / cerrar ────────────────────────────────────────────────
export function isPianoOpen() { return isOpen; }
export function togglePiano() { return isOpen ? closePiano() : openPiano(); }

export async function openPiano() {
  if (isOpen) return;
  isOpen = true;
  panelEl.hidden = false;
  setStemsNoteHandler(handleMidiNote);
  deps.onOpenChange?.(true);
  if (!piano.isLoaded()) {
    setStatus('Cargando piano…');
    try { await piano.loadSamples(); setStatus(''); }
    catch (e) { setStatus('No se pudieron cargar los samples'); console.warn('piano load failed', e); }
  }
}

export function closePiano() {
  if (!isOpen) return;
  isOpen = false;
  if (recording) stopRecording();
  setStemsNoteHandler(null);
  piano.panic();
  heldKeys.clear();
  if (mouseHeldMidi != null) { highlight(mouseHeldMidi, false); mouseHeldMidi = null; }
  panelEl.hidden = true;
  deps.onOpenChange?.(false);
}

// Corte de pánico (Esc global): suelta todo y limpia resaltados.
export function pianoPanic() {
  piano.panic();
  pending.clear();
  heldKeys.clear();
  kbEl?.querySelectorAll('.pk-key.is-active').forEach(k => k.classList.remove('is-active'));
  if (recording) { recording = false; paintRecState(); }
}

// ── Grabación ─────────────────────────────────────────────────────
// La pista MIDI la crea/gestiona el workspace vía deps: onRecordStart (crea la
// pista al instante), onRecordNote (agrega cada nota en vivo) y onRecordStop
// (re-bouncea el audio). El panel solo mide el tiempo y emite las notas.
function startRecording() {
  if (recording) return;
  recording = true;
  pending.clear();
  if (liveRec) {
    // Con el editor abierto: reproduce el EDITOR (no el timeline) y graba ahí.
    liveRec.startClock();
  } else {
    // Play-along: arranca el transporte y ancla el reloj de audio.
    recStartTransport = engine.getCurrentSec();
    if (!engine.isCurrentlyPlaying()) engine.play();
    recStartCtx = engine.getAudioContext().currentTime;
    deps.onRecordStart?.();
  }
  paintRecState();
  setStatus(liveRec ? 'Grabando en el editor…' : 'Grabando… toca encima de las pistas');
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  paintRecState();
  // Cierra notas aún sostenidas → emítelas.
  const now = recTime();
  for (const [midi, p] of pending) {
    emitNote({ midi, velocity: p.velocity, startSec: p.startSec, durationSec: Math.max(0.02, now - p.startSec) });
  }
  pending.clear();
  if (liveRec) { liveRec.stopClock(); setStatus(''); return; }   // editor: notas ya puestas
  if (engine.isCurrentlyPlaying()) engine.stop();
  setStatus('Procesando…');
  try { await deps.onRecordStop?.(); setStatus(''); }
  catch (e) { console.warn('record stop failed', e); setStatus('Error al volcar la grabación'); }
}

function paintRecState() {
  if (!recBtn) return;
  recBtn.classList.toggle('is-recording', recording);
  const lbl = recBtn.querySelector('.pk-rec-label');
  if (lbl) lbl.textContent = recording ? 'Detener' : 'Grabar';
}

function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }
