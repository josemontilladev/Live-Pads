import { SynthEngine } from './audio/SynthEngine.js';
import { Metronome }   from './audio/Metronome.js';
import { PAD_BANKS, KIT_BANKS } from './data/banks.js';
import { q, qa, esc } from './utils/dom.js';
import { openLyricsEditorModal } from './ui/lyricsEditor.js';
import { hideDialog } from './ui/dialog.js';
import { openCheatSheet, closeCheatSheet, isCheatSheetOpen, ensureShortcutsRendered } from './ui/cheatSheet.js';
import { openPreflight } from './ui/preflight.js';
import { openMappingsList } from './ui/mappingsList.js';
import { openCompanionPanel } from './ui/companionPanel.js';
import { mount as mountStemsWorkspace, toggleStemsPlay, addStemsMarker, stemsUndo, stemsRedo, showStemsTour } from './stems/workspace.js';
import { maybeStartTour, startTour } from './stems/tour.js';

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
window.__padsShowTour = () => startTour(PADS_TOUR_STEPS, PADS_TOUR_KEY);
import { openSpotlight, isSpotlightOpen, closeSpotlight } from './ui/spotlight.js';
import { showToast } from './ui/toast.js';
import { bindKitControls } from './ui/kitControls.js';
import { bindMixerControls } from './ui/mixerControls.js';
import { bindMetronomeControls } from './ui/metronomeControls.js';
import { applyTheme, buildThemesList, getCurrentTheme } from './ui/themes.js';
import {
  initService, getServiceSongs, getActiveServiceIndex,
  loadServiceSongs, saveServiceSongs, addToService, removeFromService,
  reorderService, syncActiveByTitleArtist, peekNextServiceSong,
  serviceNextSong, servicePrevSong
} from './data/service.js';
import {
  initTrackPlayer, loadAndPlayTrack, clearTrackUI,
  bindTrackPlayerControls, isTrackLoaded, isTrackPlaying, clickPlayPause, getCurrentSong
} from './audio/trackPlayer.js';
import {
  initPresets, loadPresets as loadPresetsModule
} from './data/presets.js';
import {
  setMidiMap, getMapping, addMapping, clearMappingForTarget, findKeyboardMappingFor
} from './midi/midiMap.js';
import { bindMidiHandlers } from './midi/midiBindings.js';
import { hydrateCustomKitsInto } from './data/customKits.js';
import { loadGiSetlistFromFile as loadGiSetlistFromFileModule } from './data/giSetlistLoader.js';
import { bindMongoSync } from './data/mongoSync.js';
import { bindSetlistTabs } from './ui/setlistTabs.js';
import { bindGiToolbar } from './ui/giToolbar.js';
import { updateFilterCounts as updateFilterCountsModule } from './ui/genreFilter.js';
import { openSidebarTab, closeAllOverlays } from './ui/overlays.js';
import { initDrumGrid, buildDrumGrid, hitDrum } from './ui/drumGrid.js';
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
      if (sameSong) serviceNextSong();
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
  loadServiceSongs();
  bindAll();
  initPresets({ onApply: applyPreset });
  loadPresetsModule();
  loadGiSetlistFromFile();
  mountStemsWorkspace();
  bindWorkspaceSwitcher();

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
    const type = btn.dataset.type;
    let hint = KEY_MAP_DRUMS[i] || '';
    const found = findKeyboardMappingFor('drum', type);
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
  // Any prior fade visualisation on any key is no longer relevant the
  // moment another pad event happens. Clear before we set new state.
  qa('.key-btn.fading-out').forEach(b => b.classList.remove('fading-out'));

  if (getActiveKey() === key) {
    engine.stopPad(PAD_STOP_FADE_S);
    setActiveKey(null);
    setPreparedPadKey(key); // Keep it prepared
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
    engine.playPad(key, PAD_BANKS[getPadBankIdx()].synth);
    setActiveKey(key);
    setPreparedPadKey(null);
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

  const btnMidiLearn = q('#menu-midi-learn');
  if (btnMidiLearn) {
    btnMidiLearn.onclick = () => {
      closeMenu();
      setIsMidiLearnMode(true);
      setMidiLearnTarget(null);
      q('#midi-learn-overlay').innerHTML = '🎹 Modo Mapeo: Haz clic en un botón de la app. (Clic aquí para salir)';
      q('#midi-learn-overlay').style.display = 'block';
      // Body-level flag → CSS dims the whole UI to emphasize learn-mode
      // is modal. Exit (in midiBindings.js) removes the class.
      document.body.classList.add('midi-learning');
    };
  }
}


