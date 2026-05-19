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

let audio = null;
let currentType = null;
let currentSong = null;

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

// Safe audio release and hardware decoder garbage collection
export function cleanupTrackAudio() {
  if (audio) {
    try {
      audio.pause();
      audio.src = '';
      audio.load(); // Force immediate release of OS audio resources
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
  if (isNaN(seconds)) return '0:00';
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
  els.loopBtn  = q('#tp-loop-btn');
  els.closeBtn = q('#tp-close-btn');
  els.volSlider = q('#tp-vol');
  els.cached = true;
}

async function startTrackPlayback(url, title, type) {
  const safeUrl = await resolvePlayableUrl(url);
  cacheTrackPlayerEls();

  audio = new Audio(safeUrl);
  currentType = type;

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
    if (audio.paused) audio.play(); else audio.pause();
    updatePlayBtn();
  };

  if (els.stopBtn) els.stopBtn.onclick = () => {
    audio.pause();
    audio.currentTime = 0;
    updatePlayBtn();
    if (els.progress) els.progress.value = 0;
    if (els.timeCur) els.timeCur.textContent = '0:00';
  };

  if (els.loopBtn) {
    if (!els.loopBtn.dataset.active) els.loopBtn.dataset.active = 'false';
    audio.loop = els.loopBtn.dataset.active === 'true';
    paintLoopBtn(els.loopBtn, audio.loop);
    els.loopBtn.onclick = () => {
      audio.loop = !audio.loop;
      els.loopBtn.dataset.active = audio.loop ? 'true' : 'false';
      paintLoopBtn(els.loopBtn, audio.loop);
    };
  }

  // Capture refs locally to skip repeated property access on hot path.
  const { timeCur, timeTot, progress } = els;
  const syncSlider = deps.syncSlider;

  audio.ontimeupdate = () => {
    if (timeCur) timeCur.textContent = formatTime(audio.currentTime);
    if (audio.duration) {
      if (timeTot) timeTot.textContent = formatTime(audio.duration);
      if (progress) {
        progress.value = (audio.currentTime / audio.duration) * 100;
        syncSlider(progress);
      }
    }
  };

  // Stamp the duration onto the song the first time we discover it. The
  // service-list total-time estimate (updateServiceMeta) sums these so
  // the user sees a real ETA instead of a 4-min heuristic per song.
  audio.addEventListener('loadedmetadata', () => {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    if (currentSong && (!currentSong.durationSec || currentSong.durationSec !== Math.round(audio.duration))) {
      currentSong.durationSec = Math.round(audio.duration);
      if (typeof deps.onDurationDiscovered === 'function') {
        deps.onDurationDiscovered(currentSong);
      }
    }
  }, { once: true });

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
  };

  updatePlayBtn();
}

function paintLoopBtn(btn, on) {
  btn.style.color = on ? 'var(--blue)' : 'var(--text-muted)';
  btn.style.borderColor = on ? 'var(--blue)' : 'var(--border)';
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

  const tpProgress = q('#tp-progress');
  if (tpProgress) {
    tpProgress.oninput = (e) => {
      if (audio && audio.duration) {
        audio.currentTime = (e.target.value / 100) * audio.duration;
        deps.syncSlider(e.target);
      }
    };
    deps.syncSlider(tpProgress);
  }
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
