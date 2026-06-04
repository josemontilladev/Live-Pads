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
import { detectSections } from './sectionDetector.js';
import { maybeStartTour, startTour } from './tour.js';
import { addMapping, getMapping, clearMappingForTarget } from '../midi/midiMap.js';
import { setStemsMidiHandler } from '../midi/midiBindings.js';
import { mountPianoPanel, togglePiano, closePiano, isPianoOpen, pianoPanic, setInstrumentUI } from './pianoPanel.js';
import { renderEventsToBuffer, getInstrument, instrumentName as instLabel } from './pianoSampler.js';
import { openPianoRoll } from './pianoRoll.js';
import { getIsMidiLearnMode, getMidiLearnTarget, setMidiLearnTarget, getSongs } from '../state/store.js';
import { confirmDialogAsync } from '../ui/dialog.js';
import { pushModal } from '../ui/modalStack.js';
import { openCardMoreMenu } from '../ui/cardMoreMenu.js';
import { audioMenuItems } from '../ui/songMenu.js';
import { songEditFormHTML, applyLibrarySelection } from '../ui/songEditForm.js';
import { showToast } from '../ui/toast.js';
import { esc } from '../utils/dom.js';
import { read as storageRead, write as storageWrite, remove as storageRemove } from '../utils/storage.js';

// Toast helper local — el módulo emite muchísimos avisos al usuario; antes
// usaba alert() nativo que bloquea la UI y rompe la estética. Pasa todo
// por el toast global; kind por defecto 'error' porque la mayoría son
// "algo no se pudo hacer".
const toast = (msg, kind = 'error') => window.showToast?.(msg, kind);

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
const SVG_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
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
// Cola de archivos que pidió importar otro módulo (ej. giList al
// "Extraer del original") antes de que el workspace estuviera montado.
// Se procesa al final de mount(). Si ya está montado, importa directo.
const pendingImportFiles = [];

export async function acceptIncomingFile(file) {
  if (!file) return;
  if (mounted) {
    await importFiles([file]);
  } else {
    pendingImportFiles.push(file);
  }
}
let nextTrackId = 1;
let projectName = 'Mi proyecto';
let bpm = 120;            // integer shown in the UI / track names
let bpmFloat = 120;       // precise tempo used for click, alignment + grid so
                          // nothing drifts across a long track
let beatsPerBar = 4;
let beatValue = 4;
// Tonalidad ORIGINAL del audio cargado (ej. "C", "Am", "F#m"). El selector
// del topbar muestra la tonalidad EFECTIVA = projectKey transpuesta por
// currentStemsPitch — si el usuario baja 1 semitono al transpose, ve la
// tonalidad efectiva en pantalla (C# en vez de D). Las armonías diatónicas
// se calculan contra el modo (mayor/menor), que no cambia con el shift,
// así que el cálculo es robusto en ambos sentidos.
let projectKey = null;

// Pitch-class (semitone) de cada nota. Solo sostenidos en la UI; al
// transponer hacia arriba/abajo usamos el equivalente enarmónico con #.
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Mapa de aliases enarmónicos para aceptar entradas con bemoles si en el
// futuro habilitamos esas opciones (hoy el select solo tiene sostenidos).
const FLAT_TO_SHARP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

function keyToParts(key) {
  if (!key) return null;
  const isMinor = /m$/.test(key);
  let root = isMinor ? key.slice(0, -1) : key;
  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];
  const idx = PITCH_CLASSES.indexOf(root);
  return idx >= 0 ? { semi: idx, minor: isMinor } : null;
}
function partsToKey(semi, isMinor) {
  const r = ((semi % 12) + 12) % 12;
  return PITCH_CLASSES[r] + (isMinor ? 'm' : '');
}
function transposeKey(key, semitones) {
  const p = keyToParts(key);
  if (!p) return null;
  return partsToKey(p.semi + semitones, p.minor);
}

// La tonalidad efectiva es lo que el audio realmente está sonando AHORA:
// la original transpuesta por el shift master actual.
function getEffectiveKey() {
  if (!projectKey) return null;
  return transposeKey(projectKey, currentStemsPitch);
}

// Tonalidad en un momento específico del audio. Busca el marker más
// reciente (con tonalidad seteada) cuyo atSec sea ≤ sec. Si ninguno
// tiene tonalidad, cae al projectKey global. Devuelve EFECTIVA (con el
// shift master aplicado), igual que getEffectiveKey.
//
// Caso típico: canción en Em que modula a G en el último coro. El
// usuario pone un marker "Coro final" en el cambio, le asigna G, y al
// generar armonía DESPUÉS de ese tiempo el menú armónico usa G en vez
// de Em. Antes de ese marker sigue usando Em (o projectKey).
function getKeyAtTime(sec) {
  let base = projectKey;
  // Markers ordenados por atSec ascendente; tomamos el ÚLTIMO con key
  // que sea <= sec.
  const sorted = markers.slice().sort((a, b) => a.atSec - b.atSec);
  for (const m of sorted) {
    if (m.atSec > sec) break;
    if (m.key) base = m.key;
  }
  if (!base) return null;
  return transposeKey(base, currentStemsPitch);
}

// Actualiza el select para mostrar la tonalidad efectiva sin disparar
// el onchange (que reinterpretaría el valor como original).
function paintEffectiveKeyUI() {
  const sel = document.getElementById('stems-key');
  if (!sel) return;
  const eff = getEffectiveKey();
  sel.value = eff || '';
}
// Which beats of the bar get the accent click. Length tracks beatsPerBar;
// default accents beat 1 only. User-configurable via the accent chips.
let accentPattern = [true, false, false, false];
function makeDefaultAccent(n) { const a = new Array(n).fill(false); a[0] = true; return a; }
let markers = [];        // array of { id, label, atSec, url }
let nextMarkerId = 1;
const trackRows = new Map();   // trackId → { strip, lane, canvas }
const peaksCache = new Map();  // trackId → Float32Array peaks
// Pistas MIDI (piano): notas editables por pista. La pista mantiene además un
// audio auto-renderizado (freeze) en el engine para sonar/mezclar/exportar.
const trackNotes = new Map();  // trackId → [{ midi, velocity, startSec, durationSec }]
const trackInstrument = new Map(); // trackId → instrumento (piano/rhodes/pad/lead/bass)
let activeRecId = null;        // pista MIDI que se está grabando ahora mismo

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

