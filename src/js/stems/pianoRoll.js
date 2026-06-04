// Editor piano roll para las pistas MIDI del piano en Stems.
//
// Abre un modal con una rejilla (pitch × tiempo) donde el usuario edita las
// notas de una pista: agregar (dibujar), mover, estirar y borrar, con snap a la
// subdivisión del beat. Permite previsualizar con el sampler. Al guardar,
// devuelve las notas editadas para que el workspace re-bouncee el audio.
//
// Nota: { midi, velocity, startSec, durationSec }.

import { pushModal } from '../ui/modalStack.js';
import * as piano from './pianoSampler.js';
import { openPiano, closePiano, isPianoOpen, setLiveNoteSink } from './pianoPanel.js';
import * as engine from './engine.js';
import { downloadMidi } from './midiFile.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_LOW = 21;    // A0 (piano completo)
const PITCH_HIGH = 108;  // C8
const ROW_H = 20;        // alto por semitono (px)
const PX_PER_SEC = 130;  // escala de tiempo (base, escalada por el zoom)
const KEYS_W = 60;       // ancho de la columna de teclas
const BLACK_PC = new Set([1, 3, 6, 8, 10]);

function noteName(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }

// Pitch-classes de la escala del proyecto (para resaltar la tonalidad).
const ROOT_PC = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
function scaleSet(key) {
  if (!key) return null;
  const s = String(key).trim();
  const minor = /m(in)?$/i.test(s) && !/maj/i.test(s);
  const rootName = s.replace(/\s*(m|min|minor|maj|major).*$/i, '').toUpperCase().replace('♯', '#').replace('♭', 'B');
  let pc = ROOT_PC[rootName];
  if (pc == null) pc = ROOT_PC[rootName[0]];
  if (pc == null) return null;
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return { set: new Set(steps.map(st => (pc + st) % 12)), root: pc };
}
const nPitches = PITCH_HIGH - PITCH_LOW + 1;
const gridH = nPitches * ROW_H;

