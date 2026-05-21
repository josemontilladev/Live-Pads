// Stem Editor workspace — full DAW-style layout (sidebar mixer + scrolling
// timeline with waveforms + ruler with bars/beats). Drives the engine for
// playback and orchestrates click-track / guide-track generation from
// project metadata (BPM, time signature, markers).

// ── engine: full module, includes reorderTracks now ─────────────
import * as engine from './engine.js';
import * as projectStore from './projectStore.js';
import { exportMix } from './exporter.js';
import { computePeaks, drawWaveform } from './waveform.js';
import { generateClickTrack, audioBufferToWav, getClickSounds } from './clickGenerator.js';
import { Mp3Encoder } from '../../vendor/lamejs.js';
import { buildGuideTrack } from './guideBuilder.js';
import { SECTION_CUES, findCueById } from './sectionCatalog.js';
import { pushHistory, undo as historyUndo, redo as historyRedo, clearHistory } from './history.js';
import { detectTempoMeter, detectBeatAlignment } from './bpmDetector.js';
import { maybeStartTour, startTour } from './tour.js';

// ── Constants ──────────────────────────────────────────────────────
let PX_PER_SEC        = 40;     // horizontal scale of the timeline (zoomable)
const PX_PER_SEC_MIN  = 10;
const PX_PER_SEC_MAX  = 200;
let ROW_HEIGHT        = 64;     // px per track row (strip + lane same height; user-adjustable)
const ROW_HEIGHT_MIN  = 48;
const ROW_HEIGHT_MAX  = 160;
const RULER_HEIGHT    = 40;
const STRIP_WIDTH     = 220;    // sticky-left mixer strip width
const MIN_TIMELINE_PX = 2000;   // empty-project canvas width
const SAVE_DEBOUNCE_MS = 800;

const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5,3 19,12 5,21"/></svg>`;
const SVG_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>`;
const SVG_PLUS = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
// Full trash-can icon: top rail + handle on the lid + body + two vertical
// drain lines. Reads as "papelera" at small sizes — the lid-less variant
// looked like a half-formed pail.
const SVG_TRASH = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
const SVG_FLAG = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;

// Rotation palette: every newly-imported stem gets a different colour
// from this list. The user can still override per-track via the color
// picker; this just stops every stem from defaulting to the theme accent.
const STEM_PALETTE = [
  '#FBAE00', // theme gold
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
  '#f43f5e', // rose
  '#3b82f6'  // blue
];
let nextStemColorIdx = 0;
function nextStemColor() {
  const c = STEM_PALETTE[nextStemColorIdx % STEM_PALETTE.length];
  nextStemColorIdx++;
  return c;
}

// ── Module state ───────────────────────────────────────────────────
let mounted = false;
let nextTrackId = 1;
let projectName = 'Mi proyecto';
let bpm = 120;
let beatsPerBar = 4;
let beatValue = 4;
let markers = [];        // array of { id, label, atSec, url }
let nextMarkerId = 1;
const trackRows = new Map();   // trackId → { strip, lane, canvas }
const peaksCache = new Map();  // trackId → Float32Array peaks

let saveTimer = null;
let pillTimer = null;

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const s = Math.max(0, sec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}
function formatTimecode(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Public toggle used by the global keydown router (app.js) so Space in
// the Stems workspace controls stems playback instead of the Pads master.
// Behaviour: if playing → pause (keep position); if paused/stopped → play.
export function toggleStemsPlay() {
  if (!mounted) return;
  if (engine.isCurrentlyPlaying()) engine.pause();
  else engine.play();
}

// Public: drop a marker at the current playhead using whatever section is
// selected in the dropdown. Bound to the `M` key from the global handler.
export function addStemsMarker() {
  if (!mounted) return;
  onAddMarker();
}

// Public hooks for the global keymap to invoke undo/redo from app.js.
export function stemsUndo() { if (mounted) historyUndo(); }
export function stemsRedo() { if (mounted) historyRedo(); }

// Public entry point to trigger the tour manually (from menu / cheat-sheet).
export function showStemsTour() { startTour(); }

export async function mount() {
  if (mounted) return;
  mounted = true;

  engine.init({
    onPlayingChange: applyPlayingState,
    onTimeUpdate: applyTimeUpdate
  });

  const root = document.getElementById('workspace-stems');
  if (!root) return;
  root.innerHTML = SHELL_HTML;
  wireTopbarEvents(root);
  wireArrangeEvents(root);
  wireSeekClicks(root);
  wireRowReorder(root);
  refreshSectionDropdown();
  refreshClickSoundDropdown();
  refreshTimelineWidth();

  // Repaint waveforms whenever the global theme changes so the accent
  // colour stays in sync with whatever the user picked in Ajustes.
  document.addEventListener('livepads:theme-change', () => redrawAllWaveforms());

  // Master VU meter — animate while the engine is playing. Cheap RAF
  // loop that reads peak from the analyser; idle when stopped so we
  // don't burn frames on silence.
  startMasterMeter();

  try {
    const restored = await projectStore.loadCurrent();
    if (restored && (restored.tracks?.length || restored.markers?.length)) {
      await rehydrate(restored);
    }
  } catch (e) {
    console.warn('Could not restore stem project:', e);
  }
}

// ── HTML shell ─────────────────────────────────────────────────────
const SHELL_HTML = `
  <div class="stems-shell">

   <div class="stems-deck">
    <header class="stems-topbar">
      <div class="stems-tb-left">
        <span class="stems-brand">LIVEPADS <span>STEMS</span></span>
        <div class="stems-field stems-field--bpm">
          <label>BPM</label>
          <input type="number" id="stems-bpm" min="20" max="300" value="120">
          <button class="stems-bpm-detect" id="stems-bpm-detect" title="Detectar BPM de la primera pista importada">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="11" height="11"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
            Detectar
          </button>
        </div>
        <div class="stems-field stems-field--select">
          <label>COMPÁS</label>
          <select id="stems-sig">
            <option value="2/4">2/4</option>
            <option value="3/4">3/4</option>
            <option value="4/4" selected>4/4</option>
            <option value="5/4">5/4</option>
            <option value="6/4">6/4</option>
            <option value="6/8">6/8</option>
            <option value="7/8">7/8</option>
            <option value="9/8">9/8</option>
            <option value="12/8">12/8</option>
          </select>
        </div>
      </div>

      <div class="stems-tb-mid">
        <button class="stems-tb-btn" id="stems-stop" title="Stop (vuelve al inicio)">${SVG_STOP}</button>
        <button class="stems-tb-btn" id="stems-pause" title="Pausa (mantiene la posición)" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        </button>
        <button class="stems-tb-btn stems-tb-btn--play" id="stems-play" title="Play / Reanudar" disabled>${SVG_PLAY}</button>
        <span class="stems-tb-time" id="stems-tb-time" title="Posición / duración total">
          <span id="stems-tb-cur">0:00</span><span class="stems-tb-time-sep">/</span><span id="stems-tb-total">0:00</span>
        </span>
      </div>

      <div class="stems-tb-right">
        <div class="stems-zoom-group" title="Zoom del timeline (Alt + rueda del ratón)">
          <button class="stems-zoom-btn" id="stems-zoom-out" aria-label="Reducir zoom">−</button>
          <span class="stems-zoom-readout" id="stems-zoom-readout">100%</span>
          <button class="stems-zoom-btn" id="stems-zoom-in" aria-label="Aumentar zoom">+</button>
        </div>
        <div class="stems-zoom-group" title="Altura de las pistas (Ctrl + rueda del ratón)">
          <button class="stems-zoom-btn" id="stems-row-shorter" aria-label="Pistas más pequeñas">▼</button>
          <button class="stems-zoom-btn" id="stems-row-taller" aria-label="Pistas más grandes">▲</button>
        </div>
        <label class="stems-snap-toggle" title="Marcadores se ajustan al beat más cercano">
          <input type="checkbox" id="stems-snap" checked>
          <span>SNAP</span>
        </label>
        <div class="stems-readout">
          <span class="label">TIMECODE</span>
          <span class="value mono" id="stems-timecode">00:00.000</span>
        </div>
        <span class="stems-state-pill" id="stems-state-pill">DETENIDO</span>
      </div>
    </header>

    <header class="stems-actions stems-actions--row1">
      <div class="stems-actions-primary">
        <button class="stems-btn stems-btn--primary" id="stems-import">${SVG_PLUS} Importar stems</button>
        <button class="stems-btn stems-btn--ghost" id="stems-export" disabled>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Exportar MP3
        </button>
        <input type="file" id="stems-file-input" accept="audio/*" multiple hidden>
      </div>

      <div class="stems-actions-mid">
        <span class="stems-project-icon">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" fill="none" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </span>
        <input class="stems-project-name" id="stems-project-name" value="Mi proyecto" spellcheck="false" title="Nombre del proyecto">
      </div>

      <div class="stems-proj-menu">
        <button class="stems-btn stems-btn--subtle" id="stems-proj-toggle" title="Proyecto…">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Proyecto ▾
        </button>
        <div class="stems-proj-dropdown" id="stems-proj-dropdown" hidden>
          <button data-proj-cmd="new"     class="stems-proj-item">Nuevo (vaciar actual)</button>
          <button data-proj-cmd="save-as" class="stems-proj-item">Guardar como…</button>
          <button data-proj-cmd="open"    class="stems-proj-item">Abrir proyecto…</button>
        </div>
      </div>
    </header>

    <header class="stems-actions stems-actions--row2">
      <div class="stems-tools-group">
        <span class="stems-tools-label">PISTAS</span>
        <select id="stems-click-sound" class="stems-mini-select" aria-label="Sonido del click" title="Sonido del click"></select>
        <button class="stems-btn stems-btn--subtle" id="stems-add-click" title="Genera un click track al BPM actual">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><circle cx="12" cy="12" r="9"/><line x1="12" y1="5" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
          Generar Click
        </button>
        <button class="stems-btn stems-btn--subtle" id="stems-rebuild-guide" title="Regenera la pista de guía con los marcadores actuales">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          Generar Guía
        </button>
      </div>
      <div class="stems-tools-group">
        <span class="stems-tools-label">MARCADORES</span>
        <select id="stems-section-select" class="stems-mini-select" aria-label="Sección"></select>
        <button class="stems-btn stems-btn--accent" id="stems-add-marker" title="Añadir marcador en el tiempo actual">
          ${SVG_FLAG} Añadir marcador
        </button>
        <button class="stems-btn stems-btn--subtle" id="stems-loop-toggle" title="Loop entre los dos marcadores marcados">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Loop
        </button>
      </div>
    </header>
   </div>

    <main class="stems-arrange" id="stems-arrange">
      <div class="stems-arrange-inner" id="stems-arrange-inner">
        <div class="stems-loop-overlay" id="stems-loop-overlay" hidden></div>
        <header class="stems-head-row">
          <div class="stems-head-spacer">
            <span class="stems-head-spacer-label">PISTAS</span>
          </div>
          <div class="stems-head-tl">
            <div class="stems-ruler" id="stems-ruler"></div>
            <div class="stems-marker-layer" id="stems-marker-layer"></div>
          </div>
        </header>

        <div class="stems-rows" id="stems-rows">
          <div class="stems-empty" id="stems-empty">
            <div class="stems-empty-icon">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="56" height="56"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <h3>Sin pistas aún</h3>
            <p>Arrastra stems o usa <button type="button" class="stems-empty-link" id="stems-empty-import">Importar stems</button>.</p>
          </div>
        </div>

        <div class="stems-playhead" id="stems-playhead"></div>
      </div>
    </main>

    <section class="stems-console" id="stems-console">
      <header class="stems-console-header">
        <div class="stems-console-header-left">
          <span class="stems-console-title">CONSOLA</span>
          <span class="stems-console-count" id="stems-console-count">0 pistas</span>
        </div>
        <div class="stems-console-header-right">
          <span class="stems-save-pill" id="stems-save-pill" hidden>Guardado ✓</span>
          <label class="stems-master">
            <span>MASTER</span>
            <div class="stems-master-meter" aria-hidden="true">
              <div class="stems-master-meter-fill" id="stems-master-meter"></div>
            </div>
            <input type="range" min="0" max="100" value="85" id="stems-master-vol" class="stems-range stems-range--fill">
            <span class="stems-master-readout" id="stems-master-readout">85%</span>
          </label>
        </div>
      </header>
      <div class="stems-console-strips" id="stems-console-strips"></div>
    </section>

    <div class="stems-export-overlay" id="stems-export-overlay" hidden>
      <div class="stems-export-panel">
        <h3 id="stems-export-title">Renderizando mezcla…</h3>
        <p id="stems-export-stage" class="stems-export-stage">Preparando audio</p>
        <div class="stems-export-bar"><div class="stems-export-fill" id="stems-export-fill"></div></div>
      </div>
    </div>
  </div>
