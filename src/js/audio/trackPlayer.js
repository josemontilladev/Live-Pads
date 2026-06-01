// Track Player — sequencer / original track playback.
//
// Owns the <audio> element lifecycle plus the bottom-bar transport controls
// (#tp-play-btn, #tp-stop-btn, #tp-loop-btn, #tp-progress, #tp-vol, ...).
// Designed for live offline use: hard releases the audio element between
// loads so the OS audio decoder doesn't get exhausted across long sessions.
//
// State is module-private; the rest of the app interacts via the exported
// helpers (isTrackLoaded, isTrackPlaying) and the deps callbacks supplied
// once at boot by initTrackPlayer().

import { q } from '../utils/dom.js';
import { panShort } from '../utils/format.js';
import { syncPanSlider } from '../utils/sliders.js';
import { PitchAudio } from './pitchAudio.js';

let audio = null;            // PitchAudio (API tipo HTMLAudioElement + pitchSemitones)
let currentType = null;
let currentSong = null;

// Web Audio graph: PitchAudio (fuente con pitch-shift) → pannerNode → destino.
// audioCtx es singleton; pannerNode se reconstruye por carga.
let audioCtx = null;
let pannerNode = null;
let currentPitch = 0;        // semitonos aplicados al audio cargado

// Loop/repeat is a persistent transport mode, not per-track. Held here so the
// button works whether or not a track is loaded, and every freshly loaded
// track inherits it.
let loopEnabled = false;

// True while the user is actively dragging the progress scrubber. Two reasons
// it matters: (1) ontimeupdate must NOT write progress.value while dragging or
// the thumb fights the user's finger; (2) we defer the real seek to drag-release
// so PitchAudio rebuilds its SoundTouch pipeline ONCE instead of ~once per pixel
// (rapid teardown/rebuild of ScriptProcessorNodes was breaking playback).
let isScrubbing = false;

// Injected at boot. Keeps the module decoupled from app.js's globals.
//   syncSlider(el)           : visual update for our sliders
//   onAudioPathAssigned(song, type, newPath)
//                            : called when the user picked a fresh file for
//                              a song that had no audio yet; host should
//                              persist the path and re-render any lists
let deps = {
  syncSlider: () => {},
  onAudioPathAssigned: () => {}
};

export function initTrackPlayer(d) {
  deps = { ...deps, ...d };
}

export const isTrackLoaded  = () => !!(audio && audio.src);
export const isTrackPlaying = () => !!(audio && !audio.paused);
export const getCurrentSong = () => currentSong;
export const getCurrentType = () => currentType;
export const getTrackPitch  = () => currentPitch;

// Ajusta el tono del audio cargado en semitonos (sin alterar el tempo).
// Se acota a ±12 semitonos. Persiste por canción vía deps.persistSong (si existe).
export function setTrackPitch(n) {
  const v = Math.max(-12, Math.min(12, Math.round(Number(n) || 0)));
  currentPitch = v;
  if (audio) { try { audio.pitchSemitones = v; } catch (_) {} }
  if (currentSong) {
    if (!currentSong.audio) currentSong.audio = {};
    currentSong.audio.pitch = v;
    if (typeof deps.persistSong === 'function') {
      try { deps.persistSong(currentSong); } catch (_) {}
    }
  }
  paintPitchUI();
}

function paintPitchUI() {
  const lbl = q('#tp-pitch-val');
  if (!lbl) return;
  lbl.textContent = currentPitch > 0 ? '+' + currentPitch : String(currentPitch);
  const shifted = currentPitch !== 0;
  lbl.classList.toggle('shifted', shifted);
  // Borde del grupo también se tinta para feedback visible aun sin mirar
  // el número.
  const group = lbl.closest('.tp-pitch-group');
  if (group) group.classList.toggle('shifted', shifted);
}

// Asegura un AudioContext singleton antes de crear cualquier nodo.
function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { audioCtx = new AC(); } catch (_) { audioCtx = null; }
  return audioCtx;
}

// Inserta el panner entre la fuente (audio.output) y el destino.
// audio.output es el nodo de ganancia de PitchAudio; pan no afecta el volumen.
function connectPanGraph() {
  if (!audio || !audioCtx) return;
  try {
    pannerNode = audioCtx.createStereoPanner();
    const panEl = els.panSlider;
    pannerNode.pan.value = panEl ? (parseFloat(panEl.value) || 0) / 100 : 0;
    audio.output.connect(pannerNode);
    pannerNode.connect(audioCtx.destination);
  } catch (e) {
    console.warn('Track pan graph unavailable:', e);
    pannerNode = null;
  }
}