// Abre el editor. opts: { notes, bpm, beatsPerBar, color, onSave(newNotes) }.
export function openPianoRoll(opts) {
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : 120;
  const beatsPerBar = opts.beatsPerBar || 4;
  const color = opts.color || '#FBAE00';
  const secPerBeat = 60 / bpm;
  let snapDiv = 2;                       // 1=1/4, 2=1/8, 4=1/16
  const snapSec = () => secPerBeat / snapDiv;

  // Copia de trabajo de las notas.
  let notes = (opts.notes || []).map(n => ({ ...n }));
  let selection = new Set();   // notas seleccionadas (multi)
  let clipboard = [];          // patrón copiado (offsets relativos)
  let marquee = null, marqueeEl = null;
  const scale = scaleSet(opts.projectKey);   // resaltado de tonalidad
  let zoom = 1;                // escala de tiempo (Ctrl+rueda / ± )
  let quantizeOnRec = false;   // cuantizar las notas al grabar
  let metroOn = false;         // metrónomo al grabar
  piano.loadSamples().catch(() => {});   // precarga para audición/reproducción

  // Historial para deshacer/rehacer.
  let history = [], histIdx = -1;
  function record() {
    history = history.slice(0, histIdx + 1);
    history.push(notes.map(n => ({ ...n })));
    histIdx = history.length - 1;
    if (history.length > 80) { history.shift(); histIdx--; }
  }
  function restore(snap) {
    notes = snap.map(n => ({ ...n }));
    selection = new Set();
    renderNotes(); layoutGrid();
  }
  function undo() { if (histIdx > 0) restore(history[--histIdx]); }
  function redo() { if (histIdx < history.length - 1) restore(history[++histIdx]); }

  // ── DOM ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pr-overlay';
  overlay.innerHTML = `
    <div class="pr-modal" role="dialog" aria-label="Editor de notas (piano roll)">
      <div class="pr-head">
        <span class="pr-title">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>
          Piano roll
        </span>
        <div class="pr-help-wrap">
          <button class="pr-help" id="pr-help" type="button" title="Comandos del editor" aria-label="Comandos">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" width="16" height="16"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
          </button>
          <div class="pr-legend" id="pr-legend" hidden>
            <div class="pr-legend-title">Comandos</div>
            <div class="pr-legend-row"><kbd>Clic</kbd><span>Agrega una nota</span></div>
            <div class="pr-legend-row"><kbd>Arrastra</kbd><span>Mueve / estira la nota</span></div>
            <div class="pr-legend-row"><kbd>Alt + arrastra</kbd><span>Cambia la velocity</span></div>
            <div class="pr-legend-row"><kbd>Clic der.</kbd><span>Selección por área</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + clic</kbd><span>Suma/quita a la selección</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + A</kbd><span>Seleccionar todo</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + C / V</kbd><span>Copiar / pegar patrón</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + D</kbd><span>Duplicar la selección</span></div>
            <div class="pr-legend-row"><kbd>↑ / ↓</kbd><span>Transponer (Shift = octava)</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + Z / Y</kbd><span>Deshacer / rehacer</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + rueda</kbd><span>Zoom de tiempo</span></div>
            <div class="pr-legend-row"><kbd>Supr</kbd><span>Borra la selección</span></div>
            <div class="pr-legend-row"><kbd>Regla</kbd><span>Posiciona la reproducción</span></div>
            <div class="pr-legend-row"><kbd>Espacio</kbd><span>Reproducir / detener</span></div>
          </div>
        </div>
        <label class="pr-snap">Snap
          <select id="pr-snap">
            <option value="1">1/4</option>
            <option value="2" selected>1/8</option>
            <option value="4">1/16</option>
          </select>
        </label>
        <button class="pr-btn" id="pr-play" type="button">▶ Reproducir</button>
        <button class="pr-btn" id="pr-quantize" type="button" title="Alinea las notas al BPM del proyecto">Cuantizar</button>
        <span class="pr-zoom">
          <button class="pr-icon" id="pr-zoomout" type="button" title="Alejar (Ctrl+rueda)">−</button>
          <button class="pr-icon" id="pr-zoomin" type="button" title="Acercar (Ctrl+rueda)">+</button>
        </span>
        <button class="pr-icon pr-toggle" id="pr-qrec" type="button" title="Cuantizar al grabar" aria-pressed="false">Q⟳</button>
        <button class="pr-icon pr-toggle" id="pr-metro" type="button" title="Metrónomo al grabar" aria-pressed="false">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M6 21h12L13 4h-2z"/><line x1="12" y1="9" x2="17" y2="14"/></svg>
        </button>
        <button class="pr-btn" id="pr-midi" type="button" title="Exportar a archivo .mid">MIDI</button>
        <span class="pr-spacer"></span>
        <button class="pr-btn pr-btn--ghost" id="pr-cancel" type="button">Cancelar</button>
        <button class="pr-btn pr-btn--primary" id="pr-save" type="button">Guardar</button>
      </div>
      <div class="pr-scroll" id="pr-scroll">
        <div class="pr-inner">
          <div class="pr-keys" id="pr-keys"></div>
          <div class="pr-grid" id="pr-grid">
            <div class="pr-ruler" id="pr-ruler" title="Clic para posicionar la reproducción"></div>
            <div class="pr-playhead" id="pr-playhead"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Restaura posición/tamaño guardados de la ventana.
  try {
    const w = JSON.parse(localStorage.getItem('pr-window') || 'null');
    if (w && w.width) {
      overlay.style.left = `${Math.max(0, Math.min(window.innerWidth - 200, w.left))}px`;
      overlay.style.top = `${Math.max(0, Math.min(window.innerHeight - 80, w.top))}px`;
      overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
      overlay.style.width = `${Math.min(window.innerWidth, w.width)}px`;
      overlay.style.height = `${Math.min(window.innerHeight, w.height)}px`;
    }
  } catch (_) {}

  const modal = overlay.querySelector('.pr-modal');
  const keysEl = overlay.querySelector('#pr-keys');
  const gridEl = overlay.querySelector('#pr-grid');
  const scrollEl = overlay.querySelector('#pr-scroll');
  const playhead = overlay.querySelector('#pr-playhead');
  const playBtn = overlay.querySelector('#pr-play');
  const rulerEl = overlay.querySelector('#pr-ruler');
  let playStartSec = 0;   // posición desde la que reproduce (clic en la regla)

  // Teclas verticales.
  keysEl.style.height = `${gridH}px`;
  keysEl.style.minWidth = `${KEYS_W}px`;
  let keysHtml = '';
  for (let m = PITCH_HIGH; m >= PITCH_LOW; m--) {
    const pc = m % 12;
    const black = BLACK_PC.has(pc);
    const label = (pc === 0) ? noteName(m) : '';
    const inScale = scale && scale.set.has(pc);
    const isRoot = scale && pc === scale.root;
    const cls = `pr-key${black ? ' is-black' : ''}${inScale ? ' in-scale' : ''}${isRoot ? ' is-root' : ''}`;
    keysHtml += `<div class="${cls}" style="height:${ROW_H}px">${label}</div>`;
  }
  keysEl.innerHTML = keysHtml;

  // Rejilla.
  function contentSec() {
    let end = beatsPerBar * secPerBeat * 4;   // mínimo 4 compases
    for (const n of notes) end = Math.max(end, n.startSec + n.durationSec);
    return end + beatsPerBar * secPerBeat;     // un compás extra
  }
  function layoutGrid() {
    const px = PX_PER_SEC * zoom;
    const w = Math.ceil(contentSec() * px);
    gridEl.style.width = `${w}px`;
    gridEl.style.height = `${gridH}px`;
    const beatPx = secPerBeat * px;
    const barPx = beatPx * beatsPerBar;
    const subPx = beatPx / snapDiv;   // subdivisión del snap (1/8, 1/16…)
    gridEl.style.backgroundSize = `100% ${ROW_H * 12}px, 100% ${ROW_H}px, ${subPx}px 100%, ${beatPx}px 100%, ${barPx}px 100%`;
    // Regla: números de compás.
    rulerEl.style.width = `${w}px`;
    const barSec = secPerBeat * beatsPerBar;
    const nBars = Math.ceil(contentSec() / barSec) + 1;
    let bars = '';
    for (let b = 0; b < nBars; b++) bars += `<div class="pr-ruler-bar" style="left:${(b * barSec) * px}px">${b + 1}</div>`;
    rulerEl.innerHTML = bars;
  }

  // Mapeos (pps = px por segundo, escalado por el zoom).
  const pps = () => PX_PER_SEC * zoom;
  const xToSec = (x) => Math.max(0, x / pps());
  const secToX = (s) => s * pps();
  const yToMidi = (y) => PITCH_HIGH - Math.floor(y / ROW_H);
  const midiToY = (m) => (PITCH_HIGH - m) * ROW_H;
  const snap = (s) => Math.round(s / snapSec()) * snapSec();
  function setZoom(z) {
    zoom = Math.max(0.4, Math.min(4, z));
    layoutGrid(); renderNotes(); playhead.style.left = `${secToX(playStartSec)}px`;
  }

  // Posiciona el punto de reproducción (clic en la regla). Reproduce desde aquí.
  function setPlayhead(sec) {
    playStartSec = Math.max(0, sec);
    playhead.style.left = `${secToX(playStartSec)}px`;
  }
  rulerEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const x = e.clientX - gridEl.getBoundingClientRect().left;
    setPlayhead(xToSec(x));
    if (playing) { allOff(); playT0 = performance.now(); }   // reinicia desde la nueva posición
  });

  // Pinta todas las notas.
  function renderNotes() {
    gridEl.querySelectorAll('.pr-note').forEach(el => el.remove());
    for (const n of notes) {
      const el = document.createElement('div');
      el.className = 'pr-note' + (selection.has(n) ? ' is-selected' : '');
      el.style.left = `${secToX(n.startSec)}px`;
      el.style.top = `${midiToY(n.midi)}px`;
      el.style.width = `${Math.max(4, secToX(n.durationSec))}px`;
      el.style.height = `${ROW_H - 1}px`;
      el.style.background = color;
      // La opacidad refleja la velocity (Alt+arrastra una nota para cambiarla).
      el.style.opacity = (0.4 + 0.6 * (Math.max(0, Math.min(127, n.velocity || 0)) / 127)).toFixed(2);
      el.title = `${noteName(n.midi)} · vel ${Math.round(n.velocity || 0)}`;
      el._note = n;
      el.innerHTML = `<span class="pr-note-name">${noteName(n.midi)}</span><span class="pr-note-resize"></span><span class="pr-note-del" title="Borrar">✕</span>`;
      gridEl.appendChild(el);
    }
  }
  function deleteSelection() {
    if (!selection.size) return;
    notes = notes.filter(z => !selection.has(z));
    selection = new Set();
    renderNotes(); layoutGrid();
  }

  layoutGrid();
  renderNotes();
  record();   // estado inicial del historial
  // Centra verticalmente en las notas (o en C4).
  requestAnimationFrame(() => {
    const focusMidi = notes.length ? Math.round(notes.reduce((a, n) => a + n.midi, 0) / notes.length) : 60;
    scrollEl.scrollTop = Math.max(0, midiToY(focusMidi) - scrollEl.clientHeight / 2);
  });

  // ── Selección por área (clic derecho) ────────────────────────────
  function positionMarquee() {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    marqueeEl.style.left = `${x}px`; marqueeEl.style.top = `${y}px`;
    marqueeEl.style.width = `${Math.abs(marquee.x1 - marquee.x0)}px`;
    marqueeEl.style.height = `${Math.abs(marquee.y1 - marquee.y0)}px`;
  }
  function commitMarquee() {
    const xA = Math.min(marquee.x0, marquee.x1), xB = Math.max(marquee.x0, marquee.x1);
    const yA = Math.min(marquee.y0, marquee.y1), yB = Math.max(marquee.y0, marquee.y1);
    if (!marquee.add) selection = new Set();
    for (const n of notes) {
      const nx0 = secToX(n.startSec), nx1 = nx0 + secToX(n.durationSec);
      const ny0 = midiToY(n.midi), ny1 = ny0 + ROW_H;
      if (nx1 >= xA && nx0 <= xB && ny1 >= yA && ny0 <= yB) selection.add(n);
    }
    renderNotes();
  }
  gridEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Edición por puntero ──────────────────────────────────────────
  let drag = null;
  gridEl.addEventListener('pointerdown', (e) => {
    const rect = gridEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clic derecho → rectángulo de selección (Ctrl suma a lo ya seleccionado).
    if (e.button === 2) {
      e.preventDefault();
      marquee = { x0: x, y0: y, x1: x, y1: y, add: e.ctrlKey || e.metaKey };
      if (!marqueeEl) { marqueeEl = document.createElement('div'); marqueeEl.className = 'pr-marquee'; gridEl.appendChild(marqueeEl); }
      marqueeEl.style.display = 'block'; positionMarquee();
      gridEl.setPointerCapture(e.pointerId);
      return;
    }

    const noteEl = e.target.closest('.pr-note');
    if (e.target.classList.contains('pr-note-del')) {
      const n = noteEl._note;
      notes = notes.filter(z => z !== n); selection.delete(n);
      renderNotes(); layoutGrid(); record();
      return;
    }
    if (noteEl) {
      const n = noteEl._note;
      const resize = e.target.classList.contains('pr-note-resize');
      if (e.altKey) {                          // Alt+arrastre vertical = velocity
        selection = new Set([n]);
        drag = { mode: 'velocity', note: n, startY: e.clientY, startVel: n.velocity || 100 };
        renderNotes();
        gridEl.setPointerCapture(e.pointerId); e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {            // Ctrl+clic: alterna en la selección
        if (selection.has(n)) selection.delete(n); else selection.add(n);
        renderNotes();
        gridEl.setPointerCapture(e.pointerId); e.preventDefault();
        return;
      }
      if (resize) {
        selection = new Set([n]);
        drag = { mode: 'resize', note: n };
        renderNotes();
      } else {
        if (!selection.has(n)) selection = new Set([n]);   // mueve el grupo
        drag = {
          mode: 'move', anchorS0: n.startSec, anchorM0: n.midi,
          grabDx: x - secToX(n.startSec), lastMidi: n.midi,
          group: [...selection].map(z => ({ note: z, s0: z.startSec, m0: z.midi })),
        };
        if (!playing) audition(n.midi);
        renderNotes();
      }
    } else {
      // Vacío: dibuja una nota nueva (limpia la selección).
      selection = new Set();
      const n = { midi: yToMidi(y), velocity: 100, startSec: snap(xToSec(x)), durationSec: snapSec() };
      notes.push(n); selection.add(n);
      drag = { mode: 'resize', note: n };
      if (!playing) audition(n.midi);
      renderNotes();
    }
    gridEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  gridEl.addEventListener('pointermove', (e) => {
    const rect = gridEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (marquee) { marquee.x1 = x; marquee.y1 = y; positionMarquee(); return; }
    if (!drag) return;
    if (drag.mode === 'move') {
      const anchorStart = Math.max(0, snap(xToSec(x - drag.grabDx)));
      const dStart = anchorStart - drag.anchorS0;
      const anchorMidi = Math.max(PITCH_LOW, Math.min(PITCH_HIGH, yToMidi(y)));
      const dMidi = anchorMidi - drag.anchorM0;
      for (const g of drag.group) {
        g.note.startSec = Math.max(0, g.s0 + dStart);
        g.note.midi = Math.max(PITCH_LOW, Math.min(PITCH_HIGH, g.m0 + dMidi));
      }
      if (anchorMidi !== drag.lastMidi) { if (!playing) audition(anchorMidi); drag.lastMidi = anchorMidi; }
    } else if (drag.mode === 'velocity') {
      const dv = -(e.clientY - drag.startY);
      drag.note.velocity = Math.max(1, Math.min(127, Math.round(drag.startVel + dv)));
    } else { // resize
      const dur = snap(xToSec(x) - drag.note.startSec);
      drag.note.durationSec = Math.max(snapSec(), dur);
    }
    renderNotes();
  });

  const endDrag = (e) => {
    try { gridEl.releasePointerCapture(e.pointerId); } catch (_) {}
    if (marquee) { commitMarquee(); marquee = null; if (marqueeEl) marqueeEl.style.display = 'none'; return; }
    if (!drag) return;
    drag = null;
    layoutGrid();
    record();   // punto de deshacer tras cada edición
  };
  gridEl.addEventListener('pointerup', endDrag);
  gridEl.addEventListener('pointercancel', endDrag);

  // Copiar el patrón seleccionado (offsets relativos al primero).
  function copySelection() {
    if (!selection.size) return;
    const arr = [...selection];
    const minStart = Math.min(...arr.map(n => n.startSec));
    clipboard = arr.map(n => ({ midi: n.midi, velocity: n.velocity, off: n.startSec - minStart, durationSec: n.durationSec }));
  }
  // Pegar en la posición del playhead (clic en la regla para ubicarlo).
  function pasteClipboard() {
    if (!clipboard.length) return;
    selection = new Set();
    for (const c of clipboard) {
      const n = { midi: c.midi, velocity: c.velocity, startSec: playStartSec + c.off, durationSec: c.durationSec };
      notes.push(n); selection.add(n);
    }
    renderNotes(); layoutGrid(); record();
  }
  // Duplica la selección desplazada a la derecha por su propia duración.
  function duplicateSelection() {
    if (!selection.size) return;
    const arr = [...selection];
    const minStart = Math.min(...arr.map(n => n.startSec));
    const maxEnd = Math.max(...arr.map(n => n.startSec + n.durationSec));
    const shift = maxEnd - minStart;
    const copies = arr.map(n => ({ midi: n.midi, velocity: n.velocity, startSec: n.startSec + shift, durationSec: n.durationSec }));
    selection = new Set(copies);
    notes.push(...copies);
    renderNotes(); layoutGrid(); record();
  }
  // Transpone la selección (semitonos), con clamp al rango del piano.
  function transposeSelection(semis) {
    if (!selection.size) return;
    for (const n of selection) n.midi = Math.max(PITCH_LOW, Math.min(PITCH_HIGH, n.midi + semis));
    renderNotes(); record();
  }

  // Teclas del editor (en captura, para que NO afecten al timeline detrás).
  function onKey(e) {
    const ae = e.target;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); startPreview(); return; }
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); undo(); return; }
    if (mod && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); e.stopImmediatePropagation(); redo(); return; }
    if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); e.stopImmediatePropagation(); selection = new Set(notes); renderNotes(); return; }
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); e.stopImmediatePropagation(); copySelection(); return; }
    if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); e.stopImmediatePropagation(); pasteClipboard(); return; }
    if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopImmediatePropagation(); duplicateSelection(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopImmediatePropagation(); transposeSelection(e.shiftKey ? 12 : 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); transposeSelection(e.shiftKey ? -12 : -1); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); record(); }
  }
  document.addEventListener('keydown', onKey, true);

  // Zoom de tiempo: botones + Ctrl+rueda.
  overlay.querySelector('#pr-zoomin').onclick = () => setZoom(zoom * 1.25);
  overlay.querySelector('#pr-zoomout').onclick = () => setZoom(zoom / 1.25);
  scrollEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  // Toggles: cuantizar al grabar / metrónomo.
  const qrecBtn = overlay.querySelector('#pr-qrec');
  qrecBtn.onclick = () => { quantizeOnRec = !quantizeOnRec; qrecBtn.classList.toggle('is-on', quantizeOnRec); qrecBtn.setAttribute('aria-pressed', quantizeOnRec); };
  const metroBtn = overlay.querySelector('#pr-metro');
  metroBtn.onclick = () => { metroOn = !metroOn; metroBtn.classList.toggle('is-on', metroOn); metroBtn.setAttribute('aria-pressed', metroOn); };

  // Exportar a archivo .mid.
  overlay.querySelector('#pr-midi').onclick = () => { if (notes.length) downloadMidi(notes, bpm, 'piano.mid'); };

  // Leyenda de comandos (hamburguesa) — abre/cierra; clic fuera la cierra.
  const legendEl = overlay.querySelector('#pr-legend');
  overlay.querySelector('#pr-help').onclick = (e) => { e.stopPropagation(); legendEl.hidden = !legendEl.hidden; };
  overlay.addEventListener('pointerdown', (e) => {
    if (!legendEl.hidden && !e.target.closest('.pr-help-wrap')) legendEl.hidden = true;
  }, true);

  // Snap — al cambiar, redibuja la rejilla (líneas de subdivisión).
  overlay.querySelector('#pr-snap').onchange = (e) => { snapDiv = parseInt(e.target.value, 10); layoutGrid(); };

  // Cuantizar: alinea todas las notas al BPM (snap actual).
  overlay.querySelector('#pr-quantize').onclick = () => {
    const u = snapSec();
    for (const n of notes) {
      n.startSec = Math.max(0, Math.round(n.startSec / u) * u);
      n.durationSec = Math.max(u, Math.round(n.durationSec / u) * u);
    }
    renderNotes(); record();
  };

  // Suena brevemente una nota mientras se edita (audición).
  function audition(midi) {
    if (!piano.isLoaded()) return;
    try { piano.noteOn(midi, 100); setTimeout(() => piano.noteOff(midi), 230); } catch (_) {}
  }

  // ── Reproducción (tiempo real) ───────────────────────────────────
  // Cada frame lee las notas actuales: en modo preview hace loop; en modo
  // grabación avanza hacia adelante (sin loop) y expone el tiempo `curTime`,
  // que el piano usa para sellar las notas grabadas (así suena el editor, no el
  // timeline). El playhead arranca desde playStartSec.
  let playing = false;
  let recordMode = false;
  let previewRAF = null;
  let playT0 = 0;
  let curTime = 0;
  const sounding = new Set();   // midis sonando ahora por el reproductor
  let lastBeat = -1;
  // Click del metrónomo (oscilador corto) en el ctx del engine.
  function metroClick(accent) {
    try {
      const ctx = engine.getAudioContext();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = accent ? 2000 : 1400;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); g.connect(engine.getMasterGain());
      o.start(t); o.stop(t + 0.07);
    } catch (_) {}
  }
  async function startPlayback(isRecord = false) {
    if (playing) { stopPlayback(); return; }
    if (!piano.isLoaded()) { playBtn.textContent = 'Cargando…'; await piano.loadSamples(); }
    playing = true;
    recordMode = isRecord;
    lastBeat = -1;
    if (!isRecord) playBtn.textContent = '■ Detener';
    playT0 = performance.now();
    loopTick();
  }
  function loopTick() {
    if (!playing) return;
    const len = Math.max(0.5, contentSec());
    let now = playStartSec + (performance.now() - playT0) / 1000;
    if (!recordMode && now >= len) { allOff(); playT0 = performance.now(); now = playStartSec; lastBeat = -1; }
    curTime = now;
    // Metrónomo (en grabación, si está activado).
    if (metroOn && recordMode) {
      const beat = Math.floor(now / secPerBeat);
      if (beat !== lastBeat) { lastBeat = beat; metroClick(beat % beatsPerBar === 0); }
    }
    const want = new Set();
    for (const n of notes) if (now >= n.startSec && now < n.startSec + n.durationSec) want.add(n.midi);
    for (const m of want) if (!sounding.has(m)) { piano.noteOn(m, 100); sounding.add(m); }
    for (const m of [...sounding]) if (!want.has(m)) { piano.noteOff(m); sounding.delete(m); }
    playhead.style.left = `${secToX(now)}px`;
    previewRAF = requestAnimationFrame(loopTick);
  }
  function allOff() { for (const m of sounding) { try { piano.noteOff(m); } catch (_) {} } sounding.clear(); }
  function stopPlayback() {
    playing = false;
    recordMode = false;
    playBtn.textContent = '▶ Reproducir';
    if (previewRAF) cancelAnimationFrame(previewRAF);
    allOff();
    playhead.style.left = `${secToX(playStartSec)}px`;
    try { piano.panic(); } catch (_) {}
  }
  const startPreview = () => startPlayback(false);   // botón ▶ / Espacio
  playBtn.onclick = startPreview;

  // ── Editor + piano = un solo contenedor (flotante, arrastrable, resizable) ──
  // El teclado del piano se MUEVE dentro del modal (abajo del grid); al cerrar
  // vuelve a su lugar. Las notas grabadas entran al editor en vivo.
  const wasPianoOpen = isPianoOpen();
  const pianoEl = document.getElementById('stems-piano');
  const pianoParent = pianoEl ? pianoEl.parentNode : null;
  const pianoNext = pianoEl ? pianoEl.nextSibling : null;
  document.body.classList.add('pr-open');
  openPiano();
  if (pianoEl) modal.appendChild(pianoEl);   // teclado dentro del editor

  function addLiveNote(note) {
    if (quantizeOnRec) {
      const u = snapSec();
      note.startSec = Math.max(0, Math.round(note.startSec / u) * u);
      note.durationSec = Math.max(u, Math.round(note.durationSec / u) * u);
    }
    notes.push(note);
    renderNotes();
    layoutGrid();
  }
  setLiveNoteSink({
    addNote: addLiveNote,
    startClock: () => { record(); startPlayback(true); },          // punto de deshacer pre-grabación
    stopClock: () => { if (playing) stopPlayback(); record(); },   // estado post-grabación
    time: () => curTime,
  });

  // Arrastrar el contenedor por la cabecera (excepto sobre los controles).
  (function makeDraggable() {
    const handle = overlay.querySelector('.pr-head');
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, select, label')) return;
      dragging = true;
      const r = overlay.getBoundingClientRect();
      overlay.style.left = `${r.left}px`; overlay.style.top = `${r.top}px`;
      overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 200, ox + (e.clientX - sx)));
      const ny = Math.max(0, Math.min(window.innerHeight - 60, oy + (e.clientY - sy)));
      overlay.style.left = `${nx}px`; overlay.style.top = `${ny}px`;
    });
    const end = (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  })();

  // ── Cerrar / guardar ─────────────────────────────────────────────
  const pop = pushModal(() => close(), modal);
  function cleanup() {
    stopPlayback();
    setLiveNoteSink(null);
    document.body.classList.remove('pr-open');
    if (pianoEl && pianoParent) pianoParent.insertBefore(pianoEl, pianoNext);  // restaurar
    if (!wasPianoOpen) closePiano();
    document.removeEventListener('keydown', onKey, true);
    try {
      const r = overlay.getBoundingClientRect();
      localStorage.setItem('pr-window', JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }));
    } catch (_) {}
    try { pop(); } catch (_) {}
    overlay.remove();
  }
  function close() { cleanup(); }
  function save() {
    notes.sort((a, b) => a.startSec - b.startSec);
    cleanup();
    opts.onSave?.(notes);
  }

  overlay.querySelector('#pr-cancel').onclick = () => close();
  overlay.querySelector('#pr-save').onclick = () => save();
  setPlayhead(0);   // playhead visible desde el inicio
}