`;

// HTML5 drag-and-drop reordering between .stems-row elements. The strip
// element on the left of each row is the drag handle (draggable=true).
// On drop we rebuild trackRows order in the DOM + tell the engine so the
// audio routing/console mirror stays in lockstep.
function wireRowReorder(root) {
  const list = root.querySelector('#stems-rows');
  if (!list) return;
  let draggingRow = null;

  list.addEventListener('dragstart', (e) => {
    const strip = e.target.closest('[data-drag-row]');
    if (!strip) return;
    draggingRow = strip.closest('.stems-row');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingRow.dataset.trackId);
    requestAnimationFrame(() => draggingRow.classList.add('is-dragging'));
  });
  list.addEventListener('dragend', () => {
    if (draggingRow) draggingRow.classList.remove('is-dragging');
    draggingRow = null;
    qa('.stems-row.is-drop-target', list).forEach(r => r.classList.remove('is-drop-target'));
  });
  list.addEventListener('dragover', (e) => {
    if (!draggingRow) return;
    e.preventDefault();
    const over = e.target.closest('.stems-row');
    if (!over || over === draggingRow) return;
    const rect = over.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    qa('.stems-row.is-drop-target', list).forEach(r => r.classList.remove('is-drop-target'));
    over.classList.add('is-drop-target');
    if (before) over.parentNode.insertBefore(draggingRow, over);
    else over.parentNode.insertBefore(draggingRow, over.nextSibling);
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    qa('.stems-row.is-drop-target', list).forEach(r => r.classList.remove('is-drop-target'));
    // Persist new order to the engine + console mirror.
    const newOrder = Array.from(list.querySelectorAll('.stems-row')).map(r => r.dataset.trackId);
    engine.reorderTracks(newOrder);
    // Also reorder the console strips so the bottom mixer matches.
    const console = document.getElementById('stems-console-strips');
    if (console) {
      for (const id of newOrder) {
        const c = console.querySelector(`.stems-console-strip[data-track-id="${id}"]`);
        if (c) console.appendChild(c);
      }
    }
    scheduleSave();
  });
}

// Helper: querySelectorAll relative to a root.
function qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

// Master VU meter — animates from the engine's master AnalyserNode.
let meterRAF = null;
let meterLastDecay = 0;
let meterPeakSmoothed = 0;
function startMasterMeter() {
  if (meterRAF) return; // already running
  const el = document.getElementById('stems-master-meter');
  if (!el) return;
  const tick = () => {
    if (!engine.isCurrentlyPlaying()) {
      // Decay smoothly to 0, then STOP the loop so it doesn't burn a frame
      // every tick forever (it used to run even back in the Pads workspace).
      if (meterPeakSmoothed > 0.001) {
        meterPeakSmoothed *= 0.9;
        el.style.height = `${Math.min(100, meterPeakSmoothed * 100)}%`;
        meterRAF = requestAnimationFrame(tick);
      } else {
        if (el.style.height !== '0%') el.style.height = '0%';
        meterRAF = null; // idle → stop until playback resumes
      }
      return;
    }
    const { peak } = engine.getMasterLevel();
    // Attack fast, release slow — same envelope a real VU has.
    if (peak > meterPeakSmoothed) meterPeakSmoothed = peak;
    else meterPeakSmoothed = meterPeakSmoothed * 0.85 + peak * 0.15;
    el.style.height = `${Math.min(100, meterPeakSmoothed * 100)}%`;
    meterRAF = requestAnimationFrame(tick);
  };
  meterRAF = requestAnimationFrame(tick);
}

// Click on any timeline area (ruler, marker layer, or a lane) jumps the
// transport to that time. The sticky-left strip column is excluded — the
// closest() check below scopes it to lanes / head-tl only.
function wireSeekClicks(root) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('.stems-row-strip')) return;
    if (e.target.closest('.stems-row-remove')) return; // remove button bubbles
    if (e.target.closest('.stems-marker-remove')) return;
    if (e.target.closest('input, select, button')) return;
    const lane = e.target.closest('.stems-row-lane') ||
                 e.target.closest('.stems-head-tl');
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 0) return;
    engine.seek(x / PX_PER_SEC);
  });
}

// Continuously keep the playhead at ~30% of the visible lane while
// playing. When the user grabs the scrollbar / wheel-scrolls manually,
// we pause auto-follow so they can inspect the timeline freely. Auto-
// follow resumes the next time they hit Play (or when the playhead
// catches back up to the viewport on its own).
// Keep the playhead visible during playback by scrolling the timeline so
// the cursor stays anchored ~30% from the left of the lane area. Always
// follows while playing (clamped to the scrollable range) so the vertical
// playback bar is never lost off-screen.
function autoFollowPlayhead(sec) {
  if (!engine.isCurrentlyPlaying()) return;
  const arrange = document.getElementById('stems-arrange');
  if (!arrange) return;

  const headX = STRIP_WIDTH + sec * PX_PER_SEC;
  const laneW = arrange.clientWidth - STRIP_WIDTH;
  if (laneW <= 0) return;
  const anchor = STRIP_WIDTH + laneW * 0.3;
  const maxScroll = Math.max(0, arrange.scrollWidth - arrange.clientWidth);
  const target = Math.max(0, Math.min(headX - anchor, maxScroll));
  if (Math.abs(arrange.scrollLeft - target) > 0.5) arrange.scrollLeft = target;
}

export function resumeAutoFollow() { /* always-follow now; kept for callers */ }

// ── Wiring: top bar ────────────────────────────────────────────────
function wireTopbarEvents(root) {
  const bpmInput = root.querySelector('#stems-bpm');
  const sigInput = root.querySelector('#stems-sig');
  // Capture pre-edit BPM so the history entry can revert to it on undo.
  let bpmBefore = bpm;
  bpmInput.addEventListener('focus', () => { bpmBefore = bpm; });
  bpmInput.addEventListener('input', () => {
    const v = parseInt(bpmInput.value, 10);
    if (isFinite(v) && v >= 20 && v <= 300) {
      bpm = v;
      drawRuler();
      scheduleSave();
    }
  });
  bpmInput.addEventListener('change', () => {
    if (bpm === bpmBefore) return;
    const oldBpm = bpmBefore, newBpm = bpm;
    pushHistory('Cambiar BPM',
      () => { bpm = oldBpm; bpmInput.value = oldBpm; drawRuler(); scheduleSave(); },
      () => { bpm = newBpm; bpmInput.value = newBpm; drawRuler(); scheduleSave(); }
    );
    bpmBefore = bpm;
  });

  let sigBefore = `${beatsPerBar}/${beatValue}`;
  sigInput.addEventListener('focus', () => { sigBefore = `${beatsPerBar}/${beatValue}`; });
  sigInput.addEventListener('change', () => {
    const m = sigInput.value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return;
    const newSig = sigInput.value;
    if (newSig === sigBefore) return;
    const oldSig = sigBefore;
    beatsPerBar = parseInt(m[1], 10);
    beatValue = parseInt(m[2], 10);
    drawRuler();
    scheduleSave();
    pushHistory('Cambiar compás',
      () => {
        const om = oldSig.match(/^(\d+)\s*\/\s*(\d+)$/);
        beatsPerBar = parseInt(om[1], 10); beatValue = parseInt(om[2], 10);
        sigInput.value = oldSig; drawRuler(); scheduleSave();
      },
      () => {
        beatsPerBar = parseInt(m[1], 10); beatValue = parseInt(m[2], 10);
        sigInput.value = newSig; drawRuler(); scheduleSave();
      }
    );
    sigBefore = newSig;
  });

  root.querySelector('#stems-play').onclick = () => { resumeAutoFollow(); engine.play(); };
  root.querySelector('#stems-pause').onclick = () => engine.pause();
  root.querySelector('#stems-stop').onclick = () => { resumeAutoFollow(); engine.stop(); };
  root.querySelector('#stems-bpm-detect').onclick = onDetectBpm;

  // Buttons animate too, anchored to the centre of the visible lane area.
  const zoomBtnAnchorX = () => {
    const arrange = document.getElementById('stems-arrange');
    if (!arrange) return 0;
    const r = arrange.getBoundingClientRect();
    return r.left + STRIP_WIDTH + (r.width - STRIP_WIDTH) / 2;
  };
  const stepZoom = (mult) => {
    const base = zoomRAF ? zoomTarget : PX_PER_SEC;
    animateZoomTo(base * mult, zoomBtnAnchorX());
  };
  root.querySelector('#stems-zoom-in').onclick  = () => stepZoom(1.5);
  root.querySelector('#stems-zoom-out').onclick = () => stepZoom(1 / 1.5);
  root.querySelector('#stems-row-taller').onclick   = () => setRowHeight(ROW_HEIGHT + 14);
  root.querySelector('#stems-row-shorter').onclick  = () => setRowHeight(ROW_HEIGHT - 14);
  root.querySelector('#stems-snap').onchange = (e) => { snapToBeat = e.target.checked; scheduleSave(); };

  // Alt+wheel  → horizontal zoom (anchored on the cursor X for natural feel)
  // Ctrl+wheel → row height (stack tighter / stretch taller)
  const arrange = root.querySelector('#stems-arrange');
  arrange.addEventListener('wheel', (e) => {
    if (e.altKey) {
      e.preventDefault();
      // Smooth, speed-proportional zoom: normalise deltaY across mouse-wheel
      // (lines/pages) and trackpad (pixels), then an exponential factor so a
      // single notch is a gentle ~12% step instead of compounding 1.15× jumps.
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;        // lines → ~px
      else if (e.deltaMode === 2) dy *= 100;  // pages → ~px
      dy = Math.max(-100, Math.min(100, dy)); // clamp a single event
      const factor = Math.exp(-dy * 0.0009);
      // Accumulate onto the pending target so rapid notches glide together.
      const base = zoomRAF ? zoomTarget : PX_PER_SEC;
      animateZoomTo(base * factor, e.clientX);
    } else if (e.ctrlKey) {
      e.preventDefault();
      setRowHeight(ROW_HEIGHT + (e.deltaY < 0 ? 14 : -14));
    }
  }, { passive: false });
}

// Auto-detect BPM from the first imported (non-click, non-guide) track.
// Cheap autocorrelation under the hood — see bpmDetector.js. The user
// confirms the detected value before we overwrite the current BPM,
// since the algorithm can land on the wrong octave for sparse material.
function onDetectBpm() {
  const stemTrack = engine.getTracks().find(t => t.kind === 'stem');
  if (!stemTrack) {
    alert('Importa primero un stem para detectar el BPM.');
    return;
  }
  const btn = document.getElementById('stems-bpm-detect');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  // Defer to next frame so the UI updates before we crunch numbers.
  requestAnimationFrame(() => {
    try {
      const buf = engine.getTrackBuffer(stemTrack.id);
      const result = detectTempoMeter(buf);
      if (!result || !result.bpm) {
        alert('No se pudo detectar un BPM claro. Prueba con una pista más percusiva (drums, click, bajo).');
        return;
      }
      const detected = result.bpm;
      const detectedSig = result.signature || `${beatsPerBar}/${beatValue}`;
      const oldBpm = bpm, oldSig = `${beatsPerBar}/${beatValue}`;
      if (detected === bpm && detectedSig === oldSig) {
        alert(`La pista ya coincide con lo actual (${detected} BPM, ${oldSig}).`);
        return;
      }
      if (!confirm(`Detectado: ${detected} BPM · compás ${detectedSig}.\n¿Aplicarlo? (actual: ${oldBpm} BPM · ${oldSig})`)) return;

      const apply = (b, sig) => {
        bpm = b;
        const [bp, bv] = sig.split('/').map(n => parseInt(n, 10));
        if (bp) beatsPerBar = bp;
        if (bv) beatValue = bv;
        const input = document.getElementById('stems-bpm');
        if (input) input.value = b;
        const sigSel = document.getElementById('stems-sig');
        if (sigSel) sigSel.value = sig;
        drawRuler();
      };
      apply(detected, detectedSig);
      pushHistory('Detectar BPM y compás',
        () => { apply(oldBpm, oldSig); scheduleSave(); },
        () => { apply(detected, detectedSig); scheduleSave(); }
      );
      scheduleSave();
    } catch (e) {
      console.error('BPM detection failed:', e);
      alert('Error detectando BPM: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="11" height="11"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg> Detectar`;
      }
    }
  });
}