// Public: corte de audio para el pánico global (Esc). app.js lo llama sobre el
// módulo de Stems si está montado, para que un Esc detenga TAMBIÉN la
// reproducción del timeline, no solo los pads/secuencia.
export function stemsPanicStop() {
  try { cancelImport(); } catch (_) {}
  try { if (engine.isCurrentlyPlaying()) engine.stop(); } catch (_) {}
  try { pianoPanic(); } catch (_) {}
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

// ── Stems MIDI (independent map; only active while the Stems workspace is
//    the current scope — see midiBindings/midiMap). Mappings here NEVER touch
//    the Pads map. Wired once from mount(). ───────────────────────────────
let stemsMidiWired = false;
function wireStemsMidi() {
  if (stemsMidiWired) return;
  stemsMidiWired = true;
  setStemsMidiHandler(handleStemsMidi);
  // Learn-target capture for Stems controls (the Pads intercept ignores us).
  document.addEventListener('click', stemsLearnClick, true);
}

const stripsList = () => [...document.querySelectorAll('#stems-console-strips .stems-console-strip')];
const stripBySlot = (slot) => stripsList()[Number(slot)] || null;

function stemsLearnClick(e) {
  if (!getIsMidiLearnMode()) return;
  if (document.body.dataset.workspace !== 'stems') return;
  if (e.target.closest('#midi-learn-overlay')) return; // exit handled elsewhere

  let target = null;
  if (e.target.closest('#stems-play')) target = { action: 'st_play' };
  else if (e.target.closest('#stems-stop')) target = { action: 'st_stop' };
  else if (e.target.closest('#stems-master-vol')) target = { action: 'st_master_vol' };
  else if (e.target.closest('#stems-add-marker')) target = { action: 'st_marker' };
  else if (e.target.closest('#stems-add-click')) target = { action: 'st_genclick' };
  else if (e.target.closest('#stems-detect-sections')) target = { action: 'st_detectsec' };
  else if (e.target.closest('#stems-bpm-detect')) target = { action: 'st_detectbpm' };
  else if (e.target.closest('#stems-rebuild-guide')) target = { action: 'st_guide' };
  else {
    const strip = e.target.closest('.stems-console-strip');
    const ctrl  = e.target.closest('[data-action]');
    const ACT = { vol: 'st_vol', pan: 'st_pan', mute: 'st_mute', solo: 'st_solo' };
    if (strip && ctrl && ACT[ctrl.dataset.action]) {
      const slot = stripsList().indexOf(strip);
      if (slot >= 0) target = { action: ACT[ctrl.dataset.action], id: slot };
    }
  }
  if (!target) return;
  e.stopPropagation(); e.preventDefault();
  setMidiLearnTarget(target);
  const ov = document.getElementById('midi-learn-overlay');
  if (ov) ov.innerHTML = `🎹 <b>Stems</b> — esperando MIDI para: <b>${target.action}${target.id != null ? ' ' + (target.id + 1) : ''}</b>… Toca tu controlador.`;
}

function handleStemsMidi(cmd, data1, data2) {
  const isCC = cmd >= 176 && cmd <= 191;
  const mapKey = isCC ? `cc_${data1}` : `note_${data1}`;

  // Learn mode → capture (strict uniqueness within the Stems scope).
  if (getIsMidiLearnMode() && getMidiLearnTarget()) {
    if (data2 > 0) {
      const target = getMidiLearnTarget();
      clearMappingForTarget(target, false);
      addMapping(mapKey, target);
      const ov = document.getElementById('midi-learn-overlay');
      if (ov) ov.innerHTML = `✅ ¡Asignado y guardado! (Stems) Selecciona otro o sal.`;
      setMidiLearnTarget(null);
    }
    return;
  }

  const m = getMapping(mapKey, data1);
  if (!m) return;

  // Continuous controls (use the 0-127 value).
  if (m.action === 'st_master_vol') {
    const el = document.getElementById('stems-master-vol');
    if (el) { el.value = Math.round((data2 / 127) * 100); el.dispatchEvent(new Event('input', { bubbles: true })); }
    return;
  }
  if (m.action === 'st_vol') {
    const strip = stripBySlot(m.id); if (!strip) return;
    const id = strip.dataset.trackId;
    const pct = Math.round((data2 / 127) * 100);
    engine.setTrackVolume(id, pct / 100);
    syncConsoleStripVol(id, pct);
    scheduleSave();
    return;
  }
  if (m.action === 'st_pan') {
    const strip = stripBySlot(m.id); if (!strip) return;
    const panInput = strip.querySelector('[data-action="pan"]');
    if (panInput) { panInput.value = Math.round((data2 / 127) * 200 - 100); panInput.dispatchEvent(new Event('input', { bubbles: true })); }
    return;
  }

  // Triggers (act on press only).
  if (data2 <= 0) return;
  switch (m.action) {
    case 'st_play':       toggleStemsPlay(); break;
    case 'st_stop':       engine.stop(); break;
    case 'st_marker':     addStemsMarker(); break;
    case 'st_genclick':   onAddClickTrack(); break;
    case 'st_detectsec':  onDetectSections(); break;
    case 'st_detectbpm':  onDetectBpm(); break;
    case 'st_guide':      onRebuildGuide(); break;
    case 'st_mute':       stripBySlot(m.id)?.querySelector('[data-action="mute"]')?.click(); break;
    case 'st_solo':       stripBySlot(m.id)?.querySelector('[data-action="solo"]')?.click(); break;
  }
}

export async function mount() {
  if (mounted) return;
  mounted = true;

  engine.init({
    onPlayingChange: applyPlayingState,
    onTimeUpdate: applyTimeUpdate
  });

  wireStemsMidi();

  const root = document.getElementById('workspace-stems');
  if (!root) return;
  root.innerHTML = SHELL_HTML;
  wireTopbarEvents(root);
  wireArrangeEvents(root);
  wireSeekClicks(root);
  wireRowReorder(root);
  wireConsoleReorder(root);
  wireTrackSelection(root);
  wireConsoleCollapse(root);
  wirePiano(root);
  refreshSectionDropdown();
  refreshClickSoundDropdown();
  renderAccentChips();
  refreshTimelineWidth();
  bindSetlistPanel();

  // Repaint waveforms whenever the global theme changes so the accent
  // colour stays in sync with whatever the user picked in Ajustes.
  document.addEventListener('livepads:theme-change', () => redrawAllWaveforms());

  // Master VU meter — animate while the engine is playing. Cheap RAF
  // loop that reads peak from the analyser; idle when stopped so we
  // don't burn frames on silence.
  startMasterMeter();

  // Ocultamos el estado "Sin pistas aún" hasta saber si hay proyecto guardado:
  // así no parpadea mientras se lee/restaura. Solo se muestra si no hay nada.
  const emptyEl = document.getElementById('stems-empty');
  if (emptyEl) emptyEl.hidden = true;
  try {
    const restored = await projectStore.loadCurrent();
    if (restored && (restored.tracks?.length || restored.markers?.length)) {
      await rehydrate(restored);
    } else if (emptyEl) {
      emptyEl.hidden = false;
    }
  } catch (e) {
    console.warn('Could not restore stem project:', e);
    hideRestoreOverlay();
    if (emptyEl) emptyEl.hidden = false;
  }

  // Procesa archivos que pidieron importar antes de que el workspace
  // estuviera listo (ej. giList → "Extraer del original"). El usuario
  // ya pidió la acción; el archivo aterriza solo, sin pasos extra.
  if (pendingImportFiles.length) {
    const files = pendingImportFiles.splice(0);
    await importFiles(files);
  }
}

// ── HTML shell ─────────────────────────────────────────────────────
const SHELL_HTML = `
  <div class="stems-shell">

   <!-- Panel de canciones (setlist) — contexto del servicio mientras mezclás +
        destino de la asignación. Clic en una canción → renderiza y asigna la
        mezcla a su slot (Secuencia/Original según el toggle). Colapsable. -->
   <aside class="stems-setlist" id="stems-setlist">
     <!-- Riel visible SOLO cuando el panel está colapsado: indica que ahí están
          las canciones. Clic en el riel también expande (además del chevron). -->
     <div class="ssl-rail" aria-hidden="true" title="Mostrar canciones">
       <span class="ssl-rail-top">
         <span class="ssl-title-icon" aria-hidden="true">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
         </span>
         <span class="ssl-rail-text">Canciones</span>
         <span class="ssl-rail-chevron" aria-hidden="true">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="9 6 15 12 9 18"/></svg>
         </span>
       </span>
       <span class="ssl-rail-count" id="stems-setlist-count" title="Canciones en la librería"></span>
     </div>
     <!-- Encabezado (visible expandido): icono + título + botón de contraer. -->
     <div class="ssl-title-row">
       <span class="ssl-title-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
       <span class="ssl-title-label">Canciones</span>
       <button class="ssl-collapse-btn" id="stems-setlist-collapse" type="button" title="Contraer panel" aria-label="Contraer panel">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
       </button>
     </div>
     <div class="ssl-head">
       <button class="ssl-add" id="stems-setlist-add" title="Agregar una canción nueva a la librería" aria-label="Agregar canción"><svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.1" fill="none" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
       <div class="ssl-slot" role="group" aria-label="Filtro de canciones">
         <button class="ssl-slot-btn active" data-slot="all" title="Ver todas las canciones">Todas</button>
         <button class="ssl-slot-btn" data-slot="sequence" title="Ver las de Secuencia">Secuencia</button>
         <button class="ssl-slot-btn" data-slot="original" title="Ver las de Original">Original</button>
       </div>
     </div>
     <input class="ssl-search" type="text" placeholder="Buscar canción…" aria-label="Buscar canción">
     <div class="ssl-list" id="stems-setlist-list"></div>
     <div class="ssl-hint">Clic → carga y reproduce en el timeline · Clic derecho → asignar audio.</div>
   </aside>

   <div class="stems-main">

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
        <!-- Tonalidad de la canción — habilita las opciones "diatónicas" en
             el menú de referencia armónica (3ra, 5ta) sin tener que adivinar
             si la canción está en mayor o menor. El valor visible refleja
             la tonalidad EFECTIVA (incluyendo el shift de TONO), no la
             original; si subes/bajas semitonos, el selector se actualiza. -->
        <div class="stems-field stems-field--select" title="Tonalidad de la canción (habilita armonías diatónicas)">
          <label>TONALIDAD</label>
          <select id="stems-key">
            <option value="">—</option>
            <option value="" disabled>── Mayores ──</option>
            <option value="C">C</option><option value="C#">C#</option>
            <option value="D">D</option><option value="D#">D#</option>
            <option value="E">E</option><option value="F">F</option>
            <option value="F#">F#</option><option value="G">G</option>
            <option value="G#">G#</option><option value="A">A</option>
            <option value="A#">A#</option><option value="B">B</option>
            <option value="" disabled>── Menores ──</option>
            <option value="Am">Am</option><option value="A#m">A#m</option>
            <option value="Bm">Bm</option><option value="Cm">Cm</option>
            <option value="C#m">C#m</option><option value="Dm">Dm</option>
            <option value="D#m">D#m</option><option value="Em">Em</option>
            <option value="Fm">Fm</option><option value="F#m">F#m</option>
            <option value="Gm">Gm</option><option value="G#m">G#m</option>
          </select>
        </div>
        <!-- Transposer master — shift de ±12 semitonos aplicado a TODAS las
             pistas del proyecto sin alterar el tempo. Igual idea que el
             reproductor de Pads; la diferencia es que aquí el render es
             offline por pista (ver setStemsPitchShift), no en tiempo real.
             Label "TRANSPONER" en vez de "TONO" porque al lado vive
             "TONALIDAD" (la clave musical) y los dos términos chocaban. -->
        <div class="stems-field stems-field--pitch" title="Transponer: fijá ±N semitonos y tocá Aplicar (el render es offline por pista). Doble clic en el número para resetear.">
          <label>TRANSPONER</label>
          <div class="stems-pitch-group" id="stems-pitch-group">
            <button class="stems-pitch-btn" id="stems-pitch-down" type="button" title="Bajar 1 semitono">▼</button>
            <span class="stems-pitch-val" id="stems-pitch-val" title="Semitonos (doble clic para resetear)">0</span>
            <button class="stems-pitch-btn" id="stems-pitch-up" type="button" title="Subir 1 semitono">▲</button>
          </div>
          <button class="stems-pitch-apply" id="stems-pitch-apply" type="button" title="Aplicar la transposición a todas las pistas" hidden>Aplicar</button>
        </div>
      </div>

      <div class="stems-tb-mid">
        <button class="stems-tb-btn" id="stems-restart" title="Volver al inicio (sin detener)" disabled>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polygon points="19 20 9 12 19 4 19 20" fill="currentColor"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        <button class="stems-tb-btn" id="stems-stop" title="Stop (vuelve al inicio)">${SVG_STOP}</button>
        <button class="stems-tb-btn stems-tb-btn--play" id="stems-play" title="Play / Pausa" disabled>${SVG_PLAY}</button>
        <span class="stems-tb-time" id="stems-tb-time" title="Posición / duración total">
          <span id="stems-tb-cur">0:00</span><span class="stems-tb-time-sep">/</span><span id="stems-tb-total">0:00</span>
        </span>
      </div>
    </header>

    <!-- Fila única de acciones (antes había dos filas: proyecto y tools).
         Las 3 secciones se separan con un divider vertical y la fila usa
         flex-wrap para no romperse en viewports estrechos. -->
    <header class="stems-actions stems-actions--unified">
      <div class="stems-actions-primary">
        <button class="stems-btn stems-btn--primary" id="stems-import">${SVG_PLUS} Importar stems</button>
        <button class="stems-btn stems-btn--ghost" id="stems-export" disabled>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Exportar MP3
        </button>
        <button class="stems-btn stems-btn--primary" id="stems-assign" disabled title="Renderiza la mezcla y la asigna directo a una canción (Secuencia u Original), copiándola a la librería de OneDrive">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          Asignar a canción
        </button>
        <input type="file" id="stems-file-input" accept="audio/*" multiple hidden>
        <span class="stems-actions-divider" aria-hidden="true"></span>
        <input class="stems-project-name" id="stems-project-name" value="Mi proyecto" spellcheck="false" title="Nombre del proyecto">
        <div class="stems-proj-menu">
          <button class="stems-btn stems-btn--subtle" id="stems-proj-toggle" title="Proyecto…">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="10" height="10" style="margin-left:2px;opacity:.7"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="stems-proj-dropdown" id="stems-proj-dropdown" hidden>
            <button data-proj-cmd="new"     class="stems-proj-item">Nuevo (vaciar actual)</button>
            <button data-proj-cmd="save-as" class="stems-proj-item">Guardar como…</button>
            <button data-proj-cmd="open"    class="stems-proj-item">Abrir proyecto…</button>
          </div>
        </div>
      </div>

      <span class="stems-actions-divider" aria-hidden="true"></span>

      <div class="stems-tools-group">
        <span class="stems-tools-label">PISTAS</span>
        <select id="stems-click-sound" class="stems-mini-select" aria-label="Sonido del click" title="Sonido del click"></select>
        <div class="stems-accent" id="stems-accent" title="Acentos: marca qué tiempos del compás suenan acentuados"></div>
        <div class="stems-generators-wrap">
          <button class="stems-btn stems-btn--subtle" id="stems-generators-trigger" type="button" title="Generar Click o Guía" aria-haspopup="menu" aria-expanded="false">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            Generar
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="10" height="10" style="margin-left:2px;opacity:.7"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Popover con las acciones — los botones originales viven aquí
                con sus IDs intactos para que el mapeo MIDI y el resto del
                código siga apuntando al mismo lugar. -->
          <div class="stems-generators-pop hidden" id="stems-generators-pop" role="menu">
            <button class="stems-btn stems-btn--subtle" id="stems-add-click" title="Genera un click track al BPM actual">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><circle cx="12" cy="12" r="9"/><line x1="12" y1="5" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
              Generar Click
            </button>
            <button class="stems-btn stems-btn--subtle" id="stems-rebuild-guide" title="Regenera la pista de guía con los marcadores actuales">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
              Generar Guía
            </button>
          </div>
        </div>
      </div>

      <span class="stems-actions-divider" aria-hidden="true"></span>

      <div class="stems-tools-group">
        <span class="stems-tools-label">MARCADORES</span>
        <select id="stems-section-select" class="stems-mini-select" aria-label="Sección"></select>
        <button class="stems-btn stems-btn--accent" id="stems-add-marker" title="Añadir marcador en el tiempo actual">
          ${SVG_FLAG} Añadir
        </button>
        <button class="stems-btn stems-btn--subtle" id="stems-detect-sections" title="Analiza la canción y coloca marcadores en los cambios de sección (puedes editarlos a mano)">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M12 3v18"/><path d="M3 8h4"/><path d="M17 8h4"/><path d="M3 14h4"/><path d="M17 14h4"/><circle cx="12" cy="8" r="1.6"/><circle cx="12" cy="16" r="1.6"/></svg>
          Detectar secciones
        </button>
        <div class="stems-loop-group" title="Loop A-B: marca un punto A y un punto B en el tiempo actual, luego activa Loop">
          <button class="stems-btn stems-btn--subtle stems-loop-ab" id="stems-loop-a" type="button" title="Marcar punto A en el tiempo actual (vacío)">A</button>
          <button class="stems-btn stems-btn--subtle stems-loop-ab" id="stems-loop-b" type="button" title="Marcar punto B en el tiempo actual (vacío)">B</button>
          <button class="stems-btn stems-btn--subtle" id="stems-loop-toggle" title="Activar/desactivar loop (entre A-B o marcadores)">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            Loop
          </button>
        </div>
      </div>

      <span class="stems-actions-divider" aria-hidden="true"></span>

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
        <button class="stems-piano-btn" id="stems-piano-toggle" type="button" title="Piano virtual — toca/graba con tu controlador MIDI" aria-pressed="false" aria-label="Piano virtual">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>
        </button>
        <div class="stems-readout">
          <span class="label">TIMECODE</span>
          <span class="value mono" id="stems-timecode">00:00.000</span>
        </div>
        <span class="stems-state-pill" id="stems-state-pill">DETENIDO</span>
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
          <button class="stems-console-toggle" id="stems-console-toggle" type="button" title="Contraer / expandir consola" aria-label="Contraer consola">
            <span class="stems-console-collapse" id="stems-console-collapse" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
            <span class="stems-console-title">CONSOLA</span>
            <span class="stems-console-count" id="stems-console-count">0 pistas</span>
          </button>
          <button class="stems-console-selall" id="stems-console-selall" type="button" title="Seleccionar todas las pistas (Ctrl+A)">Seleccionar todas</button>
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

    <!-- Panel del piano virtual (oculto por defecto; lo construye pianoPanel.js). -->
    <section class="stems-piano" id="stems-piano" hidden></section>

    </div><!-- /stems-main -->

    <!-- Barra de multi-selección de pistas (Ctrl/Cmd + clic para elegir varias). -->
    <div class="stems-sel-bar" id="stems-sel-bar" hidden>
      <span class="stems-sel-count">0 pistas seleccionadas</span>
      <button class="stems-sel-del" id="stems-sel-del" type="button">Eliminar</button>
      <button class="stems-sel-clear" id="stems-sel-clear" type="button" aria-label="Cancelar selección" title="Cancelar selección (Esc)">✕</button>
    </div>

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

// Drag-and-drop para reordenar los strips de la consola, espejo de wireRowReorder
// pero en horizontal. El handle es la cabecera del strip (no los controles), para
// no chocar con el fader/pan/mute/solo. En el drop reordenamos el engine y las
// filas del timeline para que ambos lados queden en lockstep.
function wireConsoleReorder(root) {
  const list = root.querySelector('#stems-console-strips');
  if (!list) return;
  let dragging = null;

  list.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('[data-drag-strip]');
    if (!handle) return;
    dragging = handle.closest('.stems-console-strip');
    if (!dragging) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging.dataset.trackId);
    requestAnimationFrame(() => dragging.classList.add('is-dragging'));
  });
  list.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('is-dragging');
    dragging = null;
    qa('.stems-console-strip.is-drop-target', list).forEach(s => s.classList.remove('is-drop-target'));
  });
  list.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest('.stems-console-strip');
    if (!over || over === dragging) return;
    const rect = over.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;   // horizontal
    qa('.stems-console-strip.is-drop-target', list).forEach(s => s.classList.remove('is-drop-target'));
    over.classList.add('is-drop-target');
    if (before) over.parentNode.insertBefore(dragging, over);
    else over.parentNode.insertBefore(dragging, over.nextSibling);
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    qa('.stems-console-strip.is-drop-target', list).forEach(s => s.classList.remove('is-drop-target'));
    const newOrder = Array.from(list.querySelectorAll('.stems-console-strip')).map(s => s.dataset.trackId);
    engine.reorderTracks(newOrder);
    // Espejar el nuevo orden a las filas del timeline.
    const rows = document.getElementById('stems-rows');
    if (rows) {
      for (const id of newOrder) {
        const r = rows.querySelector(`.stems-row[data-track-id="${id}"]`);
        if (r) rows.appendChild(r);
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
  // Setea el nivel (0..1) recortando desde arriba con clip-path → compositor,
  // sin layout. inset(100% ...) = 0 (todo recortado); inset(0 ...) = lleno.
  const setLevel = (lvl) => {
    el.style.clipPath = `inset(${100 - Math.min(100, lvl * 100)}% 0 0 0)`;
  };
  const tick = () => {
    if (!engine.isCurrentlyPlaying()) {
      // Decay smoothly to 0, then STOP the loop so it doesn't burn a frame
      // every tick forever (it used to run even back in the Pads workspace).
      if (meterPeakSmoothed > 0.02) {
        meterPeakSmoothed *= 0.9;
        setLevel(meterPeakSmoothed);
        meterRAF = requestAnimationFrame(tick);
      } else {
        setLevel(0);
        meterRAF = null; // idle → stop until playback resumes
      }
      return;
    }
    const { peak } = engine.getMasterLevel();
    // Attack fast, release slow — same envelope a real VU has.
    if (peak > meterPeakSmoothed) meterPeakSmoothed = peak;
    else meterPeakSmoothed = meterPeakSmoothed * 0.85 + peak * 0.15;
    setLevel(meterPeakSmoothed);
    meterRAF = requestAnimationFrame(tick);
  };
  meterRAF = requestAnimationFrame(tick);
}

// Click on any timeline area (ruler, marker layer, or a lane) jumps the
// transport to that time. The sticky-left strip column is excluded — the
// closest() check below scopes it to lanes / head-tl only.
function wireSeekClicks(root) {
  root.addEventListener('click', (e) => {
    // Clic en los controles de la fila (timeline) → enfocar/resaltar la pista
    // también, no solo al clickear el lane. Sin scroll (la fila ya está a la
    // vista) y sin seek (no es una zona de tiempo). Los controles siguen
    // funcionando: solo agregamos el resaltado.
    const stripEl = e.target.closest('.stems-row-strip');
    if (stripEl) {
      const rowS = stripEl.closest('.stems-row');
      if (rowS?.dataset.trackId) locateTrackRow(rowS.dataset.trackId, { scroll: false });
      return;
    }
    if (e.target.closest('.stems-row-remove')) return; // remove button bubbles
    if (e.target.closest('.stems-marker-remove')) return;
    if (e.target.closest('input, select, button')) return;
    const lane = e.target.closest('.stems-row-lane') ||
                 e.target.closest('.stems-head-tl');
    if (!lane) return;
    // Clic en una pista del timeline → también la enfoca/resalta, igual que al
    // hacer clic en su strip de la consola. (El ruler/head-tl no es una pista.)
    const rowEl = lane.closest('.stems-row');
    if (rowEl?.dataset.trackId) locateTrackRow(rowEl.dataset.trackId, { scroll: false });
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
let _lastFollowTs = 0;
function autoFollowPlayhead(sec) {
  if (!engine.isCurrentlyPlaying()) return;
  // The playhead bar itself moves every frame (cheap GPU transform); the
  // timeline auto-scroll reads layout (clientWidth/scrollWidth = reflow), so
  // we throttle it to ~30fps — plenty for follow, half the reflows.
  const now = performance.now();
  if (now - _lastFollowTs < 33) return;
  _lastFollowTs = now;
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
      bpmFloat = v; // manual entry → the integer IS the precise tempo
      drawRuler();
      scheduleSave();
    }
  });
  bpmInput.addEventListener('change', () => {
    if (bpm === bpmBefore) return;
    const oldBpm = bpmBefore, newBpm = bpm;
    pushHistory('Cambiar BPM',
      () => { bpm = oldBpm; bpmFloat = oldBpm; bpmInput.value = oldBpm; drawRuler(); scheduleSave(); },
      () => { bpm = newBpm; bpmFloat = newBpm; bpmInput.value = newBpm; drawRuler(); scheduleSave(); }
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
    accentPattern = makeDefaultAccent(beatsPerBar);
    renderAccentChips();
    drawRuler();
    scheduleSave();
    pushHistory('Cambiar compás',
      () => {
        const om = oldSig.match(/^(\d+)\s*\/\s*(\d+)$/);
        beatsPerBar = parseInt(om[1], 10); beatValue = parseInt(om[2], 10);
        accentPattern = makeDefaultAccent(beatsPerBar); renderAccentChips();
        sigInput.value = oldSig; drawRuler(); scheduleSave();
      },
      () => {
        beatsPerBar = parseInt(m[1], 10); beatValue = parseInt(m[2], 10);
        accentPattern = makeDefaultAccent(beatsPerBar); renderAccentChips();
        sigInput.value = newSig; drawRuler(); scheduleSave();
      }
    );
    sigBefore = newSig;
  });

  // Play = play/pausa en el mismo botón (como en Pads): el icono alterna en
  // applyPlayingState. Ya no hay botón de pausa exclusivo.
  root.querySelector('#stems-play').onclick = () => {
    if (engine.isCurrentlyPlaying()) engine.pause();
    else { resumeAutoFollow(); engine.play(); }
  };
  root.querySelector('#stems-stop').onclick = () => { resumeAutoFollow(); engine.stop(); };
  // Volver al inicio SIN detener: si está sonando, sigue desde 0; si está en
  // pausa, queda en 0. (Stop, en cambio, detiene.)
  root.querySelector('#stems-restart').onclick = () => { resumeAutoFollow(); engine.seek(0); };
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
    toast('Importa primero un stem para detectar el BPM.', 'warning');
    return;
  }
  const btn = document.getElementById('stems-bpm-detect');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  // Dos RAFs para que la pintura del texto ocurra ANTES del crunch (un solo
  // RAF a veces se intercala con el trabajo y el flash sigue siendo visible).
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    try {
      const buf = engine.getTrackBuffer(stemTrack.id);
      const result = detectTempoMeter(buf);
      if (!result || !result.bpm) {
        toast('No se pudo detectar un BPM claro. Prueba con una pista más percusiva (drums, click, bajo).', 'warning');
        return;
      }
      const detected = result.bpm;
      const detectedSig = result.signature || `${beatsPerBar}/${beatValue}`;
      const detectedFloat = result.bpmFloat || detected;
      const oldBpm = bpm, oldBpmFloat = bpmFloat, oldSig = `${beatsPerBar}/${beatValue}`;
      if (detected === bpm && detectedSig === oldSig) {
        toast(`Ya coincide con lo actual (${detected} BPM, ${oldSig}).`, 'info');
        return;
      }
      const ok = await confirmDialogAsync({
        title: 'Aplicar BPM detectado',
        message: `Detectado: ${detected} BPM · compás ${detectedSig}. ¿Aplicarlo?\nActual: ${oldBpm} BPM · ${oldSig}.`,
        confirmLabel: 'Aplicar', danger: false,
      });
      if (!ok) return;

      const apply = (b, sig, bFloat) => {
        bpm = b;
        bpmFloat = bFloat || b;
        const [bp, bv] = sig.split('/').map(n => parseInt(n, 10));
        if (bp) beatsPerBar = bp;
        if (bv) beatValue = bv;
        accentPattern = makeDefaultAccent(beatsPerBar);
        renderAccentChips();
        const input = document.getElementById('stems-bpm');
        if (input) input.value = b;
        const sigSel = document.getElementById('stems-sig');
        if (sigSel) sigSel.value = sig;
        drawRuler();
      };
      apply(detected, detectedSig, detectedFloat);
      pushHistory('Detectar BPM y compás',
        () => { apply(oldBpm, oldSig, oldBpmFloat); scheduleSave(); },
        () => { apply(detected, detectedSig, detectedFloat); scheduleSave(); }
      );
      scheduleSave();
    } catch (e) {
      console.error('BPM detection failed:', e);
      toast('Error detectando BPM: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="11" height="11"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg> Detectar`;
      }
    }
  }));
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
    const willOpen = projDropdown.hidden;
    projDropdown.hidden = !willOpen;
    if (willOpen) {
      // Posiciona en coords absolutas porque el dropdown ahora es
      // position:fixed (escape del overflow:hidden del .stems-deck).
      const r = projToggle.getBoundingClientRect();
      projDropdown.style.left = `${r.left}px`;
      projDropdown.style.top  = `${r.bottom + 4}px`;
      requestAnimationFrame(() => {
        const dr = projDropdown.getBoundingClientRect();
        if (dr.right > window.innerWidth) projDropdown.style.left = `${window.innerWidth - dr.width - 8}px`;
      });
    }
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
      const ok = await confirmDialogAsync({
        title: 'Vaciar proyecto',
        message: '¿Vaciar el proyecto actual? Esta acción no se puede deshacer.',
        confirmLabel: 'Vaciar', danger: true,
      });
      if (!ok) return;
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
  root.querySelector('#stems-assign').onclick = async () => {
    if (engine.getTracks().length === 0) return;
    await runExport({ assign: true });
  };

  // Selector de tonalidad del proyecto. El usuario PICKEA la tonalidad
  // efectiva (lo que oye); internamente guardamos la "original" para que
  // las armonías diatónicas y el display sigan coherentes cuando se
  // transponga con TONO.
  const keySel = root.querySelector('#stems-key');
  if (keySel) {
    paintEffectiveKeyUI();
    keySel.onchange = () => {
      const effective = keySel.value || null;
      const old = projectKey;
      // Si transpose está en +N, lo que el usuario picó (efectiva) ES
      // (original + N). Para guardar original = picked - N.
      projectKey = effective ? transposeKey(effective, -currentStemsPitch) : null;
      pushHistory('Cambiar tonalidad',
        () => { projectKey = old; paintEffectiveKeyUI(); scheduleSave(); },
        () => { projectKey = effective ? transposeKey(effective, -currentStemsPitch) : null; paintEffectiveKeyUI(); scheduleSave(); }
      );
      scheduleSave();
    };
  }

  // Grupo de tono master.
  const pitchUp = root.querySelector('#stems-pitch-up');
  const pitchDown = root.querySelector('#stems-pitch-down');
  const pitchVal = root.querySelector('#stems-pitch-val');
  // ▼/▲ solo ajustan el valor PENDIENTE (sin procesar). El render offline (caro)
  // se dispara una sola vez con el botón "Aplicar". Doble clic resetea (a 0 es
  // instantáneo, restaura los originales).
  if (pitchUp)   pitchUp.onclick   = () => adjustPendingPitch(1);
  if (pitchDown) pitchDown.onclick = () => adjustPendingPitch(-1);
  if (pitchVal)  pitchVal.ondblclick = () => { pendingPitch = 0; setStemsPitchShift(0); };
  const pitchApply = root.querySelector('#stems-pitch-apply');
  if (pitchApply) pitchApply.onclick = () => setStemsPitchShift(pendingPitch);

  // Popover "Generar" — agrupa Click + Guía para descongestionar la fila.
  const genTrigger = root.querySelector('#stems-generators-trigger');
  const genPop = root.querySelector('#stems-generators-pop');
  if (genTrigger && genPop) {
    const closeGenPop = () => {
      genPop.classList.add('hidden');
      genTrigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocGen, true);
    };
    const onDocGen = (ev) => {
      if (genTrigger.contains(ev.target) || genPop.contains(ev.target)) return;
      closeGenPop();
    };
    genTrigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = !genPop.classList.contains('hidden');
      if (isOpen) { closeGenPop(); return; }
      genPop.classList.remove('hidden');
      genTrigger.setAttribute('aria-expanded', 'true');
      // position:fixed → calculamos coords contra el rect del trigger
      // para que el popover escape del overflow:hidden del .stems-deck.
      const r = genTrigger.getBoundingClientRect();
      genPop.style.left = `${r.left}px`;
      genPop.style.top  = `${r.bottom + 4}px`;
      requestAnimationFrame(() => {
        const pr = genPop.getBoundingClientRect();
        if (pr.right > window.innerWidth) genPop.style.left = `${window.innerWidth - pr.width - 8}px`;
      });
      setTimeout(() => document.addEventListener('mousedown', onDocGen, true), 0);
    };
    // Cerrar también al elegir una acción adentro.
    genPop.addEventListener('click', (e) => {
      if (e.target.closest('button')) closeGenPop();
    });
  }

  root.querySelector('#stems-add-click').onclick = () => onAddClickTrack();
  root.querySelector('#stems-add-marker').onclick = () => onAddMarker();
  root.querySelector('#stems-detect-sections').onclick = () => onDetectSections();
  root.querySelector('#stems-rebuild-guide').onclick = () => onRebuildGuide();
  root.querySelector('#stems-loop-toggle').onclick = () => toggleLoop();

  // Loop A-B "libres" — dropear al tiempo actual, doble-clic para limpiar.
  // Si después de setear ambos el loop no estaba activo, lo activamos
  // automáticamente: el usuario quería loop, no marcar puntos por nada.
  const loopABtn = root.querySelector('#stems-loop-a');
  const loopBBtn = root.querySelector('#stems-loop-b');
  if (loopABtn) {
    loopABtn.onclick = () => {
      freeLoopA = engine.getCurrentSec();
      if (freeLoopA != null && freeLoopB != null && !loopEnabled) {
        loopEnabled = true;
      }
      syncLoopRegion();
    };
    loopABtn.ondblclick = () => {
      freeLoopA = null;
      syncLoopRegion();
    };
  }
  if (loopBBtn) {
    loopBBtn.onclick = () => {
      freeLoopB = engine.getCurrentSec();
      if (freeLoopA != null && freeLoopB != null && !loopEnabled) {
        loopEnabled = true;
      }
      syncLoopRegion();
    };
    loopBBtn.ondblclick = () => {
      freeLoopB = null;
      syncLoopRegion();
    };
  }

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

