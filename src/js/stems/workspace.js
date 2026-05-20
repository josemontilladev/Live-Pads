// Stem Editor workspace — Phase 1+2.
// Mounts the editor UI, wires drag-drop / file picker imports, renders
// track strips (name, vol, pan, mute, solo, remove), transport, master
// volume, and project header with rename + new. Auto-saves current state
// to userData/StemProjects/current/ via IPC so the user doesn't lose mixes
// across restarts.

import * as engine from './engine.js';
import * as projectStore from './projectStore.js';
import { exportMix } from './exporter.js';

const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>`;
const SVG_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;
const SVG_NEW = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="10" y1="15" x2="14" y2="15"/></svg>`;

let mounted = false;
let nextTrackId = 1;
const trackEls = new Map(); // id → row element
let projectName = 'Mi proyecto';
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 800;

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export async function mount() {
  if (mounted) return;
  mounted = true;

  engine.init({
    onPlayingChange: applyPlayingState,
    onTimeUpdate: applyTimeUpdate
  });

  const root = document.getElementById('workspace-stems');
  if (!root) return;

  root.innerHTML = `
    <div class="stems-shell">
      <header class="stems-header">
        <div class="stems-titlebar">
          <input class="stems-project-name" id="stems-project-name" value="Mi proyecto" spellcheck="false">
          <span class="stems-sub">Carga tus stems, ajusta volumen y paneo, exporta una mezcla a MP3.</span>
        </div>
        <div class="stems-header-actions">
          <button class="stems-btn" id="stems-new" title="Vaciar el proyecto actual">${SVG_NEW} Nuevo</button>
          <button class="stems-btn" id="stems-export" disabled title="Exportar la mezcla a MP3">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar MP3
          </button>
          <button class="stems-btn stems-btn--primary" id="stems-import">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Importar stems
          </button>
          <input type="file" id="stems-file-input" accept="audio/*" multiple hidden>
        </div>
      </header>

      <section class="stems-tracks" id="stems-tracks">
        <div class="stems-empty" id="stems-empty">
          <div class="stems-empty-icon">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="48" height="48"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
          <h3>Arrastra tus stems aquí</h3>
          <p>O usa <strong>Importar stems</strong> arriba. Soporta WAV, MP3, OGG, AAC.</p>
        </div>
      </section>

      <footer class="stems-transport">
        <div class="stems-transport-left">
          <button class="stems-play" id="stems-play" disabled>${SVG_PLAY}</button>
          <div class="stems-time">
            <span id="stems-current">0:00</span>
            <span class="stems-sep">/</span>
            <span id="stems-total">0:00</span>
          </div>
        </div>
        <div class="stems-transport-right">
          <label class="stems-master">
            <span>Master</span>
            <input type="range" min="0" max="100" value="85" id="stems-master-vol" class="stems-range">
          </label>
          <span class="stems-save-pill" id="stems-save-pill" hidden>Guardado ✓</span>
        </div>
      </footer>

      <div class="stems-export-overlay" id="stems-export-overlay" hidden>
        <div class="stems-export-panel">
          <h3 id="stems-export-title">Renderizando mezcla…</h3>
          <p id="stems-export-stage" class="stems-export-stage">Preparando audio</p>
          <div class="stems-export-bar"><div class="stems-export-fill" id="stems-export-fill"></div></div>
        </div>
      </div>
    </div>
  `;

  wireEvents(root);

  // Restore the auto-saved project (if any) — silently.
  try {
    const restored = await projectStore.loadCurrent();
    if (restored && restored.tracks && restored.tracks.length) {
      await rehydrate(restored);
    }
  } catch (e) {
    console.warn('Could not restore stem project:', e);
  }
}

