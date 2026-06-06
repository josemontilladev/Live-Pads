import { SynthEngine } from './audio/SynthEngine.js';
import { Metronome }   from './audio/Metronome.js';
import { PAD_BANKS, KIT_BANKS } from './data/banks.js';
import { q, qa, esc } from './utils/dom.js';
import { openLyricsEditorModal } from './ui/lyricsEditor.js';
import { hideDialog, confirmDialogAsync } from './ui/dialog.js';
import { openCheatSheet, closeCheatSheet, isCheatSheetOpen, ensureShortcutsRendered } from './ui/cheatSheet.js';
import { initAudioLibrarySetting } from './ui/audioLibrarySetting.js';
import { openPreflight } from './ui/preflight.js';
import { openMappingsList } from './ui/mappingsList.js';
import { openCompanionPanel } from './ui/companionPanel.js';
import { togglePadsPiano, closePadsPiano, isPadsPianoOpen, padsPianoPanic } from './ui/padsPiano.js';
// The Stems workspace pulls in heavy deps (audio engine, exporter, waveform
// renderer, lamejs, ONNX-backed separation IPC glue…) yet the app boots into
// Pads. Lazy-load it on first entry to the Stems tab so initial load stays fast.
let stemsWS = null;
let stemsMounted = false;
function ensureStemsWorkspace() {
  if (stemsWS) return Promise.resolve(stemsWS);
  return import('./stems/workspace.js').then(m => { stemsWS = m; return m; });
}
function ensureStemsMounted() {
  return ensureStemsWorkspace().then(ws => {
    if (!stemsMounted) { ws.mount(); stemsMounted = true; }
    return ws;
  });
}
import { maybeStartTour, startTour } from './stems/tour.js';
import { initAuthGate } from './cloud/authUI.js';
import { initLibrarySelector } from './cloud/librarySelector.js';

// Pads workspace guided tour (mirrors the Stems one). Targets stable static
// elements in the Pads layout. Its own one-time localStorage flag.
const PADS_TOUR_KEY = 'livepads-pads-tour-seen-v1';
const PADS_TOUR_STEPS = [
  { target: '#key-grid',        title: 'Pads de adoración',     body: 'Los 12 tonos. Pulsa uno para lanzar un colchón continuo; al cambiar de tono hace <b>crossfade</b> automático, sin silencios. También responden al teclado/MIDI.' },
  { target: '#pad-bank-select', title: 'Bancos de sonido',      body: 'Cambia el carácter del pad (cálido, etéreo, etc.). Cada banco tiene los 12 tonos precargados para que el cambio sea instantáneo.' },
  { target: '#bpm-display',     title: 'Metrónomo',             body: 'Tempo, compás, sonido del click y multiplicador 1x/2x. Timing sample-accurate para que no se desfase nunca.' },
  { target: '#drum-grid',       title: 'Batería',               body: 'Pads de percusión mapeables a teclado/MIDI. Puedes crear kits propios y asignar tus propios samples.' },
  { target: '#gi-search',       title: 'Setlist y librería',    body: 'Busca por título, artista, letra, <b>tono:G</b> o <b>tag:navidad</b>. Arma el servicio con arrastrar y soltar, y activa el auto-avance entre canciones.' },
  { target: '.ws-tab[data-workspace="stems"]', title: 'Editor de Stems', body: 'La pestaña Stems abre el editor con <b>separación por IA</b> (voz/batería/bajo/otros) y click inteligente alineado a la canción.' },
  { target: '#btn-help',        title: 'Atajos de teclado',     body: 'Pulsa <b>?</b> en cualquier momento para ver todos los atajos. Casi todo se controla sin ratón.' },
];
function maybeStartPadsTour() { maybeStartTour(PADS_TOUR_KEY, PADS_TOUR_STEPS); }

// El tour de bienvenida no debe solaparse con la pantalla de login: esperamos
// a que el usuario termine con el auth gate (inicie sesión o entre sin cuenta).
let authGateReady = Promise.resolve();
window.__padsShowTour = () => startTour(PADS_TOUR_STEPS, PADS_TOUR_KEY);
import { openSpotlight, isSpotlightOpen, closeSpotlight } from './ui/spotlight.js';
import { showToast } from './ui/toast.js';
import { bindKitControls } from './ui/kitControls.js';
import { bindMixerControls } from './ui/mixerControls.js';
import { bindMetronomeControls } from './ui/metronomeControls.js';
import { bindMixerBar } from './ui/mixerBar.js';
import { applyTheme, buildThemesList, getCurrentTheme } from './ui/themes.js';
import {
  initService, getServiceSongs, getActiveServiceIndex, setActiveServiceIndex,
  loadServiceSongs, saveServiceSongs, addToService, removeFromService,
  reorderService, syncActiveByTitleArtist, peekNextServiceSong,
  serviceNextSong, servicePrevSong
} from './data/service.js';
import {
  initTrackPlayer, loadAndPlayTrack, clearTrackUI,
  bindTrackPlayerControls, isTrackLoaded, isTrackPlaying, clickPlayPause, getCurrentSong, getCurrentType
} from './audio/trackPlayer.js';
import {
  setMidiMap, getMapping, addMapping, clearMappingForTarget, findKeyboardMappingFor, setMidiScope
} from './midi/midiMap.js';
import { bindMidiHandlers } from './midi/midiBindings.js';
import { hydrateCustomKitsInto } from './data/customKits.js';
import { loadGiSetlistFromFile as loadGiSetlistFromFileModule } from './data/giSetlistLoader.js';
// mongoSync (legacy GI.Setlist/MongoDB) retirado — la sincronización vive en
// la nube Supabase vía Mi cuenta → librería activa.
import { bindSetlistTabs } from './ui/setlistTabs.js';
import { bindGiToolbar } from './ui/giToolbar.js';
import { updateFilterCounts as updateFilterCountsModule } from './ui/genreFilter.js';
import { openSidebarTab, closeAllOverlays } from './ui/overlays.js';
import { initDrumGrid, buildDrumGrid, hitDrum, resolveDrumPad } from './ui/drumGrid.js';
import { initMetroBeatDots, buildMetroBeatDots, onMetroBeat } from './ui/metroBeatDots.js';
import { initDrumVolumes, buildDrumVolumes } from './ui/drumVolumes.js';
import { KEYS_FLAT, KEYS_SHARP, KEY_MAP_PADS, KEY_MAP_DRUMS } from './data/musicConstants.js';
import { syncSlider } from './utils/sliders.js';
import {
  initGiList, renderGiList,
  repaintGiCard, getGiCardBySongId
} from './ui/giList.js';
import {
  initServiceList, renderServiceList as renderServiceListModule
} from './ui/serviceListView.js';
import {
  refreshActiveSongHighlights,
  toggleLyricsAccordion,
  toggleChordVisibility,
  closeAllLyrics,
  refreshNowPlayingLiveState,
} from './ui/songState.js';
import {
  getSongs, setSongs,
  getActiveSongId as getActiveSongIdFromStore,
  setActiveSongId,
  getPadBankIdx, setPadBankIdx,
  getKitBankIdx, setKitBankIdx,
  getActiveKey, setActiveKey,
  getPreparedPadKey, setPreparedPadKey,
  getUseFlats, setUseFlats,
  getMetroRunning, setMetroRunning,
  getIsEditKitMode,
  getIsMidiLearnMode, setIsMidiLearnMode,
  getMidiLearnTarget, setMidiLearnTarget,
} from './state/store.js';