function clampPx(v) { return Math.max(PX_PER_SEC_MIN, Math.min(PX_PER_SEC_MAX, v)); }

// Instant zoom (used on project load). Interactive zoom uses animateZoomTo.
function setZoom(next) {
  PX_PER_SEC = clampPx(next);
  const readout = document.getElementById('stems-zoom-readout');
  if (readout) readout.textContent = `${Math.round((PX_PER_SEC / 40) * 100)}%`;
  refreshTimelineWidth();
  scheduleSave();
}

// Smooth, anchor-preserving zoom: glide PX_PER_SEC toward a target over a few
// frames so wheel notches feel continuous instead of snapping. During the
// glide the existing waveform bitmaps are cheaply CSS-stretched (no peak
// recompute); a single crisp redraw runs when the glide settles.
let zoomTarget = PX_PER_SEC;
let zoomRAF = 0;
let zoomAnchorSec = 0;       // audio time to keep under the anchor point
let zoomAnchorOffsetX = 0;   // anchor X relative to the arrange left edge

function animateZoomTo(target, anchorClientX) {
  const arrange = document.getElementById('stems-arrange');
  if (!arrange) { setZoom(target); return; }
  zoomTarget = clampPx(target);
  const rectLeft = arrange.getBoundingClientRect().left;
  zoomAnchorOffsetX = anchorClientX - rectLeft;
  zoomAnchorSec = (arrange.scrollLeft + zoomAnchorOffsetX - STRIP_WIDTH) / PX_PER_SEC;
  if (zoomRAF) return; // already gliding; new target picked up next frame

  const tick = () => {
    const diff = zoomTarget - PX_PER_SEC;
    const done = Math.abs(diff) < 0.5;
    PX_PER_SEC = done ? zoomTarget : clampPx(PX_PER_SEC + diff * 0.28);
    applyZoomFrame(arrange, done);
    if (done) { zoomRAF = 0; scheduleSave(); }
    else zoomRAF = requestAnimationFrame(tick);
  };
  zoomRAF = requestAnimationFrame(tick);
}

function applyZoomFrame(arrange, crisp) {
  const readout = document.getElementById('stems-zoom-readout');
  if (readout) readout.textContent = `${Math.round((PX_PER_SEC / 40) * 100)}%`;
  const inner = document.getElementById('stems-arrange-inner');
  const w = projectWidthPx();
  const tl = inner && inner.querySelector('.stems-head-tl');
  if (tl) tl.style.width = `${w}px`;
  for (const [id, entry] of trackRows) {
    entry.lane.style.width = `${w}px`;
    if (crisp) {
      drawTrackWaveform(id);
    } else {
      // cheap: stretch the existing bitmap via CSS, no peak recompute
      const buffer = engine.getTrackBuffer(id);
      if (buffer) {
        entry.canvas.style.width = `${Math.ceil(buffer.duration * PX_PER_SEC)}px`;
        entry.canvas.style.transform = `translateX(${(engine.getTrackOffset(id) || 0) * PX_PER_SEC}px)`;
      }
    }
  }
  drawRuler();
  redrawMarkers();
  syncLoopRegion();
  const head = document.getElementById('stems-playhead');
  if (head) head.style.transform = `translateX(${STRIP_WIDTH + engine.getCurrentSec() * PX_PER_SEC}px)`;
  // keep the anchored audio time pinned under the cursor
  arrange.scrollLeft = zoomAnchorSec * PX_PER_SEC + STRIP_WIDTH - zoomAnchorOffsetX;
}

function setRowHeight(next) {
  ROW_HEIGHT = Math.max(ROW_HEIGHT_MIN, Math.min(ROW_HEIGHT_MAX, next));
  // Update CSS variable so every row + its canvas pick up the new height.
  document.documentElement.style.setProperty('--stems-row-height', `${ROW_HEIGHT}px`);
  redrawAllWaveforms();
  scheduleSave();
}

// ── Wiring: arrange + actions ──────────────────────────────────────
function wireArrangeEvents(root) {
  const fileInput = root.querySelector('#stems-file-input');
  root.querySelector('#stems-import').onclick = () => fileInput.click();
  // Same trigger from the inline "Importar stems" link inside the empty state
  // (uses event delegation since the empty state is recreated on resetProject).
  root.addEventListener('click', (e) => {
    if (e.target.closest('#stems-empty-import')) fileInput.click();
  });
  fileInput.onchange = (e) => importFiles(e.target.files);

  const masterEl = root.querySelector('#stems-master-vol');
  const masterReadout = root.querySelector('#stems-master-readout');
  const paintMaster = (pct) => {
    masterEl.style.setProperty('--fill', `${pct}%`);
    if (masterReadout) masterReadout.textContent = `${pct}%`;
  };
  paintMaster(parseInt(masterEl.value, 10));
  masterEl.oninput = (e) => {
    const pct = parseInt(e.target.value, 10);
    const v = pct / 100;
    engine.setMasterVolume(v);
    paintMaster(pct);
    scheduleSave();
    document.dispatchEvent(new CustomEvent('livepads:master-vol-change', {
      detail: { value: v, source: 'stems' }
    }));
  };
  document.addEventListener('livepads:master-vol-change', (e) => {
    if (e.detail.source === 'stems') return;
    const pct = Math.round(e.detail.value * 100);
    masterEl.value = pct;
    engine.setMasterVolume(e.detail.value);
    paintMaster(pct);
  });

  const projToggle = root.querySelector('#stems-proj-toggle');
  const projDropdown = root.querySelector('#stems-proj-dropdown');
  projToggle.onclick = (e) => {
    e.stopPropagation();
    projDropdown.hidden = !projDropdown.hidden;
  };
  document.addEventListener('mousedown', (e) => {
    if (!projDropdown.hidden && !projDropdown.contains(e.target) && e.target !== projToggle) {
      projDropdown.hidden = true;
    }
  });
  projDropdown.addEventListener('click', async (e) => {
    const cmd = e.target.dataset.projCmd;
    if (!cmd) return;
    projDropdown.hidden = true;
    if (cmd === 'new') {
      if (engine.getTracks().length === 0 && markers.length === 0) return;
      if (!confirm('¿Vaciar el proyecto actual? Esta acción no se puede deshacer.')) return;
      await resetProject();
    } else if (cmd === 'save-as') {
      openSaveAsModal();
    } else if (cmd === 'open') {
      openProjectsModal();
    }
  });

  root.querySelector('#stems-export').onclick = async () => {
    if (engine.getTracks().length === 0) return;
    await runExport();
  };

  root.querySelector('#stems-add-click').onclick = () => onAddClickTrack();
  root.querySelector('#stems-add-marker').onclick = () => onAddMarker();
  root.querySelector('#stems-rebuild-guide').onclick = () => onRebuildGuide();
  root.querySelector('#stems-loop-toggle').onclick = () => toggleLoop();

  const nameInput = root.querySelector('#stems-project-name');
  nameInput.addEventListener('input', () => {
    projectName = nameInput.value.trim() || 'Mi proyecto';
    scheduleSave();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });

  // Drag-and-drop file import — ONLY reacts to real files dragged from
  // the OS. Internal track-reorder drags carry no 'Files' type, so the
  // import dropzone overlay no longer lights up the whole workspace when
  // you reorder a row.
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  ['dragenter', 'dragover'].forEach(evt => {
    root.addEventListener(evt, (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      root.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    root.addEventListener(evt, (e) => {
      if (evt === 'dragleave' && e.target !== root) return;
      root.classList.remove('is-dragover');
    });
  });
  root.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  });
}

function refreshSectionDropdown() {
  const sel = document.getElementById('stems-section-select');
  if (!sel) return;
  sel.innerHTML = SECTION_CUES.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
}
function refreshClickSoundDropdown() {
  const sel = document.getElementById('stems-click-sound');
  if (!sel) return;
  sel.innerHTML = getClickSounds().map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  sel.value = clickSoundId;
  sel.onchange = (e) => {
    clickSoundId = e.target.value;
    scheduleSave();
  };
}

// ── Import + track strip rendering ────────────────────────────────
async function importFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const files = Array.from(fileList).filter(f =>
    f.type.startsWith('audio/') || /\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(f.name)
  );
  if (!files.length) return;

  showImportOverlay(files.length);
  // Yield two frames so the overlay actually paints before we hit the
  // synchronous-heavy decode work (decodeAudioData can briefly block).
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let done = 0;
  for (const file of files) {
    try {
      updateImportOverlay(done, files.length, file.name);
      await new Promise(r => requestAnimationFrame(r)); // let the name paint
      const arrayBuffer = await file.arrayBuffer();
      const id = `t${nextTrackId++}`;
      const name = file.name.replace(/\.[^.]+$/, '');
      await engine.addTrack({ id, name, arrayBuffer });
      engine.setTrackColor(id, nextStemColor());
      const savedPath = await projectStore.saveStem(id, file.name, arrayBuffer);
      appendTrackRow(id, savedPath);
    } catch (err) {
      console.error('Failed to import', file.name, err);
      alert(`No se pudo importar "${file.name}": ${err.message || err}`);
    }
    done++;
    updateImportOverlay(done, files.length, '');
  }
  // Keep the "Listo" state on screen briefly so a fast import still
  // registers visually instead of just flashing.
  await new Promise(r => setTimeout(r, 350));
  hideImportOverlay();
  refreshTransport();
  scheduleSave();
}

// Lightweight overlay that surfaces import progress. Reuses the same
// export-overlay shell so the styling stays consistent, but lives in
// its own element so a slow import never blocks an export popup.
function showImportOverlay(total) {
  let overlay = document.getElementById('stems-import-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'stems-import-overlay';
    overlay.className = 'stems-export-overlay';
    overlay.innerHTML = `
      <div class="stems-export-panel">
        <div class="stems-spinner" aria-hidden="true"></div>
        <h3 id="stems-import-title">Importando stems…</h3>
        <p id="stems-import-stage" class="stems-export-stage"></p>
        <div class="stems-export-bar"><div class="stems-export-fill" id="stems-import-fill"></div></div>
      </div>
    `;
    // Append to body (not .stems-shell) so position:fixed always centres
    // on the viewport, regardless of any transform on workspace ancestors.
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;
  updateImportOverlay(0, total, '');
}
function updateImportOverlay(done, total, name) {
  const fill = document.getElementById('stems-import-fill');
  const stage = document.getElementById('stems-import-stage');
  const title = document.getElementById('stems-import-title');
  if (!fill) return;
  const pct = total > 0 ? (done / total) * 100 : 0;
  fill.style.width = `${pct}%`;
  if (title) title.textContent = total > 1
    ? `Importando ${done + (name ? 1 : 0)} de ${total}…`
    : 'Importando stem…';
  if (stage) stage.textContent = name || (done === total ? 'Listo' : 'Decodificando audio…');
}
function hideImportOverlay() {
  const overlay = document.getElementById('stems-import-overlay');
  if (overlay) overlay.hidden = true;
}

function appendTrackRow(id, savedPath) {
  const track = engine.getTracks().find(t => t.id === id);
  if (!track) return;

  const empty = document.getElementById('stems-empty');
  if (empty) empty.hidden = true;

  // A row is the unit: sticky strip on the left + waveform lane on the right.
  const rows = document.getElementById('stems-rows');
  const row = document.createElement('div');
  row.className = `stems-row stems-row--${track.kind}`;
  row.dataset.trackId = id;
  if (savedPath) row.dataset.path = savedPath;
  row.innerHTML = buildRowHtml(track);
  rows.appendChild(row);

  const strip = row.querySelector('.stems-row-strip');
  const lane  = row.querySelector('.stems-row-lane');
  const canvas = row.querySelector('.stems-row-canvas');

  // Mirror the track as a vertical-fader strip inside the bottom console.
  const console = appendConsoleStrip(track);

  trackRows.set(id, { row, strip, lane, canvas, console });

  wireStrip(row, id);
  wireConsoleStrip(console, id);
  wireLaneDrag(lane, id);
  drawTrackWaveform(id);
  refreshTimelineWidth();
}

// Drag the waveform left/right to shift this track on the timeline (to
// align a click, a guide, or an offset stem to the rest). A small move is
// treated as a seek-click (handled by wireSeekClicks); only a real drag
// changes the offset, and we then swallow the trailing click.
function wireLaneDrag(lane, id) {
  const DRAG_THRESHOLD = 4; // px before it counts as a drag, not a click
  lane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('input, select, button')) return;
    const startX = e.clientX;
    const startOffset = engine.getTrackOffset(id);
    let dragging = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
      lane.classList.add('is-shifting');
      let newOffset = startOffset + dx / PX_PER_SEC;
      if (snapToBeat) newOffset = Math.round(newOffset / (60 / bpm)) * (60 / bpm);
      newOffset = Math.max(0, newOffset);
      // Live visual: shift only this row's canvas; commit to engine on up.
      const row = trackRows.get(id);
      if (row) row.canvas.style.transform = `translateX(${newOffset * PX_PER_SEC}px)`;
      lane.dataset.pendingOffset = String(newOffset);
    };
    const onUp = () => {
      lane.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      lane.classList.remove('is-shifting');
      if (!dragging) return;
      const newOffset = parseFloat(lane.dataset.pendingOffset || String(startOffset));
      delete lane.dataset.pendingOffset;
      if (Math.abs(newOffset - startOffset) < 1e-4) return;
      applyTrackOffset(id, newOffset);
      pushHistory('Alinear pista',
        () => { applyTrackOffset(id, startOffset); scheduleSave(); },
        () => { applyTrackOffset(id, newOffset); scheduleSave(); }
      );
      scheduleSave();
      // Swallow the click that fires right after a drag so it doesn't seek.
      lane.addEventListener('click', (ce) => { ce.stopImmediatePropagation(); ce.preventDefault(); }, { capture: true, once: true });
    };
    lane.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function applyTrackOffset(id, sec) {
  engine.setTrackOffset(id, sec);
  drawTrackWaveform(id);
  refreshTimelineWidth();
  refreshTotalTime();
}

