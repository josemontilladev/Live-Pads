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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_LOW = 21;    // A0 (piano completo)
const PITCH_HIGH = 108;  // C8
const ROW_H = 20;        // alto por semitono (px)
const PX_PER_SEC = 130;  // escala de tiempo
const KEYS_W = 60;       // ancho de la columna de teclas
const BLACK_PC = new Set([1, 3, 6, 8, 10]);

function noteName(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
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
  piano.loadSamples().catch(() => {});   // precarga para audición/reproducción

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
            <div class="pr-legend-row"><kbd>Clic der.</kbd><span>Selección por área</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + clic</kbd><span>Suma/quita a la selección</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + A</kbd><span>Seleccionar todo</span></div>
            <div class="pr-legend-row"><kbd>Ctrl + C / V</kbd><span>Copiar / pegar patrón</span></div>
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
    const black = BLACK_PC.has(m % 12);
    const label = (m % 12 === 0) ? noteName(m) : '';
    keysHtml += `<div class="pr-key ${black ? 'is-black' : ''}" style="height:${ROW_H}px">${label}</div>`;
  }
  keysEl.innerHTML = keysHtml;

  // Rejilla.
  function contentSec() {
    let end = beatsPerBar * secPerBeat * 4;   // mínimo 4 compases
    for (const n of notes) end = Math.max(end, n.startSec + n.durationSec);
    return end + beatsPerBar * secPerBeat;     // un compás extra
  }
  function layoutGrid() {
    const w = Math.ceil(contentSec() * PX_PER_SEC);
    gridEl.style.width = `${w}px`;
    gridEl.style.height = `${gridH}px`;
    const beatPx = secPerBeat * PX_PER_SEC;
    const barPx = beatPx * beatsPerBar;
    const subPx = beatPx / snapDiv;   // subdivisión del snap (1/8, 1/16…)
    gridEl.style.backgroundSize = `100% ${ROW_H * 12}px, 100% ${ROW_H}px, ${subPx}px 100%, ${beatPx}px 100%, ${barPx}px 100%`;
    // Regla: números de compás.
    rulerEl.style.width = `${w}px`;
    const barSec = secPerBeat * beatsPerBar;
    const nBars = Math.ceil(contentSec() / barSec) + 1;
    let bars = '';
    for (let b = 0; b < nBars; b++) bars += `<div class="pr-ruler-bar" style="left:${(b * barSec) * PX_PER_SEC}px">${b + 1}</div>`;
    rulerEl.innerHTML = bars;
  }

  // Mapeos.
  const xToSec = (x) => Math.max(0, x / PX_PER_SEC);
  const secToX = (s) => s * PX_PER_SEC;
  const yToMidi = (y) => PITCH_HIGH - Math.floor(y / ROW_H);
  const midiToY = (m) => (PITCH_HIGH - m) * ROW_H;
  const snap = (s) => Math.round(s / snapSec()) * snapSec();

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
      renderNotes(); layoutGrid();
      return;
    }
    if (noteEl) {
      const n = noteEl._note;
      const resize = e.target.classList.contains('pr-note-resize');
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
    renderNotes(); layoutGrid();
  }

  // Teclas del editor (en captura, para que NO afecten al timeline detrás).
  function onKey(e) {
    const ae = e.target;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); startPreview(); return; }
    if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); e.stopImmediatePropagation(); selection = new Set(notes); renderNotes(); return; }
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); e.stopImmediatePropagation(); copySelection(); return; }
    if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); e.stopImmediatePropagation(); pasteClipboard(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  }
  document.addEventListener('keydown', onKey, true);

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
    renderNotes();
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
  async function startPlayback(record = false) {
    if (playing) { stopPlayback(); return; }
    if (!piano.isLoaded()) { playBtn.textContent = 'Cargando…'; await piano.loadSamples(); }
    playing = true;
    recordMode = record;
    if (!record) playBtn.textContent = '■ Detener';
    playT0 = performance.now();
    loopTick();
  }
  function loopTick() {
    if (!playing) return;
    const len = Math.max(0.5, contentSec());
    let now = playStartSec + (performance.now() - playT0) / 1000;
    if (!recordMode && now >= len) { allOff(); playT0 = performance.now(); now = playStartSec; }
    curTime = now;
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
    notes.push(note);
    renderNotes();
    layoutGrid();
  }
  setLiveNoteSink({
    addNote: addLiveNote,
    startClock: () => startPlayback(true),
    stopClock: () => { if (playing) stopPlayback(); },
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