// engine + metro are instance refs created at boot. Stay as module-scope
// `let`s because they're imported by callsites within this file only; the
// extracted modules receive them via getEngine()/getMetro() deps when they
// need them. We could move them to the store too, but they have no
// "reset" semantics — they're created once and live forever — so keeping
// them here makes the boot sequence easier to follow.
let engine, metro;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  // Configuración personal en la nube (offline-first): si hay sesión + internet,
  // baja la config del usuario a local ANTES de leerla, para que el arranque
  // tome los valores de la nube. Sin red o sin sesión, no bloquea nada.
  try {
    const { restoreSession } = await import('./cloud/supabase.js');
    await restoreSession();
    const us = await import('./cloud/userSettings.js');
    await us.bootSyncBeforeLoad();
  } catch (_) {}

  // Pantalla de bienvenida / login (si la nube está activada y no hay sesión).
  // No bloquea el arranque: el audio y la UI se preparan detrás del overlay.
  authGateReady = initAuthGate().catch(() => {});

  engine = new SynthEngine();

  // Boot phase 1: kick off everything that can run in parallel.
  //   - Engine init (must complete before we touch audio nodes)
  //   - Default click sound decode (depends on engine.ctx)
  //   - User drums + MIDI map from disk (Node-side IPC, independent)
  await engine.init();
  const clickWarmup = engine.loadClickBuffers(); // default = 'cowbell'
  const userDrumsP = window.electronAPI?.loadUserDrums
    ? window.electronAPI.loadUserDrums()
    : Promise.resolve(null);
  const midiMapP = window.electronAPI?.loadMidiMap
    ? window.electronAPI.loadMidiMap()
    : Promise.resolve(null);

  // Pad Amb files are lazy-loaded on first keypress (~48MB each, see _ensurePadAmb).
  metro = new Metronome(engine);
  initMetroBeatDots(metro);
  metro.onBeat = onMetroBeat;
  metro.sound = 'cowbell';

  const [, rawDrums, rawMidi] = await Promise.all([clickWarmup, userDrumsP, midiMapP]);

  // Prepend custom drum kits (loaded from disk or one empty default) into KIT_BANKS.
  hydrateCustomKitsInto(KIT_BANKS, rawDrums);

  // MIDI map was loaded in parallel above; just commit it now.
  setMidiMap(rawMidi);

  applyTheme(getCurrentTheme());
  initService({ render: renderServiceList, applyGiSong });
  // Note: GI library state (songs, genre, active id, accordion ids) lives
  // in src/js/state/store.js. The modules below read/write it directly —
  // we only inject side-effectful callbacks they can't supply themselves.
  initGiList({
    persist: () => { if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs()); },
    onApplySong: applyGiSong,
    loadAndPlayTrack,
    addToService,
    openLyricsEditorModal,
    toggleLyricsAccordion,
    toggleChordVisibility,
    updateFilterCounts,
  });
  initLibrarySelector();
  initServiceList({
    getSongs: getServiceSongs,
    getActiveIndex: getActiveServiceIndex,
    persistServiceSongs: saveServiceSongs,
    onApplySong: applyGiSong,
    loadAndPlayTrack,
    removeFromService,
    reorderService,
    openLyricsEditorModal,
    toggleLyricsAccordion,
    toggleChordVisibility,
    syncLyricsToLibrary: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      giSong.lyrics = song.lyrics;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
    syncFavoriteToLibrary: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      giSong.favorite = !!song.favorite;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
      updateFilterCounts();
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
    syncMetaToLibrary: (oldKey, song) => {
      const giSong = getSongs().find(s => (s.title + '\x00' + s.artist) === oldKey);
      if (!giSong) return;
      giSong.title = song.title;
      giSong.artist = song.artist;
      giSong.bpm = song.bpm;
      giSong.key = song.key;
      giSong.genre = song.genre;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
      // Title/artist may have moved the library card in sort order → full re-render.
      renderGiList(q('#gi-search').value);
    },
    // Espeja el audio (y youtubeUrl/carátula) cargado desde el Servicio a la
    // canción de la librería que matchea por título+artista, y persiste.
    syncAudioToLibrary: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      if (!giSong.audio) giSong.audio = {};
      Object.assign(giSong.audio, song.audio || {});
      if (song.youtubeUrl) giSong.youtubeUrl = song.youtubeUrl;
      if (song.cover && !giSong.cover) giSong.cover = song.cover;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
  });
  initDrumGrid({
    getEngine: () => engine,
    getKitBankIdx: () => getKitBankIdx(),
    isEditKit: () => getIsEditKitMode(),
    onAfterBuild: () => { if (typeof updateKeyHints === 'function') updateKeyHints(); }
  });
  initDrumVolumes({ getEngine: () => engine, syncSlider });

  // Hook the track player to app.js helpers so it stays decoupled.
  initTrackPlayer({
    syncSlider,
    // Persiste cualquier cambio en la canción (ej. pitch del track player).
    persistSong: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong && giSong !== song) {
        if (!giSong.audio) giSong.audio = {};
        Object.assign(giSong.audio, song.audio || {});
      }
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
    },
    onAudioPathAssigned: (song, type, newPath) => {
      // Sync the new file path back into the library + persist + refresh views.
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong) {
        if (!giSong.audio) giSong.audio = {};
        giSong.audio[type] = newPath;
      }
      if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
      saveServiceSongs();
      const searchInput = q('#gi-search');
      if (searchInput) renderGiList(searchInput.value);
      renderServiceList();
    },
    // Cache audio duration onto the library song the first time it plays,
    // so the service-list total-time estimate (4-min heuristic by default)
    // upgrades to real values as the user works through their setlist.
    onDurationDiscovered: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong && (!giSong.durationSec || giSong.durationSec !== song.durationSec)) {
        giSong.durationSec = song.durationSec;
        if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
        renderServiceList();
      }
    },
    // Auto-advance: when a track finishes and the toggle is on, chain into
    // the next service song — but only if the finished track IS the active
    // service song and there's a real next one (no wrap-around looping).
    onTrackEnded: () => {
      if (!autoAdvanceEnabled) return;
      const idx = getActiveServiceIndex();
      const songs = getServiceSongs();
      if (idx < 0 || idx >= songs.length - 1) return; // no next song
      const cur = getCurrentSong();
      const active = songs[idx];
      if (!cur || !active) return;
      const sameSong = (cur.serviceId && cur.serviceId === active.serviceId) ||
                       (cur.title === active.title && cur.artist === active.artist);
      if (sameSong) {
        // Prepara la siguiente pero NO la lanza (control en vivo): avisamos
        // claramente para que no parezca que el set se cortó.
        serviceNextSong();
        showToast('Siguiente preparada — pulsá Espacio para lanzar', 'info');
      }
    }
  });

  buildBankSelects();
  
  // Restore last selected Pad Bank or default to Chris Rocha (index 2)
  const savedPadIdx = localStorage.getItem('lastPadBankIdx');
  if (savedPadIdx !== null) {
    loadPadBank(parseInt(savedPadIdx));
  } else {
    loadPadBank(2); // Chris Rocha por defecto
  }
  
  // Restore last selected Kit Bank or default to EFX 1
  const savedKitIdx = localStorage.getItem('lastKitBankIdx');
  if (savedKitIdx !== null) {
    loadKitBank(parseInt(savedKitIdx));
  } else {
    const efx1Idx = KIT_BANKS.findIndex(k => k.name === 'EFX 1');
    loadKitBank(efx1Idx >= 0 ? efx1Idx : 0);
  }
  buildKeyGrid();
  buildMetroBeatDots(4);
  buildThemesList();
  ensureShortcutsRendered();
  initAudioLibrarySetting();
  loadServiceSongs();
  bindAll();
  loadGiSetlistFromFile();
  bindWorkspaceSwitcher(); // mounts the Stems workspace lazily on first entry

  // Defensive: Chromium suspends AudioContexts created before the first user
  // gesture. Resume on the first pointer/key event so the first pad/drum hit
  // has no warm-up latency.
  const resumeAudio = () => {
    if (engine && engine.ctx && engine.ctx.state === 'suspended') {
      engine.ctx.resume().catch(() => {});
    }
    document.removeEventListener('pointerdown', resumeAudio, true);
    document.removeEventListener('keydown', resumeAudio, true);
  };
  document.addEventListener('pointerdown', resumeAudio, true);
  document.addEventListener('keydown', resumeAudio, true);

  // When scrolling either song list, collapse the panel-wide chrome (Setlist
  // header + tab toggle) plus the local filters, leaving only the search input
  // pinned at the top. Passive listeners — never block scroll.
  const panelSetlist = q('#panel-setlist');
  const giSongsContainer = q('#gi-songs-container');
  const giSetlistList = q('#gi-setlist-list');
  const serviceSongsContainer = q('#service-songs-container');

  const wireScrollChrome = (scroller) => {
    if (!scroller || !panelSetlist) return;
    const update = () => {
      const scrolled = scroller.scrollTop > 8;
      panelSetlist.classList.toggle('songs-scrolled', scrolled);
      if (scroller === giSongsContainer && giSetlistList) {
        giSetlistList.classList.toggle('scrolled', scrolled);
      }
    };
    scroller.addEventListener('scroll', update, { passive: true });
  };
  wireScrollChrome(giSongsContainer);
  wireScrollChrome(serviceSongsContainer);

  q('#sidebar').classList.remove('open');

  // Hide preloader smoothly
  setTimeout(() => {
    const preloader = q('#preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
      setTimeout(() => preloader.remove(), 800); // clean from DOM
    }
  }, 800);
});

/* ── BANK SELECTS ── */
function buildBankSelects() {
  const padSel = q('#pad-bank-select');
  const kitSel = q('#kit-bank-select');
  if (padSel) {
    padSel.innerHTML = PAD_BANKS.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    padSel.value = getPadBankIdx();
    padSel.onchange = (e) => loadPadBank(parseInt(e.target.value));
  }
  if (kitSel) {
    kitSel.innerHTML = KIT_BANKS.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    kitSel.value = getKitBankIdx();
    kitSel.onchange = (e) => loadKitBank(parseInt(e.target.value));
  }
}