// Beat-accent chips — one per beat in the bar. Click to toggle which beats
// carry the accent sample. Rebuilt whenever beatsPerBar changes.
function renderAccentChips() {
  const box = document.getElementById('stems-accent');
  if (!box) return;
  if (accentPattern.length !== beatsPerBar) accentPattern = makeDefaultAccent(beatsPerBar);
  box.innerHTML = '';
  for (let i = 0; i < beatsPerBar; i++) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stems-accent-chip' + (accentPattern[i] ? ' is-on' : '');
    chip.textContent = String(i + 1);
    chip.title = `Tiempo ${i + 1} — clic para acentuar`;
    chip.onclick = () => {
      accentPattern[i] = !accentPattern[i];
      chip.classList.toggle('is-on', accentPattern[i]);
      scheduleSave();
    };
    box.appendChild(chip);
  }
}

// ── Import + track strip rendering ────────────────────────────────
// Estado de la importación en curso, para poder cancelarla con Esc si se
// queda colgada (antes había que recargar toda la interfaz con Ctrl+R).
let importInProgress = false;
let importAbort = false;

// Cancela la importación en curso: oculta el overlay al instante y marca el
// abort para que el bucle corte en el próximo archivo. La invoca el pánico de
// Esc (stemsPanicStop). No-op si no hay importación activa.
export function cancelImport() {
  if (!importInProgress) return false;
  importAbort = true;
  hideImportOverlay();
  toast('Importación cancelada');
  return true;
}

async function importFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const files = Array.from(fileList).filter(f =>
    f.type.startsWith('audio/') || /\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(f.name)
  );
  if (!files.length) return;

  importInProgress = true;
  importAbort = false;
  showImportOverlay(files.length);
  // Yield two frames so the overlay actually paints before we hit the
  // synchronous-heavy decode work (decodeAudioData can briefly block).
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let done = 0;
  try {
   for (const file of files) {
    if (importAbort) break;   // Esc canceló: no procesar más archivos
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
      const raw = String(err && err.message || err);
      // El error nativo de decode ("Unable to decode audio data") no le dice
      // nada al usuario; lo traducimos a algo accionable.
      const msg = /decode/i.test(raw)
        ? `No se pudo importar "${file.name}": formato de audio no soportado o archivo dañado. Probá reexportarlo como WAV 16-bit o MP3.`
        : `No se pudo importar "${file.name}": ${raw}`;
      toast(msg);
    }
    done++;
    updateImportOverlay(done, files.length, '');
   }
  } finally {
    importInProgress = false;
  }
  // Si Esc canceló, el overlay ya se ocultó; si no, dejamos el estado "Listo"
  // un instante para que un import rápido no sea solo un parpadeo.
  if (!importAbort) {
    await new Promise(r => setTimeout(r, 350));
    hideImportOverlay();
  }
  // Conservamos lo que SÍ se importó (incluso tras un abort) y lo guardamos.
  refreshTransport();
  // La consola ya está visible y con layout: repinta los faders por si alguno
  // se creó sin alto (import en lote) y se quedó sin el relleno amarillo.
  requestAnimationFrame(repaintAllFaders);
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
        <button type="button" class="stems-import-cancel" id="stems-import-cancel">Cancelar (Esc)</button>
      </div>
    `;
    overlay.querySelector('#stems-import-cancel').addEventListener('click', () => cancelImport());
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

// Overlay de "Cargando proyecto…" al reabrir/refrescar con un proyecto guardado.
// Mismo shell visual que el de importar, con su propio texto y progreso por pista.
function showRestoreOverlay(total) {
  let overlay = document.getElementById('stems-restore-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'stems-restore-overlay';
    overlay.className = 'stems-export-overlay';
    overlay.innerHTML = `
      <div class="stems-export-panel">
        <div class="stems-spinner" aria-hidden="true"></div>
        <h3>Cargando proyecto…</h3>
        <p id="stems-restore-stage" class="stems-export-stage">Preparando pistas</p>
        <div class="stems-export-bar"><div class="stems-export-fill" id="stems-restore-fill"></div></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;
  updateRestoreOverlay(0, total);
}
function updateRestoreOverlay(done, total) {
  const fill = document.getElementById('stems-restore-fill');
  const stage = document.getElementById('stems-restore-stage');
  if (!fill) return;
  fill.style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
  if (stage) stage.textContent = total > 0
    ? (done >= total ? 'Listo' : `Cargando pistas… ${done}/${total}`)
    : 'Cargando…';
}
function hideRestoreOverlay() {
  const overlay = document.getElementById('stems-restore-overlay');
  if (overlay) overlay.hidden = true;
}