function wireEvents(root) {
  const fileInput = root.querySelector('#stems-file-input');
  root.querySelector('#stems-import').onclick = () => fileInput.click();
  fileInput.onchange = (e) => importFiles(e.target.files);

  root.querySelector('#stems-play').onclick = () => {
    if (engine.isCurrentlyPlaying()) engine.stop();
    else engine.play();
  };

  root.querySelector('#stems-master-vol').oninput = (e) => {
    engine.setMasterVolume(parseInt(e.target.value, 10) / 100);
    scheduleSave();
  };

  root.querySelector('#stems-new').onclick = async () => {
    if (engine.getTracks().length === 0) return;
    if (!confirm('¿Vaciar el proyecto actual? Esta acción no se puede deshacer.')) return;
    await resetProject();
  };

  root.querySelector('#stems-export').onclick = async () => {
    if (engine.getTracks().length === 0) return;
    await runExport();
  };

  const nameInput = root.querySelector('#stems-project-name');
  nameInput.addEventListener('input', () => {
    projectName = nameInput.value.trim() || 'Mi proyecto';
    scheduleSave();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });

  // Drag-and-drop file import — anywhere over the workspace counts.
  ['dragenter', 'dragover'].forEach(evt => {
    root.addEventListener(evt, (e) => {
      e.preventDefault();
      root.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    root.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && e.target !== root) return;
      root.classList.remove('is-dragover');
    });
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  });
}

async function importFiles(fileList) {
  if (!fileList || !fileList.length) return;
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(file.name)) continue;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const id = `t${nextTrackId++}`;
      const name = file.name.replace(/\.[^.]+$/, '');
      await engine.addTrack({ id, name, arrayBuffer });
      // Persist the raw stem to disk so we can rehydrate next launch.
      const savedPath = await projectStore.saveStem(id, file.name, arrayBuffer);
      appendTrackStrip(id, savedPath);
    } catch (err) {
      console.error('Failed to import', file.name, err);
      alert(`No se pudo importar "${file.name}": ${err.message || err}`);
    }
  }
  refreshTransport();
  scheduleSave();
}

function appendTrackStrip(id, savedPath) {
  const all = engine.getTracks();
  const track = all.find(t => t.id === id);
  if (!track) return;

  const empty = document.getElementById('stems-empty');
  if (empty) empty.hidden = true;

  const list = document.getElementById('stems-tracks');
  const row = document.createElement('div');
  row.className = 'stems-track';
  row.dataset.trackId = id;
  if (savedPath) row.dataset.path = savedPath;
  row.innerHTML = buildTrackRowHtml(track);
  list.appendChild(row);
  trackEls.set(id, row);
  wireTrackRow(row, id);
}

function buildTrackRowHtml(track) {
  return `
    <div class="stems-track-info">
      <input class="stems-track-name" value="${escapeAttr(track.name)}" spellcheck="false">
      <span class="stems-track-dur">${formatTime(track.durationSec)}</span>
    </div>
    <div class="stems-track-controls">
      <div class="stems-mute-solo">
        <button class="stems-ms stems-ms--mute ${track.muted ? 'is-on' : ''}" data-action="mute" title="Silenciar">M</button>
        <button class="stems-ms stems-ms--solo ${track.soloed ? 'is-on' : ''}" data-action="solo" title="Solo">S</button>
      </div>
      <div class="stems-knob-group">
        <span class="stems-knob-label">Pan</span>
        <input type="range" min="-100" max="100" value="${Math.round(track.pan * 100)}" class="stems-range stems-track-pan" data-action="pan">
        <span class="stems-pan-readout">${panLabel(track.pan)}</span>
      </div>
      <div class="stems-knob-group">
        <span class="stems-knob-label">Vol</span>
        <input type="range" min="0" max="100" value="${Math.round(track.volume * 100)}" class="stems-range stems-track-vol" data-action="vol">
      </div>
      <button class="stems-track-remove" title="Eliminar" data-action="remove">${SVG_TRASH}</button>
    </div>
  `;
}