function appendConsoleStrip(track) {
  const host = document.getElementById('stems-console-strips');
  if (!host) return null;
  const strip = document.createElement('div');
  strip.className = `stems-console-strip stems-console-strip--${track.kind}`;
  strip.dataset.trackId = track.id;
  strip.innerHTML = buildConsoleStripHtml(track);
  host.appendChild(strip);
  return strip;
}

function buildConsoleStripHtml(track) {
  const kindLabel = track.kind === 'click' ? 'CLICK'
                  : track.kind === 'guide' ? 'GUÍA'
                  : 'AUDIO';
  const volPct = Math.round(track.volume * 100);
  return `
    <header class="stems-console-strip-head">
      <span class="stems-console-strip-kind">${kindLabel}</span>
      <span class="stems-console-strip-name" title="${escapeAttr(track.name)}">${escapeHtml(track.name)}</span>
    </header>
    <div class="stems-console-pan-row">
      <span class="stems-console-pan-label">PAN</span>
      <input type="range" min="-100" max="100" value="${Math.round(track.pan * 100)}"
             class="stems-pan-slider stems-console-pan" data-action="pan" aria-label="Pan">
      <span class="stems-console-pan-readout">${panLabel(track.pan)}</span>
    </div>
    <div class="stems-console-ms-row">
      <button class="stems-ms stems-ms--mute ${track.muted ? 'is-on' : ''}" data-action="mute" title="Silenciar">M</button>
      <button class="stems-ms stems-ms--solo ${track.soloed ? 'is-on' : ''}" data-action="solo" title="Solo">S</button>
    </div>
    <div class="stems-cfader" data-action="vol" role="slider"
         aria-label="Volumen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}"
         tabindex="0" data-value="${volPct}">
      <div class="stems-cfader-track" aria-hidden="true"></div>
      <div class="stems-cfader-fill" aria-hidden="true"></div>
      <div class="stems-cfader-handle" aria-hidden="true"></div>
    </div>
    <span class="stems-console-strip-readout">${volPct}</span>
  `;
}

// Custom vertical fader — pointer-driven, so it works reliably across
// Chromium versions (native vertical <input type=range> rendering is
// inconsistent and was ignoring drags). value is 0..100.
const FADER_PAD = 8;     // top/bottom inset matching CSS
const FADER_HANDLE = 18; // handle height

function paintFader(faderEl, v) {
  const h = faderEl.clientHeight;
  if (h === 0) return;
  const travel = h - FADER_PAD * 2 - FADER_HANDLE;
  const handle = faderEl.querySelector('.stems-cfader-handle');
  const fill = faderEl.querySelector('.stems-cfader-fill');
  const handleBottom = FADER_PAD + (v / 100) * travel;
  if (handle) handle.style.bottom = `${handleBottom}px`;
  if (fill) fill.style.height = `${(handleBottom - FADER_PAD) + FADER_HANDLE / 2}px`;
  faderEl.dataset.value = v;
  faderEl.setAttribute('aria-valuenow', v);
}

function faderValueFromPointer(faderEl, clientY) {
  const rect = faderEl.getBoundingClientRect();
  const h = rect.height;
  const travel = h - FADER_PAD * 2 - FADER_HANDLE;
  const y = clientY - rect.top;
  let pos = (y - FADER_PAD - FADER_HANDLE / 2) / travel; // 0 top → 1 bottom
  pos = Math.max(0, Math.min(1, pos));
  return Math.round((1 - pos) * 100); // top = 100
}

// Wires the pointer interaction. onInput fires live during drag, onCommit
// once at release (for history). Returns a paint(v) callback.
function wireVerticalFader(faderEl, { onInput, onCommit }) {
  let dragging = false;
  let startValue = parseInt(faderEl.dataset.value, 10);

  const apply = (v) => { paintFader(faderEl, v); onInput?.(v); };

  faderEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    startValue = parseInt(faderEl.dataset.value, 10);
    faderEl.setPointerCapture(e.pointerId);
    apply(faderValueFromPointer(faderEl, e.clientY));
  });
  faderEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    apply(faderValueFromPointer(faderEl, e.clientY));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const finalV = parseInt(faderEl.dataset.value, 10);
    if (finalV !== startValue) onCommit?.(startValue, finalV);
  };
  faderEl.addEventListener('pointerup', end);
  faderEl.addEventListener('pointercancel', end);
  // Keyboard: arrows nudge ±1, PageUp/Down ±10.
  faderEl.addEventListener('keydown', (e) => {
    let v = parseInt(faderEl.dataset.value, 10);
    const before = v;
    if (e.key === 'ArrowUp')        v = Math.min(100, v + 1);
    else if (e.key === 'ArrowDown') v = Math.max(0, v - 1);
    else if (e.key === 'PageUp')    v = Math.min(100, v + 10);
    else if (e.key === 'PageDown')  v = Math.max(0, v - 10);
    else return;
    e.preventDefault();
    apply(v);
    if (v !== before) onCommit?.(before, v);
  });
}

// Console strip mirrors the row strip — changes here propagate back so
// both UIs stay in lockstep.
function wireConsoleStrip(strip, id) {
  if (!strip) return;
  const faderEl = strip.querySelector('.stems-cfader');
  const panInput = strip.querySelector('[data-action="pan"]');
  paintPanFill(panInput);

  // Paint the fader once layout settles (clientHeight needs a frame).
  requestAnimationFrame(() => paintFader(faderEl, parseInt(faderEl.dataset.value, 10)));

  wireVerticalFader(faderEl, {
    onInput: (v) => {
      engine.setTrackVolume(id, v / 100);
      const out = strip.querySelector('.stems-console-strip-readout');
      if (out) out.textContent = v;
      scheduleSave();
    },
    onCommit: (oldV, newV) => {
      pushHistory('Volumen',
        () => { engine.setTrackVolume(id, oldV / 100); syncConsoleStripVol(id, oldV); scheduleSave(); },
        () => { engine.setTrackVolume(id, newV / 100); syncConsoleStripVol(id, newV); scheduleSave(); }
      );
    }
  });
  panInput.oninput = (e) => {
    const v = parseInt(e.target.value, 10);
    engine.setTrackPan(id, v / 100);
    paintPanFill(e.target);
    const r = strip.querySelector('.stems-console-pan-readout');
    if (r) r.textContent = panLabel(v / 100);
    scheduleSave();
  };

  const muteBtn = strip.querySelector('[data-action="mute"]');
  muteBtn.onclick = () => {
    const next = !muteBtn.classList.contains('is-on');
    engine.setTrackMuted(id, next);
    muteBtn.classList.toggle('is-on', next);
    syncRowStripMute(id, next);
    reflectSoloHighlights();
    scheduleSave();
  };

  const soloBtn = strip.querySelector('[data-action="solo"]');
  soloBtn.onclick = () => {
    const next = !soloBtn.classList.contains('is-on');
    engine.setTrackSoloed(id, next);
    soloBtn.classList.toggle('is-on', next);
    syncRowStripSolo(id, next);
    reflectSoloHighlights();
    scheduleSave();
  };
}

// ── Two-way sync helpers (row strip ↔ console strip) ──────────────
// Each pair updates the other UI's element without re-triggering its
// input handler, so we don't fire scheduleSave / engine setter twice.

function syncConsoleStripVol(id, v) {
  const c = trackRows.get(id)?.console; if (!c) return;
  const fader = c.querySelector('.stems-cfader');
  if (fader) paintFader(fader, v);
  const out = c.querySelector('.stems-console-strip-readout');
  if (out) out.textContent = v;
}
function syncConsoleStripPan(id, v) {
  const c = trackRows.get(id)?.console; if (!c) return;
  const slider = c.querySelector('[data-action="pan"]');
  if (slider) { slider.value = v; paintPanFill(slider); }
  const r = c.querySelector('.stems-console-pan-readout');
  if (r) r.textContent = panLabel(v / 100);
}
function syncConsoleStripMute(id, on) {
  const c = trackRows.get(id)?.console; if (!c) return;
  c.querySelector('[data-action="mute"]')?.classList.toggle('is-on', on);
}
function syncConsoleStripSolo(id, on) {
  const c = trackRows.get(id)?.console; if (!c) return;
  c.querySelector('[data-action="solo"]')?.classList.toggle('is-on', on);
}
function syncConsoleStripName(id, name) {
  const c = trackRows.get(id)?.console; if (!c) return;
  const el = c.querySelector('.stems-console-strip-name');
  if (el) { el.textContent = name; el.title = name; }
}

// Row-strip sync helpers are now no-ops because the strip no longer
// has vol / pan / mute / solo controls (they live solely in the
// console). Kept as empty exports so callers don't have to be edited.
function syncRowStripVol()  {}
function syncRowStripPan()  {}
function syncRowStripMute() {}
function syncRowStripSolo() {}

function buildRowHtml(track) {
  const kindLabel = track.kind === 'click' ? 'CLICK'
                  : track.kind === 'guide' ? 'GUÍA'
                  : 'AUDIO';
  // Slim strip: identification + reorder + per-track destructive actions.
  // The mixer console below owns vol / pan / mute / solo so we don't
  // duplicate the same four controls on every row.
  return `
    <aside class="stems-row-strip" draggable="true" data-drag-row>
      <span class="stems-row-grip" title="Arrastra para reordenar" aria-hidden="true">⋮⋮</span>
      <input type="color" class="stems-row-color" data-action="color" value="${track.color || '#FBAE00'}" title="Color de la pista">
      <div class="stems-row-meta">
        <span class="stems-row-kind">${kindLabel}</span>
        <input class="stems-row-name" value="${escapeAttr(track.name)}" spellcheck="false">
      </div>
      ${track.kind === 'click' || track.kind === 'guide' ? '' : `
      <button class="stems-row-export" data-action="separate" title="Separar en voz e instrumental (IA, local)">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
      </button>`}
      <button class="stems-row-export" data-action="export" title="Exportar esta pista a MP3">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button class="stems-row-remove" data-action="remove" title="Eliminar">${SVG_TRASH}</button>
    </aside>
    <div class="stems-row-lane">
      <canvas class="stems-row-canvas"></canvas>
      <div class="stems-row-grid" aria-hidden="true"></div>
    </div>
  `;
}

function buildStripHtml(track) {
  const kindLabel = track.kind === 'click' ? 'CLICK'
                  : track.kind === 'guide' ? 'GUÍA'
                  : 'AUDIO';
  return `
    <header class="stems-strip-head">
      <span class="stems-strip-kind">${kindLabel}</span>
      <input class="stems-strip-name" value="${escapeAttr(track.name)}" spellcheck="false">
      <button class="stems-strip-remove" data-action="remove" title="Eliminar">${SVG_TRASH}</button>
    </header>

    <div class="stems-strip-pan">
      <span class="stems-strip-pan-readout">${panLabel(track.pan)}</span>
      <input type="range" min="-100" max="100" value="${Math.round(track.pan * 100)}" class="stems-range stems-pan" data-action="pan" aria-label="Pan">
    </div>

    <div class="stems-strip-fader">
      <div class="stems-strip-fader-meter" aria-hidden="true"></div>
      <input type="range" min="0" max="100" value="${Math.round(track.volume * 100)}"
             class="stems-fader" data-action="vol" aria-label="Volumen" orient="vertical">
      <span class="stems-strip-vol-readout">${Math.round(track.volume * 100)}</span>
    </div>

    <footer class="stems-strip-foot">
      <button class="stems-ms stems-ms--mute ${track.muted ? 'is-on' : ''}" data-action="mute" title="Silenciar (M)">M</button>
      <button class="stems-ms stems-ms--solo ${track.soloed ? 'is-on' : ''}" data-action="solo" title="Solo (S)">S</button>
    </footer>
  `;
}