function appendTrackRow(id, savedPath) {
  const track = engine.getTracks().find(t => t.id === id);
  if (!track) return;

  const empty = document.getElementById('stems-empty');
  if (empty) empty.hidden = true;
  // Marca el shell como "con pistas" para que el CSS (a) muestre la consola
  // y (b) deje la timeline scrollable. Cuando está vacío, ambos colapsan.
  document.getElementById('workspace-stems')?.classList.add('has-tracks');

  // Si hay un pitch master activo, la pista recién añadida debe quedar al
  // mismo tono que las demás. Se hace en background para no bloquear la
  // adición; el usuario verá el toast de "Procesando…".
  if (currentStemsPitch !== 0) {
    const buf = engine.getTrackBuffer(id);
    if (buf) {
      originalBuffers.set(id, buf);
      (async () => {
        try {
          const { pitchShiftBuffer } = await import('./harmonyShifter.js');
          const shifted = await pitchShiftBuffer(buf, currentStemsPitch);
          engine.replaceTrackBuffer(id, shifted);
          peaksCache.delete(id);
          drawTrackWaveform(id);
        } catch (e) { console.warn('Auto-shift on new track failed:', e); }
      })();
    }
  }

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
      if (snapToBeat) newOffset = Math.round(newOffset / (60 / bpmFloat)) * (60 / bpmFloat);
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

// Etiqueta legible del tipo de pista. Usada en row, strip y console por
// igual; antes el ternario vivía duplicado en cada builder.
function kindLabelFor(track) {
  return track.kind === 'click' ? 'CLICK'
       : track.kind === 'guide' ? 'GUÍA'
       : track.kind === 'midi'  ? 'MIDI'
       : 'AUDIO';
}

function buildConsoleStripHtml(track) {
  const kindLabel = kindLabelFor(track);
  const volPct = Math.round(track.volume * 100);
  return `
    <header class="stems-console-strip-head" draggable="true" data-drag-strip title="Arrastra para reordenar">
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

function paintFader(faderEl, v, _tries = 0) {
  const h = faderEl.clientHeight;
  if (h === 0) {
    // Layout aún no listo (típico al importar varios stems de golpe: el rAF
    // corre mientras el overlay cubre la consola y la tira no tiene alto).
    // Reintenta unos frames en vez de abandonar, si no el relleno amarillo
    // nunca se pinta aunque el valor (data-value) sí quede en 85.
    if (_tries < 60) requestAnimationFrame(() => paintFader(faderEl, v, _tries + 1));
    return;
  }
  const travel = h - FADER_PAD * 2 - FADER_HANDLE;
  const handle = faderEl.querySelector('.stems-cfader-handle');
  const fill = faderEl.querySelector('.stems-cfader-fill');
  const handleBottom = FADER_PAD + (v / 100) * travel;
  if (handle) handle.style.bottom = `${handleBottom}px`;
  if (fill) fill.style.height = `${(handleBottom - FADER_PAD) + FADER_HANDLE / 2}px`;
  faderEl.dataset.value = v;
  faderEl.setAttribute('aria-valuenow', v);
}

// Repinta TODOS los faders de la consola desde su data-value. Se llama cuando
// el layout pudo no estar listo al crearlos (import en lote) o al volver a
// mostrarse la consola (expandir), para que el relleno amarillo quede correcto.
function repaintAllFaders() {
  document.querySelectorAll('#stems-console-strips .stems-cfader').forEach((faderEl) => {
    const v = parseInt(faderEl.dataset.value, 10);
    if (!Number.isNaN(v)) paintFader(faderEl, v);
  });
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
// Resalta la pista del timeline que corresponde a un strip de la consola y la
// trae al tope del área de arrastre, para que el usuario vea de inmediato qué
// pista está tocando en la consola. Capa propia (.is-located) — independiente
// de la multi-selección (.is-selected) de Ctrl+clic.
function locateTrackRow(id, { scroll = true } = {}) {
  const entry = trackRows.get(id);
  if (!entry || !entry.row) return;
  document.querySelectorAll('#stems-rows .stems-row.is-located')
    .forEach(r => r.classList.remove('is-located'));
  document.querySelectorAll('#stems-console-strips .stems-console-strip.is-located')
    .forEach(s => s.classList.remove('is-located'));
  entry.row.classList.add('is-located');
  if (entry.console) entry.console.classList.add('is-located');
  // Desde la consola (scroll:true) traemos la fila al tope para ubicarla. Desde
  // un clic en el propio timeline (scroll:false) NO scrolleamos: la fila ya está
  // a la vista y saltarla sería molesto. Durante la reproducción tampoco se sube
  // al tope (el auto-follow reescribe scrollLeft y producía un pestañeo).
  let playing = false;
  try { playing = engine.isCurrentlyPlaying(); } catch (_) {}
  if (scroll && !playing) entry.row.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Iconos del menú contextual del strip (los mismos que las acciones de la fila).
const ICON_MENU_PR   = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>';
const ICON_MENU_SEP  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
const ICON_MENU_HARM = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_MENU_EXP  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

// Menú contextual (clic derecho) de un strip de la consola: ofrece las mismas
// acciones que la fila de la pista (separar, armónica, exportar, eliminar, o
// editar notas si es MIDI), en el dropdown discreto de las tarjetas. Cada item
// dispara el botón real de la fila para reusar toda su lógica (confirmaciones,
// re-bounce, etc.).
function openStripContextMenu(anchorEl, id) {
  const entry = trackRows.get(id);
  if (!entry || !entry.row) return;
  locateTrackRow(id, { scroll: false });
  const row = entry.row;
  const btn = (a) => row.querySelector(`[data-action="${a}"]`);
  // (locate sin scroll arriba: un scrollIntoView dispara eventos de scroll que
  //  cerrarían el menú recién abierto → hacía falta un segundo clic.)
  const items = [];
  if (btn('piano-roll')) items.push({ icon: ICON_MENU_PR,   label: 'Editar notas (piano roll)', onSelect: () => btn('piano-roll').click() });
  if (btn('separate'))   items.push({ icon: ICON_MENU_SEP,  label: 'Separar voz e instrumental', onSelect: () => btn('separate').click() });
  if (btn('harmony'))    items.push({ icon: ICON_MENU_HARM, label: 'Referencia armónica',        onSelect: () => btn('harmony').click() });
  if (btn('export'))     items.push({ icon: ICON_MENU_EXP,  label: 'Exportar pista a MP3',        onSelect: () => btn('export').click() });
  if (btn('remove'))     items.push({ icon: SVG_TRASH,      label: 'Eliminar pista', danger: true, onSelect: () => btn('remove').click() });
  if (items.length) openCardMoreMenu(anchorEl, items);
}

function wireConsoleStrip(strip, id) {
  if (!strip) return;
  // Clic en cualquier parte del strip (en captura, para anteceder al fader)
  // localiza y resalta su pista en el timeline. En clic DERECHO no scrolleamos:
  // el scroll dispararía el cierre del menú contextual (ver openStripContextMenu).
  strip.addEventListener('pointerdown', (e) => locateTrackRow(id, { scroll: e.button !== 2 }), true);
  // Clic derecho → menú con las acciones de la pista (mismo dropdown discreto).
  strip.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openStripContextMenu(strip, id);
  });
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
    reflectSoloHighlights();
    scheduleSave();
  };

  const soloBtn = strip.querySelector('[data-action="solo"]');
  soloBtn.onclick = () => {
    const next = !soloBtn.classList.contains('is-on');
    engine.setTrackSoloed(id, next);
    soloBtn.classList.toggle('is-on', next);
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


function buildRowHtml(track) {
  const kindLabel = kindLabelFor(track);
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
      ${track.kind === 'click' || track.kind === 'guide' ? '' :
        track.kind === 'midi' ? `
      <button class="stems-row-export" data-action="piano-roll" title="Editar notas (piano roll)">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>
      </button>` : `
      <button class="stems-row-export" data-action="separate" title="Separar en voz e instrumental (IA, local)">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
      </button>
      <button class="stems-row-export" data-action="harmony" title="Crear referencia armónica (pitch ±semitonos)">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
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
  const kindLabel = kindLabelFor(track);
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
      <button class="stems-ms stems-ms--mute ${track.muted ? 'is-on' : ''}" data-action="mute" title="Silenciar">M</button>
      <button class="stems-ms stems-ms--solo ${track.soloed ? 'is-on' : ''}" data-action="solo" title="Solo">S</button>
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
    const ok = await confirmDialogAsync({
      title: 'Eliminar pista',
      message: '¿Eliminar esta pista del proyecto?',
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
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
  const harmonyBtn = root.querySelector('[data-action="harmony"]');
  if (harmonyBtn) {
    harmonyBtn.onclick = (e) => {
      e.stopPropagation();
      openHarmonyMenu(harmonyBtn, id);
    };
  }
  const pianoRollBtn = root.querySelector('[data-action="piano-roll"]');
  if (pianoRollBtn) {
    pianoRollBtn.onclick = (e) => {
      e.stopPropagation();
      openPianoRollForTrack(id);
    };
  }

  // Click derecho en cualquier parte de la row → menú contextual con
  // todas las acciones de la pista en un solo lugar (export, separar,
  // armonía, renombrar, color, eliminar). Duplica los botones-icono pero
  // los hace descubribles con shortcut estándar de "right-click siempre".
  root.addEventListener('contextmenu', (e) => {
    // No interferir con el menú del input de nombre o el color picker.
    if (e.target.closest('input, [contenteditable="true"]')) return;
    e.preventDefault();
    openRowContextMenu(e.clientX, e.clientY, id);
  });
}

// Menú contextual de pista (click derecho en la row). Centraliza
// acciones que también viven en botones-icono, útil cuando la fila está
// estrecha o cuando el usuario prefiere "right-click for everything".
function openRowContextMenu(x, y, id) {
  document.getElementById('stems-row-ctx')?.remove();
  const track = engine.getTracks().find(t => t.id === id);
  if (!track) return;
  const isCueTrack = track.kind === 'click' || track.kind === 'guide';
  const menu = document.createElement('div');
  menu.id = 'stems-row-ctx';
  menu.className = 'stems-context-menu';
  menu.innerHTML = `
    <button data-cmd="export">Exportar esta pista a MP3</button>
    ${isCueTrack ? '' : '<button data-cmd="separate">Separar con IA…</button>'}
    ${isCueTrack ? '' : '<button data-cmd="harmony">Referencia armónica…</button>'}
    <div class="smc-sep"></div>
    <button data-cmd="rename">Renombrar pista</button>
    <button data-cmd="color">Cambiar color…</button>
    <div class="smc-sep"></div>
    <button data-cmd="remove" class="danger">Eliminar pista</button>
  `;
  document.body.appendChild(menu);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth)  menu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 8}px`;
  });
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);

  menu.querySelector('[data-cmd="export"]').onclick = async () => {
    close();
    const t = engine.getTracks().find(tr => tr.id === id);
    if (!t) return;
    await runExport({ onlyTrackIds: [id], suggestedName: `${projectName} - ${t.name}` });
  };
  menu.querySelector('[data-cmd="separate"]')?.addEventListener('click', () => {
    close();
    const row = trackRows.get(id)?.row;
    const anchor = row?.querySelector('[data-action="separate"]');
    if (anchor) openSeparateMenu(anchor, id);
  });
  menu.querySelector('[data-cmd="harmony"]')?.addEventListener('click', () => {
    close();
    const row = trackRows.get(id)?.row;
    const anchor = row?.querySelector('[data-action="harmony"]');
    if (anchor) openHarmonyMenu(anchor, id);
  });
  menu.querySelector('[data-cmd="rename"]').onclick = () => {
    close();
    const input = trackRows.get(id)?.row?.querySelector('.stems-row-name');
    if (input) { input.focus(); input.select(); }
  };
  menu.querySelector('[data-cmd="color"]').onclick = () => {
    close();
    const colorInput = trackRows.get(id)?.row?.querySelector('[data-action="color"]');
    if (colorInput) colorInput.click();
  };
  menu.querySelector('[data-cmd="remove"]').onclick = async () => {
    close();
    const ok = await confirmDialogAsync({
      title: 'Eliminar pista',
      message: '¿Eliminar esta pista del proyecto?',
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
    await removeTrackById(id);
  };
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
    <button data-mode="otros">Solo "Otros" (teclados, guitarras…) <span class="stems-ctx-hint">medio</span></button>
    <div class="stems-ctx-sep"></div>
    <button data-toggle="cpu" class="stems-ctx-toggle">${forceCpu ? '☑' : '☐'} Forzar CPU (sin GPU)</button>
    <button data-action="cloud" class="stems-ctx-toggle">☁ Separación en la nube${getCloudConfig() ? ' ✓' : '…'}</button>
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
  const cloudBtn = menu.querySelector('[data-action="cloud"]');
  if (cloudBtn) cloudBtn.onclick = (ev) => { ev.stopPropagation(); menu.remove(); openCloudConfigDialog(); };
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

// ── Hybrid cloud separation config ────────────────────────────────
// Stored in localStorage as { provider, apiKey }. When present + online, the
// separation routes to the cloud (with automatic local fallback on failure).
// Schema v1: { provider:string, apiKey:string }. Helper de storage envuelve
// el blob con su versión y descarta valores corruptos/incompatibles.
const CLOUD_CFG_KEY = 'livepads-stems-cloud';
const CLOUD_CFG_VERSION = 1;
function getCloudConfig() {
  const c = storageRead(CLOUD_CFG_KEY, {
    version: CLOUD_CFG_VERSION,
    fallback: null,
    // Migra cualquier clave legacy (string JSON sin wrapper) que ya tuviera
    // la forma { provider, apiKey }. Nada que tocar más allá de validarla.
    migrateLegacy: (val) => (val && val.apiKey && val.provider) ? val : null,
  });
  return (c && c.apiKey && c.provider) ? c : null;
}

// Minimal config dialog (Electron disables window.prompt, so we build our own).
function openCloudConfigDialog() {
  document.getElementById('stems-cloud-cfg')?.remove();
  const cur = getCloudConfig() || { provider: 'replicate', apiKey: '' };
  const overlay = document.createElement('div');
  overlay.id = 'stems-cloud-cfg';
  overlay.className = 'stems-cloud-overlay';
  overlay.innerHTML = `
    <div class="stems-cloud-panel" role="dialog" aria-modal="true">
      <h3>Separación en la nube</h3>
      <p>Con internet y una API key, la separación se hace en la nube (más rápida y con más stems, ej. "Otros" sin guitarra). Sin internet o sin key, se usa tu GPU/CPU local. La key se guarda solo en este equipo.</p>
      <label>Proveedor</label>
      <select id="cloud-provider">
        <option value="replicate"${cur.provider === 'replicate' ? ' selected' : ''}>Replicate (Demucs, pago por uso)</option>
      </select>
      <label>API key</label>
      <input id="cloud-key" type="password" placeholder="Pega tu token aquí" value="${cur.apiKey ? cur.apiKey.replace(/"/g, '&quot;') : ''}">
      <div class="stems-cloud-actions">
        <button id="cloud-clear" class="stems-btn stems-btn--subtle">Quitar</button>
        <span style="flex:1"></span>
        <button id="cloud-cancel" class="stems-btn stems-btn--subtle">Cancelar</button>
        <button id="cloud-save" class="stems-btn stems-btn--accent">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector('#cloud-cancel').onclick = close;
  overlay.querySelector('#cloud-clear').onclick = () => { storageRemove(CLOUD_CFG_KEY); close(); };
  overlay.querySelector('#cloud-save').onclick = () => {
    const provider = overlay.querySelector('#cloud-provider').value;
    const apiKey = overlay.querySelector('#cloud-key').value.trim();
    if (apiKey) storageWrite(CLOUD_CFG_KEY, { provider, apiKey }, { version: CLOUD_CFG_VERSION });
    else storageRemove(CLOUD_CFG_KEY);
    close();
  };
}

// ── Tono master (pitch shift offline en todas las pistas) ───────
// Aplica un desplazamiento de N semitonos a TODAS las pistas del proyecto
// sin alterar el tempo. A diferencia del player de Pads (que tiene un solo
// AudioBuffer y usa PitchShifter en tiempo real), el motor de Stems mezcla
// múltiples AudioBufferSourceNodes en paralelo — no podemos meter un
// PitchShifter al master sin reescribir la arquitectura de scheduling.
//
// Trade-off: el shift se hace offline (re-renderiza cada pista al cambiar
// el valor), con coste de 2-5 s por minuto de audio. A cambio: sync
// perfecto, sin glitches, ningún cambio en engine.js.
//
// Caching: los buffers originales se guardan en originalBuffers la primera
// vez que se pide un shift; volver a 0 restaura instantáneamente.
const originalBuffers = new Map();   // trackId → AudioBuffer original
let currentStemsPitch = 0;   // semitonos APLICADOS (lo que realmente suena)
let pendingPitch = 0;        // valor en la UI, todavía sin aplicar
let pitchApplying = false;

// Ajusta el valor pendiente del transposer (sin procesar audio). El render se
// dispara después con "Aplicar".
function adjustPendingPitch(delta) {
  if (pitchApplying) return;
  pendingPitch = Math.max(-12, Math.min(12, pendingPitch + delta));
  paintStemsPitchUI();
}

function paintStemsPitchUI() {
  const lbl = document.getElementById('stems-pitch-val');
  const applyBtn = document.getElementById('stems-pitch-apply');
  const dirty = pendingPitch !== currentStemsPitch;   // hay un cambio sin aplicar
  if (lbl) {
    lbl.textContent = pendingPitch > 0 ? '+' + pendingPitch : String(pendingPitch);
    lbl.classList.toggle('shifted', pendingPitch !== 0);
  }
  document.getElementById('stems-pitch-group')?.classList.toggle('shifted', pendingPitch !== 0);
  if (applyBtn) applyBtn.hidden = !dirty;
}