// Libera la fuente actual y el panner para que la siguiente carga arranque limpia.
export function cleanupTrackAudio() {
  if (audio) {
    try { audio.output && audio.output.disconnect(); } catch (e) {}
  }
  if (pannerNode) { try { pannerNode.disconnect(); } catch (e) {} pannerNode = null; }
  if (audio) {
    try {
      audio.pause();
      audio.src = '';
      audio.onerror = null;
      audio.ontimeupdate = null;
      audio.onended = null;
    } catch (e) {
      console.warn('Error cleaning up audio element:', e);
    }
    audio = null;
  }
}

export function loadAndPlayTrack(song, type) {
  cleanupTrackAudio();
  currentSong = song;
  const path = (song.audio && song.audio[type]) ? song.audio[type] : null;

  if (!path) {
    // Song has no audio yet for this slot — let the user pick a file.
    if (window.electronAPI && window.electronAPI.openAudioFile) {
      window.electronAPI.openAudioFile().then(async (file) => {
        if (file && file.path) {
          const newPath = await window.electronAPI.assignAudioFile({ sourcePath: file.path, type });
          if (!song.audio) song.audio = {};
          song.audio[type] = newPath;
          deps.onAudioPathAssigned(song, type, newPath);
          startTrackPlayback(newPath, song.title, type);
        }
      });
    } else {
      const input = q('#tp-file-input');
      if (!input) return;
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) startTrackPlayback(URL.createObjectURL(file), song.title, type);
        input.value = '';
      };
      input.click();
    }
  } else {
    startTrackPlayback(path, song.title, type);
  }
}