// Strip is now ID-only (name, color, export, remove). All mixing
// controls live in the console below — see wireConsoleStrip.
function wireStrip(root, id) {
  const nameInput = root.querySelector('.stems-row-name');
  nameInput.addEventListener('input', () => {
    engine.renameTrack(id, nameInput.value);
    syncConsoleStripName(id, nameInput.value);
    scheduleSave();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });

  root.querySelector('[data-action="remove"]').onclick = async () => {
    if (!confirm('¿Eliminar esta pista del proyecto?')) return;
    await removeTrackById(id);
  };

  const colorInput = root.querySelector('[data-action="color"]');
  if (colorInput) {
    let colorBefore = colorInput.value;
    colorInput.addEventListener('focus', () => { colorBefore = colorInput.value; });
    colorInput.oninput = (e) => {
      engine.setTrackColor(id, e.target.value);
      drawTrackWaveform(id);
      scheduleSave();
    };
    colorInput.addEventListener('change', () => {
      const oldC = colorBefore, newC = colorInput.value;
      if (oldC === newC) return;
      pushHistory('Cambiar color',
        () => { engine.setTrackColor(id, oldC); colorInput.value = oldC; drawTrackWaveform(id); scheduleSave(); },
        () => { engine.setTrackColor(id, newC); colorInput.value = newC; drawTrackWaveform(id); scheduleSave(); }
      );
      colorBefore = newC;
    });
  }

  const exportBtn = root.querySelector('[data-action="export"]');
  if (exportBtn) {
    exportBtn.onclick = async (e) => {
      e.stopPropagation();
      const t = engine.getTracks().find(tr => tr.id === id);
      if (!t) return;
      await runExport({
        onlyTrackIds: [id],
        suggestedName: `${projectName} - ${t.name}`
      });
    };
  }

  const separateBtn = root.querySelector('[data-action="separate"]');
  if (separateBtn) {
    separateBtn.onclick = (e) => {
      e.stopPropagation();
      openSeparateMenu(separateBtn, id);
    };
  }
}

// Small popup to choose separation mode before running.
function openSeparateMenu(anchor, id) {
  document.getElementById('stems-sep-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'stems-context-menu';
  menu.id = 'stems-sep-menu';
  const forceCpu = localStorage.getItem('livepads-stems-force-cpu') === '1';
  menu.innerHTML = `
    <button data-mode="2stem">Voz / Instrumental <span class="stems-ctx-hint">rápido</span></button>
    <button data-mode="4stem">Voz · Batería · Bajo · Otros <span class="stems-ctx-hint">lento</span></button>
    <div class="stems-ctx-sep"></div>
    <button data-toggle="cpu" class="stems-ctx-toggle">${forceCpu ? '☑' : '☐'} Forzar CPU (sin GPU)</button>
  `;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top  = `${r.bottom + 4}px`;
  requestAnimationFrame(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth) menu.style.left = `${window.innerWidth - mr.width - 8}px`;
    if (mr.bottom > window.innerHeight) menu.style.top = `${r.top - mr.height - 4}px`;
  });
  menu.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => { const mode = b.dataset.mode; menu.remove(); onSeparateTrack(id, mode); };
  });
  const cpuToggle = menu.querySelector('[data-toggle="cpu"]');
  if (cpuToggle) cpuToggle.onclick = (ev) => {
    ev.stopPropagation();
    const next = localStorage.getItem('livepads-stems-force-cpu') === '1' ? '0' : '1';
    localStorage.setItem('livepads-stems-force-cpu', next);
    cpuToggle.textContent = `${next === '1' ? '☑' : '☐'} Forzar CPU (sin GPU)`;
  };
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

// ── Local AI stem separation (voz / instrumental) ────────────────
let separating = false;
// Bounded cache of the LAST separation result, keyed by source track + mode +
// buffer length. Lets an immediate re-separation (e.g. after undo) reuse the
// result instead of re-running the heavy model. Kept to a single entry to
// cap memory (stem buffers are large).
let lastSeparation = null;
async function onSeparateTrack(id, mode = '2stem') {
  if (separating) return;
  if (!window.electronAPI?.stemsSeparate) {
    alert('La separación de stems no está disponible en esta versión.');
    return;
  }
  const track = engine.getTracks().find(t => t.id === id);
  const buffer = engine.getTrackBuffer(id);
  if (!track || !buffer) return;

  const cacheKey = `${id}:${mode}:${buffer.length}`;
  const baseName = track.name.replace(/\.(wav|mp3|ogg|aac|m4a|flac)$/i, '');

  separating = true;
  const toast = showSepToast(track.name);

  // Cache hit → build the tracks from the stored result, no model run.
  if (lastSeparation && lastSeparation.key === cacheKey) {
    try {
      toast.update(1, 'Usando resultado en caché…');
      for (const stem of lastSeparation.stems) {
        await addSeparatedTrack(`${baseName} — ${stem.name}`, stem.channels, lastSeparation.sampleRate, stem.kind);
      }
      toast.done(`✓ ${baseName}: ${lastSeparation.stems.length} pistas (caché)`);
    } catch (err) {
      console.error('Cache rehydrate failed:', err);
      toast.error(err.message || String(err));
    } finally {
      separating = false;
    }
    return;
  }

  const unsubscribe = window.electronAPI.onStemsSeparateProgress(({ fraction, stage }) => {
    toast.update(fraction, stage);
  });

  try {
    const ch0 = buffer.getChannelData(0).slice();
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : ch0;
    const forceCpu = localStorage.getItem('livepads-stems-force-cpu') === '1';
    const result = await window.electronAPI.stemsSeparate({
      channels: [ch0, ch1],
      sampleRate: buffer.sampleRate,
      mode,
      ep: forceCpu ? 'cpu' : undefined,
    });

    if (result && result.cancelled) { toast.cancelled(); return; }

    // Cache the result (single entry) for an instant re-run.
    lastSeparation = { key: cacheKey, sampleRate: result.sampleRate, stems: result.stems };

    toast.update(1, 'Creando pistas…');
    for (const stem of result.stems) {
      await addSeparatedTrack(`${baseName} — ${stem.name}`, stem.channels, result.sampleRate, stem.kind);
    }
    const epLabel = result.ep === 'dml' ? ' (GPU)' : '';
    toast.done(`✓ ${baseName}: ${result.stems.length} pistas${epLabel}`);
  } catch (err) {
    console.error('Separation failed:', err);
    toast.error(err.message || String(err));
  } finally {
    unsubscribe && unsubscribe();
    separating = false;
  }
}

// Non-modal corner toast so separation runs in the background while the
// user keeps editing. Returns { update, done, error }.
function showSepToast(trackName) {
  const el = document.createElement('div');
  el.className = 'stems-sep-toast';
  el.innerHTML = `
    <div class="stems-sep-toast-head">
      <span class="stems-sep-toast-spin" aria-hidden="true"></span>
      <div class="stems-sep-toast-text">
        <strong>Separando pista</strong>
        <span class="stems-sep-toast-name">${escapeHtml(trackName)}</span>
      </div>
      <span class="stems-sep-toast-pct">0%</span>
      <button class="stems-sep-toast-cancel" title="Cancelar separación" aria-label="Cancelar">✕</button>
    </div>
    <div class="stems-sep-toast-stage">Preparando audio</div>
    <div class="stems-sep-toast-bar"><div class="stems-sep-toast-fill"></div></div>
  `;
  document.body.appendChild(el);
  const fill  = el.querySelector('.stems-sep-toast-fill');
  const pct   = el.querySelector('.stems-sep-toast-pct');
  const stage = el.querySelector('.stems-sep-toast-stage');
  const cancelBtn = el.querySelector('.stems-sep-toast-cancel');
  cancelBtn.onclick = () => {
    cancelBtn.disabled = true;
    stage.textContent = 'Cancelando…';
    try { window.electronAPI.stemsSeparateCancel(); } catch (_) {}
  };
  requestAnimationFrame(() => el.classList.add('is-in'));
  const remove = (delay) => setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 280);
  }, delay);
  return {
    update(fraction, label) {
      const p = Math.round((fraction || 0) * 100);
      fill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      if (label) stage.textContent = label;
    },
    done(msg) {
      el.classList.add('is-done');
      el.querySelector('.stems-sep-toast-spin')?.remove();
      cancelBtn.remove();
      stage.textContent = msg;
      fill.style.width = '100%';
      pct.textContent = '✓';
      remove(2600);
    },
    error(msg) {
      el.classList.add('is-error');
      el.querySelector('.stems-sep-toast-spin')?.remove();
      cancelBtn.remove();
      stage.textContent = msg;
      remove(4500);
    },
    cancelled() {
      el.querySelector('.stems-sep-toast-spin')?.remove();
      cancelBtn.remove();
      stage.textContent = 'Separación cancelada';
      remove(1800);
    },
  };
}

// Build a stereo AudioBuffer from [L,R] Float32 and add it as a new track,
// persisting the audio as MP3 (much lighter on disk than WAV).
async function addSeparatedTrack(name, channels, sampleRate, kind) {
  const ctx = engine.getAudioContext();
  const len = channels[0].length;
  const buffer = ctx.createBuffer(2, len, sampleRate);
  buffer.copyToChannel(Float32Array.from(channels[0]), 0);
  buffer.copyToChannel(Float32Array.from(channels[1] || channels[0]), 1);
  const mp3 = audioBufferToMp3(buffer);
  const tid = `sep-${nextTrackId++}`;
  await engine.addTrack({ id: tid, name, audioBuffer: buffer, kind });
  const savedPath = await projectStore.saveStem(tid, `${kind}.mp3`, mp3);
  appendTrackRow(tid, savedPath);
  refreshTransport();
  scheduleSave();
}