async function setStemsPitchShift(semitones) {
  semitones = Math.max(-12, Math.min(12, semitones | 0));
  if (semitones === currentStemsPitch) return;
  if (pitchApplying) { toast('Espera a que termine la aplicación anterior.', 'warning'); return; }
  const trackList = engine.getTracks();
  if (!trackList.length) {
    // Sin pistas todavía: solo actualiza el valor y la UI. Cuando lleguen,
    // se aplicará al import (ver appendTrackRow más abajo).
    currentStemsPitch = semitones;
    pendingPitch = semitones;
    paintStemsPitchUI();
    paintEffectiveKeyUI();
    return;
  }

  const wasPlaying = engine.isCurrentlyPlaying();
  const curSec = engine.getCurrentSec();
  if (wasPlaying) engine.pause();

  // Guarda originales la primera vez que vemos cada pista.
  trackList.forEach(t => {
    if (!originalBuffers.has(t.id)) {
      const b = engine.getTrackBuffer(t.id);
      if (b) originalBuffers.set(t.id, b);
    }
  });

  // Volver a 0 = restaurar originales (instantáneo).
  if (semitones === 0) {
    for (const t of trackList) {
      const orig = originalBuffers.get(t.id);
      if (orig) engine.replaceTrackBuffer(t.id, orig);
    }
    currentStemsPitch = 0;
    pendingPitch = 0;
    paintStemsPitchUI();
    paintEffectiveKeyUI();
    refreshTimelineWidth();
    redrawAllWaveforms();
    if (wasPlaying) engine.seek(curSec);
    return;
  }

  pitchApplying = true;
  const sign = semitones > 0 ? '+' : '';
  const toastUi = showSepToast(`Tono ${sign}${semitones} st`);
  try {
    const { pitchShiftBuffer } = await import('./harmonyShifter.js');
    let i = 0;
    for (const t of trackList) {
      const orig = originalBuffers.get(t.id);
      if (!orig) continue;
      const base = i / trackList.length;
      toastUi.update(base, `Procesando ${t.name}…`);
      const shifted = await pitchShiftBuffer(orig, semitones, {
        onProgress: (f) => toastUi.update(base + (f / trackList.length), `Procesando ${t.name}…`)
      });
      engine.replaceTrackBuffer(t.id, shifted);
      peaksCache.delete(t.id);
      drawTrackWaveform(t.id);
      i++;
    }
    currentStemsPitch = semitones;
    pendingPitch = semitones;
    paintStemsPitchUI();
    paintEffectiveKeyUI();
    toastUi.done(`✓ Tono ${sign}${semitones} st aplicado`);
    if (wasPlaying) engine.seek(curSec);
  } catch (err) {
    console.error('Stems pitch shift failed:', err);
    toastUi.error(err.message || String(err));
  } finally {
    pitchApplying = false;
  }
}

// ── Referencia armónica (pitch-shift offline) ─────────────────────
// Crea una pista nueva con el audio fuente desplazado N semitonos sin
// alterar el tempo. Útil para que coristas/segundas voces tengan una guía
// de afinación encima de la voz líder ya separada.
let harmonyRunning = false;
async function openHarmonyMenu(anchor, id) {
  if (harmonyRunning) return;
  const harm = await import('./harmonyShifter.js');
  const { HARMONY_PRESETS, HARMONY_DIATONIC, resolveDiatonic, isMinorKey } = harm;
  document.getElementById('stems-harmony-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'stems-harmony-menu';
  menu.className = 'stems-ctx-menu';

  // Sección diatónica — usa la tonalidad EN EL PLAYHEAD (con prioridad
  // al marker más reciente con key seteado, fallback al projectKey). Así
  // si la canción modula y el usuario marca esa sección con G, el menú
  // armónico al pararse ahí muestra G en vez de la tonalidad original.
  const refSec = engine.getCurrentSec();
  const effKey = getKeyAtTime(refSec);
  const hasKey = !!effKey;
  const isSectional = !!markers.find(mm => mm.key && mm.atSec <= refSec);
  const sourceNote = isSectional ? '(según marker de sección)' : (projectKey ? '(tonalidad del proyecto)' : '');
  const modeNote = hasKey
    ? `Tonalidad: ${effKey} (${isMinorKey(effKey) ? 'menor' : 'mayor'}) ${sourceNote}`
    : 'Fija una tonalidad arriba para activar opciones diatónicas';
  const diatonicHtml = hasKey ? `
    <div class="stems-ctx-hint" style="padding:6px 10px;color:var(--accent);font-size:10px;font-weight:800;letter-spacing:1px;">DIATÓNICAS (${effKey})</div>
    ${HARMONY_DIATONIC.map((d, idx) => {
      const semis = resolveDiatonic(d, effKey);
      return `<button data-dia="${idx}" data-st="${semis}">${d.label} (${semis > 0 ? '+' : ''}${semis} st)</button>`;
    }).join('')}
    <div class="stems-ctx-sep" style="height:1px;background:var(--border);margin:4px 6px;"></div>
  ` : '';

  menu.innerHTML = `
    <div class="stems-ctx-hint" style="padding:6px 10px;color:var(--text-muted);font-size:11px;">${modeNote}</div>
    ${diatonicHtml}
    <div class="stems-ctx-hint" style="padding:4px 10px;color:var(--text-muted);font-size:10px;font-weight:800;letter-spacing:1px;">INTERVALOS FIJOS</div>
    ${HARMONY_PRESETS.map(p => `
      <button data-st="${p.semitones}">${p.label}</button>
    `).join('')}
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
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
  menu.querySelectorAll('[data-st]').forEach(b => {
    b.onclick = () => {
      close();
      const semis = parseInt(b.dataset.st, 10);
      // Si es preset diatónico, el nombre incluye la clave para trazabilidad.
      if (b.dataset.dia != null) {
        const d = HARMONY_DIATONIC[+b.dataset.dia];
        runHarmonyShift(id, semis, `${d.name} en ${effKey}`);
      } else {
        const preset = HARMONY_PRESETS.find(p => p.semitones === semis);
        runHarmonyShift(id, semis, preset?.name || `${semis}st`);
      }
    };
  });
}

async function runHarmonyShift(id, semitones, presetName) {
  if (harmonyRunning) { toast('Espera a que termine la referencia anterior.', 'warning'); return; }
  const track = engine.getTracks().find(t => t.id === id);
  const buffer = engine.getTrackBuffer(id);
  if (!track || !buffer) return;
  const baseName = track.name.replace(/\.(wav|mp3|ogg|aac|m4a|flac)$/i, '');

  harmonyRunning = true;
  const toastUi = showSepToast(`${baseName} → ${presetName}`);
  try {
    const { pitchShiftBuffer } = await import('./harmonyShifter.js');
    toastUi.update(0.02, 'Generando referencia armónica…');
    const shifted = await pitchShiftBuffer(buffer, semitones, {
      onProgress: (f) => toastUi.update(Math.max(0.02, f), 'Procesando…')
    });
    toastUi.update(1, 'Creando pista…');
    const ch0 = shifted.getChannelData(0).slice();
    const ch1 = shifted.numberOfChannels > 1 ? shifted.getChannelData(1).slice() : ch0;
    await addSeparatedTrack(`${baseName} — ${presetName}`, [ch0, ch1], shifted.sampleRate, 'other');
    toastUi.done(`✓ Referencia ${presetName} creada`);
  } catch (err) {
    console.error('Harmony shift failed:', err);
    toastUi.error(err.message || String(err));
  } finally {
    harmonyRunning = false;
  }
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
    toast('La separación de stems no está disponible en esta versión.', 'warning');
    return;
  }
  const track = engine.getTracks().find(t => t.id === id);
  const buffer = engine.getTrackBuffer(id);
  if (!track || !buffer) return;

  const cacheKey = `${id}:${mode}:${buffer.length}`;
  const baseName = track.name.replace(/\.(wav|mp3|ogg|aac|m4a|flac)$/i, '');

  // Confirmación: el proceso es pesado (1-2 min en un PC modesto), consume
  // CPU/RAM y bloquea otras separaciones. Mejor avisar antes que dejar al
  // usuario preguntándose qué pasa.
  const modeLabel = mode === '2stem' ? 'Voz / Instrumental'
                  : mode === '4stem' ? 'Voz · Batería · Bajo · Otros'
                  : 'Solo "Otros"';
  const reuseCached = lastSeparation && lastSeparation.cacheKey === cacheKey;
  if (!reuseCached) {
    const ok = await confirmDialogAsync({
      title: 'Separar pista con IA',
      message: `"${baseName}" → ${modeLabel}.\nPuede tardar 1-2 minutos y consume CPU. Mientras se procesa, no podrás separar otra pista.`,
      confirmLabel: 'Separar', danger: false,
    });
    if (!ok) return;
  }

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

  // Cloud route (hybrid): if a provider + key are configured AND we're online,
  // offload to the cloud. ANY failure falls through to the local model below,
  // so live use is never blocked.
  const cloudCfg = getCloudConfig();
  if (cloudCfg && navigator.onLine && window.electronAPI.stemsSeparateCloud) {
    try {
      toast.update(0.05, `Separando en la nube (${cloudCfg.provider})…`);
      const wavBytes = new Uint8Array(audioBufferToWav(buffer));
      const res = await window.electronAPI.stemsSeparateCloud({
        wav: wavBytes, provider: cloudCfg.provider, apiKey: cloudCfg.apiKey, mode,
      });
      const bytes = res && res.audio;
      if (bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const decoded = await engine.decodeAudio(ab);
        const ch = [decoded.getChannelData(0), decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)];
        await addSeparatedTrack(`${baseName} — ${res.name || 'Otros'}`, ch, decoded.sampleRate, res.kind || 'other');
        toast.done(`✓ ${baseName}: ${res.name || 'Otros'} (nube)`);
        separating = false;
        return;
      }
    } catch (err) {
      console.warn('Cloud separation failed, falling back to local:', err);
      toast.update(0.05, 'Nube no disponible, usando local…');
    }
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
  originalBuffers.delete(id);
  trackNotes.delete(id);
  trackInstrument.delete(id);
  if (trackRows.size === 0) {
    const empty = document.getElementById('stems-empty');
    if (empty) empty.hidden = false;
    document.getElementById('workspace-stems')?.classList.remove('has-tracks');
    // Volver al estado "sin pistas" limpio. Sin esto, el timeline quedaba
    // alargado: el playhead conserva su transform en la posición vieja y eso
    // genera overflow scrollable. Paramos, reseteamos zoom/playhead a 0 y
    // llevamos el scroll al inicio.
    try { engine.stop(); } catch (_) {}
    applyPlayingState(false);
    setZoom(40); // zoom por defecto → ancho del timeline vuelve al del estado vacío
    applyTimeUpdate(0); // playhead a 0 (elimina el overflow)
    const arrange = document.getElementById('stems-arrange');
    if (arrange) arrange.scrollLeft = 0;
  }
  selectedTrackIds.delete(id);
  refreshTransport();
  refreshTimelineWidth();
  reflectSoloHighlights();
  scheduleSave();
}

// ── Multi-selección de pistas (Ctrl/Cmd + clic) ─────────────────────────────
// Permite seleccionar varias pistas y eliminarlas de golpe (tecla Supr o el
// botón de la barra de selección). Escape limpia la selección.
const selectedTrackIds = new Set();

function updateTrackSelectionUI() {
  for (const [id, entry] of trackRows) entry.row.classList.toggle('is-selected', selectedTrackIds.has(id));
  const bar = document.getElementById('stems-sel-bar');
  const n = selectedTrackIds.size;
  if (bar) {
    bar.hidden = n === 0;
    const lbl = bar.querySelector('.stems-sel-count');
    if (lbl) lbl.textContent = `${n} pista${n === 1 ? '' : 's'} seleccionada${n === 1 ? '' : 's'}`;
  }
}

function toggleTrackSelection(id) {
  if (selectedTrackIds.has(id)) selectedTrackIds.delete(id); else selectedTrackIds.add(id);
  updateTrackSelectionUI();
}

function clearTrackSelection() {
  if (!selectedTrackIds.size) return;
  selectedTrackIds.clear();
  updateTrackSelectionUI();
}

function selectAllTracks() {
  selectedTrackIds.clear();
  for (const id of trackRows.keys()) selectedTrackIds.add(id);
  updateTrackSelectionUI();
}

// Contrae/expande la consola para liberar alto y ver más pistas del timeline.
// El estado se recuerda entre sesiones (localStorage).
const CONSOLE_COLLAPSE_KEY = 'stems-console-collapsed';
function setConsoleCollapsed(collapsed) {
  const section = document.getElementById('stems-console');
  if (!section) return;
  section.classList.toggle('is-collapsed', collapsed);
  // La chevron (span) rota; el botón-toggle lleva el título/aria.
  const chevron = document.getElementById('stems-console-collapse');
  if (chevron) chevron.classList.toggle('is-collapsed', collapsed);
  const toggle = document.getElementById('stems-console-toggle');
  if (toggle) {
    toggle.title = collapsed ? 'Expandir consola' : 'Contraer consola';
    toggle.setAttribute('aria-label', toggle.title);
  }
  try { localStorage.setItem(CONSOLE_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  // El alto del área de pistas cambió: redibuja la regla/timeline.
  refreshTimelineWidth();
  // Al expandir, los faders recuperan alto: repíntalos por si alguno se creó
  // colapsado/sin layout y quedó sin el relleno.
  if (!collapsed) requestAnimationFrame(repaintAllFaders);
}
function wireConsoleCollapse(root) {
  const toggle = root.querySelector('#stems-console-toggle');
  if (!toggle) return;
  let collapsed = false;
  try { collapsed = localStorage.getItem(CONSOLE_COLLAPSE_KEY) === '1'; } catch {}
  setConsoleCollapsed(collapsed);
  toggle.addEventListener('click', () => {
    const section = document.getElementById('stems-console');
    setConsoleCollapsed(!section?.classList.contains('is-collapsed'));
  });
}

// ── Piano virtual ─────────────────────────────────────────────────
function wirePiano(root) {
  const container = root.querySelector('#stems-piano');
  if (!container) return;
  mountPianoPanel(container, {
    onOpenChange: paintPianoToggle,
    onRecordStart: onPianoRecordStart,
    onRecordNote: onPianoRecordNote,
    onRecordStop: onPianoRecordStop,
  });
  const btn = root.querySelector('#stems-piano-toggle');
  if (btn) btn.onclick = () => togglePiano();
  // Doble clic en una fila MIDI abre el piano roll.
  const rows = root.querySelector('#stems-rows');
  if (rows) rows.addEventListener('dblclick', (e) => {
    if (e.target.closest('.stems-row-strip')) return;   // no en el strip de controles
    const row = e.target.closest('.stems-row');
    const id = row?.dataset.trackId;
    if (!id) return;
    const t = engine.getTracks().find(tr => tr.id === id);
    if (t?.kind === 'midi') { e.preventDefault(); openPianoRollForTrack(id); }
  });
}

function paintPianoToggle(open) {
  const btn = document.getElementById('stems-piano-toggle');
  if (!btn) return;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
}

// ── Pistas MIDI (piano) ───────────────────────────────────────────
// Buffer de silencio (placeholder mientras la pista MIDI no tiene audio).
function makeSilentBuffer(sec) {
  const ctx = engine.getAudioContext();
  const sr = ctx.sampleRate;
  return ctx.createBuffer(2, Math.max(1, Math.ceil((sec || 1) * sr)), sr);
}
// Notas {startSec,durationSec} → eventos {startSec,endSec} para el sampler.
function notesToEvents(notes) {
  return notes.map(n => ({ midi: n.midi, velocity: n.velocity, startSec: n.startSec, endSec: n.startSec + n.durationSec }));
}

// Grabar: crea la pista MIDI al instante (vacía, con buffer silencioso) para que
// las notas aparezcan en vivo. El audio real se rinde al parar (re-bounce).
async function onPianoRecordStart() {
  try {
    const id = `t${nextTrackId++}`;
    const inst = getInstrument();
    const silent = makeSilentBuffer(Math.max(2, projectDurationSec()));
    await engine.addTrack({ id, name: instLabel(inst), audioBuffer: silent, kind: 'midi' });
    engine.setTrackColor(id, nextStemColor());
    trackNotes.set(id, []);
    trackInstrument.set(id, inst);
    activeRecId = id;
    appendTrackRow(id, null);
    refreshTransport();
  } catch (e) {
    console.error('No se pudo crear la pista de piano', e);
    activeRecId = null;
  }
}

// Cada nota grabada se agrega en vivo y se repinta la fila.
function onPianoRecordNote(note) {
  if (!activeRecId) return;
  const arr = trackNotes.get(activeRecId);
  if (!arr) return;
  arr.push(note);
  drawTrackWaveform(activeRecId);   // delega a drawMidiRow
}

// Parar: rinde el audio de la pista a partir de las notas y persiste.
async function onPianoRecordStop() {
  const id = activeRecId;
  activeRecId = null;
  if (!id) return;
  const notes = trackNotes.get(id) || [];
  if (!notes.length) {
    await removeTrackById(id);
    showToast('No se grabaron notas.', 'info');
    return;
  }
  await rebounceMidiTrack(id);
  scheduleSave();
  showToast('Pista de piano grabada. Doble clic en la fila para editar las notas.', 'success');
}

// Re-renderiza el audio (freeze) de una pista MIDI desde sus notas y actualiza
// el stem en disco. Mismo patrón que la regeneración del click.
async function rebounceMidiTrack(id) {
  const notes = trackNotes.get(id) || [];
  let lengthSec = projectDurationSec();
  for (const n of notes) lengthSec = Math.max(lengthSec, n.startSec + n.durationSec);
  lengthSec += 0.3;
  const inst = trackInstrument.get(id) || 'piano';
  let buffer = notes.length ? await renderEventsToBuffer(notesToEvents(notes), lengthSec, inst) : null;
  if (!buffer) buffer = makeSilentBuffer(Math.max(1, lengthSec));
  engine.replaceTrackBuffer(id, buffer);
  const entry = trackRows.get(id);
  if (entry) {
    const oldPath = entry.row.dataset.path;
    const bytes = audioBufferToMp3(buffer);
    const savedPath = await projectStore.saveStem(id, 'piano.mp3', bytes);
    entry.row.dataset.path = savedPath || '';
    if (oldPath && oldPath !== savedPath) { try { await projectStore.removeStem(oldPath); } catch (_) {} }
  }
  peaksCache.delete(id);
  drawTrackWaveform(id);
  refreshTransport();
}

// Abre el piano roll para editar las notas de una pista MIDI. Al guardar,
// actualiza las notas y re-bouncea el audio.
function openPianoRollForTrack(id) {
  const t = engine.getTracks().find(tr => tr.id === id);
  if (!t || t.kind !== 'midi') return;
  // El piano (acoplado en el editor) usa el instrumento de ESTA pista.
  setInstrumentUI(trackInstrument.get(id) || 'piano');
  openPianoRoll({
    notes: trackNotes.get(id) || [],
    bpm: bpmFloat || bpm,
    beatsPerBar,
    color: t.color || currentAccent(),
    projectKey,
    onSave: async (newNotes) => {
      trackNotes.set(id, newNotes);
      trackInstrument.set(id, getInstrument());   // adopta el instrumento elegido
      try { await rebounceMidiTrack(id); scheduleSave(); }
      catch (e) { console.error('re-bounce piano roll failed', e); toast('No se pudo re-renderizar la pista MIDI.'); }
    },
  });
}

async function deleteSelectedTracks() {
  const ids = [...selectedTrackIds];
  if (!ids.length) return;
  const ok = await confirmDialogAsync({
    title: 'Eliminar pistas',
    message: `¿Eliminar ${ids.length} pista${ids.length === 1 ? '' : 's'} del proyecto? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true,
  });
  if (!ok) return;
  selectedTrackIds.clear();
  for (const id of ids) await removeTrackById(id);
  updateTrackSelectionUI();
}