function bindRestOfApp() {
  bindSetlistTabs();
  bindMongoSync({
    getSongs: () => getSongs(),
    persist: () => { if (window.electronAPI) window.electronAPI.saveGiSetlist(getSongs()); },
    rerender: renderGiList,
    updateFilterCounts,
    getSearchFilter: () => q('#gi-search')?.value || '',
  });
  bindGiToolbar({ updateFilterCounts });
  bindMidiHandlers({
    getEngine: () => engine,
    onKeyClick,
    toggleMetro,
    triggerMasterPlayPause,
    triggerMasterStop,
  });
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
  try { localStorage.setItem(WS_KEY, valid); } catch (e) {}

  // First-run tutorial fires the very first time the user enters each
  // workspace. After that it can be re-launched manually.
  if (valid === 'stems') maybeStartTour();
  else maybeStartPadsTour();
}

// Public so a menu item or spotlight command can re-launch the tour.
window.__stemsShowTour = showStemsTour;

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

function triggerMasterPlayPause() {
  // A session is "currently active" if the loaded track is playing, or — if
  // no track is loaded — the metronome is running.
  const isCurrentlyActive = isTrackLoaded() ? isTrackPlaying() : getMetroRunning();

  if (isCurrentlyActive) {
    triggerMasterStop();
  } else {
    // 1. Play the pad if not already active (if it crossfaded, it's already active!)
    if (getPreparedPadKey() && !getActiveKey()) onKeyClick(getPreparedPadKey());

    // 2. Play the track or the metronome
    if (isTrackLoaded()) {
      if (!isTrackPlaying()) clickPlayPause();
    } else if (!getMetroRunning()) {
      toggleMetro();
    }
  }
}

function triggerMasterStop() {
  if (getActiveKey()) onKeyClick(getActiveKey());
  if (getMetroRunning()) toggleMetro();
  if (isTrackPlaying()) clickPlayPause();
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

  // Stems workspace owns its own shortcuts. Space toggles play/pause,
  // M drops a marker, and Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) drive the
  // undo stack. Nothing else from the Pads keymap should reach the user
  // when they're working in the Stems editor.
  if (document.body.dataset.workspace === 'stems') {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      stemsUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      stemsRedo();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      toggleStemsPlay();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      addStemsMarker();
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
  // Cheat sheet visible — only Escape escapes; everything else is locked
  // so pads/drums don't fire while the help is being read.
  if (isCheatSheetOpen()) {
    if (e.code === 'Escape') { closeCheatSheet(); e.preventDefault(); }
    return;
  }

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
      const pad = kit.pads.find(p => p.type === mapping.id);
      if (pad) {
        const btn = q(`.drum-btn[data-drum="${pad.id}"]`);
        if (btn) btn.classList.add('hit');
        setTimeout(() => { if(btn) btn.classList.remove('hit'); }, 120);
        if (!engine.playCustomDrum(pad.id, pad.id)) engine.playDrum(pad.type, pad.id);
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
  if (e.code === 'Tab') {
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

  if (e.code === 'Escape') { closeAllOverlays(); q('#sidebar').classList.remove('open'); engine.stopPad(); setActiveKey(null); setPreparedPadKey(null); buildKeyGrid(); }

  const padIdx = KEY_MAP_PADS.indexOf(kUpper);
  if (padIdx !== -1) { const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP; onKeyClick(keys[padIdx]); }

  const drumIdx = KEY_MAP_DRUMS.indexOf(kUpper);
  if (drumIdx !== -1) {
    const kit = KIT_BANKS[getKitBankIdx()];
    const pad = kit.pads[drumIdx];
    if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
  }
}

// doSavePreset was only called from a `#btn-add-preset` button that doesn't
// exist in the HTML — removed as dead code. If a "Save preset" button is
// added back later, use `addPreset({...})` directly.

// Apply a saved snapshot to the live engine + UI. Lives here (not in
// presets.js) because it touches engine/metro/UI globals.
function applyPreset(p) {
  loadPadBank(p.padBankIdx);
  loadKitBank(p.kitBankIdx);
  if (p.key) onKeyClick(p.key);
  applyBpm(p.bpm);
}

/* ── GI-SETLIST LOGIC ── */

// updateFilterCounts -> src/js/ui/genreFilter.js (passing the current songs list)
const updateFilterCounts = () => updateFilterCountsModule(getSongs());

async function loadGiSetlistFromFile() {
  const songs = await loadGiSetlistFromFileModule();
  if (!songs) return;
  setSongs(songs);
  updateFilterCounts();
  renderGiList();
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
  // Sync active library song id in the store.
  setActiveSongId(song.id);

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

  // Auto-load track if available
  if (song.audio) {
    if (song.audio.sequence) {
      loadAndPlayTrack(song, 'sequence');
    } else if (song.audio.original) {
      loadAndPlayTrack(song, 'original');
    }
  } else if (isTrackLoaded()) {
    // No audio for the new song — release the previous track and reset the UI.
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
    if (st) { st.className = 'about-update-status'; st.textContent = '✓ Descarga completa — listo para reiniciar'; }
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