/* ── PAD BANK ── */
function loadPadBank(idx) {
  setPadBankIdx(((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length);
  const bank = PAD_BANKS[getPadBankIdx()];
  const padSel = q('#pad-bank-select');
  if (padSel) padSel.value = getPadBankIdx();
  engine.setPadBank(bank);
  if (getActiveKey()) engine.playPad(getActiveKey());
  
  // Save last selected Pad Bank persistently
  localStorage.setItem('lastPadBankIdx', getPadBankIdx());
}

let lastDrumGridSig = null; // pad-layout signature of the currently-mounted drum grid
function loadKitBank(idx) {
  setKitBankIdx(((idx % KIT_BANKS.length) + KIT_BANKS.length) % KIT_BANKS.length);
  const kit = KIT_BANKS[getKitBankIdx()];
  const kitSel = q('#kit-bank-select');
  if (kitSel) kitSel.value = getKitBankIdx();
  
  // Show/hide the trash button + toggle edit pencil availability based on
  // whether the active kit is user-custom. Class-based so it stays themable.
  const btnDelete = q('#btn-delete-kit');
  if (btnDelete) btnDelete.classList.toggle('kit-action-btn--hidden', !kit.isCustom);
  const btnEdit = q('#btn-edit-kit');
  if (btnEdit) btnEdit.classList.toggle('kit-action-btn--disabled', !kit.isCustom);

  // Skip rebuilding the grid/volumes when the pad layout is unchanged (e.g.
  // re-selecting the same kit) — avoids needless DOM churn and, importantly,
  // preserves the user's current drum volumes instead of resetting them.
  const sig = kit.pads.map(p => `${p.id}:${p.label}:${p.type}`).join('|');
  if (sig !== lastDrumGridSig) {
    engine.initDrumVolumes(kit.pads);
    buildDrumGrid(kit.pads);
    buildDrumVolumes(kit.pads);
    lastDrumGridSig = sig;
  }
  // Load real WAV samples in background
  engine.loadKitSamples(kit.pads).then(loadedIds => {
    loadedIds.forEach(id => {
      const btn = q(`.drum-btn[data-drum="${id}"]`);
      if (btn) btn.classList.add('has-sample');
    });
    // Re-apply MIDI/keyboard hints after async kit load so the mapping stays visible
    if (typeof updateKeyHints === 'function') updateKeyHints();
  });
  
  // Save last selected Kit Bank persistently
  localStorage.setItem('lastKitBankIdx', getKitBankIdx());
}

/* ── KEY GRID ── */
function buildKeyGrid() {
  const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP;
  const grid = q('#key-grid'); grid.innerHTML = '';
  keys.forEach((key, keyIdx) => {
    const btn = document.createElement('button');
    btn.className = 'key-btn' + (key === getActiveKey() ? ' active' : '');
    btn.dataset.key = key;
    btn.innerHTML = `<span>${key}</span><span class="kbd-hint">${KEY_MAP_PADS[keyIdx]}</span>`;
    btn.onclick = () => onKeyClick(key);
    grid.appendChild(btn);
  });
  if (typeof updateKeyHints === 'function') updateKeyHints();
}

function updateKeyHints() {
  const cleanHint = (key) => key.replace('kbd_Key', '').replace('kbd_Digit', '').replace('kbd_', '');

  qa('.key-btn').forEach(btn => {
    const key = btn.dataset.key;
    const padIdx = (getUseFlats() ? KEYS_FLAT : KEYS_SHARP).indexOf(key);
    let hint = KEY_MAP_PADS[padIdx] || '';
    const found = findKeyboardMappingFor('pad', key);
    if (found) hint = cleanHint(found.key);
    const hintEl = btn.querySelector('.kbd-hint');
    if (hintEl) hintEl.textContent = hint;
  });
  qa('.drum-btn').forEach((btn, i) => {
    let hint = KEY_MAP_DRUMS[i] || '';
    // Drum mappings key by slot now; fall back to pad id / type for legacy maps.
    const found = findKeyboardMappingFor('drum', String(i))
               || findKeyboardMappingFor('drum', btn.dataset.drum)
               || findKeyboardMappingFor('drum', btn.dataset.type);
    if (found) hint = cleanHint(found.key);
    const hintEl = btn.querySelector('.kbd-hint');
    if (hintEl) hintEl.textContent = hint;
  });
}

// clearMappingForTarget now lives in midi/midiMap.js (imported above).

// Stop fade is 5 s; while it's running the pad button shows a draining
// progress bar via .fading-out — visual cue so the user knows audio is
// still tailing out and can predict when the tail ends.
const PAD_STOP_FADE_S = 5.0;

function onKeyClick(key) {
  if (getActiveKey() === key) {
    engine.stopPad(PAD_STOP_FADE_S);
    setActiveKey(null);
    setPreparedPadKey(key); // Keep it prepared
    qa('.key-btn.fading-out').forEach(b => b.classList.remove('fading-out'));
    qa('.key-btn').forEach(b => {
      b.classList.remove('active');
      if (b.dataset.key === key) {
        b.classList.add('prepared');
        b.classList.add('fading-out');
        // Auto-clear once the fade completes. Re-check in case the
        // user has triggered another key in the meantime — the class
        // may have been removed already.
        setTimeout(() => b.classList.remove('fading-out'), PAD_STOP_FADE_S * 1000);
      }
    });
  } else {
    // Audio FIRST (zero added latency), then all the visual state.
    engine.playPad(key, PAD_BANKS[getPadBankIdx()].synth);
    setActiveKey(key);
    setPreparedPadKey(null);
    qa('.key-btn.fading-out').forEach(b => b.classList.remove('fading-out'));
    qa('.key-btn').forEach(b => {
      b.classList.remove('prepared');
      b.classList.toggle('active', b.dataset.key === getActiveKey());
    });
  }
}


// Drum grid (buildDrumGrid, hitDrum, assignSampleToPad) -> src/js/ui/drumGrid.js

/* ── DRUM VOLUMES ── */
/* ── BIND ALL ──
   The big "wire up the UI" function. Split into named sub-binders for
   navigability — each runs once at boot, no separate test cases needed.
   Sub-binders reference module-scope `engine`, `metro`, KIT_BANKS, etc.,
   so they're defined at module level too (no closure tricks). */

// Auto-advance toggle state (persisted). Read at boot; toggled from the
// track-player transport button.
let autoAdvanceEnabled = localStorage.getItem('tpAutoAdvance') === '1';
function bindAutoAdvanceToggle() {
  const btn = q('#tp-autoadvance-btn');
  if (!btn) return;
  const sync = () => {
    btn.classList.toggle('active', autoAdvanceEnabled);
    btn.setAttribute('aria-pressed', String(autoAdvanceEnabled));
  };
  sync();
  btn.onclick = () => {
    autoAdvanceEnabled = !autoAdvanceEnabled;
    localStorage.setItem('tpAutoAdvance', autoAdvanceEnabled ? '1' : '0');
    sync();
  };
}

function bindAll() {
  // Safety net: an unexpected error in any handler should be logged, never
  // bubble up as an uncaught exception that could leave the UI mid-action
  // during a live service.
  window.addEventListener('error', (e) => { try { console.error('[LivePads] error:', e.message); } catch (_) {} });
  window.addEventListener('unhandledrejection', (e) => { try { console.error('[LivePads] promise rejection:', e.reason); } catch (_) {} });
  bindClickWithSeqToggle();
  bindCountInToggle();
  bindPadsPianoToggle();
  // Refresh the on-pad key hints whenever mappings are cleared/changed.
  document.addEventListener('livepads:mappings-changed', () => {
    if (typeof updateKeyHints === 'function') updateKeyHints();
  });
  bindTrackPlayerControls();
  bindAutoAdvanceToggle();
  bindKitControls({ buildBankSelects, loadKitBank });
  bindWindowControls();
  bindSidebarAndTabs();
  bindHamburgerMenu();
  bindMixerControls({ getEngine: () => engine });
  bindMetronomeControls({
    getEngine: () => engine,
    getMetro: () => metro,
    toggleMetro,
    applyBpm,
    buildKeyGrid,
  });
  // Must run after the canonical sliders above are wired — the mixer bar
  // bridges to them.
  bindMixerBar();
  bindRestOfApp();
}


function bindWindowControls() {
  const api = window.electronAPI;
  if (!api) return;
  q('#btn-min').onclick   = () => api.windowAction('minimize');
  q('#btn-max').onclick   = () => api.windowAction('maximize');
  q('#btn-close').onclick = () => api.windowAction('close');
}

// Everything else that bindAll() used to wire: sidebar, hamburger menu,
// mixer sliders, metronome controls, setlist/GI bindings, MIDI listener,
// and the document-level keyboard / click handlers. Kept as one block for
// now because all sections share module-scope state (engine, metro, etc.).
function bindSidebarAndTabs() {
  q('#btn-settings-toggle').onclick = () => q('#sidebar').classList.toggle('open');
  q('#sidebar-overlay').onclick = () => q('#sidebar').classList.remove('open');
  const btnClose = q('#btn-sidebar-close');
  if (btnClose) btnClose.onclick = () => q('#sidebar').classList.remove('open');

  qa('.stab').forEach(btn => {
    btn.onclick = () => {
      qa('.stab').forEach(b => b.classList.remove('active'));
      qa('.stab-body').forEach(b => b.classList.remove('visible'));
      btn.classList.add('active');
      q(`#tab-${btn.dataset.tab}`).classList.add('visible');
    };
  });
}

function bindHamburgerMenu() {
  q('#btn-menu').onclick = () => {
    const pop = q('#menu-popover'), ov = q('#menu-overlay');
    const vis = !pop.classList.contains('hidden');
    pop.classList.toggle('hidden', vis); ov.classList.toggle('hidden', vis);
  };
  window.closeMenu = closeAllOverlays;

  q('#menu-open-settings').onclick = () => { closeMenu(); openSidebarTab('settings'); };
  q('#menu-open-themes').onclick   = () => { closeMenu(); openSidebarTab('themes'); };
  q('#menu-fullscreen').onclick = () => {
    closeMenu();
    window.electronAPI.windowAction('fullscreen');
  };
  q('#menu-about').onclick = () => { closeMenu(); openSidebarTab('about'); };

  // Relanzar el tutorial a demanda (según el espacio activo), desde el menú o
  // desde el panel Info. Ignora el flag de "ya visto".
  const relaunchTour = () => {
    const ws = document.querySelector('.ws-tab.is-active')?.dataset.workspace;
    if (ws === 'stems') ensureStemsMounted().then(() => startTour());
    else startTour(PADS_TOUR_STEPS, PADS_TOUR_KEY);
  };
  const btnMenuTour = q('#menu-tour');
  if (btnMenuTour) btnMenuTour.onclick = () => { closeMenu(); relaunchTour(); };
  const btnAboutTour = q('#about-tour');
  if (btnAboutTour) btnAboutTour.onclick = relaunchTour;

  const btnPreflight = q('#menu-preflight');
  if (btnPreflight) {
    btnPreflight.onclick = () => {
      closeMenu();
      openPreflight({ getEngine: () => engine });
    };
  }

  const btnMappings = q('#menu-mappings');
  if (btnMappings) {
    btnMappings.onclick = () => {
      closeMenu();
      openMappingsList();
    };
  }

  const btnCompanion = q('#menu-companion');
  if (btnCompanion) {
    btnCompanion.onclick = () => {
      closeMenu();
      openCompanionPanel();
    };
  }

  const btnAccount = q('#menu-account');
  if (btnAccount) {
    btnAccount.onclick = () => {
      closeMenu();
      import('./cloud/accountPanel.js').then(m => m.openAccountPanel()).catch(() => {});
    };
  }

  const btnMidiLearn = q('#menu-midi-learn');
  if (btnMidiLearn) {
    btnMidiLearn.onclick = () => {
      closeMenu();
      setIsMidiLearnMode(true);
      setMidiLearnTarget(null);
      q('#midi-learn-overlay').innerHTML = '🎹 Modo Mapeo: hacé clic en un control <b>resaltado</b> y tocá tu controlador. Podés mapear varios seguidos. (Clic aquí para salir)';
      q('#midi-learn-overlay').style.display = 'block';
      // Body-level flag → CSS dims the whole UI to emphasize learn-mode
      // is modal. Exit (in midiBindings.js) removes the class.
      document.body.classList.add('midi-learning');
    };
  }
}


function bindRestOfApp() {
  bindSetlistTabs();
  // bindMongoSync retirado: la sincronización con GI.Setlist ahora va por
  // Supabase ("Mi cuenta → Repertorio GI.Setlist → ⬆/⬇"). RLS protege que
  // solo el dueño suba; los invitados solo pueden bajar.
  bindGiToolbar({ updateFilterCounts });

  // La sincronización con la librería de la nube (cloud/songSync.js) actualiza
  // la lista en memoria y avisa por este evento para refrescar disco + UI.
  window.addEventListener('livepads:library-synced', () => {
    if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs());
    renderGiList(q('#gi-search')?.value || '');
    updateFilterCounts();
  });

  // Recarga la librería DESDE DISCO (sin guardar el store antes): lo usa el
  // orphan linker tras reparar la BD en el proceso principal, para que el
  // renderer no pise la BD reparada con su copia en memoria (vieja).
  window.addEventListener('livepads:library-reload', () => {
    loadGiSetlistFromFile(true);
  });

  // Cambio EN MEMORIA de la lista (crear/asignar canción desde Stems u otra
  // pantalla): re-render SIN recargar de disco. getSongs() es el mismo array
  // compartido, así que la canción nueva ya está; aparece al instante sin Ctrl+R.
  window.addEventListener('livepads:songs-changed', () => {
    updateFilterCounts();
    renderGiList(q('#gi-search')?.value || '');
    scheduleCloudAutoSync();
  });

  // Auto-sync a la nube (Supabase) tras crear/editar: empuja la librería activa
  // en background para que la otra app (misma BD) lo vea sin pulsar "Subir".
  // Debounced para agrupar ráfagas de ediciones; best-effort (silencioso si no
  // hay sesión/red). Avisa con un toast sutil solo cuando SUBE canciones nuevas.
  let cloudSyncTimer = null;
  function scheduleCloudAutoSync() {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(async () => {
      cloudSyncTimer = null;
      try {
        const { autoPushActiveLibrary } = await import('./cloud/songSync.js');
        const r = await autoPushActiveLibrary();
        if (r && r.created > 0) {
          showToast(`☁️ ${r.created} canción(es) sincronizada(s) con la nube.`, 'success');
        }
      } catch (_) { /* sin sesión/red: se reintenta en el próximo cambio */ }
    }, 2000);
  }
  // Señal genérica "cambió data de canciones, sincronizá" — NO re-renderiza la
  // lista (a diferencia de songs-changed), para editar metadatos/letra sin
  // reconstruir la vista en cada cambio. La disparan giList al guardar una
  // edición y el editor de letra al autoguardar.
  window.addEventListener('livepads:cloud-dirty', scheduleCloudAutoSync);

  // Borrado propagado: al eliminar una canción que está en la nube, la quita
  // también de la librería compartida (silencioso sin red / sin permiso).
  window.addEventListener('livepads:song-deleted', (ev) => {
    const cloudId = ev?.detail?.cloudId;
    if (!cloudId) return;
    import('./cloud/songSync.js').then(m => m.deleteCloudSong(cloudId)).catch(() => {});
  });
  bindMidiHandlers({
    getEngine: () => engine,
    onKeyClick,
    toggleMetro,
    triggerMasterPlayPause,
    triggerMasterStop,
    selectSource,
    togglePadsPiano: () => togglePadsPiano(reflectPadsPianoBtn),
  });
  bindSourceControl();
  bindGlobalHandlers();
}

// Workspace switcher — top-bar tabs that toggle between the Pads view
// (#body) and the Stems editor (#workspace-stems). Persisted in
// localStorage so the app reopens to the user's last context.
const WS_KEY = 'livepads-active-workspace';
function bindWorkspaceSwitcher() {
  const tabs = qa('.ws-tab');
  if (!tabs.length) return;
  const stored = localStorage.getItem(WS_KEY) || 'pads';
  applyWorkspace(stored);
  tabs.forEach(tab => {
    tab.onclick = () => applyWorkspace(tab.dataset.workspace);
  });
}
function applyWorkspace(name) {
  const valid = name === 'stems' ? 'stems' : 'pads';
  // Hiding logic lives in CSS now: `body[data-workspace="stems"]` hides
  // all Pads-only chrome (#stage, #track-player-bar, #now-playing-banner)
  // while keeping the fixed #sidebar reachable so the gear / ? buttons
  // still work from the Stems workspace.
  const stems = q('#workspace-stems');
  if (stems) stems.classList.toggle('hidden', valid !== 'stems');

  // Tab buttons + sliding indicator.
  qa('.ws-tab').forEach(t => {
    const isActive = t.dataset.workspace === valid;
    t.classList.toggle('is-active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  moveWorkspaceIndicator();

  // No entry animation on the workspace swap. It used to add a transform to
  // the showing element + force a synchronous reflow (void offsetWidth) — on
  // the large Pads #body (full library DOM) that blocked for a noticeable
  // beat on weaker laptops, so Stems→Pads felt laggy. A plain display swap is
  // instant. (It also avoids leaving a transform on #body, which would trap
  // the position:fixed sidebar in the height:0 Stems layout.)
  if (body) body.classList.remove('ws-entering');
  if (stems) stems.classList.remove('ws-entering');

  document.body.dataset.workspace = valid;
  // El piano de Pads no aplica en Stems (que tiene el suyo) → cerrarlo al cambiar.
  if (valid === 'stems' && isPadsPianoOpen()) closePadsPiano();
  // Switch the active MIDI map so Pads and Stems use fully independent
  // mappings (a control mapped in one never fires in the other).
  setMidiScope(valid);
  try { localStorage.setItem(WS_KEY, valid); } catch (e) {}

  // First-run tutorial fires the very first time the user enters each
  // workspace. After that it can be re-launched manually. Entering Stems
  // also lazily loads + mounts the heavy Stems workspace.
  if (valid === 'stems') {
    authGateReady.then(() => ensureStemsMounted().then(() => maybeStartTour()));
  } else {
    authGateReady.then(() => maybeStartPadsTour());
  }
}

// Public so a menu item or spotlight command can re-launch the tour.
window.__stemsShowTour = () => ensureStemsMounted().then(ws => ws.showStemsTour());

function moveWorkspaceIndicator() {
  const indicator = q('.ws-indicator');
  const activeTab = q('.ws-tab.is-active');
  if (!indicator || !activeTab) return;
  const w = activeTab.offsetWidth;
  if (w === 0) {
    // Layout not ready yet — try again next frame.
    requestAnimationFrame(moveWorkspaceIndicator);
    return;
  }
  indicator.style.width = `${w}px`;
  indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
}
// Resize keeps the indicator anchored under the active tab.
window.addEventListener('resize', () => moveWorkspaceIndicator());

// MIDI listener (incoming notes/CC → mapped action) + the document-level
// click capture that runs while Learn mode is active.

// Document-level handlers that don't fit anywhere else: dialog cancel,
// keyboard shortcuts, and click-outside-to-close for the bank pickers.
function bindGlobalHandlers() {
  q('#dialog-cancel').onclick = hideDialog;
  document.addEventListener('keydown', onKey);

  const btnHelp = q('#btn-help');
  if (btnHelp) {
    btnHelp.onclick = () => isCheatSheetOpen() ? closeCheatSheet() : openCheatSheet();
  }
  document.addEventListener('click', () => {
    q('#pad-bank-picker').classList.add('hidden');
    q('#kit-bank-picker').classList.add('hidden');
  });

  // Now-playing banner: jump to the active library card on click. Switches
  // to the Librería tab (in case the user is on Servicio/Presets), scrolls
  // the card into view, and pulses a flash so the eye lands on it instantly.
  const npBanner = q('#now-playing-banner');
  if (npBanner) {
    npBanner.onclick = () => {
      const activeId = getActiveSongIdFromStore();
      if (activeId == null) return;
      const libTab = q('.s-toggle[data-target="gi-setlist-list"]');
      if (libTab && !libTab.classList.contains('active')) libTab.click();
      const card = getGiCardBySongId(activeId);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash-locate');
      // Restart the animation by yielding a frame before re-adding the class.
      requestAnimationFrame(() => card.classList.add('flash-locate'));
      setTimeout(() => card.classList.remove('flash-locate'), 950);
    };

    // Deselect button — clears the active song (library + service), which
    // hides the banner and drops the .active-song highlight. Stops
    // propagation so it doesn't also trigger the jump-to-card click above.
    const npClose = q('#np-close-btn');
    if (npClose) {
      npClose.onclick = (e) => {
        e.stopPropagation();
        setActiveSongId(null);
        setActiveServiceIndex(-1);
        qa('.gi-song-item.queued-next').forEach(c => c.classList.remove('queued-next'));
        refreshActiveSongHighlights();
      };
    }
  }
}

function toggleMetro() {
  setMetroRunning(metro.toggle());
  const btn = q('#btn-metro-main');
  btn.innerHTML = getMetroRunning()
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><polygon points="5,3 19,12 5,21"/></svg>';
  btn.classList.toggle('running', getMetroRunning());
  if (!getMetroRunning()) {
    qa('.beat-dot').forEach(d => d.classList.remove('on'));
  }
}

// openSidebarTab / closeAllOverlays -> src/js/ui/overlays.js
// Legacy alias kept for inline HTML onclick handlers (if any).
window.closeMenu = closeAllOverlays;

// Apply a BPM value to the metronome and refresh every BPM UI element that
// shows it (main slider, big display, live counter). Called from the BPM
// controls, applyPreset, and applyGiSong — same logic everywhere.
function applyBpm(v) {
  if (!metro) return;
  metro.setBPM(v);
  const slider = q('#bpm-slider');
  if (slider) { slider.value = metro.bpm; syncSlider(slider); }
  const disp = q('#bpm-display');
  if (disp) disp.textContent = metro.bpm;
  const live = q('#metro-bpm-live');
  if (live) live.textContent = metro.bpm + ' BPM';
}

// Stage the next service song's key as the prepared pad. Normalises the
// raw key string (handles Spanish names + flat/sharp notation) the same
// way applyGiSong() does, then sets prepared visual on the matching pad
// button. Space press will then start playback on that key.
// Also marks the corresponding service card as `.queued-next` so the user
// sees WHICH card they've staged, not just an abstract "prepared" pad.
function prepareNextSongKey(song) {
  if (!song) return;

  // Clear any prior queued marker — only one card can be "next up".
  qa('.gi-song-item.queued-next').forEach(c => c.classList.remove('queued-next'));

  if (song.serviceId != null) {
    const svcCard = q(`#service-songs-container .gi-song-item[data-service-id="${CSS.escape(String(song.serviceId))}"]`);
    if (svcCard) svcCard.classList.add('queued-next');
  }

  if (!song.key) return;
  let key = song.key.replace('m', '').trim();
  const esToEn = { 'Do':'C', 'Re':'D', 'Mi':'E', 'Fa':'F', 'Sol':'G', 'La':'A', 'Si':'B' };
  for (const es in esToEn) {
    if (key.startsWith(es)) key = key.replace(es, esToEn[es]);
  }
  const useFlatsLocal = key.includes('b');
  if (useFlatsLocal !== getUseFlats()) {
    setUseFlats(useFlatsLocal);
    const notSel = q('#metro-notation-select');
    if (notSel) notSel.value = useFlatsLocal ? 'flats' : 'sharps';
    buildKeyGrid();
  }
  const keys = useFlatsLocal ? KEYS_FLAT : KEYS_SHARP;
  if (!keys.includes(key)) return;

  setPreparedPadKey(key);
  qa('.key-btn').forEach(b => {
    b.classList.remove('prepared');
    if (b.dataset.key === key) b.classList.add('prepared');
  });
}

// La ORIGINAL nunca es la fuente maestra: solo cuenta como fuente de tiempo una
// SECUENCIA cargada. La original es referencia/ensayo y se controla aparte.
function isSequenceLoaded() {
  return isTrackLoaded() && getCurrentType() === 'sequence';
}

let lastMasterToggle = 0;
// Fuente que dispara el Play maestro (Space / botón): 'sequence' (default),
// 'click' o 'reference'. La fija el selector de fuente; se resetea a 'sequence'
// al elegir otra canción.
let masterSource = 'sequence';
function triggerMasterPlayPause() {
  // Debounce: una doble-pulsación nerviosa de Espacio (o key-repeat) lanzaba y
  // cortaba al instante, dejando todo en silencio cuando el director creía
  // haber arrancado. Ignoramos disparos a <250ms del anterior.
  const now = Date.now();
  if (now - lastMasterToggle < 250) return;
  lastMasterToggle = now;
  if (countingIn) return; // ya hay una cuenta de entrada en curso

  // "Activo" = suena CUALQUIER fuente (pista —secuencia u original— o metrónomo).
  // Así el Space/Play pausa lo que esté sonando, sea cual sea la fuente.
  const isCurrentlyActive = (isTrackLoaded() && isTrackPlaying()) || getMetroRunning();

  if (isCurrentlyActive) {
    triggerMasterStop();
    refreshNowPlayingLiveState();
    return;
  }

  // Nada sonando → reproducir la FUENTE SELECCIONADA (no siempre la secuencia).
  if (masterSource === 'reference') {
    if (isTrackLoaded() && getCurrentType() === 'original') {
      if (getMetroRunning()) toggleMetro();
      if (!isTrackPlaying()) clickPlayPause();   // reanuda donde quedó
    } else {
      selectSource('reference');                  // carga + reproduce la original
    }
    refreshNowPlayingLiveState();
    return;
  }
  if (masterSource === 'click') {
    selectSource('click');       // pad + metrónomo
    refreshNowPlayingLiveState();
    return;
  }

  // Secuencia (por defecto): pad + secuencia (con cuenta de entrada) o metrónomo.
  if (getPreparedPadKey() && !getActiveKey()) onKeyClick(getPreparedPadKey());
  if (isSequenceLoaded()) {
    // Cuenta de entrada (si está activa): un compás de clicks y luego arranca
    // la secuencia justo en el "1".
    if (!isTrackPlaying() && countInEnabled()) {
      doCountIn(() => {
        if (!isTrackPlaying()) clickPlayPause();
        if (clickWithSequenceEnabled() && !getMetroRunning()) toggleMetro();
        refreshNowPlayingLiveState();
      });
      return;
    }
    if (!isTrackPlaying()) clickPlayPause();
    if (clickWithSequenceEnabled() && !getMetroRunning()) toggleMetro();
  } else if (!getMetroRunning()) {
    toggleMetro();
  }
  refreshNowPlayingLiveState();
}

function clickWithSequenceEnabled() {
  return localStorage.getItem('livepads-click-with-seq') === '1';
}

function countInEnabled() {
  return localStorage.getItem('livepads-countin') === '1';
}
function bindCountInToggle() {
  const cb = q('#countin-toggle');
  if (!cb) return;
  cb.checked = countInEnabled();
  cb.onchange = () => localStorage.setItem('livepads-countin', cb.checked ? '1' : '0');
}

// Piano de Pads: el botón del topbar lo muestra/oculta. Suena con mouse, teclado
// de PC y controlador MIDI (igual que el de Stems, pero sin grabar).
function reflectPadsPianoBtn(open) {
  const btn = q('#btn-piano-pads');
  if (!btn) return;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
}
function bindPadsPianoToggle() {
  const btn = q('#btn-piano-pads');
  if (btn) btn.onclick = () => togglePadsPiano(reflectPadsPianoBtn);
}

// Cuenta de entrada: agenda un compás de clicks (al BPM/compás del metrónomo) y
// llama onDone() al terminar, para arrancar la secuencia justo en el "1".
let countingIn = false;
let countInTimer = null;
// Aborta una cuenta de entrada en curso (lo llaman Stop y el pánico): cancela el
// timer para que la secuencia NO arranque al final del conteo.
function cancelCountIn() {
  if (countInTimer) { clearTimeout(countInTimer); countInTimer = null; }
  countingIn = false;
  const btn = q('#tp-play-btn');
  if (btn) btn.classList.remove('counting-in');
}
function doCountIn(onDone) {
  if (countingIn || !engine || !engine.ctx) { onDone(); return; }
  const beats = metro.beats || 4;
  const interval = 60 / (metro.bpm || 120);
  const t0 = engine.ctx.currentTime + 0.06;
  for (let i = 0; i < beats; i++) {
    const accent = i === 0 || (Array.isArray(metro.accents) && metro.accents.includes(i));
    engine.playClick(accent, metro.sound, metro.volume, metro.pan, t0 + i * interval);
  }
  countingIn = true;
  const btn = q('#tp-play-btn');
  if (btn) btn.classList.add('counting-in');
  countInTimer = setTimeout(() => {
    countInTimer = null;
    countingIn = false;
    if (btn) btn.classList.remove('counting-in');
    onDone();
  }, Math.round(beats * interval * 1000));
}

function bindClickWithSeqToggle() {
  const cb = q('#click-with-seq');
  if (!cb) return;
  cb.checked = clickWithSequenceEnabled();
  cb.onchange = () => localStorage.setItem('livepads-click-with-seq', cb.checked ? '1' : '0');
}

function triggerMasterStop() {
  cancelCountIn(); // si había una cuenta de entrada, abortarla (no arrancar)
  if (getActiveKey()) onKeyClick(getActiveKey());
  if (getMetroRunning()) toggleMetro();
  if (isTrackPlaying()) clickPlayPause();
  refreshNowPlayingLiveState();
}

// ── Selector de Fuente del banner (Secuencia / Click / Referencia) ─────────
// Cambio rápido de qué suena para la canción activa. Cada uno es clickeable,
// táctil y MIDI-mapeable. Una sola fuente de tiempo a la vez.
function getActiveSongForSource() {
  const id = getActiveSongIdFromStore();
  if (id != null) { const s = getSongs().find(x => x.id === id); if (s) return s; }
  return getCurrentSong();
}

// Asegura el PAD en la tonalidad de la canción sonando (Secuencia y Click van
// SIEMPRE con el pad — el click nunca va solo).
function ensurePadPlaying() {
  const key = getPreparedPadKey() || getActiveKey();
  if (key && !getActiveKey()) onKeyClick(key);
}

function selectSource(which) {
  masterSource = which;   // el Play maestro (Space) respeta esta fuente
  const song = getActiveSongForSource();
  if (which === 'sequence') {
    if (!song || !(song.audio && song.audio.sequence)) { showToast('Esta canción no tiene secuencia asignada.', 'info'); return; }
    if (getMetroRunning()) toggleMetro();          // una sola fuente de tiempo
    ensurePadPlaying();                            // pad + secuencia
    loadAndPlayTrack(song, 'sequence');
  } else if (which === 'click') {
    if (isTrackLoaded() && isTrackPlaying()) clickPlayPause(); // pausa la pista
    ensurePadPlaying();                            // pad + click (nunca click solo)
    if (!getMetroRunning()) toggleMetro();
  } else if (which === 'reference') {
    if (!song || !(song.audio && song.audio.original)) { showToast('Esta canción no tiene original asignado.', 'info'); return; }
    if (getMetroRunning()) toggleMetro();
    loadAndPlayTrack(song, 'original');            // referencia (sin forzar el pad)
  }
  refreshNowPlayingLiveState();                    // feedback inmediato del segmento
}

function bindSourceControl() {
  const map = { 'src-seq': 'sequence', 'src-click': 'click', 'src-ref': 'reference' };
  for (const [id, which] of Object.entries(map)) {
    const b = q('#' + id);
    if (b) b.onclick = () => selectSource(which);
  }
}

// PÁNICO: corta absolutamente todo y cierra cualquier overlay/ayuda, pase lo que
// pase. Es la tecla de seguridad en vivo (Esc) — el director nunca debe dudar de
// que esto silencia el escenario.
function panicStopAll() {
  // Cerrar overlays/ayuda/sidebar primero (no bloquean el corte de audio).
  if (isCheatSheetOpen()) closeCheatSheet();
  closeAllOverlays();
  q('#sidebar').classList.remove('open');
  // Cortar TODA fuente de sonido: pad, metrónomo y la pista (secuencia U original).
  engine.stopPad();
  setActiveKey(null);
  setPreparedPadKey(null);
  buildKeyGrid();
  if (getMetroRunning()) toggleMetro();
  if (isTrackLoaded() && isTrackPlaying()) clickPlayPause(); // pausa secuencia/original
  // Detener TAMBIÉN la reproducción del timeline de Stems si está montado: el
  // motor de Stems es independiente del player de Pads, así que sin esto un Esc
  // en la pantalla de Stems dejaba el audio sonando.
  if (stemsWS && stemsWS.stemsPanicStop) {
    try { stemsWS.stemsPanicStop(); } catch (_) {}
  }
  try { padsPianoPanic(); } catch (_) {} // soltar notas sostenidas del piano
  cancelCountIn(); // abortar la cuenta de entrada si estaba en curso
  // Limpiar el marcador "PRÓXIMA": tras el pánico no hay nada pre-armado, así
  // que la card no debe seguir diciendo que sonará algo al pulsar Espacio.
  qa('.gi-song-item.queued-next').forEach(c => c.classList.remove('queued-next'));
}

function onKey(e) {
  // Don't capture keypresses meant for any text editor — INPUT, TEXTAREA,
  // SELECT, or contentEditable. Previously only INPUT was filtered, so
  // typing 'R' in the lyrics textarea would trigger the drum pad.

  // Ctrl/Cmd+K opens Spotlight — handled BEFORE the input/textarea filter
  // so it works even when focus is inside the search input or lyrics
  // editor. The Spotlight overlay itself manages its own keydown after
  // that, so we don't compete.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (isSpotlightOpen()) closeSpotlight();
    else openSpotlight();
    return;
  }

  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  // Lyrics editor modal is open — full lockout of pad/drum/master shortcuts.
  if (document.getElementById('gi-lyrics-modal')) return;

  // Esc = PÁNICO: detiene TODO (pad, metrónomo, secuencia/original) y cierra
  // cualquier overlay/ayuda, pase lo que pase. Se maneja ANTES de los bloques de
  // Tab/Stems/cheat-sheet para que funcione siempre, incluso con la ayuda o un
  // overlay abierto. (En inputs ya se retornó arriba — Esc cancela la edición.)
  if (e.code === 'Escape') {
    e.preventDefault();
    panicStopAll();
    return;
  }

  // Tab → alternar workspace Pads ↔ Stems. Solo si el foco no está en un
  // input (ya filtrado arriba) y sin modificadores (Ctrl+Tab está reservado
  // por el sistema). Funciona en ambos workspaces porque está antes del
  // bloque que retorna para Stems.
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const current = document.body.dataset.workspace || 'pads';
    const target = current === 'stems' ? 'pads' : 'stems';
    document.querySelector(`.ws-tab[data-workspace="${target}"]`)?.click();
    return;
  }

  // Stems workspace owns its own shortcuts. Space toggles play/pause,
  // M drops a marker, and Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) drive the
  // undo stack. Nothing else from the Pads keymap should reach the user
  // when they're working in the Stems editor.
  if (document.body.dataset.workspace === 'stems') {
    // stemsWS is always loaded here (entering the Stems tab loads it).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      stemsWS?.stemsUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      stemsWS?.stemsRedo();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      stemsWS?.toggleStemsPlay();
    } else if ((e.key === 'm' || e.key === 'M') && !e.altKey) {
      e.preventDefault();
      stemsWS?.addStemsMarker();
    }
    return;
  }

  // '?' (Shift+/) opens the cheat sheet — checked BEFORE the kbd_${code}
  // map lookup so the user can't accidentally remap it. Toggles open/close.
  if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
    e.preventDefault();
    if (isCheatSheetOpen()) closeCheatSheet();
    else openCheatSheet();
    return;
  }
  // Cheat sheet visible — todo bloqueado para que pads/drums no disparen
  // mientras se lee la ayuda. (Esc ya se manejó arriba como pánico, que también
  // cierra la ayuda.)
  if (isCheatSheetOpen()) return;

  const k = e.code; // Use e.code (e.g. 'KeyA', 'Digit1', 'Space')
  
  if (getIsMidiLearnMode() && getMidiLearnTarget()) {
    e.preventDefault();
    clearMappingForTarget(getMidiLearnTarget(), true);
    addMapping(`kbd_${k}`, getMidiLearnTarget());
    const kName = k.replace('Key', '').replace('Digit', '');
    q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${getMidiLearnTarget().action.toUpperCase()} a la tecla ${kName}. Selecciona otro o sal.`;
    setMidiLearnTarget(null);
    updateKeyHints();
    return;
  }

  // Check custom keyboard mapping
  const mapping = getMapping(`kbd_${k}`);
  if (mapping) {
    e.preventDefault();
    if (mapping.action === 'pad') {
      onKeyClick(mapping.id);
    } else if (mapping.action === 'drum') {
      const kit = KIT_BANKS[getKitBankIdx()];
      if (!kit) return;
      const pad = resolveDrumPad(kit, mapping.id);
      if (pad) {
        // Audio FIRST (zero added latency), then the visual feedback.
        if (!engine.playCustomDrum(pad.id, pad.id)) engine.playDrum(pad.type, pad.id);
        const btn = q(`.drum-btn[data-drum="${pad.id}"]`);
        if (btn) { btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 120); }
      }
    } else if (mapping.action === 'metro') {
      toggleMetro();
    } else if (mapping.action === 'play_seq') {
      triggerMasterPlayPause();
    } else if (mapping.action === 'stop_seq') {
      triggerMasterStop();
    } else if (mapping.action === 'loop_seq') {
      const btn = q('#tp-loop-btn'); if (btn) btn.click();
    } else if (mapping.action === 'prev_song') {
      servicePrevSong();
    } else if (mapping.action === 'next_song') {
      serviceNextSong();
    }
    return;
  }

  // Fallbacks
  const kUpper = e.key.toUpperCase();
  if (e.code === 'Space') {
    e.preventDefault();
    triggerMasterPlayPause();
  }

  // Ctrl/Cmd+N — quick-add new song. Switches to the Library tab (in case
  // the user is browsing another tab) and clicks the existing add button
  // so all the same wiring (empty song template, edit form, focus first
  // input) runs without duplication.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
    const addBtn = q('#btn-add-gi-song');
    if (addBtn) {
      e.preventDefault();
      const libTab = q('.s-toggle[data-target="gi-setlist-list"]');
      if (libTab && !libTab.classList.contains('active')) libTab.click();
      addBtn.click();
      return;
    }
  }

  // Tab — "prepare next song" workflow. Reads (without advancing) the
  // service list's next song and stages its key as the prepared pad,
  // so the next Space press will trigger a smooth crossfade into it.
  // Useful in live: stage the next song silently between segments,
  // confirm with Space when ready.
  // "N" (next) → preparar la siguiente canción del servicio para confirmar con
  // Espacio. Antes era Shift+Tab, que pisaba la navegación de foco estándar del
  // sistema; ahora esa combinación vuelve a ser navegación normal. Guardamos los
  // modificadores para no chocar con Ctrl+N (nueva canción rápida).
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const next = peekNextServiceSong();
    if (next) {
      e.preventDefault();
      prepareNextSongKey(next);
      return;
    }
  }

  // Arrow key navigation for Service List
  if (document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
      e.preventDefault();
      serviceNextSong();
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
      e.preventDefault();
      servicePrevSong();
      return;
    }
  }

  const padIdx = KEY_MAP_PADS.indexOf(kUpper);
  if (padIdx !== -1) { const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP; onKeyClick(keys[padIdx]); }

  const drumIdx = KEY_MAP_DRUMS.indexOf(kUpper);
  if (drumIdx !== -1) {
    const kit = KIT_BANKS[getKitBankIdx()];
    const pad = kit.pads[drumIdx];
    if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
  }
}

/* ── GI-SETLIST LOGIC ── */

// updateFilterCounts -> src/js/ui/genreFilter.js (passing the current songs list)
const updateFilterCounts = () => updateFilterCountsModule(getSongs());

async function loadGiSetlistFromFile(skipConflictCheck = false) {
  const songs = await loadGiSetlistFromFileModule();
  if (!songs) return;
  // Normaliza una sola vez las letras que llegaron como HTML (canciones
  // importadas/GI.Setlist) → texto plano con acordes. Persiste si cambió algo.
  let changed = 0;
  for (const s of songs) {
    if (s.lyrics && /<\/?(p|br|div|li)\b/i.test(s.lyrics)) {
      const plain = htmlToPlainLyrics(s.lyrics);
      if (plain !== s.lyrics) { s.lyrics = plain; changed++; }
    }
  }
  setSongs(songs);
  if (changed && window.electronAPI) window.electronAPI.saveGiSetlist(songs);
  updateFilterCounts();
  renderGiList();
  if (!skipConflictCheck) checkLibraryConflicts();
}

// Si OneDrive creó copias en conflicto de la BD (editar en 2 PCs a la vez),
// ofrece fusionarlas en vez de perder datos en silencio.
async function checkLibraryConflicts() {
  try {
    const api = window.electronAPI;
    if (!api || !api.libraryConflictsCheck) return;
    const { count, conflicts } = await api.libraryConflictsCheck();
    if (!count) return;
    const ok = await confirmDialogAsync({
      title: 'Copias en conflicto detectadas',
      message: `OneDrive creó ${count} copia(s) en conflicto de tu librería (pasa si editás en las dos PCs antes de que sincronice):\n\n${conflicts.join('\n')}\n\n¿Fusionarlas ahora? Se agregan las canciones que falten y se completan los audios faltantes — sin pisar lo que ya tenés. Las copias se archivan en "_conflictos_resueltos/" por las dudas.`,
      confirmLabel: 'Fusionar', danger: false,
    });
    if (!ok) return;
    const r = await api.libraryConflictsResolve();
    showToast(`✓ Fusionado: +${r.addedSongs} canciones, +${r.filledSlots} audios. ${r.resolved} copia(s) archivada(s).`, 'success');
    await loadGiSetlistFromFile(true); // recarga ya fusionada, sin re-chequear
  } catch (e) {
    console.warn('Chequeo de conflictos falló:', e);
  }
}

// Lyrics formatting (formatLyrics, highlightSyntax) -> src/js/ui/lyricsFormat.js
// Textarea helpers (wrapTextareaSelection, insertTextAtCursor) -> src/js/utils/text.js


// Library list + service list render/delegation now live in their own
// modules. We keep a local alias for renderServiceList because it's still
// referenced by handlers in app.js (loadGiSetlist sync, track-player audio
// path assignment, etc.) and by data/service.js via the initService render
// callback.
const renderServiceList = renderServiceListModule;



function applyGiSong(song) {
  // Switching songs → fold away the previous song's open lyrics so the list
  // stays tidy.
  closeAllLyrics();

  // Sync active library song id in the store.
  setActiveSongId(song.id);

  // Nueva canción → la fuente del Play maestro vuelve a "Secuencia" por defecto.
  masterSource = 'sequence';

  // Sync active service-list pointer by matching title+artist.
  syncActiveByTitleArtist(song);

  // Any previously-queued "next up" marker is now stale — the song is
  // actually playing (or about to). Clear it from whatever card had it.
  qa('.gi-song-item.queued-next').forEach(c => c.classList.remove('queued-next'));

  // Surgical highlight update — replaces what used to be two full re-renders
  // (~81 + N cards rebuilt on every song click). The audio change below now
  // happens with zero contention from DOM work.
  refreshActiveSongHighlights();

  // Update BPM
  if (song.bpm) {
    const v = parseInt(song.bpm);
    if (!isNaN(v)) applyBpm(v);
  }
  
  // Update Key
  if (song.key) {
    let key = song.key.replace('m', '').trim();
    // Normalizar Do, Re, Mi si vienen así
    const esToEn = { 'Do':'C', 'Re':'D', 'Mi':'E', 'Fa':'F', 'Sol':'G', 'La':'A', 'Si':'B' };
    for (let es in esToEn) {
      if (key.startsWith(es)) key = key.replace(es, esToEn[es]);
    }
    
    // Check if flat or sharp — update the select dropdown
    const notSel = q('#metro-notation-select');
    if (key.includes('b')) {
      setUseFlats(true);
      if (notSel) notSel.value = 'flats';
    } else {
      setUseFlats(false);
      if (notSel) notSel.value = 'sharps';
    }
    buildKeyGrid();
    
    // Stop metronome if it is running
    if (getMetroRunning()) {
      toggleMetro();
    }
    
    // Smooth transition or prepare the new key
    const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP;
    if (keys.includes(key)) {
      if (getActiveKey()) {
        // If a pad is playing, smoothly crossfade to the new key
        onKeyClick(key);
      } else {
        // If no pad is playing, just prepare the key for master trigger
        setPreparedPadKey(key);
        qa('.key-btn').forEach(b => {
          b.classList.remove('active', 'prepared');
          if (b.dataset.key === key) b.classList.add('prepared');
        });
      }
    } else {
      // Key doesn't map to any of the 12 chromatic pads (e.g. "Em7b5",
      // unusual jazz extensions). Surface a warning so the user knows
      // why the pad didn't auto-prepare instead of silently failing.
      showToast(`Tono "${song.key}" no se reconoce — el pad no se preparó automáticamente.`, 'warning');
    }
  }

  // Auto-load ONLY the sequence (the backing track that master Play drives).
  // The ORIGINAL is never auto-loaded — it loads exclusively when the user
  // clicks its icon. Live safety: selecting a song (or hitting Play) must
  // never fire the studio recording by accident.
  if (song.audio && song.audio.sequence) {
    loadAndPlayTrack(song, 'sequence');
  } else if (isTrackLoaded()) {
    // New song has no sequence — release whatever track was loaded (incl. a
    // previously hand-loaded original) and reset the player UI.
    clearTrackUI();
  }

  // Mirror to the LAN Companion (no-op if server is off).
  if (window.electronAPI && window.electronAPI.companionPublishSong) {
    window.electronAPI.companionPublishSong({
      id: song.id,
      title: song.title,
      artist: song.artist,
      key: song.key,
      bpm: song.bpm,
      lyrics: song.lyrics
    }).catch(() => {});
  }
}

// Mirrors the cabin's playing state to the Companion. Track player +
// metronome state changes don't fan out through a central event, so a
// diff-publish poll is the lowest-friction way to keep the LAN viewer's
// "live" dot in sync. It only emits on actual change AND fully pauses while
// the window is hidden/minimised (no battery/CPU waste in the background).
let lastCompanionPlaying = null;
let companionPollTimer = null;
function companionPollTick() {
  companionPollTimer = null;
  if (window.electronAPI && window.electronAPI.companionPublishPlaying) {
    const playing = isTrackLoaded() ? isTrackPlaying() : getMetroRunning();
    if (playing !== lastCompanionPlaying) {
      lastCompanionPlaying = playing;
      window.electronAPI.companionPublishPlaying(playing).catch(() => {});
    }
  }
  // Mantiene la etiqueta del banner ("Preparada"/"Sonando") al día ante
  // play/pause que no pasan por un cambio de canción (idempotente y barato).
  refreshNowPlayingLiveState();
  scheduleCompanionPoll();
}
function scheduleCompanionPoll() {
  if (companionPollTimer || document.visibilityState !== 'visible') return;
  companionPollTimer = setTimeout(companionPollTick, 600);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleCompanionPoll();
});
scheduleCompanionPoll();

// Auto-update: when a new version finishes downloading in the background,
// show a non-intrusive banner offering to restart now (it also installs on
// the next normal quit).
// Show the real app version in the Info panel + wire the manual update check.
if (window.electronAPI && window.electronAPI.getAppVersion) {
  window.electronAPI.getAppVersion().then(v => {
    const el = document.getElementById('about-version');
    if (el && v) el.textContent = `Versión ${v} · Edición Profesional`;
  }).catch(() => {});

  const checkBtn = document.getElementById('btn-check-updates');
  const statusEl = document.getElementById('update-status');
  let downloadingVersion = '';

  // Render "Descargando vX… NN%" with a thin progress bar inside the status.
  const renderProgress = (pct) => {
    const el = document.getElementById('update-status');
    if (!el) return;
    const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    el.className = 'about-update-status';
    el.innerHTML =
      `Descargando${downloadingVersion ? ` v${downloadingVersion}` : ''}… <b>${p}%</b>` +
      `<span class="update-bar"><span class="update-bar-fill" style="width:${p}%"></span></span>`;
  };

  if (checkBtn) {
    checkBtn.onclick = async () => {
      if (!statusEl) return;
      checkBtn.disabled = true;
      statusEl.textContent = 'Buscando…';
      statusEl.className = 'about-update-status';
      try {
        const r = await window.electronAPI.checkForUpdates();
        if (r.status === 'available')      { downloadingVersion = r.version || ''; renderProgress(0); }
        else if (r.status === 'latest')    statusEl.textContent = 'Ya tienes la última versión ✓';
        else if (r.status === 'dev')       statusEl.textContent = 'Solo disponible en la app instalada';
        else                               { statusEl.textContent = 'No se pudo comprobar'; statusEl.classList.add('is-error'); }
      } catch (e) {
        statusEl.textContent = 'No se pudo comprobar';
        statusEl.classList.add('is-error');
      } finally {
        checkBtn.disabled = false;
      }
    };
  }

  // Live download progress + errors (also fires from the auto-check on launch).
  if (window.electronAPI.onUpdateProgress) {
    window.electronAPI.onUpdateProgress((p) => renderProgress(p && p.percent));
  }
  if (window.electronAPI.onUpdateError) {
    window.electronAPI.onUpdateError((e) => {
      const el = document.getElementById('update-status');
      if (!el) return;
      el.className = 'about-update-status is-error';
      el.textContent = `Error al actualizar: ${(e && e.message) || 'desconocido'}`;
    });
  }
}

if (window.electronAPI && window.electronAPI.onUpdateReady) {
  window.electronAPI.onUpdateReady((info) => {
    const st = document.getElementById('update-status');
    if (st) {
      st.className = 'about-update-status';
      st.textContent = '✓ Descarga completa — listo para reiniciar';
      // Show "what's new" in the Info panel when the release carries notes.
      const notes = info && info.notes ? String(info.notes).trim() : '';
      const prev = document.getElementById('update-notes');
      if (prev) prev.remove();
      if (notes) {
        const nb = document.createElement('div');
        nb.id = 'update-notes';
        nb.className = 'about-update-notes';
        nb.innerHTML = `<strong>Novedades v${(info && info.version) || ''}</strong><br>${notes.replace(/\n/g, '<br>')}`;
        st.insertAdjacentElement('afterend', nb);
      }
    }
    if (document.getElementById('update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.className = 'update-banner';
    bar.innerHTML = `
      <span>Actualización lista${info && info.version ? ` (v${info.version})` : ''} — reinicia para aplicarla.</span>
      <button id="update-restart">Reiniciar ahora</button>
      <button id="update-later" class="update-banner__later" aria-label="Más tarde">✕</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('is-in'));
    bar.querySelector('#update-restart').onclick = () => window.electronAPI.installUpdate();
    bar.querySelector('#update-later').onclick = () => bar.remove();
  });
}