function wireTrackSelection(root) {
  const rows = root.querySelector('#stems-rows');
  // Ctrl/Cmd + clic en una pista la (de)selecciona. En CAPTURA → gana antes del
  // seek y de los botones de la fila, sin disparar nada más.
  if (rows) rows.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const row = e.target.closest('.stems-row');
    if (!row || !row.dataset.trackId) return;
    e.preventDefault(); e.stopPropagation();
    toggleTrackSelection(row.dataset.trackId);
  }, true);

  root.querySelector('#stems-sel-del')?.addEventListener('click', deleteSelectedTracks);
  root.querySelector('#stems-sel-clear')?.addEventListener('click', clearTrackSelection);
  root.querySelector('#stems-console-selall')?.addEventListener('click', selectAllTracks);

  document.addEventListener('keydown', (e) => {
    const ws = document.getElementById('workspace-stems');
    if (!ws || ws.offsetParent === null) return;   // Stems no visible
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    // Ctrl/Cmd+A selecciona todas las pistas (si hay alguna cargada).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      if (!trackRows.size) return;
      e.preventDefault();
      selectAllTracks();
      return;
    }
    if (!selectedTrackIds.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedTracks(); }
    else if (e.key === 'Escape') { clearTrackSelection(); }
  });
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
  const barSec = (60 / bpmFloat) * beatsPerBar;
  const beatSec = 60 / bpmFloat;
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
  const beatPx = (60 / bpmFloat) * PX_PER_SEC;
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
  // Las pistas MIDI (piano) muestran sus notas en vez del waveform del audio
  // congelado. Delegamos para que todos los callers (zoom, tema, etc.) sirvan.
  const tk = engine.getTracks().find(tr => tr.id === id);
  if (tk?.kind === 'midi') { drawMidiRow(id); return; }
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

// Preview de SOLO LECTURA de las notas de una pista MIDI en su fila (canvas
// compacto). La edición se hace en el editor grande (piano roll): doble clic en
// la fila o el botón del strip. Aquí solo se muestra para saber qué hay.
function drawMidiRow(id) {
  const entry = trackRows.get(id);
  if (!entry) return;
  const notes = trackNotes.get(id) || [];
  const t = engine.getTracks().find(tr => tr.id === id);
  const color = t?.color || currentAccent();
  if (entry.canvas) entry.canvas.style.display = '';
  let endSec = 0;
  for (const n of notes) endSec = Math.max(endSec, n.startSec + n.durationSec);
  const widthPx = Math.max(1, Math.ceil(endSec * PX_PER_SEC));
  const h = ROW_HEIGHT - 8;
  entry.lane.style.width = `${projectWidthPx()}px`;
  entry.canvas.style.width = `${widthPx}px`;
  entry.canvas.style.height = `${h}px`;
  entry.canvas.style.transform = `translateX(${(engine.getTrackOffset(id) || 0) * PX_PER_SEC}px)`;
  const cv = entry.canvas;
  cv.width = widthPx;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, widthPx, h);
  if (!notes.length) return;
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
  if (lo === hi) { lo -= 6; hi += 6; } else { lo -= 1; hi += 1; }
  const span = Math.max(1, hi - lo);
  const noteH = Math.max(2, Math.min(10, h / (span + 1)));
  ctx.fillStyle = color;
  for (const n of notes) {
    const x = n.startSec * PX_PER_SEC;
    const w = Math.max(2, n.durationSec * PX_PER_SEC);
    const y = h - ((n.midi - lo) / span) * (h - noteH) - noteH;
    ctx.globalAlpha = 0.5 + 0.5 * (Math.max(0, Math.min(127, n.velocity)) / 127);
    ctx.fillRect(x, y, w, noteH);
  }
  ctx.globalAlpha = 1;
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
// Loop A-B "libre" — bounds en segundos que NO dependen de marcadores.
// Si ambos están set, ganan sobre los marcadores. Botones A / B en la
// toolbar los dropean en el tiempo actual; permite loopear cualquier
// trozo sin tener que crear marcadores permanentes para algo efímero.
let freeLoopA = null;
let freeLoopB = null;