function wireTrackRow(row, id) {
  const nameInput = row.querySelector('.stems-track-name');
  nameInput.addEventListener('input', () => {
    engine.renameTrack(id, nameInput.value);
    scheduleSave();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });

  row.querySelector('[data-action="vol"]').oninput = (e) => {
    engine.setTrackVolume(id, parseInt(e.target.value, 10) / 100);
    scheduleSave();
  };
  row.querySelector('[data-action="pan"]').oninput = (e) => {
    const pan = parseInt(e.target.value, 10) / 100;
    engine.setTrackPan(id, pan);
    row.querySelector('.stems-pan-readout').textContent = panLabel(pan);
    scheduleSave();
  };

  const muteBtn = row.querySelector('[data-action="mute"]');
  muteBtn.onclick = () => {
    const next = !muteBtn.classList.contains('is-on');
    engine.setTrackMuted(id, next);
    muteBtn.classList.toggle('is-on', next);
    reflectSoloHighlights();
    scheduleSave();
  };

  const soloBtn = row.querySelector('[data-action="solo"]');
  soloBtn.onclick = () => {
    const next = !soloBtn.classList.contains('is-on');
    engine.setTrackSoloed(id, next);
    soloBtn.classList.toggle('is-on', next);
    reflectSoloHighlights();
    scheduleSave();
  };

  row.querySelector('[data-action="remove"]').onclick = async () => {
    if (!confirm('¿Eliminar esta pista del proyecto?')) return;
    engine.removeTrack(id);
    await projectStore.removeStem(row.dataset.path);
    row.remove();
    trackEls.delete(id);
    const empty = document.getElementById('stems-empty');
    if (trackEls.size === 0 && empty) empty.hidden = false;
    refreshTransport();
    reflectSoloHighlights();
    scheduleSave();
  };
}

function panLabel(pan) {
  if (Math.abs(pan) < 0.04) return 'C';
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}

// When any track is soloed, dim the non-soloed/non-muted-but-silenced rows
// so the user has a visual cue why some tracks went quiet.
function reflectSoloHighlights() {
  const anySoloed = engine.getTracks().some(t => t.soloed);
  for (const [id, row] of trackEls.entries()) {
    const t = engine.getTracks().find(tr => tr.id === id);
    if (!t) continue;
    row.classList.toggle('is-silenced', t.muted || (anySoloed && !t.soloed));
  }
}

function refreshTransport() {
  const totalSec = engine.getDurationSec();
  document.getElementById('stems-total').textContent = formatTime(totalSec);
  document.getElementById('stems-play').disabled = totalSec === 0;
  const exportBtn = document.getElementById('stems-export');
  if (exportBtn) exportBtn.disabled = engine.getTracks().length === 0;
}

// ── Export to MP3 ─────────────────────────────────────────────────

async function runExport() {
  if (engine.isCurrentlyPlaying()) engine.stop();

  const overlay = document.getElementById('stems-export-overlay');
  const fill    = document.getElementById('stems-export-fill');
  const stageEl = document.getElementById('stems-export-stage');
  const titleEl = document.getElementById('stems-export-title');

  overlay.hidden = false;
  titleEl.textContent = 'Renderizando mezcla…';
  stageEl.textContent = 'Preparando audio';
  fill.style.width = '0%';

  try {
    const mp3Bytes = await exportMix((progress, stage) => {
      // 0-50% render, 50-100% encode — gives a single linear bar.
      const linear = stage === 'render' ? progress * 0.5 : 0.5 + progress * 0.5;
      fill.style.width = `${Math.round(linear * 100)}%`;
      stageEl.textContent = stage === 'render'
        ? 'Renderizando mezcla con paneos y volúmenes'
        : 'Codificando a MP3';
    });

    titleEl.textContent = 'Guardando archivo…';
    stageEl.textContent = 'Elige dónde guardar el .mp3';
    const savedPath = await window.electronAPI.stemsExportMp3({
      suggestedName: projectName,
      buffer: mp3Bytes.buffer
    });

    if (savedPath) {
      titleEl.textContent = 'Mezcla exportada ✓';
      stageEl.textContent = savedPath;
      setTimeout(() => { overlay.hidden = true; }, 1800);
    } else {
      // User canceled the save dialog — just close the overlay.
      overlay.hidden = true;
    }
  } catch (e) {
    console.error('Stem export failed:', e);
    titleEl.textContent = 'Error al exportar';
    stageEl.textContent = e.message || String(e);
    setTimeout(() => { overlay.hidden = true; }, 3000);
  }
}