// Encode an AudioBuffer to MP3 (192 kbps stereo) via lamejs. Returns an
// ArrayBuffer for projectStore.saveStem.
function audioBufferToMp3(buffer) {
  const sr = buffer.sampleRate, BLOCK = 1152;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const enc = new Mp3Encoder(2, sr, 192);
  const lp = new Int16Array(BLOCK), rp = new Int16Array(BLOCK);
  const chunks = [];
  for (let i = 0; i < left.length; i += BLOCK) {
    const n = Math.min(BLOCK, left.length - i);
    for (let s = 0; s < n; s++) {
      const l = left[i + s], r = right[i + s];
      lp[s] = Math.max(-32768, Math.min(32767, l < 0 ? l * 32768 : l * 32767));
      rp[s] = Math.max(-32768, Math.min(32767, r < 0 ? r * 32768 : r * 32767));
    }
    const buf = enc.encodeBuffer(lp.subarray(0, n), rp.subarray(0, n));
    if (buf.length) chunks.push(buf);
  }
  const flush = enc.flush();
  if (flush.length) chunks.push(flush);
  let total = 0; for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

async function removeTrackById(id) {
  const row = trackRows.get(id);
  engine.removeTrack(id);
  if (row) {
    await projectStore.removeStem(row.row.dataset.path);
    row.row.remove();
    if (row.console) row.console.remove();
  }
  trackRows.delete(id);
  peaksCache.delete(id);
  if (trackRows.size === 0) {
    const empty = document.getElementById('stems-empty');
    if (empty) empty.hidden = false;
  }
  refreshTransport();
  refreshTimelineWidth();
  reflectSoloHighlights();
  scheduleSave();
}

function panLabel(pan) {
  if (Math.abs(pan) < 0.04) return 'C';
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}

// Live-update the gold-fill ratio on a horizontal/vertical volume range
// input. The CSS variable --fill is read by the slider's track gradient.
function paintVolFill(input) {
  const v = parseInt(input.value, 10);
  input.style.setProperty('--fill', `${v}%`);
}
// Pan slider (-100..+100). Matches the Pads slider look: a single gold
// fill from the left edge up to the thumb position. The L/R readout text
// communicates the actual pan, the fill is purely the thumb's position.
function paintPanFill(input) {
  const v = parseInt(input.value, 10);     // -100..100
  const pct = ((v + 100) / 200) * 100;      // 0..100 thumb position
  input.style.setProperty('--fill', `${pct}%`);
}

function reflectSoloHighlights() {
  const anySoloed = engine.getTracks().some(t => t.soloed);
  for (const [id, entry] of trackRows.entries()) {
    const t = engine.getTracks().find(tr => tr.id === id);
    if (!t) continue;
    const silent = t.muted || (anySoloed && !t.soloed);
    entry.row.classList.toggle('is-silenced', silent);
  }
}

// ── Timeline + ruler + waveform ───────────────────────────────────
function projectDurationSec() {
  return Math.max(engine.getDurationSec(), 60);
}
function projectWidthPx() {
  return Math.max(MIN_TIMELINE_PX, Math.ceil(projectDurationSec() * PX_PER_SEC));
}

let waveformRedrawRAF = 0;
// coalesceWaveforms: during continuous zoom (wheel) the cheap layout (widths,
// ruler, grid, markers) runs every event for instant feedback, but the
// expensive per-track peak recompute is collapsed to once per animation
// frame at the latest zoom — keeps zooming smooth instead of jumpy.
function refreshTimelineWidth({ coalesceWaveforms = false } = {}) {
  const inner = document.getElementById('stems-arrange-inner');
  if (!inner) return;
  const w = projectWidthPx();
  // The ruler container, every lane, and the marker layer must all share
  // the same width so columns align vertically. The strip column adds a
  // fixed STRIP_WIDTH that lives in a sibling sticky element.
  const tl = inner.querySelector('.stems-head-tl');
  if (tl) tl.style.width = `${w}px`;
  for (const entry of trackRows.values()) {
    entry.lane.style.width = `${w}px`;
  }
  drawRuler();
  redrawMarkers();
  syncLoopRegion();
  if (coalesceWaveforms) {
    if (!waveformRedrawRAF) {
      waveformRedrawRAF = requestAnimationFrame(() => { waveformRedrawRAF = 0; redrawAllWaveforms(); });
    }
  } else {
    redrawAllWaveforms();
  }
}

function drawRuler() {
  const ruler = document.getElementById('stems-ruler');
  if (!ruler) return;
  const w = projectWidthPx();
  const dur = projectDurationSec();
  const barSec = (60 / bpm) * beatsPerBar;
  const beatSec = 60 / bpm;
  const beatsTotal = Math.ceil(dur / beatSec);

  let html = '';
  for (let beat = 0; beat <= beatsTotal; beat++) {
    const tSec = beat * beatSec;
    const x = tSec * PX_PER_SEC;
    if (x > w) break;
    const isBar = beat % beatsPerBar === 0;
    html += `<div class="stems-tick ${isBar ? 'stems-tick--bar' : ''}" style="left:${x}px"></div>`;
    if (isBar) {
      const bar = beat / beatsPerBar + 1;
      html += `<div class="stems-tick-label" style="left:${x + 4}px">
        <span class="stems-tick-bar">${bar}.1.00</span>
        <span class="stems-tick-time">${formatBarTime(tSec)}</span>
      </div>`;
    }
  }
  // Ruler is position:absolute inset:0 inside .stems-head-tl, so width
  // is inherited from the parent — no need to set it here.
  ruler.innerHTML = html;
  drawGrid();
}

// Beat/bar guide lines on the lanes, aligned to the ruler, so dragged
// tracks can be lined up. Implemented as CSS custom properties consumed by
// .stems-row-lane backgrounds (lanes scroll with content and sit to the
// right of the sticky strip, so the lines never overlap the controls).
function drawGrid() {
  const beatPx = (60 / bpm) * PX_PER_SEC;
  const barPx = beatPx * beatsPerBar;
  const root = document.documentElement.style;
  if (!isFinite(beatPx) || beatPx <= 0) {
    root.setProperty('--stems-beatpx', '100000px');
    root.setProperty('--stems-barpx', '100000px');
    return;
  }
  root.setProperty('--stems-beatpx', `${beatPx}px`);
  root.setProperty('--stems-barpx', `${barPx}px`);
}
function formatBarTime(sec) {
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${mm}:${String(ss).padStart(2, '0')}.${String(Math.floor(ms/10)).padStart(2, '0')}`;
}

function drawTrackWaveform(id) {
  const row = trackRows.get(id);
  if (!row) return;
  const buffer = engine.getTrackBuffer(id);
  if (!buffer) return;
  const audioPx = Math.ceil(buffer.duration * PX_PER_SEC);
  // Lane spans the full project width so all rows align vertically with
  // the ruler. The canvas only covers the actual audio duration; any
  // trailing space stays empty (matching Moises / LibreTracks behaviour).
  row.lane.style.width = `${projectWidthPx()}px`;
  row.canvas.style.width = `${audioPx}px`;
  row.canvas.style.height = `${ROW_HEIGHT - 8}px`;
  // Shift the waveform horizontally by the track's timeline offset.
  const offPx = (engine.getTrackOffset(id) || 0) * PX_PER_SEC;
  row.canvas.style.transform = `translateX(${offPx}px)`;
  let peaks = peaksCache.get(id);
  if (!peaks || peaks.length / 2 !== audioPx) {
    peaks = computePeaks(buffer, audioPx);
    peaksCache.set(id, peaks);
  }
  const t = engine.getTracks().find(tr => tr.id === id);
  // Per-track override wins over kind defaults; only fall back to the
  // theme accent when neither has been set.
  const color = t?.color
    ? t.color
    : t?.kind === 'click' ? 'rgba(96, 165, 250, 0.9)'
    : t?.kind === 'guide' ? 'rgba(74, 222, 128, 0.9)'
    : currentAccent();
  drawWaveform(row.canvas, peaks, { color });
}

// Read the active theme accent at draw time so waveforms inherit the
// global theme tokens. Returns a CSS colour string (rgb/hex) — drawWaveform
// passes it straight to canvas fillStyle so any valid format works.
function currentAccent() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return v || '#FBAE00';
}

function redrawAllWaveforms() {
  for (const id of trackRows.keys()) drawTrackWaveform(id);
}

// ── Markers ────────────────────────────────────────────────────────
// Snap-to-beat: when ON (default), marker time is rounded to the nearest
// beat at the current BPM. Visually cleaner, easier to make rhythmic
// sections line up. The toggle lives in the topbar.
let snapToBeat = true;
let clickSoundId = 'cowbell';
// Loop region — ids of the two markers that bound the loop. Null when
// no loop is set. The actual numeric region is computed on toggle from
// these markers' atSec values.
let loopStartMarkerId = null;
let loopEndMarkerId = null;
let loopEnabled = false;

function snapTimeIfEnabled(sec) {
  if (!snapToBeat) return sec;
  const beatSec = 60 / bpm;
  return Math.round(sec / beatSec) * beatSec;
}

function onAddMarker() {
  const sel = document.getElementById('stems-section-select');
  if (!sel) return;
  const cueId = sel.value;
  const cue = findCueById(cueId);
  if (!cue) return;
  const atSec = snapTimeIfEnabled(engine.getCurrentSec());
  const m = { id: `m${nextMarkerId++}`, cueId, label: cue.label, url: cue.url, atSec };
  markers.push(m);
  redrawMarkers();
  pushHistory('Añadir marcador',
    () => { markers = markers.filter(x => x.id !== m.id); redrawMarkers(); scheduleSave(); },
    () => { markers.push(m); redrawMarkers(); scheduleSave(); }
  );
  scheduleSave();
  scheduleGuideSync();
}

function removeMarker(markerId) {
  const idx = markers.findIndex(m => m.id === markerId);
  if (idx < 0) return;
  const removed = markers[idx];
  markers.splice(idx, 1);
  redrawMarkers();
  pushHistory('Eliminar marcador',
    () => { markers.splice(idx, 0, removed); redrawMarkers(); scheduleSave(); },
    () => { markers.splice(idx, 1); redrawMarkers(); scheduleSave(); }
  );
  scheduleSave();
  scheduleGuideSync();
}

function renameMarker(markerId, newLabel) {
  const m = markers.find(x => x.id === markerId);
  if (!m) return;
  const oldLabel = m.label;
  const next = String(newLabel || '').trim() || m.label;
  if (next === oldLabel) return;
  m.label = next;
  redrawMarkers();
  pushHistory('Renombrar marcador',
    () => { m.label = oldLabel; redrawMarkers(); scheduleSave(); },
    () => { m.label = next;     redrawMarkers(); scheduleSave(); }
  );
  scheduleSave();
}

// record:false during a live drag — the drag handler pushes ONE history
// entry on pointerup so the whole gesture is a single undo step.
function moveMarkerTo(markerId, atSec, { record = true } = {}) {
  const m = markers.find(x => x.id === markerId);
  if (!m) return;
  const oldSec = m.atSec;
  const newSec = snapTimeIfEnabled(Math.max(0, atSec));
  if (Math.abs(newSec - oldSec) < 0.001) return; // unchanged, skip
  m.atSec = newSec;
  redrawMarkers();
  if (record) {
    pushHistory('Mover marcador',
      () => { m.atSec = oldSec; redrawMarkers(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); },
      () => { m.atSec = newSec; redrawMarkers(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); }
    );
  }
  syncLoopRegion();
  scheduleSave();
  scheduleGuideSync();
}

// Commit a finished marker drag as a single undo step (oldSec → newSec).
function commitMarkerMove(markerId, oldSec) {
  const m = markers.find(x => x.id === markerId);
  if (!m) return;
  const newSec = m.atSec;
  if (Math.abs(newSec - oldSec) < 0.001) return;
  pushHistory('Mover marcador',
    () => { m.atSec = oldSec; redrawMarkers(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); },
    () => { m.atSec = newSec; redrawMarkers(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); }
  );
}

function changeMarkerCue(markerId, cueId) {
  const cue = findCueById(cueId);
  const m = markers.find(x => x.id === markerId);
  if (!cue || !m) return;
  const prev = { cueId: m.cueId, label: m.label, url: m.url };
  m.cueId = cue.id;
  m.label = cue.label;
  m.url = cue.url;
  redrawMarkers();
  pushHistory('Cambiar tipo de marcador',
    () => { m.cueId = prev.cueId; m.label = prev.label; m.url = prev.url; redrawMarkers(); scheduleSave(); },
    () => { m.cueId = cue.id; m.label = cue.label; m.url = cue.url; redrawMarkers(); scheduleSave(); }
  );
  scheduleSave();
  scheduleGuideSync();
}

function redrawMarkers() {
  const layer = document.getElementById('stems-marker-layer');
  if (!layer) return;
  // Marker layer inherits width from .stems-head-tl (parent).
  layer.innerHTML = '';
  for (const m of markers) {
    const x = m.atSec * PX_PER_SEC;
    const el = document.createElement('div');
    let role = '';
    if (m.id === loopStartMarkerId) role = ' stems-marker--loop-start';
    if (m.id === loopEndMarkerId)   role += ' stems-marker--loop-end';
    el.className = 'stems-marker' + role;
    el.style.left = `${x}px`;
    el.dataset.markerId = m.id;
    el.innerHTML = `
      <span class="stems-marker-flag" title="Arrastra para mover · click derecho para opciones">${SVG_FLAG}</span>
      <span class="stems-marker-label">${escapeHtml(m.label)}</span>
      <button class="stems-marker-remove" title="Quitar">×</button>
    `;
    el.querySelector('.stems-marker-remove').onclick = (e) => {
      e.stopPropagation();
      removeMarker(m.id);
    };
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMarkerMenu(e.clientX, e.clientY, m.id);
    });
    enableMarkerDrag(el, m.id);
    layer.appendChild(el);
  }
}

// ── Marker drag-to-reposition ────────────────────────────────────
function enableMarkerDrag(el, markerId) {
  const flag = el.querySelector('.stems-marker-flag');
  flag.style.cursor = 'grab';
  flag.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    flag.style.cursor = 'grabbing';
    const headTl = document.getElementById('stems-marker-layer');
    const tlRect = headTl.getBoundingClientRect();
    const dragStartSec = markers.find(x => x.id === markerId)?.atSec ?? 0;
    const onMove = (ev) => {
      const x = ev.clientX - tlRect.left;
      const sec = Math.max(0, x / PX_PER_SEC);
      moveMarkerTo(markerId, sec, { record: false });
    };
    const onUp = () => {
      flag.style.cursor = 'grab';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      commitMarkerMove(markerId, dragStartSec);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// ── Right-click menu for markers ────────────────────────────────
function openMarkerMenu(x, y, markerId) {
  closeMarkerMenu();
  const m = markers.find(t => t.id === markerId);
  if (!m) return;
  const menu = document.createElement('div');
  menu.className = 'stems-context-menu';
  menu.id = 'stems-marker-menu';
  menu.innerHTML = `
    <button data-cmd="rename">Renombrar</button>
    <button data-cmd="change">Cambiar tipo…</button>
    <button data-cmd="loop-start">Marcar como inicio de loop</button>
    <button data-cmd="loop-end">Marcar como fin de loop</button>
    <button data-cmd="loop-clear">Quitar de loop</button>
    <button data-cmd="delete" class="danger">Eliminar marcador</button>
  `;
  document.body.appendChild(menu);
  // Position then clamp inside viewport.
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth)  menu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 8}px`;
  });
  menu.querySelector('[data-cmd="rename"]').onclick = () => {
    closeMarkerMenu();
    const next = window.prompt
      ? null
      : null; // prompt is disabled in Electron 33 — use inline approach
    // Inline rename: turn the label into a contenteditable
    const el = document.querySelector(`.stems-marker[data-marker-id="${markerId}"] .stems-marker-label`);
    if (!el) return;
    el.contentEditable = 'true';
    el.focus();
    document.getSelection().selectAllChildren(el);
    const commit = () => {
      el.contentEditable = 'false';
      renameMarker(markerId, el.textContent);
    };
    el.addEventListener('blur', commit, { once: true });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = m.label; el.blur(); }
    });
  };
  menu.querySelector('[data-cmd="change"]').onclick = () => {
    closeMarkerMenu();
    openChangeCueMenu(x, y, markerId);
  };
  menu.querySelector('[data-cmd="loop-start"]').onclick = () => {
    closeMarkerMenu();
    loopStartMarkerId = markerId;
    syncLoopRegion();
    redrawMarkers();
    scheduleSave();
  };
  menu.querySelector('[data-cmd="loop-end"]').onclick = () => {
    closeMarkerMenu();
    loopEndMarkerId = markerId;
    syncLoopRegion();
    redrawMarkers();
    scheduleSave();
  };
  menu.querySelector('[data-cmd="loop-clear"]').onclick = () => {
    closeMarkerMenu();
    if (loopStartMarkerId === markerId) loopStartMarkerId = null;
    if (loopEndMarkerId === markerId)   loopEndMarkerId = null;
    syncLoopRegion();
    redrawMarkers();
    scheduleSave();
  };
  menu.querySelector('[data-cmd="delete"]').onclick = () => {
    closeMarkerMenu();
    if (loopStartMarkerId === markerId) loopStartMarkerId = null;
    if (loopEndMarkerId === markerId)   loopEndMarkerId = null;
    removeMarker(markerId);
    syncLoopRegion();
  };
  document.addEventListener('mousedown', closeMarkerMenuOnce, { capture: true });
  document.addEventListener('keydown', closeMarkerMenuOnEsc, { once: true });
}