function snapTimeIfEnabled(sec) {
  if (!snapToBeat) return sec;
  const beatSec = 60 / bpmFloat;
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
  // Drag path: ráfaga de moveMarkerTo a 60Hz; coalescer en RAF para que
  // el layer no se rebuilde por cada pointermove.
  scheduleMarkersRedraw();
  if (record) {
    pushHistory('Mover marcador',
      () => { m.atSec = oldSec; scheduleMarkersRedraw(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); },
      () => { m.atSec = newSec; scheduleMarkersRedraw(); syncLoopRegion(); scheduleSave(); scheduleGuideSync(); }
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

function setMarkerKey(markerId, key) {
  const m = markers.find(x => x.id === markerId);
  if (!m) return;
  const oldKey = m.key || null;
  const newKey = key || null;
  if (oldKey === newKey) return;
  m.key = newKey;
  redrawMarkers();
  pushHistory('Tonalidad del marcador',
    () => { m.key = oldKey; redrawMarkers(); scheduleSave(); },
    () => { m.key = newKey; redrawMarkers(); scheduleSave(); }
  );
  scheduleSave();
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

// Coalesce repeated marker redraws en un solo RAF — necesario porque
// pointermove durante el drag dispara redrawMarkers a 60+ Hz, y cada
// llamada hace un innerHTML completo del layer. Sin batching el drag
// se vuelve perceptiblemente lento con muchos marcadores.
let markersRedrawRAF = 0;
function scheduleMarkersRedraw() {
  if (markersRedrawRAF) return;
  markersRedrawRAF = requestAnimationFrame(() => {
    markersRedrawRAF = 0;
    redrawMarkers();
  });
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
    // Si el marker tiene tonalidad de sección asignada, mostramos un
    // badge con la tonalidad EFECTIVA (transpuesta por el shift master).
    const effSectionKey = m.key ? transposeKey(m.key, currentStemsPitch) : null;
    el.innerHTML = `
      <span class="stems-marker-flag" title="Arrastra para mover · click derecho para opciones">${SVG_FLAG}</span>
      <span class="stems-marker-label">${escapeHtml(m.label)}</span>
      ${effSectionKey ? `<span class="stems-marker-key" title="Tonalidad de esta sección">${escapeHtml(effSectionKey)}</span>` : ''}
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

// Tipos de sección más comunes — los que aparecen en el grid inline del
// menú contextual de marcadores. Los menos frecuentes (vamp, breakdown,
// interludio, etc.) viven detrás de "Más tipos…" para no saturar.
const MARKER_QUICK_TYPES = [
  'intro', 'verso', 'pre-coro',
  'coro', 'puente', 'instrumental',
  'post-coro', 'solo', 'outro',
];

// ── Right-click menu for markers ────────────────────────────────
function openMarkerMenu(x, y, markerId) {
  closeMarkerMenu();
  const m = markers.find(t => t.id === markerId);
  if (!m) return;
  const isLoopA = loopStartMarkerId === markerId;
  const isLoopB = loopEndMarkerId === markerId;
  const inLoop = isLoopA || isLoopB;
  const quickCues = MARKER_QUICK_TYPES.map(id => SECTION_CUES.find(c => c.id === id)).filter(Boolean);
  const menu = document.createElement('div');
  menu.className = 'stems-context-menu stems-marker-ctx';
  menu.id = 'stems-marker-menu';
  // Grid visual de tipos en lugar del submenú anidado anterior. Tap-friendly,
  // sin necesidad de hover-for-submenu, con el tipo actual resaltado.
  menu.innerHTML = `
    <div class="smc-section-label">CAMBIAR TIPO</div>
    <div class="smc-type-grid">
      ${quickCues.map(c => `
        <button data-cue="${c.id}" class="smc-type-btn ${m.cueId === c.id ? 'is-active' : ''}" title="${c.label}">
          <span>${c.label}</span>
        </button>
      `).join('')}
    </div>
    <button data-cmd="change" class="smc-more">Más tipos…</button>
    <div class="smc-sep"></div>
    <button data-cmd="rename">Renombrar etiqueta</button>
    <div class="smc-sep"></div>
    <div class="smc-section-label">TONALIDAD DE LA SECCIÓN</div>
    <div class="smc-key-row">
      <select class="smc-key-select" data-cmd="set-key">
        <option value="">— (usa tonalidad del proyecto)</option>
        <option value="" disabled>── Mayores ──</option>
        ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map(k => `<option value="${k}" ${m.key === k ? 'selected' : ''}>${k}</option>`).join('')}
        <option value="" disabled>── Menores ──</option>
        ${['Am','A#m','Bm','Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m'].map(k => `<option value="${k}" ${m.key === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
    </div>
    <div class="smc-sep"></div>
    <button data-cmd="loop-start" class="${isLoopA ? 'is-active' : ''}">▎ Marcar como inicio de loop (A)</button>
    <button data-cmd="loop-end"   class="${isLoopB ? 'is-active' : ''}">▎ Marcar como fin de loop (B)</button>
    ${inLoop ? '<button data-cmd="loop-clear">Quitar de loop</button>' : ''}
    <div class="smc-sep"></div>
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
  menu.querySelectorAll('[data-cue]').forEach(b => {
    b.onclick = () => { changeMarkerCue(markerId, b.dataset.cue); closeMarkerMenu(); };
  });
  const keySelInMenu = menu.querySelector('[data-cmd="set-key"]');
  if (keySelInMenu) {
    // Evita que el mousedown cierre el menú vía closeMarkerMenuOnce.
    keySelInMenu.addEventListener('mousedown', (e) => e.stopPropagation());
    keySelInMenu.onchange = () => {
      setMarkerKey(markerId, keySelInMenu.value || null);
      // No cerramos — el usuario puede querer ver cómo cambia el badge sin
      // perder el resto del menú.
    };
  }
  menu.querySelector('[data-cmd="rename"]').onclick = () => {
    closeMarkerMenu();
    // Inline rename: turn the label into a contenteditable (window.prompt
    // está deshabilitado en Electron renderer; este flujo lo reemplaza).
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
  const loopClearBtn = menu.querySelector('[data-cmd="loop-clear"]');
  if (loopClearBtn) loopClearBtn.onclick = () => {
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
  // Prioridad: si hay A/B "libres" definidos, ganan sobre los marcadores.
  // Eso permite loopear secciones efímeras (entre verso y coro, etc.) sin
  // ensuciar la lista de marcadores con anclas permanentes.
  let start = null, end = null;
  if (freeLoopA != null && freeLoopB != null) {
    start = Math.min(freeLoopA, freeLoopB);
    end   = Math.max(freeLoopA, freeLoopB);
  } else if (loopStartMarkerId && loopEndMarkerId) {
    const a = markers.find(m => m.id === loopStartMarkerId);
    const b = markers.find(m => m.id === loopEndMarkerId);
    if (a && b) { start = Math.min(a.atSec, b.atSec); end = Math.max(a.atSec, b.atSec); }
  }
  if (!loopEnabled || start == null || end == null || end <= start) {
    engine.clearLoopRegion();
    if (overlay) overlay.hidden = true;
    paintLoopAbButtons();
    return;
  }
  engine.setLoopRegion(start, end);
  // Position overlay over the timeline area (after the sticky strip column).
  if (overlay) {
    overlay.hidden = false;
    overlay.style.left  = `${STRIP_WIDTH + start * PX_PER_SEC}px`;
    overlay.style.width = `${(end - start) * PX_PER_SEC}px`;
  }
  paintLoopAbButtons();
}

// Pinta el estado visual de los botones A/B: vacío vs. activo (con el
// tiempo definido), y le pone el time como title para que se vea al
// pasar el mouse. El toggle de Loop también se sincroniza.
function paintLoopAbButtons() {
  const aBtn = document.getElementById('stems-loop-a');
  const bBtn = document.getElementById('stems-loop-b');
  const loopBtn = document.getElementById('stems-loop-toggle');
  if (aBtn) {
    aBtn.classList.toggle('is-set', freeLoopA != null);
    aBtn.title = freeLoopA != null
      ? `Punto A: ${freeLoopA.toFixed(2)}s — clic para mover al tiempo actual, doble-clic para limpiar`
      : 'Marcar punto A en el tiempo actual';
  }
  if (bBtn) {
    bBtn.classList.toggle('is-set', freeLoopB != null);
    bBtn.title = freeLoopB != null
      ? `Punto B: ${freeLoopB.toFixed(2)}s — clic para mover al tiempo actual, doble-clic para limpiar`
      : 'Marcar punto B en el tiempo actual';
  }
  if (loopBtn) loopBtn.classList.toggle('is-on', loopEnabled);
}
function closeMarkerMenuOnce(e) {
  const menu = document.getElementById('stems-marker-menu');
  if (!menu) return;
  if (menu.contains(e.target)) return;
  // Si el foco vive dentro del menú (típicamente un <select> abierto cuyo
  // dropdown nativo está fuera del DOM del menú), no cerramos — el click
  // es parte de la interacción con ese control.
  if (menu.contains(document.activeElement)) return;
  closeMarkerMenu();
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

// ── Auto-detect sections ──────────────────────────────────────────
// Analyses the loaded song and drops generic markers at each structural
// change. Purely additive to the manual workflow: the markers are normal
// markers the user can rename / re-cue / move / delete, and one undo step
// reverts the whole batch. If detection finds nothing, the user just adds
// markers by hand as before.
async function onDetectSections() {
  const stem = engine.getTracks().find(t => t.kind === 'stem');
  if (!stem) { toast('Sube una canción primero para detectar sus secciones.', 'warning'); return; }
  const buf = engine.getTrackBuffer(stem.id);
  if (!buf) { toast('No se pudo leer el audio de la canción.'); return; }

  const btn = document.getElementById('stems-detect-sections');
  const prevHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  let sections = [];
  try {
    await new Promise(r => setTimeout(r, 20)); // let the button repaint first
    // Pass the precise project tempo so boundaries snap to exact bar lines.
    sections = detectSections(buf, { bpm: bpmFloat, beatsPerBar });
  } catch (e) {
    console.warn('Section detection failed:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prevHtml; }
  }

  if (!sections.length) {
    toast('No se detectaron cambios de sección claros. Puedes añadir los marcadores a mano.', 'warning');
    return;
  }

  if (markers.length) {
    const ok = await confirmDialogAsync({
      title: 'Reemplazar marcadores',
      message: `Se detectaron ${sections.length} secciones. Esto reemplazará los marcadores actuales por los detectados. ¿Continuar?`,
      confirmLabel: 'Reemplazar', danger: true,
    });
    if (!ok) return;
  }

  // Each detected section carries a best-guess cue (Intro / Verso / Coro);
  // the user fine-tunes the names via the marker right-click menu.
  const prevMarkers = markers.slice();
  let versoN = 0, coroN = 0;
  const newMarkers = sections.map((sec) => {
    const cue = findCueById(sec.cueId) || SECTION_CUES[0];
    let label = sec.label;
    if (sec.cueId === 'verso') label = `Verso ${++versoN}`;
    else if (sec.cueId === 'coro') label = `Coro ${++coroN}`;
    return { id: `m${nextMarkerId++}`, cueId: cue.id, label, url: cue.url, atSec: sec.atSec };
  });
  markers = newMarkers;
  redrawMarkers();
  pushHistory('Detectar secciones',
    () => { markers = prevMarkers; redrawMarkers(); scheduleSave(); scheduleGuideSync(); },
    () => { markers = newMarkers; redrawMarkers(); scheduleSave(); scheduleGuideSync(); }
  );
  scheduleSave();
  scheduleGuideSync();
}

// ── Click track generator ─────────────────────────────────────────
async function onAddClickTrack() {
  const existingClickId = engine.findTrackByKind('click');
  if (existingClickId) {
    const ok = await confirmDialogAsync({
      title: 'Regenerar click',
      message: 'Ya existe una pista de click. ¿Regenerarla con el BPM actual?',
      confirmLabel: 'Regenerar', danger: false,
    });
    if (!ok) return;
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
  const a = detectBeatAlignment(buf, bpmFloat, beatsPerBar);
  return a || { offsetSec: 0, accentBeatOffset: 0 };
}

async function createClickTrack(durationSec) {
  const ctx = engine.getAudioContext();
  const { offsetSec, accentBeatOffset } = computeClickAlignment();
  const buffer = await generateClickTrack({ bpm: bpmFloat, beatsPerBar, durationSec, ctx, sound: clickSoundId, accentBeatOffset, accentPattern });
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
  const buffer = await generateClickTrack({ bpm: bpmFloat, beatsPerBar, durationSec, ctx, sound: clickSoundId, accentBeatOffset, accentPattern });
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
    if (!silent) toast('Añade al menos un marcador antes de generar la guía.', 'warning');
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
    if (!silent) toast('No se pudo generar la guía: ' + (e.message || e));
  }
}

// ── Transport state ───────────────────────────────────────────────
function refreshTransport() {
  const hasTracks = engine.getTracks().length > 0;
  document.getElementById('stems-play').disabled  = !hasTracks;
  document.getElementById('stems-stop').disabled  = !hasTracks;
  const exportBtn = document.getElementById('stems-export');
  if (exportBtn) exportBtn.disabled = !hasTracks;
  const assignBtn = document.getElementById('stems-assign');
  if (assignBtn) assignBtn.disabled = !hasTracks;
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
  const stopBtn  = document.getElementById('stems-stop');
  const pill     = document.getElementById('stems-state-pill');
  const hasTracks = engine.getTracks().length > 0;
  if (playBtn) {
    playBtn.classList.toggle('is-playing', playing);
    // El play/pausa es un solo botón que alterna icono (como el reproductor
    // de Pads): triángulo cuando está pausado, barras cuando reproduce.
    playBtn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    // Play stays enabled when paused so the user can resume; only the
    // empty-project case disables it.
    playBtn.disabled = !hasTracks;
  }
  if (stopBtn)  stopBtn.disabled  = !hasTracks;
  const restartBtn = document.getElementById('stems-restart');
  if (restartBtn) restartBtn.disabled = !hasTracks;
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

    if (opts.assign) {
      // Asignar directo a una canción (sin "Guardar como" + reimportar). Si
      // viene un destino pre-elegido (clic en el panel de setlist), no abre el
      // modal — asigna directo.
      overlay.hidden = true;
      await assignMixToSong(mp3Bytes, opts.suggestedName || projectName, opts.target);
    } else {
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
    }
  } catch (e) {
    console.error('Stem export failed:', e);
    titleEl.textContent = 'Error al exportar';
    stageEl.textContent = e.message || String(e);
    setTimeout(() => { overlay.hidden = true; }, 3000);
  }
}

// Asigna la mezcla recién renderizada a una canción elegida (copia a la librería
// de OneDrive con nombre por contenido + persiste + recarga la Librería).
async function assignMixToSong(mp3Bytes, suggestedName, preChosen) {
  // `preChosen` = { song, slot } cuando viene del panel de setlist (clic en una
  // fila). Si no, abre el modal buscador.
  const choice = preChosen || await pickSongAndSlot();
  if (!choice) return; // cancelado
  const { song, slot } = choice;
  try {
    const url = await window.electronAPI.assignStemsMix({
      buffer: mp3Bytes.buffer,
      type: slot,
      name: suggestedName || song.title,
    });
    if (!song.audio) song.audio = {};
    song.audio[slot] = url;
    if (window.electronAPI?.saveGiSetlist) window.electronAPI.saveGiSetlist(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
    const slotLabel = slot === 'original' ? 'Original' : 'Secuencia';
    showToast(`✓ Mezcla asignada a "${song.title}" (${slotLabel}).`, 'success');
    // Refrescar el panel para que la fila muestre el nuevo badge Sec/Orig.
    const se = document.querySelector('#stems-setlist .ssl-search');
    renderSetlistPanel(se ? se.value : '');
  } catch (e) {
    showToast('No se pudo asignar: ' + (e.message || e), 'error');
  }
}

// Modal: toggle de slot (Secuencia/Original) + buscador + lista de canciones de
// la librería. Resuelve { song, slot } al elegir, o null si se cancela.
function pickSongAndSlot() {
  return new Promise((resolve) => {
    const songs = getSongs();
    let slot = 'sequence';

    const overlay = document.createElement('div');
    overlay.className = 'stems-assign-overlay';
    overlay.innerHTML = `
      <div class="stems-assign-modal" role="dialog" aria-modal="true" aria-label="Asignar mezcla a una canción">
        <div class="sam-head">
          <span class="sam-title">Asignar mezcla a…</span>
          <button class="sam-close" aria-label="Cerrar">&times;</button>
        </div>
        <div class="sam-slot" role="group" aria-label="Slot destino">
          <button class="sam-slot-btn active" data-slot="sequence">Secuencia</button>
          <button class="sam-slot-btn" data-slot="original">Original</button>
        </div>
        <input class="sam-search" type="text" placeholder="Buscar canción…" aria-label="Buscar canción">
        <div class="sam-list"></div>
      </div>`;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.stems-assign-modal');
    const listEl = overlay.querySelector('.sam-list');
    const searchEl = overlay.querySelector('.sam-search');

    const pop = pushModal(() => done(null), modal);
    const done = (result) => {
      try { pop(); } catch (_) {}
      overlay.remove();
      resolve(result);
    };

    const renderList = (filter = '') => {
      const f = (filter || '').trim().toLowerCase();
      const rows = songs.filter(s => !f || `${s.title || ''} ${s.artist || ''}`.toLowerCase().includes(f));
      if (!rows.length) { listEl.innerHTML = `<div class="sam-empty">Sin resultados</div>`; return; }
      listEl.innerHTML = rows.map(s => {
        const has = s.audio && s.audio[slot];
        return `<button class="sam-row" data-id="${esc(String(s.id))}">
          <span class="sam-row-title">${esc(s.title || 'Sin título')}</span>
          <span class="sam-row-meta">${esc(s.artist || '')}${s.key ? ' · ' + esc(s.key) : ''}</span>
          ${has ? `<span class="sam-row-has" title="Ya tiene audio en este slot — se reemplaza">reemplaza</span>` : ''}
        </button>`;
      }).join('');
    };

    renderList();
    setTimeout(() => { try { searchEl.focus(); } catch (_) {} }, 40);

    searchEl.oninput = () => renderList(searchEl.value);
    overlay.querySelector('.sam-close').onclick = () => done(null);
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    overlay.querySelectorAll('.sam-slot-btn').forEach(b => {
      b.onclick = () => {
        slot = b.dataset.slot;
        overlay.querySelectorAll('.sam-slot-btn').forEach(x => x.classList.toggle('active', x === b));
        renderList(searchEl.value);
      };
    });
    listEl.onclick = (e) => {
      const row = e.target.closest('.sam-row');
      if (!row) return;
      const song = songs.find(s => String(s.id) === row.dataset.id);
      if (song) done({ song, slot });
    };
  });
}

// ── Panel de setlist siempre visible (destino de la mezcla) ─────────────────
// Replica la lista del servicio dentro de Stems: el usuario mezcla el
// multitrack y, de un clic en una canción, le asigna la mezcla al slot elegido
// (Secuencia u Original) sin pasar por el modal.
let setlistPanelSlot = 'all';   // 'all' | 'sequence' | 'original'

// Tono de acento estable por canción — mismo hash que songCard.js para que la
// barrita de color coincida con la del setlist principal.
function ssAccentHue(song) {
  const s = String(song.id || song.title || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function ssCoverHtml(song) {
  const hue = ssAccentHue(song);
  if (song.cover) {
    return `<span class="ssl-cover" style="--song-accent:hsl(${hue} 60% 55%)"><img src="${esc(song.cover)}" alt="" loading="lazy"></span>`;
  }
  const initial = esc((String(song.title || '?').trim().charAt(0) || '?').toUpperCase());
  return `<span class="ssl-cover no-cover" style="--song-accent:hsl(${hue} 60% 55%);--song-tint:hsl(${hue} 40% 24%)"><span class="ssl-cover-fallback">${initial}</span></span>`;
}

function renderSetlistPanel(filter = '') {
  const listEl = document.getElementById('stems-setlist-list');
  if (!listEl) return;
  const all = getSongs();
  // Contador del riel colapsado (total de canciones en la librería).
  const countEl = document.getElementById('stems-setlist-count');
  if (countEl) countEl.textContent = String(all.length);
  const f = (filter || '').trim().toLowerCase();
  const slotKey = setlistPanelSlot;                          // 'all' | 'sequence' | 'original'
  const isSlot = slotKey === 'sequence' || slotKey === 'original';   // hay slot destino activo
  const slotLabel = slotKey === 'original' ? 'Original' : 'Secuencia';
  // SIEMPRE se muestran todas las canciones (solo se filtra por la búsqueda).
  // En modo Secuencia/Original el toggle define el slot destino del clic; las
  // que YA tienen ese slot se atenúan (no se ocultan) para distinguir de un
  // vistazo lo pendiente, sin que los botones queden inútiles al completar todo.
  const songs = all
    .filter(s => !f || `${s.title || ''} ${s.artist || ''}`.toLowerCase().includes(f))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' }));

  const hintEl = document.querySelector('#stems-setlist .ssl-hint');
  if (hintEl) {
    hintEl.textContent = isSlot
      ? `Clic en una canción → asigna la mezcla como ${slotLabel}. Las atenuadas ya la tienen.`
      : 'Clic → carga y reproduce en el timeline · Clic derecho → asignar audio.';
  }

  if (!songs.length) {
    listEl.innerHTML = `<div class="ssl-empty">${all.length ? 'Sin resultados' : 'Tu librería está vacía'}</div>`;
    return;
  }
  listEl.innerHTML = songs.map(s => {
    const hasSeq = !!(s.audio && s.audio.sequence);
    const hasOrig = !!(s.audio && s.audio.original);
    const isDone = isSlot && !!(s.audio && s.audio[slotKey]);   // ya tiene el slot activo
    // Badges de estado (verde = Secuencia, ámbar = Original). En modo de slot, el
    // del slot activo no se muestra como badge: lo reemplaza el check ✓ a la
    // derecha, que lee en positivo ("ya la tiene") sin parecer deshabilitada.
    const showSeqBadge  = hasSeq  && slotKey !== 'sequence';
    const showOrigBadge = hasOrig && slotKey !== 'original';
    const badges =
      `${showSeqBadge  ? '<span class="ssl-tag seq" title="Ya tiene Secuencia asignada">Sec</span>' : ''}` +
      `${showOrigBadge ? '<span class="ssl-tag orig" title="Ya tiene Original asignado">Orig</span>' : ''}`;
    const check = isDone
      ? `<span class="ssl-check ${slotKey === 'original' ? 'orig' : 'seq'}" title="Ya tiene ${slotLabel} — clic para reemplazar">✓</span>`
      : '';
    // Misma estructura que el setlist de Pads: título / artista / tono·BPM·género.
    const music = [s.key || '', s.bpm ? `${s.bpm} BPM` : '', s.genre || ''].filter(Boolean).join(' · ');
    const rowTitle = isSlot
      ? `Asignar la mezcla a «${esc(s.title || '')}» como ${slotLabel} · clic derecho para cargar un archivo`
      : (hasSeq || hasOrig)
        ? `Clic para reproducir «${esc(s.title || '')}» en el timeline · clic derecho para asignar audio`
        : `Clic derecho en «${esc(s.title || '')}» para cargarle secuencia u original`;
    return `<button class="ssl-row" data-id="${esc(String(s.id))}" title="${rowTitle}">
      ${ssCoverHtml(s)}
      <span class="ssl-row-info">
        <span class="ssl-row-title">${esc(s.title || 'Sin título')}</span>
        <span class="ssl-row-artist">${esc(s.artist || 'Sin artista')}</span>
        <span class="ssl-row-meta">
          ${music ? `<span class="ssl-meta-music">${esc(music)}</span>` : ''}
          ${badges ? `<span class="ssl-tags">${badges}</span>` : ''}
        </span>
      </span>
      ${check}
    </button>`;
  }).join('');
}

function bindSetlistPanel() {
  const panel = document.getElementById('stems-setlist');
  if (!panel) return;
  const listEl = document.getElementById('stems-setlist-list');
  const searchEl = panel.querySelector('.ssl-search');
  const collapseBtn = document.getElementById('stems-setlist-collapse');

  renderSetlistPanel();

  if (searchEl) searchEl.oninput = () => renderSetlistPanel(searchEl.value);
  // Estado colapsado recordado entre sesiones (igual que la consola).
  try { if (localStorage.getItem('stems-setlist-collapsed') === '1') panel.classList.add('collapsed'); } catch {}
  const toggleCollapsed = () => {
    const collapsed = panel.classList.toggle('collapsed');
    try { localStorage.setItem('stems-setlist-collapsed', collapsed ? '1' : '0'); } catch {}
  };
  if (collapseBtn) collapseBtn.onclick = toggleCollapsed;
  // El riel "Canciones" (solo visible colapsado) también expande al hacer clic.
  const rail = panel.querySelector('.ssl-rail');
  if (rail) rail.onclick = toggleCollapsed;

  const addBtn = document.getElementById('stems-setlist-add');
  if (addBtn) addBtn.onclick = addSongFromStems;

  panel.querySelectorAll('.ssl-slot-btn').forEach(b => {
    b.onclick = () => {
      setlistPanelSlot = b.dataset.slot;
      panel.querySelectorAll('.ssl-slot-btn').forEach(x => x.classList.toggle('active', x === b));
      renderSetlistPanel(searchEl ? searchEl.value : '');
    };
  });

  // Clic izquierdo: en modo pendiente (Secuencia/Original) asigna la mezcla al
  // slot activo; en "Todas" no hay slot destino, así que abre el menú de carga.
  if (listEl) listEl.onclick = async (e) => {
    const row = e.target.closest('.ssl-row');
    if (!row) return;
    const song = getSongs().find(s => String(s.id) === row.dataset.id);
    if (!song) return;
    if (setlistPanelSlot === 'all') {
      // Clic izquierdo en "Todas": carga el audio ya asignado al timeline y lo
      // reproduce. Si tiene secuencia y original, deja elegir; si no tiene
      // ninguno, abre el menú para asignarlo (mismo que el clic derecho).
      const hasSeq = !!song.audio?.sequence;
      const hasOrig = !!song.audio?.original;
      if (hasSeq && hasOrig) openPlayInTimelineMenu(row, song);
      else if (hasSeq) loadSongAudioIntoTimeline(song, 'sequence');
      else if (hasOrig) loadSongAudioIntoTimeline(song, 'original');
      else openSongAudioMenu(row, song);
      return;
    }
    if (engine.getTracks().length === 0) { showToast('Cargá stems antes de asignar la mezcla.', 'info'); return; }
    await runExport({ assign: true, target: { song, slot: setlistPanelSlot } });
  };

  // Clic derecho (en cualquier modo): menú para cargar secuencia/original.
  if (listEl) listEl.oncontextmenu = (e) => {
    const row = e.target.closest('.ssl-row');
    if (!row) return;
    e.preventDefault();
    const song = getSongs().find(s => String(s.id) === row.dataset.id);
    if (song) openSongAudioMenu(row, song);
  };

  // Si la librería cambia por fuera (otra pantalla, sync), refrescar la lista.
  // `library-reload` = recarga de disco (orphan linker, settings); `songs-changed`
  // = cambio en memoria (crear/asignar desde Pads) — re-render al instante.
  const refreshFromExternal = () => renderSetlistPanel(searchEl ? searchEl.value : '');
  window.addEventListener('livepads:library-reload', refreshFromExternal);
  window.addEventListener('livepads:songs-changed', refreshFromExternal);
}

// Menú contextual del panel: cargar audio a una canción desde Stems. Secuencia
// y Original aceptan archivo; Original además acepta una URL de YouTube (mismo
// flujo que el panel de Pads). Tras cargar, persiste y refresca la lista.
function openSongAudioMenu(anchorEl, song) {
  // Mismas opciones que las tarjetas de Pads (módulo compartido songMenu.js):
  // subir/reemplazar secuencia, original, original desde YouTube, carátula.
  const onAssigned = () => {
    if (window.electronAPI?.saveGiSetlist) window.electronAPI.saveGiSetlist(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
    refreshSetlistPanelKeepingSearch();
  };
  openCardMoreMenu(anchorEl, audioMenuItems(song, onAssigned));
}

// Cuando una canción tiene secuencia Y original, el clic izquierdo abre un menú
// para elegir cuál cargar/reproducir en el timeline.
function openPlayInTimelineMenu(anchorEl, song) {
  const ICO_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><polygon points="6,4 20,12 6,20"/></svg>';
  openCardMoreMenu(anchorEl, [
    { label: 'Reproducir secuencia', icon: ICO_PLAY, onSelect: () => loadSongAudioIntoTimeline(song, 'sequence') },
    { label: 'Reproducir original',  icon: ICO_PLAY, onSelect: () => loadSongAudioIntoTimeline(song, 'original') },
  ]);
}

// Carga el audio ya asignado de una canción (secuencia u original) como una
// pista del timeline de Stems y lo reproduce. Si ya hay un multitrack cargado,
// pide confirmación porque vacía el proyecto actual: mezclar una mezcla
// terminada con stems crudos no tiene sentido. Mismo patrón que importFiles.
async function loadSongAudioIntoTimeline(song, type) {
  const url = song?.audio?.[type];
  if (!url) { showToast('Esa canción no tiene ese audio asignado.', 'info'); return; }
  const typeLabel = type === 'sequence' ? 'Secuencia' : 'Original';

  if (engine.getTracks().length > 0) {
    const ok = await confirmDialogAsync({
      title: 'Cargar canción en el timeline',
      message: `Esto vaciará el proyecto actual y cargará «${song.title}» (${typeLabel}). ¿Continuar?`,
      confirmLabel: 'Cargar', danger: true,
    });
    if (!ok) return;
    await resetProject();
  }

  showImportOverlay(1);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  updateImportOverlay(0, 1, song.title || '');
  try {
    const arrayBuffer = await window.electronAPI.readAudioFile(url);
    const id = `t${nextTrackId++}`;
    const name = `${song.title || 'Canción'} · ${typeLabel}`;
    await engine.addTrack({ id, name, arrayBuffer });
    engine.setTrackColor(id, nextStemColor());
    const fname = `${String(song.title || 'cancion').replace(/[^\w.-]+/g, '_')}-${type}.mp3`;
    const savedPath = await projectStore.saveStem(id, fname, arrayBuffer);
    appendTrackRow(id, savedPath);
    // El nombre del proyecto pasa a ser la canción, para que se entienda de un
    // vistazo qué se está oyendo (en vez de quedar como "Mi proyecto").
    projectName = song.title || 'Mi proyecto';
    const nameInput = document.getElementById('stems-project-name');
    if (nameInput) nameInput.value = projectName;
    updateImportOverlay(1, 1, '');
    await new Promise(r => setTimeout(r, 250));
    hideImportOverlay();
    refreshTransport();
    scheduleSave();
    engine.seek(0);
    engine.play();
  } catch (err) {
    hideImportOverlay();
    console.error('No se pudo cargar el audio de la canción', err);
    toast(`No se pudo cargar «${song.title || ''}»: ${err.message || err}`);
  }
}

function refreshSetlistPanelKeepingSearch() {
  const se = document.querySelector('#stems-setlist .ssl-search');
  renderSetlistPanel(se ? se.value : '');
}

// Crea una canción nueva desde el panel de Stems usando EL MISMO formulario que
// Pads (songEditFormHTML), dentro de un modal. Al guardar, persiste y refresca.
function addSongFromStems() {
  const newSong = {
    id: 'song_' + Date.now(),
    addedAt: Date.now(),
    title: 'Nueva Canción',
    artist: '',
    bpm: '',
    key: '',
    genre: 'adoracion',
    tags: [],
    audio: { sequence: null, original: null },
  };
  const overlay = document.createElement('div');
  overlay.className = 'stems-newsong-overlay';
  overlay.innerHTML = `<div class="stems-newsong-modal">${songEditFormHTML(newSong, { placeholderForNewSong: true })}</div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.stems-newsong-modal');

  const pop = pushModal(() => close(), modal);
  const close = () => { try { pop(); } catch (_) {} overlay.remove(); };

  setTimeout(() => { try { modal.querySelector('.edit-title').focus(); } catch (_) {} }, 40);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit-cancel') { close(); return; }
    if (action !== 'edit-save') return;
    const titleEl = modal.querySelector('.edit-title');
    const t = titleEl.value.trim();
    if (!t) { titleEl.focus(); return; }
    newSong.title = t;
    newSong.artist = modal.querySelector('.edit-artist').value.trim();
    newSong.bpm = modal.querySelector('.edit-bpm').value.trim();
    newSong.key = modal.querySelector('.edit-key').value;
    newSong.genre = modal.querySelector('.edit-genre').value;
    const tagsEl = modal.querySelector('.edit-tags');
    newSong.tags = tagsEl ? tagsEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    // Biblioteca elegida en el form (si hay selector): así la canción aparece en
    // esa librería de Pads, no solo en "Todas".
    applyLibrarySelection(modal, newSong);
    getSongs().push(newSong);
    if (window.electronAPI?.saveGiSetlist) window.electronAPI.saveGiSetlist(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
    refreshSetlistPanelKeepingSearch();
    showToast(`✓ «${t}» agregada. Clic derecho para cargarle secuencia u original.`, 'success');
    close();
  });
}

// (loadSlotFromFile + loadOriginalFromYoutube se movieron al módulo compartido
//  ui/songMenu.js — los usan tanto Stems como las tarjetas de Pads.)

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
        path: entry ? entry.row.dataset.path : null,
        // Pistas MIDI: guardamos las notas editables (el audio va por `path`).
        notes: t.kind === 'midi' ? (trackNotes.get(t.id) || []) : undefined,
        instrument: t.kind === 'midi' ? (trackInstrument.get(t.id) || 'piano') : undefined,
      };
    });
    await projectStore.saveCurrent({
      projectName,
      bpm, bpmFloat, beatsPerBar, beatValue,
      accentPattern,
      projectKey,             // clave musical (habilita armonías diatónicas)
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
    bpmFloat = (typeof state.bpmFloat === 'number') ? state.bpmFloat : state.bpm;
    document.getElementById('stems-bpm').value = bpm;
  }
  if (typeof state.beatsPerBar === 'number') beatsPerBar = state.beatsPerBar;
  if (typeof state.beatValue === 'number') beatValue = state.beatValue;
  // Tonalidad del proyecto — string ("C", "Am", etc.) o null si no se fijó.
  // El display refleja la efectiva (= original transpuesta por el shift
  // master vigente). En este punto currentStemsPitch ya está en 0 porque
  // resetProject() corre antes de rehydrate; igual llamamos al pintor para
  // mantener la invariante "select = effective".
  projectKey = (typeof state.projectKey === 'string' && state.projectKey) ? state.projectKey : null;
  paintEffectiveKeyUI();
  const sigSel = document.getElementById('stems-sig');
  if (sigSel) sigSel.value = `${beatsPerBar}/${beatValue}`;
  // Restore the accent pattern (fall back to a sane default if absent/stale).
  accentPattern = (Array.isArray(state.accentPattern) && state.accentPattern.length === beatsPerBar)
    ? state.accentPattern.map(Boolean)
    : makeDefaultAccent(beatsPerBar);
  renderAccentChips();

  if (typeof state.masterVolume === 'number') {
    engine.setMasterVolume(state.masterVolume);
    document.getElementById('stems-master-vol').value = Math.round(state.masterVolume * 100);
  }

  // Fetch + decode every stem IN PARALLEL (the slow part — disk read + audio
  // decode). Previously this ran one track at a time, so on reopen the tracks
  // trickled in one by one. Now they all decode at once and we add them in
  // the saved order once ready.
  const trackList = (state.tracks || []).filter(t => t.path);
  const ctx = engine.getAudioContext();
  // Mientras se descargan/decodifican los stems guardados, el timeline está
  // vacío y parpadeaba el estado "Sin pistas aún". Mostramos un overlay de
  // "Cargando proyecto…" con progreso para que se entienda que está trabajando.
  if (trackList.length) {
    const empty = document.getElementById('stems-empty');
    if (empty) empty.hidden = true;
    showRestoreOverlay(trackList.length);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  let restoreDone = 0;
  const decoded = await Promise.all(trackList.map(async (t) => {
    try {
      const arrayBuffer = await projectStore.fetchStem(t.path);
      const audioBuffer = await engine.decodeAudio(arrayBuffer);
      return { t, audioBuffer };
    } catch (e) {
      console.warn('Could not load stem', t.id, e);
      return null;
    } finally {
      if (trackList.length) updateRestoreOverlay(++restoreDone, trackList.length);
    }
  }));
  for (const d of decoded) {
    if (!d) continue;
    const { t, audioBuffer } = d;
    try {
      await engine.addTrack({ id: t.id, name: t.name, audioBuffer, kind: t.kind || 'stem', offsetSec: t.offsetSec || 0 });
      engine.setTrackVolume(t.id, t.volume);
      engine.setTrackPan(t.id, t.pan);
      if (t.muted)  engine.setTrackMuted(t.id, true);
      if (t.soloed) engine.setTrackSoloed(t.id, true);
      if (t.color)  engine.setTrackColor(t.id, t.color);
      // Pistas MIDI: restaura las notas ANTES de pintar la fila (drawMidiRow las usa).
      if (t.kind === 'midi' && Array.isArray(t.notes)) trackNotes.set(t.id, t.notes);
      if (t.kind === 'midi') trackInstrument.set(t.id, t.instrument || 'piano');
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
  hideRestoreOverlay();
  requestAnimationFrame(repaintAllFaders);
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
      toast('Error: ' + (e.message || e));
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
      } catch (e) { toast('No se pudo abrir: ' + (e.message || e)); }
    };
    row.querySelector('[data-act="delete"]').onclick = async () => {
      const projName = row.querySelector('.stems-modal-row-name').textContent;
      const ok = await confirmDialogAsync({
        title: 'Eliminar proyecto',
        message: `¿Eliminar el proyecto "${projName}"? Esto borra sus stems del disco.`,
        confirmLabel: 'Eliminar', danger: true,
      });
      if (!ok) return;
      try {
        await window.electronAPI.stemsDeleteProject(slug);
        row.remove();
      } catch (e) { toast('No se pudo eliminar: ' + (e.message || e)); }
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
  originalBuffers.clear();
  currentStemsPitch = 0;
  paintStemsPitchUI();
  projectKey = null;
  paintEffectiveKeyUI();
  markers = [];
  nextTrackId = 1;
  nextMarkerId = 1;
  projectName = 'Mi proyecto';
  bpm = 120; bpmFloat = 120; beatsPerBar = 4; beatValue = 4;
  document.getElementById('stems-project-name').value = projectName;
  document.getElementById('stems-bpm').value = bpm;
  document.getElementById('stems-sig').value = '4/4';
  document.getElementById('stems-empty').hidden = false;
  document.getElementById('workspace-stems')?.classList.remove('has-tracks');
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