function applyPlayingState(playing) {
  const btn = document.getElementById('stems-play');
  if (!btn) return;
  btn.innerHTML = playing ? SVG_STOP : SVG_PLAY;
  btn.classList.toggle('is-playing', playing);
}

function applyTimeUpdate(sec) {
  const el = document.getElementById('stems-current');
  if (el) el.textContent = formatTime(sec);
}

// ── Persistence orchestration ──────────────────────────────────────

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

async function doSave() {
  saveTimer = null;
  try {
    const tracks = engine.getTracks().map(t => {
      const row = trackEls.get(t.id);
      return {
        id: t.id,
        name: t.name,
        volume: t.volume,
        pan: t.pan,
        muted: t.muted,
        soloed: t.soloed,
        path: row ? row.dataset.path : null
      };
    });
    await projectStore.saveCurrent({
      projectName,
      masterVolume: engine.getMasterVolume(),
      nextTrackId,
      tracks
    });
    flashSavedPill();
  } catch (e) {
    console.warn('Stem auto-save failed:', e);
  }
}

let pillTimer = null;
function flashSavedPill() {
  const pill = document.getElementById('stems-save-pill');
  if (!pill) return;
  pill.hidden = false;
  pill.classList.add('is-on');
  if (pillTimer) clearTimeout(pillTimer);
  pillTimer = setTimeout(() => pill.classList.remove('is-on'), 1500);
}

async function rehydrate(state) {
  projectName = state.projectName || 'Mi proyecto';
  const nameInput = document.getElementById('stems-project-name');
  if (nameInput) nameInput.value = projectName;

  if (typeof state.masterVolume === 'number') {
    engine.setMasterVolume(state.masterVolume);
    const slider = document.getElementById('stems-master-vol');
    if (slider) slider.value = Math.round(state.masterVolume * 100);
  }

  // Restore each track: fetch the stored file via livepads:// → decode → register.
  for (const t of state.tracks || []) {
    if (!t.path) continue;
    try {
      const arrayBuffer = await projectStore.fetchStem(t.path);
      await engine.addTrack({ id: t.id, name: t.name, arrayBuffer });
      // Apply saved knob values now that the buffer is in the engine.
      engine.setTrackVolume(t.id, t.volume);
      engine.setTrackPan(t.id, t.pan);
      if (t.muted)  engine.setTrackMuted(t.id, true);
      if (t.soloed) engine.setTrackSoloed(t.id, true);
      appendTrackStrip(t.id, t.path);
    } catch (e) {
      console.warn('Could not restore stem', t.id, e);
    }
  }

  if (typeof state.nextTrackId === 'number') nextTrackId = state.nextTrackId;
  refreshTransport();
  reflectSoloHighlights();
}

async function resetProject() {
  // Tear down every active track in the engine + UI, drop saved stems.
  if (engine.isCurrentlyPlaying()) engine.stop();
  for (const id of Array.from(trackEls.keys())) {
    const row = trackEls.get(id);
    engine.removeTrack(id);
    if (row) {
      await projectStore.removeStem(row.dataset.path);
      row.remove();
    }
  }
  trackEls.clear();
  nextTrackId = 1;
  projectName = 'Mi proyecto';
  document.getElementById('stems-project-name').value = projectName;
  const empty = document.getElementById('stems-empty');
  if (empty) empty.hidden = false;
  refreshTransport();
  await projectStore.clearCurrent();
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