function toggleLoop() {
  loopEnabled = !loopEnabled;
  syncLoopRegion();
  redrawMarkers();
  const btn = document.getElementById('stems-loop-toggle');
  if (btn) btn.classList.toggle('is-on', loopEnabled);
  scheduleSave();
}

function syncLoopRegion() {
  const overlay = document.getElementById('stems-loop-overlay');
  if (!loopEnabled || !loopStartMarkerId || !loopEndMarkerId) {
    engine.clearLoopRegion();
    if (overlay) overlay.hidden = true;
    return;
  }
  const a = markers.find(m => m.id === loopStartMarkerId);
  const b = markers.find(m => m.id === loopEndMarkerId);
  if (!a || !b) { engine.clearLoopRegion(); if (overlay) overlay.hidden = true; return; }
  const start = Math.min(a.atSec, b.atSec);
  const end   = Math.max(a.atSec, b.atSec);
  engine.setLoopRegion(start, end);
  // Position overlay over the timeline area (after the sticky strip column).
  if (overlay) {
    overlay.hidden = false;
    overlay.style.left  = `${STRIP_WIDTH + start * PX_PER_SEC}px`;
    overlay.style.width = `${(end - start) * PX_PER_SEC}px`;
  }
}
function closeMarkerMenuOnce(e) {
  const menu = document.getElementById('stems-marker-menu');
  if (menu && !menu.contains(e.target)) closeMarkerMenu();
}
function closeMarkerMenuOnEsc(e) {
  if (e.key === 'Escape') closeMarkerMenu();
}
function closeMarkerMenu() {
  document.getElementById('stems-marker-menu')?.remove();
  document.getElementById('stems-change-cue-menu')?.remove();
  document.removeEventListener('mousedown', closeMarkerMenuOnce, { capture: true });
}
function openChangeCueMenu(x, y, markerId) {
  const menu = document.createElement('div');
  menu.className = 'stems-context-menu stems-context-menu--scroll';
  menu.id = 'stems-change-cue-menu';
  menu.innerHTML = SECTION_CUES.map(c =>
    `<button data-cue="${c.id}">${c.label}</button>`
  ).join('');
  document.body.appendChild(menu);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth)  menu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 8}px`;
  });
  menu.querySelectorAll('[data-cue]').forEach(b => {
    b.onclick = () => {
      changeMarkerCue(markerId, b.dataset.cue);
      closeMarkerMenu();
    };
  });
  document.addEventListener('mousedown', closeMarkerMenuOnce, { capture: true });
}

// ── Click track generator ─────────────────────────────────────────
async function onAddClickTrack() {
  const existingClickId = engine.findTrackByKind('click');
  if (existingClickId) {
    if (!confirm('Ya existe una pista de click. ¿Regenerarla con el BPM actual?')) return;
    await regenerateClickTrack(existingClickId);
    return;
  }
  // Electron 33 disables window.prompt(), so we just default the duration:
  // existing-stem length if any, otherwise 4 min (typical worship song).
  // The user can regenerate later (it'll use whatever the project length is
  // by then). Simpler than maintaining a custom inline-prompt dialog.
  const hasTracks = engine.getTracks().length > 0;
  const seconds = hasTracks ? projectDurationSec() : 240;
  await createClickTrack(seconds);
}

// Smart-align the click to the loaded song: detect where the beat actually
// falls (handles intros / leading silence) and which beat is the downbeat,
// so the generated click is phase-locked to the music (like Moises). Returns
// { offsetSec, accentBeatOffset }; falls back to no shift if no song/onsets.
function computeClickAlignment() {
  const stem = engine.getTracks().find(t => t.kind === 'stem');
  if (!stem) return { offsetSec: 0, accentBeatOffset: 0 };
  const buf = engine.getTrackBuffer(stem.id);
  if (!buf) return { offsetSec: 0, accentBeatOffset: 0 };
  const a = detectBeatAlignment(buf, bpm, beatsPerBar);
  return a || { offsetSec: 0, accentBeatOffset: 0 };
}

async function createClickTrack(durationSec) {
  const ctx = engine.getAudioContext();
  const { offsetSec, accentBeatOffset } = computeClickAlignment();
  const buffer = await generateClickTrack({ bpm, beatsPerBar, durationSec, ctx, sound: clickSoundId, accentBeatOffset });
  const wav = audioBufferToWav(buffer);
  const id = `click-${nextTrackId++}`;
  await engine.addTrack({ id, name: `Click ${bpm} BPM`, audioBuffer: buffer, kind: 'click', offsetSec });
  const savedPath = await projectStore.saveStem(id, `click_${bpm}bpm.wav`, wav);
  appendTrackRow(id, savedPath);
  refreshTransport();
  scheduleSave();
}

async function regenerateClickTrack(existingId) {
  const durationSec = projectDurationSec();
  const ctx = engine.getAudioContext();
  const { offsetSec, accentBeatOffset } = computeClickAlignment();
  const buffer = await generateClickTrack({ bpm, beatsPerBar, durationSec, ctx, sound: clickSoundId, accentBeatOffset });
  const wav = audioBufferToWav(buffer);
  engine.replaceTrackBuffer(existingId, buffer);
  engine.setTrackOffset(existingId, offsetSec);
  // Refresh persisted file too.
  const entry = trackRows.get(existingId);
  if (entry) {
    await projectStore.removeStem(entry.row.dataset.path);
    const savedPath = await projectStore.saveStem(existingId, `click_${bpm}bpm.wav`, wav);
    entry.row.dataset.path = savedPath;
  }
  peaksCache.delete(existingId);
  drawTrackWaveform(existingId);
  scheduleSave();
}

// ── Guide track build ─────────────────────────────────────────────
// When a guide already exists, marker edits (add/move/remove/retype)
// trigger a debounced rebuild so the guide tracks the markers without the
// user pressing "Generar Guía" again. Debounced because moveMarkerTo fires
// on every pointermove during a drag — we only rebuild once the drag settles.
let guideSyncTimer = null;
let guideSyncRunning = false;
let guideSyncDirty = false;
function scheduleGuideSync() {
  if (!engine.findTrackByKind('guide')) return; // nothing to keep in sync yet
  if (guideSyncTimer) clearTimeout(guideSyncTimer);
  guideSyncTimer = setTimeout(runGuideSync, 350);
}
async function runGuideSync() {
  guideSyncTimer = null;
  if (markers.length === 0) return;
  // Don't overlap with an in-flight rebuild; mark dirty and re-run after.
  if (guideSyncRunning) { guideSyncDirty = true; return; }
  guideSyncRunning = true;
  try {
    await onRebuildGuide({ silent: true });
  } finally {
    guideSyncRunning = false;
    if (guideSyncDirty) { guideSyncDirty = false; scheduleGuideSync(); }
  }
}

async function onRebuildGuide({ silent = false } = {}) {
  if (markers.length === 0) {
    if (!silent) alert('Añade al menos un marcador antes de generar la guía.');
    return;
  }
  try {
    const durationSec = projectDurationSec();
    const ctx = engine.getAudioContext();
    const buffer = await buildGuideTrack({ markers, durationSec, sampleRate: ctx.sampleRate });
    if (!buffer) return;
    const wav = audioBufferToWav(buffer);
    const existingId = engine.findTrackByKind('guide');
    if (existingId) {
      engine.replaceTrackBuffer(existingId, buffer);
      const entry = trackRows.get(existingId);
      if (entry) {
        await projectStore.removeStem(entry.row.dataset.path);
        const savedPath = await projectStore.saveStem(existingId, 'guide.wav', wav);
        entry.row.dataset.path = savedPath;
      }
      peaksCache.delete(existingId);
      drawTrackWaveform(existingId);
    } else {
      const id = `guide-${nextTrackId++}`;
      await engine.addTrack({ id, name: 'Guía', audioBuffer: buffer, kind: 'guide' });
      const savedPath = await projectStore.saveStem(id, 'guide.wav', wav);
      appendTrackRow(id, savedPath);
    }
    refreshTransport();
    scheduleSave();
  } catch (e) {
    console.error('Guide build failed', e);
    if (!silent) alert('No se pudo generar la guía: ' + (e.message || e));
  }
}

// ── Transport state ───────────────────────────────────────────────
function refreshTransport() {
  const hasTracks = engine.getTracks().length > 0;
  document.getElementById('stems-play').disabled  = !hasTracks;
  document.getElementById('stems-stop').disabled  = !hasTracks;
  document.getElementById('stems-pause').disabled = !engine.isCurrentlyPlaying();
  const exportBtn = document.getElementById('stems-export');
  if (exportBtn) exportBtn.disabled = !hasTracks;
  const count = engine.getTracks().length;
  const countText = `${count} ${count === 1 ? 'pista' : 'pistas'}`;
  const c2 = document.getElementById('stems-console-count');
  if (c2) c2.textContent = countText;
  refreshTotalTime();
}

function applyPlayingState(playing) {
  // The VU meter loop self-stops when idle; (re)start it when playback begins.
  if (playing) startMasterMeter();
  const playBtn  = document.getElementById('stems-play');
  const pauseBtn = document.getElementById('stems-pause');
  const stopBtn  = document.getElementById('stems-stop');
  const pill     = document.getElementById('stems-state-pill');
  const hasTracks = engine.getTracks().length > 0;
  if (playBtn) {
    playBtn.classList.toggle('is-playing', playing);
    // Play stays enabled when paused so the user can resume; only the
    // empty-project case disables it.
    playBtn.disabled = !hasTracks;
  }
  if (pauseBtn) pauseBtn.disabled = !playing;
  if (stopBtn)  stopBtn.disabled  = !hasTracks;
  if (pill) {
    pill.textContent = playing ? 'REPRODUCIENDO' : 'DETENIDO';
    pill.dataset.state = playing ? 'play' : 'stop';
  }
}

function applyTimeUpdate(sec) {
  const tc = document.getElementById('stems-timecode');
  if (tc) tc.textContent = formatTimecode(sec);
  const cur = document.getElementById('stems-tb-cur');
  if (cur) cur.textContent = formatTime(sec);
  const head = document.getElementById('stems-playhead');
  if (head) head.style.transform = `translateX(${STRIP_WIDTH + sec * PX_PER_SEC}px)`;
  autoFollowPlayhead(sec);
}

// Refresh the total-duration readout in the transport (call when tracks
// change, since duration = the longest track).
function refreshTotalTime() {
  const total = document.getElementById('stems-tb-total');
  if (total) total.textContent = formatTime(engine.getDurationSec() || 0);
}

// ── Export ────────────────────────────────────────────────────────
async function runExport(opts = {}) {
  if (engine.isCurrentlyPlaying()) engine.stop();
  const overlay = document.getElementById('stems-export-overlay');
  const fill    = document.getElementById('stems-export-fill');
  const stageEl = document.getElementById('stems-export-stage');
  const titleEl = document.getElementById('stems-export-title');

  const isIndividual = !!opts.onlyTrackIds;
  overlay.hidden = false;
  titleEl.textContent = isIndividual ? 'Exportando pista…' : 'Renderizando mezcla…';
  stageEl.textContent = 'Preparando audio';
  fill.style.width = '0%';

  try {
    const mp3Bytes = await exportMix((progress, stage) => {
      const linear = stage === 'render' ? progress * 0.5 : 0.5 + progress * 0.5;
      fill.style.width = `${Math.round(linear * 100)}%`;
      stageEl.textContent = stage === 'render'
        ? (isIndividual ? 'Renderizando pista individual' : 'Renderizando mezcla con paneos y volúmenes')
        : 'Codificando a MP3';
    }, opts);

    titleEl.textContent = 'Guardando archivo…';
    stageEl.textContent = 'Elige dónde guardar el .mp3';
    const savedPath = await window.electronAPI.stemsExportMp3({
      suggestedName: opts.suggestedName || projectName,
      buffer: mp3Bytes.buffer
    });

    if (savedPath) {
      titleEl.textContent = 'Mezcla exportada ✓';
      stageEl.textContent = savedPath;
      setTimeout(() => { overlay.hidden = true; }, 1800);
    } else {
      overlay.hidden = true;
    }
  } catch (e) {
    console.error('Stem export failed:', e);
    titleEl.textContent = 'Error al exportar';
    stageEl.textContent = e.message || String(e);
    setTimeout(() => { overlay.hidden = true; }, 3000);
  }
}

// ── Persistence ───────────────────────────────────────────────────
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  // Show "Pendiente…" right away so the user knows a save is queued.
  const pill = document.getElementById('stems-save-pill');
  if (pill) {
    pill.hidden = false;
    pill.dataset.state = 'pending';
    pill.textContent = 'Pendiente…';
  }
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

async function doSave() {
  saveTimer = null;
  const pill = document.getElementById('stems-save-pill');
  if (pill) { pill.dataset.state = 'saving'; pill.textContent = 'Guardando…'; }
  try {
    const tracks = engine.getTracks().map(t => {
      const entry = trackRows.get(t.id);
      return {
        id: t.id, kind: t.kind, name: t.name,
        volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed,
        color: t.color || null, offsetSec: t.offsetSec || 0,
        path: entry ? entry.row.dataset.path : null
      };
    });
    await projectStore.saveCurrent({
      projectName,
      bpm, beatsPerBar, beatValue,
      masterVolume: engine.getMasterVolume(),
      nextTrackId, nextMarkerId,
      tracks,
      markers,
      // View / preferences — persisted so a reopen restores the exact state.
      pxPerSec: PX_PER_SEC,
      rowHeight: ROW_HEIGHT,
      snapToBeat,
      clickSoundId,
      loopEnabled,
      loopStartMarkerId,
      loopEndMarkerId
    });
    flashSavedPill();
  } catch (e) {
    console.warn('Stem auto-save failed:', e);
  }
}

function flashSavedPill() {
  const pill = document.getElementById('stems-save-pill');
  if (!pill) return;
  pill.hidden = false;
  pill.dataset.state = 'saved';
  pill.textContent = 'Guardado ✓';
  pill.classList.add('is-on');
  if (pillTimer) clearTimeout(pillTimer);
  pillTimer = setTimeout(() => pill.classList.remove('is-on'), 1500);
}

async function rehydrate(state) {
  projectName = state.projectName || 'Mi proyecto';
  document.getElementById('stems-project-name').value = projectName;

  if (typeof state.bpm === 'number') {
    bpm = state.bpm;
    document.getElementById('stems-bpm').value = bpm;
  }
  if (typeof state.beatsPerBar === 'number') beatsPerBar = state.beatsPerBar;
  if (typeof state.beatValue === 'number') beatValue = state.beatValue;
  const sigSel = document.getElementById('stems-sig');
  if (sigSel) sigSel.value = `${beatsPerBar}/${beatValue}`;

  if (typeof state.masterVolume === 'number') {
    engine.setMasterVolume(state.masterVolume);
    document.getElementById('stems-master-vol').value = Math.round(state.masterVolume * 100);
  }

  for (const t of state.tracks || []) {
    if (!t.path) continue;
    try {
      const arrayBuffer = await projectStore.fetchStem(t.path);
      await engine.addTrack({ id: t.id, name: t.name, arrayBuffer, kind: t.kind || 'stem', offsetSec: t.offsetSec || 0 });
      engine.setTrackVolume(t.id, t.volume);
      engine.setTrackPan(t.id, t.pan);
      if (t.muted)  engine.setTrackMuted(t.id, true);
      if (t.soloed) engine.setTrackSoloed(t.id, true);
      if (t.color)  engine.setTrackColor(t.id, t.color);
      appendTrackRow(t.id, t.path);
    } catch (e) {
      console.warn('Could not restore stem', t.id, e);
    }
  }

  if (state.markers) markers = state.markers;
  if (typeof state.nextTrackId === 'number') nextTrackId = state.nextTrackId;
  if (typeof state.nextMarkerId === 'number') nextMarkerId = state.nextMarkerId;
  if (typeof state.pxPerSec === 'number') setZoom(state.pxPerSec);
  if (typeof state.rowHeight === 'number') setRowHeight(state.rowHeight);
  if (typeof state.snapToBeat === 'boolean') {
    snapToBeat = state.snapToBeat;
    const snap = document.getElementById('stems-snap');
    if (snap) snap.checked = snapToBeat;
  }
  if (typeof state.clickSoundId === 'string') {
    const valid = getClickSounds().some(s => s.id === state.clickSoundId);
    clickSoundId = valid ? state.clickSoundId : 'cowbell';
    const sel = document.getElementById('stems-click-sound');
    if (sel) sel.value = clickSoundId;
  }
  if (state.loopStartMarkerId) loopStartMarkerId = state.loopStartMarkerId;
  if (state.loopEndMarkerId)   loopEndMarkerId = state.loopEndMarkerId;
  if (typeof state.loopEnabled === 'boolean') {
    loopEnabled = state.loopEnabled;
    const btn = document.getElementById('stems-loop-toggle');
    if (btn) btn.classList.toggle('is-on', loopEnabled);
    syncLoopRegion();
  }
  refreshTransport();
  refreshTimelineWidth();
  reflectSoloHighlights();
}

// ── Save As / Open modals ─────────────────────────────────────────
// Electron 33 disables window.prompt(), so we render small inline modals
// for project naming and project picking instead of relying on native
// prompts. Both share the same dim backdrop + escape-to-close behaviour.

function openSaveAsModal() {
  closeStemsModal();
  const m = document.createElement('div');
  m.id = 'stems-modal';
  m.className = 'stems-modal';
  m.innerHTML = `
    <div class="stems-modal-card">
      <h3>Guardar proyecto como…</h3>
      <p>Se guardará una copia del proyecto actual con este nombre. Podrás abrirlo después desde "Abrir proyecto".</p>
      <input id="stems-modal-name" class="stems-modal-input" placeholder="Nombre del proyecto" autofocus>
      <div class="stems-modal-actions">
        <button class="stems-btn stems-btn--subtle" data-act="cancel">Cancelar</button>
        <button class="stems-btn stems-btn--primary" data-act="save">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  const input = m.querySelector('#stems-modal-name');
  input.value = projectName;
  requestAnimationFrame(() => { input.focus(); input.select(); });
  m.querySelector('[data-act="cancel"]').onclick = closeStemsModal;
  m.querySelector('[data-act="save"]').onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      // Flush any pending save first so the snapshot is up-to-date.
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await doSave();
      await window.electronAPI.stemsSaveAs({ name });
      projectName = name;
      document.getElementById('stems-project-name').value = name;
      flashSavedPill();
      closeStemsModal();
    } catch (e) {
      alert('Error: ' + (e.message || e));
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') m.querySelector('[data-act="save"]').click();
    if (e.key === 'Escape') closeStemsModal();
  });
  m.addEventListener('click', (e) => { if (e.target === m) closeStemsModal(); });
}

