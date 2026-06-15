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
import { confirmDialogAsync } from '../ui/dialog.js';

let audio = null;            // PitchAudio (API tipo HTMLAudioElement + pitchSemitones)
let currentType = null;
let currentSong = null;

// Web Audio graph: PitchAudio → makeupNode → limiterNode → pannerNode → destino.
// audioCtx es singleton; los nodos se reconstruyen por carga.
let audioCtx = null;
let pannerNode = null;
let makeupNode = null;       // ganancia de compensación (nivela la Pista con pads/batería)
let trackLimiter = null;     // limitador de seguridad para que el makeup no sature
let currentPitch = 0;        // semitonos aplicados al audio cargado

// La Pista vive en su propio AudioContext (sin el master/limiter del SynthEngine),
// así que sale "en crudo" mientras pads/batería/click pasan por un limiter
// maximizador y suenan mucho más fuerte. Esta ganancia de compensación sube la
// Pista a un nivel comparable; el trackLimiter de abajo evita que sature.
const TRACK_MAKEUP = 1.9;    // ≈ +5.6 dB

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

// Asegura un AudioContext antes de crear cualquier nodo. Si el host inyectó
// deps.getSharedCtx (el contexto del SynthEngine), lo REUSAMOS: un solo hilo
// de audio para Pads+Pista en vez de dos. La Pista conserva su camino "crudo"
// (su cadena conecta directo a ctx.destination, sin pasar por el limiter
// maximizador del engine, que es una cadena de nodos, no el destino).
function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  const shared = typeof deps.getSharedCtx === 'function' ? deps.getSharedCtx() : null;
  if (shared) { audioCtx = shared; return audioCtx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { audioCtx = new AC({ latencyHint: 'interactive' }); } catch (_) { audioCtx = null; }
  return audioCtx;
}

// Inserta makeup → limiter → panner entre la fuente (audio.output) y el destino.
// audio.output es el nodo de ganancia de PitchAudio; el makeup nivela la Pista
// con los demás canales y el limiter la protege de saturar. El pan no afecta el
// volumen.
function connectPanGraph() {
  if (!audio || !audioCtx) return;
  try {
    makeupNode = audioCtx.createGain();
    makeupNode.gain.value = TRACK_MAKEUP;

    // Limitador de seguridad: solo actúa en los picos que el makeup empuja
    // por encima de ~-1 dB, así sube el cuerpo de la Pista sin clipear.
    trackLimiter = audioCtx.createDynamicsCompressor();
    trackLimiter.threshold.value = -1;
    trackLimiter.knee.value = 0;
    trackLimiter.ratio.value = 20;
    trackLimiter.attack.value = 0.003;
    trackLimiter.release.value = 0.1;

    pannerNode = audioCtx.createStereoPanner();
    const panEl = els.panSlider;
    pannerNode.pan.value = panEl ? (parseFloat(panEl.value) || 0) / 100 : 0;

    audio.output.connect(makeupNode);
    makeupNode.connect(trackLimiter);
    trackLimiter.connect(pannerNode);
    pannerNode.connect(audioCtx.destination);
  } catch (e) {
    console.warn('Track pan graph unavailable:', e);
    pannerNode = null;
    makeupNode = null;
    trackLimiter = null;
  }
}

const TRACK_SWITCH_FADE_S = 0.14;  // fade-out al cambiar de canción (evita el corte/click seco)

// Libera la fuente actual y el panner para que la siguiente carga arranque limpia.
// Si la pista estaba SONANDO, hace un fade-out corto antes de desconectar: la
// siguiente carga arranca de inmediato, así el viejo se desvanece mientras el
// nuevo entra (mini-crossfade) en vez de cortar en seco.
export function cleanupTrackAudio() {
  if (!audio) return;
  const old = audio;
  const oldMakeup = makeupNode, oldLimiter = trackLimiter, oldPanner = pannerNode;
  // Liberamos las referencias del módulo YA, para que la próxima carga cree su
  // propio grafo y los dos puedan sonar a la vez durante el fade.
  audio = null; makeupNode = null; trackLimiter = null; pannerNode = null;

  const dispose = () => {
    try { old.output && old.output.disconnect(); } catch (e) {}
    [oldMakeup, oldLimiter, oldPanner].forEach(n => { try { n && n.disconnect(); } catch (e) {} });
    try { old.pause(); old.src = ''; old.onerror = null; old.ontimeupdate = null; old.onended = null; } catch (e) {}
  };

  const g = old.output && old.output.gain;
  if (!old.paused && g && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + TRACK_SWITCH_FADE_S);
    } catch (e) {}
    setTimeout(dispose, TRACK_SWITCH_FADE_S * 1000 + 40);
  } else {
    dispose();
  }
}

// Abre el selector de archivo, copia/asigna el audio a la canción y lo reproduce.
// Reutilizado tanto al asignar un slot vacío como al REASIGNAR uno cuyo archivo
// falta o se movió (ver el manejo de onerror en startTrackPlayback).
function pickAssignAndPlay(song, type) {
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
}

export function loadAndPlayTrack(song, type) {
  cleanupTrackAudio();
  currentSong = song;
  const path = (song.audio && song.audio[type]) ? song.audio[type] : null;

  if (!path) {
    // Song has no audio yet for this slot — let the user pick a file.
    pickAssignAndPlay(song, type);
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

  audio.onerror = async (e) => {
    console.error('Error loading audio:', safeUrl, e);
    if (els.title) els.title.textContent = 'Audio no encontrado';
    // El archivo falta/se movió/está dañado: ofrecer REASIGNAR aquí mismo en vez
    // de mandar al usuario a editar la canción. La canción + slot ya los tenemos.
    const song = currentSong;
    const slot = type === 'sequence' ? 'la secuencia' : 'el original';
    const ok = await confirmDialogAsync({
      title: 'Audio no encontrado',
      message: `No se pudo cargar ${slot} de “${title}”. El archivo puede faltar, haberse movido o estar dañado.\n\n¿Reasignar el archivo ahora?`,
      confirmLabel: 'Reasignar…',
      danger: false,
    });
    if (ok && song) pickAssignAndPlay(song, type);
  };

  if (els.title) els.title.textContent = title + (type === 'sequence' ? ' (Secuencia)' : ' (Original)');

  const updatePlayBtn = () => {
    if (!els.playBtn) return;
    els.playBtn.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON;
    els.playBtn.style.transform = audio.paused ? 'scale(1)' : 'scale(0.96)';
  };
  // El icono SIEMPRE refleja el estado real, aunque play/pause venga por otra
  // vía (fin de pista, auto-avance, atajos): así no queda "pegado" en play.
  audio.addEventListener('play', updatePlayBtn);
  audio.addEventListener('pause', updatePlayBtn);

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