async function resolvePlayableUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Old paths sometimes wrote '../assets/...' — normalize.
  let safeUrl = url.replace('../assets/', 'assets/');

  const needsResolve = (!safeUrl.startsWith('blob:') &&
                       !safeUrl.startsWith('http') &&
                       !safeUrl.startsWith('file:') &&
                       !safeUrl.startsWith('livepads://'))
                       || safeUrl.includes('/livepads/');

  if (needsResolve) {
    if (window.electronAPI && window.electronAPI.getAbsolutePath) {
      try {
        const absPath = await window.electronAPI.getAbsolutePath(safeUrl);
        const fileUrl = 'file:///' + absPath.replace(/\\/g, '/');
        safeUrl = encodeURI(fileUrl).replace(/#/g, '%23').replace(/\?/g, '%3F');
      } catch (e) {
        console.error('Error resolving absolute path:', e);
      }
    } else {
      safeUrl = encodeURI(url).replace(/#/g, '%23').replace(/\?/g, '%3F');
      if (!safeUrl.startsWith('./') && !safeUrl.startsWith('/')) safeUrl = './' + safeUrl;
    }
  }
  return safeUrl;
}

const PLAY_ICON  = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5,3 19,12 5,21"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';

function formatTime(seconds) {
  // !isFinite covers both NaN (no metadata yet) and Infinity (streams whose
  // length the decoder can't determine) so we never render "Infinity:NaN".
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// DOM element refs are cached lazily — populated on first track playback and
// reused across all subsequent renders so ontimeupdate (firing ~4×/sec)
// doesn't hit querySelector on every tick.
const els = {};
function cacheTrackPlayerEls() {
  if (els.cached) return;
  els.title    = q('#tp-title');
  els.timeCur  = q('#tp-time-current');
  els.timeTot  = q('#tp-time-total');
  els.progress = q('#tp-progress');
  els.playBtn  = q('#tp-play-btn');
  els.stopBtn  = q('#tp-stop-btn');
  els.restartBtn = q('#tp-restart-btn');
  els.loopBtn  = q('#tp-loop-btn');
  els.closeBtn = q('#tp-close-btn');
  els.volSlider = q('#tp-vol');
  els.panSlider = q('#tp-pan');
  els.panVal   = q('#tp-pan-val');
  els.cached = true;
}

async function startTrackPlayback(url, title, type) {
  const safeUrl = await resolvePlayableUrl(url);
  cacheTrackPlayerEls();

  // PitchAudio: fuente Web Audio con desplazamiento de tono (SoundTouchJS).
  // Requiere el audioCtx creado de antemano (a diferencia del flujo anterior
  // basado en HTMLAudioElement + createMediaElementSource lazy).
  if (!ensureAudioCtx()) { console.warn('Web Audio no disponible'); return; }
  audio = new PitchAudio(audioCtx);
  // Restaurar tono guardado en la canción (si lo hay) antes de cargar el audio.
  currentPitch = Number((currentSong && currentSong.audio && currentSong.audio.pitch) || 0) || 0;
  audio.pitchSemitones = currentPitch;
  audio.src = safeUrl;
  currentType = type;
  connectPanGraph();
  paintPitchUI();

  // The pan graph routes audio through the context, so a suspended context
  // means silence. Resume on every play start, whatever triggered it
  // (manual button, master transport, auto-advance).
  audio.addEventListener('play', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  audio.onerror = (e) => {
    console.error('Error loading audio:', safeUrl, e);
    if (els.title) els.title.textContent = 'Error al cargar audio';
  };

  if (els.title) els.title.textContent = title + (type === 'sequence' ? ' (Secuencia)' : ' (Original)');

  const updatePlayBtn = () => {
    if (!els.playBtn) return;
    els.playBtn.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON;
    els.playBtn.style.transform = audio.paused ? 'scale(1)' : 'scale(0.96)';
  };

  if (els.playBtn) els.playBtn.onclick = () => {
    if (audio.paused) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      audio.play();
    } else {
      audio.pause();
    }
    updatePlayBtn();
  };

  // Pause (keeps the playhead where it is). Returning to the start is the
  // restart button's job now.
  if (els.stopBtn) els.stopBtn.onclick = () => {
    audio.pause();
    updatePlayBtn();
  };

  // Restart: jump back to the start while preserving the play/pause state —
  // if it was playing it keeps playing from 0, distinct from Stop (which
  // halts and resets).
  if (els.restartBtn) els.restartBtn.onclick = () => {
    const wasPlaying = !audio.paused;
    audio.currentTime = 0;
    if (wasPlaying) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      audio.play();
    }
    updatePlayBtn();
    if (els.progress) { els.progress.value = 0; deps.syncSlider(els.progress); }
    if (els.timeCur) els.timeCur.textContent = '0:00';
  };

  // The freshly loaded track inherits the persistent loop mode. The button
  // itself is wired once in bindTrackPlayerControls().
  audio.loop = loopEnabled;

  // Capture refs locally to skip repeated property access on hot path.
  const { timeCur, timeTot, progress } = els;
  const syncSlider = deps.syncSlider;

  audio.ontimeupdate = () => {
    // While the user is scrubbing, the progress bar + time label reflect the
    // drag target, not the (still-old) playhead — don't overwrite them.
    if (isScrubbing) return;
    if (timeCur) timeCur.textContent = formatTime(audio.currentTime);
    if (audio.duration) {
      if (timeTot) timeTot.textContent = formatTime(audio.duration);
      if (progress) {
        progress.value = (audio.currentTime / audio.duration) * 100;
        syncSlider(progress);
      }
    }
  };

  // Some encodings (notably VBR MP3 served without a Content-Length) report
  // duration === Infinity until the decoder scans to the end. Nudge it: seek
  // far past the end so the browser computes the real duration, then snap
  // (The old Infinity-duration "seek to the end and back" hack was removed: it
  // fought with playback and caused the track to jump back to 0 mid-song. With
  // the livepads:// protocol now honouring byte ranges, the media element gets
  // the real duration on its own and can seek normally.)

  // Stamp the duration onto the song + the readout once it's known. The
  // service-list total-time estimate (updateServiceMeta) sums these so the
  // user sees a real ETA instead of a 4-min heuristic per song.
  const stampDuration = () => {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    if (timeTot) timeTot.textContent = formatTime(audio.duration);
    if (currentSong && (!currentSong.durationSec || currentSong.durationSec !== Math.round(audio.duration))) {
      currentSong.durationSec = Math.round(audio.duration);
      if (typeof deps.onDurationDiscovered === 'function') {
        deps.onDurationDiscovered(currentSong);
      }
    }
  };
  audio.addEventListener('loadedmetadata', stampDuration);
  audio.addEventListener('durationchange', stampDuration);

  if (els.volSlider) audio.volume = els.volSlider.value / 100;

  if (els.closeBtn) els.closeBtn.onclick = () => {
    cleanupTrackAudio();
    if (els.title)    els.title.textContent = 'Ninguna pista cargada';
    if (els.timeCur)  els.timeCur.textContent = '0:00';
    if (els.timeTot)  els.timeTot.textContent = '0:00';
    if (els.progress) { els.progress.value = 0; deps.syncSlider(els.progress); }
    if (els.playBtn)  els.playBtn.innerHTML = PLAY_ICON;
  };

  audio.onended = () => {
    updatePlayBtn();
    if (els.progress) { els.progress.value = 0; deps.syncSlider(els.progress); }
    if (els.timeCur)  els.timeCur.textContent = '0:00';
    if (deps.onTrackEnded) deps.onTrackEnded();
  };

  updatePlayBtn();
}

function paintLoopBtn(btn, on) {
  btn.classList.toggle('active', on);
  btn.title = on ? 'Repetir: activado' : 'Repetir (Loop)';
}

// Wire the volume slider and seek bar once at boot.
export function bindTrackPlayerControls() {
  const tpVolSlider = q('#tp-vol');
  const tpVolVal = q('#tp-vol-val');
  if (tpVolSlider && tpVolVal) {
    tpVolSlider.oninput = (e) => {
      if (audio) audio.volume = e.target.value / 100;
      tpVolVal.textContent = e.target.value + '%';
      deps.syncSlider(e.target);
    };
    deps.syncSlider(tpVolSlider);
  }

  // Loop/repeat toggle — wired once. Works with or without a track loaded;
  // a track applies the mode on load (see startTrackPlayback).
  const tpLoopBtn = q('#tp-loop-btn');
  if (tpLoopBtn) {
    paintLoopBtn(tpLoopBtn, loopEnabled);
    tpLoopBtn.onclick = () => {
      loopEnabled = !loopEnabled;
      if (audio) audio.loop = loopEnabled;
      paintLoopBtn(tpLoopBtn, loopEnabled);
    };
  }

  const tpPanSlider = q('#tp-pan');
  const tpPanVal = q('#tp-pan-val');
  if (tpPanSlider && tpPanVal) {
    tpPanSlider.oninput = (e) => {
      const v = parseFloat(e.target.value) || 0;
      if (pannerNode) pannerNode.pan.value = v / 100;
      tpPanVal.textContent = panShort(v);
      syncPanSlider(e.target);
    };
    syncPanSlider(tpPanSlider);
  }

  const tpProgress = q('#tp-progress');
  if (tpProgress) {
    // oninput fires continuously during a drag — only give visual feedback
    // (fill + time preview). Committing audio.currentTime here would rebuild
    // the SoundTouch pipeline dozens of times/sec and break playback.
    tpProgress.oninput = (e) => {
      isScrubbing = true;
      deps.syncSlider(e.target);
      if (audio && isFinite(audio.duration)) {
        const t = (e.target.value / 100) * audio.duration;
        const tc = q('#tp-time-current');
        if (tc) tc.textContent = formatTime(t);
      }
    };
    // onchange fires once, on drag-release (or click / keyboard) — this is where
    // the real seek happens, so the shifter is rebuilt a single time.
    tpProgress.onchange = (e) => {
      if (audio && isFinite(audio.duration)) {
        audio.currentTime = (e.target.value / 100) * audio.duration;
      }
      isScrubbing = false;
      deps.syncSlider(e.target);
    };
    deps.syncSlider(tpProgress);
  }

  // Pitch (tono): ±1 semitono sin alterar el tempo (SoundTouchJS).
  const tpPitchUp = q('#tp-pitch-up');
  const tpPitchDown = q('#tp-pitch-down');
  const tpPitchReset = q('#tp-pitch-val');
  if (tpPitchUp)   tpPitchUp.onclick   = () => setTrackPitch(currentPitch + 1);
  if (tpPitchDown) tpPitchDown.onclick = () => setTrackPitch(currentPitch - 1);
  // Doble-clic en el contador para resetear a 0.
  if (tpPitchReset) tpPitchReset.ondblclick = () => setTrackPitch(0);
  paintPitchUI();
}

// Used by master play/stop logic for the "Sin pista seleccionada" reset.
export function clearTrackUI() {
  cleanupTrackAudio();
  const tt = q('#tp-title'); if (tt) tt.textContent = 'Sin pista seleccionada';
  const tc = q('#tp-time-current'); if (tc) tc.textContent = '0:00';
  const tot = q('#tp-time-total'); if (tot) tot.textContent = '0:00';
  const prog = q('#tp-progress'); if (prog) prog.value = 0;
  const playBtn = q('#tp-play-btn');
  if (playBtn) playBtn.innerHTML = PLAY_ICON;
}

// Programmatic toggle for the master play/stop bindings.
export function clickPlayPause() {
  const btn = q('#tp-play-btn');
  if (btn) btn.click();
}