async function openProjectsModal() {
  closeStemsModal();
  const list = await window.electronAPI.stemsListProjects();
  const m = document.createElement('div');
  m.id = 'stems-modal';
  m.className = 'stems-modal';
  m.innerHTML = `
    <div class="stems-modal-card stems-modal-card--wide">
      <h3>Abrir proyecto</h3>
      <p>Selecciona un proyecto guardado.</p>
      <div class="stems-modal-list" id="stems-modal-list">
        ${list.length === 0
          ? '<div class="stems-modal-empty">No hay proyectos guardados aún. Usa <strong>Guardar como…</strong> primero.</div>'
          : list.map(p => `
            <div class="stems-modal-row" data-slug="${escapeAttr(p.slug)}">
              <div class="stems-modal-row-info">
                <span class="stems-modal-row-name">${escapeHtml(p.name)}</span>
                <span class="stems-modal-row-time">${formatRelTime(p.updatedAt)}</span>
              </div>
              <div class="stems-modal-row-actions">
                <button class="stems-btn stems-btn--subtle" data-act="open">Abrir</button>
                <button class="stems-btn stems-btn--subtle stems-btn--danger" data-act="delete" title="Eliminar este proyecto">×</button>
              </div>
            </div>
          `).join('')}
      </div>
      <div class="stems-modal-actions">
        <button class="stems-btn stems-btn--subtle" data-act="cancel">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.querySelector('[data-act="cancel"]').onclick = closeStemsModal;
  m.addEventListener('click', (e) => { if (e.target === m) closeStemsModal(); });
  document.addEventListener('keydown', escCloseStemsModal, { once: true });

  m.querySelectorAll('.stems-modal-row').forEach(row => {
    const slug = row.dataset.slug;
    row.querySelector('[data-act="open"]').onclick = async () => {
      try {
        await resetProject();
        const state = await window.electronAPI.stemsLoadProject(slug);
        if (state) await rehydrate(state);
        closeStemsModal();
      } catch (e) { alert('No se pudo abrir: ' + (e.message || e)); }
    };
    row.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm(`¿Eliminar el proyecto "${row.querySelector('.stems-modal-row-name').textContent}"? Esto borra sus stems del disco.`)) return;
      try {
        await window.electronAPI.stemsDeleteProject(slug);
        row.remove();
      } catch (e) { alert('No se pudo eliminar: ' + (e.message || e)); }
    };
  });
}
function escCloseStemsModal(e) {
  if (e.key === 'Escape') closeStemsModal();
}
function closeStemsModal() {
  document.getElementById('stems-modal')?.remove();
}
function formatRelTime(ms) {
  if (!ms) return '';
  const d = Date.now() - ms;
  const min = Math.floor(d / 60000);
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  return `hace ${day} día${day === 1 ? '' : 's'}`;
}

async function resetProject() {
  if (engine.isCurrentlyPlaying()) engine.stop();
  for (const id of Array.from(trackRows.keys())) {
    const entry = trackRows.get(id);
    engine.removeTrack(id);
    if (entry) {
      await projectStore.removeStem(entry.row.dataset.path);
      entry.row.remove();
      if (entry.console) entry.console.remove();
    }
  }
  trackRows.clear();
  peaksCache.clear();
  markers = [];
  nextTrackId = 1;
  nextMarkerId = 1;
  projectName = 'Mi proyecto';
  bpm = 120; beatsPerBar = 4; beatValue = 4;
  document.getElementById('stems-project-name').value = projectName;
  document.getElementById('stems-bpm').value = bpm;
  document.getElementById('stems-sig').value = '4/4';
  document.getElementById('stems-empty').hidden = false;
  refreshTransport();
  refreshTimelineWidth();
  redrawMarkers();
  await projectStore.clearCurrent();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
