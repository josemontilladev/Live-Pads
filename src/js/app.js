import { SynthEngine } from './audio/SynthEngine.js';
import { Metronome }   from './audio/Metronome.js';
import { PAD_BANKS, KIT_BANKS } from './data/banks.js';
import { q, qa, esc, debounce } from './utils/dom.js';
import { panShort } from './utils/format.js';
import { showToast } from './ui/toast.js';
import { songEditFormHTML } from './ui/songEditForm.js';
import { songCardInnerHTML } from './ui/songCard.js';
import { openLyricsEditorModal } from './ui/lyricsEditor.js';
import { showDialog, hideDialog } from './ui/dialog.js';
import { applyTheme, buildThemesList, getCurrentTheme } from './ui/themes.js';
import {
  initService, getServiceSongs, getActiveServiceIndex,
  loadServiceSongs, saveServiceSongs, addToService, removeFromService,
  clearServiceList, serviceNextSong, servicePrevSong,
  reorderService, syncActiveByTitleArtist
} from './data/service.js';
import {
  initTrackPlayer, loadAndPlayTrack, clearTrackUI,
  bindTrackPlayerControls, isTrackLoaded, isTrackPlaying, clickPlayPause
} from './audio/trackPlayer.js';
import {
  initPresets, loadPresets as loadPresetsModule
} from './data/presets.js';
import {
  setMidiMap, getMapping, addMapping, clearMappingForTarget, findKeyboardMappingFor
} from './midi/midiMap.js';
import {
  hydrateCustomKitsInto, saveCustomKitsToStorage, createEmptyCustomKit
} from './data/customKits.js';
import { loadGiSetlistFromFile as loadGiSetlistFromFileModule } from './data/giSetlistLoader.js';
import { updateFilterCounts as updateFilterCountsModule } from './ui/genreFilter.js';
import { openSidebarTab, closeAllOverlays } from './ui/overlays.js';
import { initDrumGrid, buildDrumGrid, hitDrum } from './ui/drumGrid.js';
import { initMetroBeatDots, buildMetroBeatDots, onMetroBeat } from './ui/metroBeatDots.js';
import { initDrumVolumes, buildDrumVolumes } from './ui/drumVolumes.js';
import { KEYS_FLAT, KEYS_SHARP, KEY_MAP_PADS, KEY_MAP_DRUMS } from './data/musicConstants.js';
import { syncSlider, syncPanSlider, bindToggle } from './utils/sliders.js';
import {
  initGiList, renderGiList,
  repaintGiCard, getGiCardBySongId
} from './ui/giList.js';
import {
  initServiceList, renderServiceList as renderServiceListModule
} from './ui/serviceListView.js';

let engine, metro;
let activeKey = null;
let useFlats = false;
let padBankIdx = 0, kitBankIdx = 0;
let metroRunning = false;
let giSetlistSongs = [];
let currentGiGenre = 'all';
let activeGiSongId = null;
let openAccordionSongId = null;
let openAccordionServiceId = null;
let isEditKitMode  = false;
let isMidiLearnMode = false;
let midiLearnTarget = null;

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
  initGiList({
    getSongs: () => giSetlistSongs,
    setSongs: (s) => { giSetlistSongs = s; },
    getCurrentGenre: () => currentGiGenre,
    getActiveSongId: () => activeGiSongId,
    getOpenAccordionId: () => openAccordionSongId,
    persist: () => { if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs); },
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
    getOpenAccordionId: () => openAccordionServiceId,
    persistServiceSongs: saveServiceSongs,
    onApplySong: applyGiSong,
    loadAndPlayTrack,
    removeFromService,
    reorderService,
    openLyricsEditorModal,
    toggleLyricsAccordion,
    toggleChordVisibility,
    syncLyricsToLibrary: (song) => {
      const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      giSong.lyrics = song.lyrics;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
    syncMetaToLibrary: (oldKey, song) => {
      const giSong = giSetlistSongs.find(s => (s.title + '\x00' + s.artist) === oldKey);
      if (!giSong) return;
      giSong.title = song.title;
      giSong.artist = song.artist;
      giSong.bpm = song.bpm;
      giSong.key = song.key;
      giSong.genre = song.genre;
      if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
      // Title/artist may have moved the library card in sort order → full re-render.
      renderGiList(q('#gi-search').value);
    },
  });
  initDrumGrid({
    getEngine: () => engine,
    getKitBankIdx: () => kitBankIdx,
    isEditKit: () => isEditKitMode,
    onAfterBuild: () => { if (typeof updateKeyHints === 'function') updateKeyHints(); }
  });
  initDrumVolumes({ getEngine: () => engine, syncSlider });

  // Hook the track player to app.js helpers so it stays decoupled.
  initTrackPlayer({
    syncSlider,
    onAudioPathAssigned: (song, type, newPath) => {
      // Sync the new file path back into the library + persist + refresh views.
      const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
      if (giSong) {
        if (!giSong.audio) giSong.audio = {};
        giSong.audio[type] = newPath;
      }
      if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
      saveServiceSongs();
      const searchInput = q('#gi-search');
      if (searchInput) renderGiList(searchInput.value);
      renderServiceList();
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
  loadServiceSongs();
  bindAll();
  initPresets({ onApply: applyPreset });
  loadPresetsModule();
  loadGiSetlistFromFile();

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
    padSel.value = padBankIdx;
    padSel.onchange = (e) => loadPadBank(parseInt(e.target.value));
  }
  if (kitSel) {
    kitSel.innerHTML = KIT_BANKS.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    kitSel.value = kitBankIdx;
    kitSel.onchange = (e) => loadKitBank(parseInt(e.target.value));
  }
}

/* ── PAD BANK ── */
function loadPadBank(idx) {
  padBankIdx = ((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length;
  const bank = PAD_BANKS[padBankIdx];
  const padSel = q('#pad-bank-select');
  if (padSel) padSel.value = padBankIdx;
  engine.setPadBank(bank);
  if (activeKey) engine.playPad(activeKey);
  
  // Save last selected Pad Bank persistently
  localStorage.setItem('lastPadBankIdx', padBankIdx);
}

function loadKitBank(idx) {
  kitBankIdx = ((idx % KIT_BANKS.length) + KIT_BANKS.length) % KIT_BANKS.length;
  const kit = KIT_BANKS[kitBankIdx];
  const kitSel = q('#kit-bank-select');
  if (kitSel) kitSel.value = kitBankIdx;
  
  // Show/hide the trash button + toggle edit pencil availability based on
  // whether the active kit is user-custom. Class-based so it stays themable.
  const btnDelete = q('#btn-delete-kit');
  if (btnDelete) btnDelete.classList.toggle('kit-action-btn--hidden', !kit.isCustom);
  const btnEdit = q('#btn-edit-kit');
  if (btnEdit) btnEdit.classList.toggle('kit-action-btn--disabled', !kit.isCustom);

  engine.initDrumVolumes(kit.pads);
  buildDrumGrid(kit.pads);
  buildDrumVolumes(kit.pads);
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
  localStorage.setItem('lastKitBankIdx', kitBankIdx);
}

/* ── KEY GRID ── */
function buildKeyGrid() {
  const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
  const grid = q('#key-grid'); grid.innerHTML = '';
  keys.forEach((key, keyIdx) => {
    const btn = document.createElement('button');
    btn.className = 'key-btn' + (key === activeKey ? ' active' : '');
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
    const padIdx = (useFlats ? KEYS_FLAT : KEYS_SHARP).indexOf(key);
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

function onKeyClick(key) {
  if (activeKey === key) { 
    engine.stopPad(5.0); // Smooth 5-second fade out on stop
    activeKey = null; 
    preparedPadKey = key; // Keep it prepared
    qa('.key-btn').forEach(b => {
      b.classList.remove('active');
      if(b.dataset.key === key) b.classList.add('prepared');
    });
  }
  else { 
    engine.playPad(key, PAD_BANKS[padBankIdx].synth); 
    activeKey = key; 
    preparedPadKey = null;
    qa('.key-btn').forEach(b => {
      b.classList.remove('prepared');
      b.classList.toggle('active', b.dataset.key === activeKey);
    });
  }
}

let preparedPadKey = null;

// Drum grid (buildDrumGrid, hitDrum, assignSampleToPad) -> src/js/ui/drumGrid.js

/* ── DRUM VOLUMES ── */
/* ── BIND ALL ──
   The big "wire up the UI" function. Split into named sub-binders for
   navigability — each runs once at boot, no separate test cases needed.
   Sub-binders reference module-scope `engine`, `metro`, KIT_BANKS, etc.,
   so they're defined at module level too (no closure tricks). */

function bindAll() {
  bindTrackPlayerControls();
  bindKitButtons();
  bindWindowControls();
  bindSidebarAndTabs();
  bindHamburgerMenu();
  bindMixerControls();
  bindMetronomeControls();
  bindRestOfApp();
}

function bindKitButtons() {
  const btnCreateKit = q('#btn-create-kit');
  if (btnCreateKit) {
    btnCreateKit.onclick = () => {
      // Exit edit mode first so contentEditable pads don't steal focus from the dialog
      if (isEditKitMode) {
        const btnEditKit = q('#btn-edit-kit');
        if (btnEditKit) btnEditKit.click();
      }
      showDialog('Nuevo kit de batería', 'Ej. Worship Acoustic', (name) => {
        if (!name || !name.trim()) return;
        KIT_BANKS.unshift(createEmptyCustomKit(name.trim()));
        saveCustomKitsToStorage();
        buildBankSelects();
        loadKitBank(0);
      });
    };
  }

  const btnDeleteKit = q('#btn-delete-kit');
  if (btnDeleteKit) {
    btnDeleteKit.onclick = () => {
      const currentKit = KIT_BANKS[kitBankIdx];
      if (!currentKit || !currentKit.isCustom) return;
      if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el kit "${currentKit.name}"?`)) {
        KIT_BANKS.splice(kitBankIdx, 1);
        saveCustomKitsToStorage();
        buildBankSelects();
        loadKitBank(0);
      }
    };
  }

  const btnEditKit = q('#btn-edit-kit');
  if (btnEditKit) {
    btnEditKit.onclick = () => {
      const currentKit = KIT_BANKS[kitBankIdx];
      if (!currentKit || !currentKit.isCustom) {
        alert('Selecciona un kit personalizado primero.');
        return;
      }
      
      isEditKitMode = !isEditKitMode;
      btnEditKit.style.color = isEditKitMode ? 'var(--blue)' : 'var(--text-muted)';
      btnEditKit.style.borderColor = isEditKitMode ? 'var(--blue)' : 'transparent';
      if (isEditKitMode) {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="18" height="18"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="18" height="18"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      }
      
      const kitSelect = q('#kit-bank-select');
      const selectWrapper = kitSelect.parentElement;

      if (isEditKitMode) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'edit-kit-name-input';
        input.className = 'metro-dropdown';
        input.style.width = '100%';
        input.style.border = '1px solid var(--blue)';
        input.value = currentKit.name;
        kitSelect.style.display = 'none';
        selectWrapper.insertBefore(input, kitSelect);
        input.focus();
      } else {
        const input = q('#edit-kit-name-input');
        if (input) {
           const newName = input.value.trim() || 'Custom Kit';
           currentKit.name = newName;
           saveCustomKitsToStorage();
           input.remove();
        }
        kitSelect.style.display = 'block';
        buildBankSelects();
        kitSelect.value = kitBankIdx;
      }

      qa('.drum-btn').forEach(b => {
        const lbl = b.querySelector('.drum-label');
        if (isEditKitMode) {
           b.classList.add('edit-pulse');
           if(lbl) lbl.contentEditable = true;
        } else {
           b.classList.remove('edit-pulse');
           if(lbl) lbl.contentEditable = false;
        }
      });
    };
  }
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

  const btnMidiLearn = q('#menu-midi-learn');
  if (btnMidiLearn) {
    btnMidiLearn.onclick = () => {
      closeMenu();
      isMidiLearnMode = true;
      midiLearnTarget = null;
      q('#midi-learn-overlay').innerHTML = '🎹 Modo Mapeo: Haz clic en un botón de la app. (Clic aquí para salir)';
      q('#midi-learn-overlay').style.display = 'block';
    };
  }
}

function bindMixerControls() {
  // Pad volume (stage + sidebar mirror)
  const pvolStage = q('#pad-vol-stage'), pvolValStage = q('#pad-vol-val-stage');
  const pvol = q('#pad-vol'), pvolVal = q('#pad-vol-val');
  const updatePadVol = val => {
    engine.setPadVolume(val / 100);
    if (pvol) { pvol.value = val; pvolVal.textContent = val + '%'; syncSlider(pvol); }
    if (pvolStage) { pvolStage.value = val; pvolValStage.textContent = val + '%'; syncSlider(pvolStage); }
  };
  if (pvolStage) pvolStage.oninput = () => updatePadVol(pvolStage.value);
  if (pvol) pvol.oninput = () => updatePadVol(pvol.value);
  if (pvol) syncSlider(pvol);
  if (pvolStage) syncSlider(pvolStage);

  // Pad pan
  const ppanStage = q('#pad-pan-stage'), ppanValStage = q('#pad-pan-val-stage');
  const ppan = q('#pad-pan'), ppanVal = q('#pad-pan-val');
  const updatePadPan = val => {
    engine.setPadPan(val / 100);
    if (ppan) { ppan.value = val; ppanVal.textContent = panShort(val); syncPanSlider(ppan); }
    if (ppanStage) { ppanStage.value = val; ppanValStage.textContent = panShort(val); syncPanSlider(ppanStage); }
  };
  if (ppanStage) ppanStage.oninput = () => updatePadPan(ppanStage.value);
  if (ppan) ppan.oninput = () => updatePadPan(ppan.value);
  if (ppanStage) updatePadPan(ppanStage.value);

  // Drum master volume (drumGain node — all pads together)
  const drumMasterVolStage    = q('#drum-master-vol-stage');
  const drumMasterVolValStage = q('#drum-master-vol-val-stage');
  const drumMasterVol         = q('#drum-master-vol');
  const drumMasterVolVal      = q('#drum-master-vol-val');
  const updateDrumMasterVol = val => {
    engine.setDrumVolume(val / 100);
    if (drumMasterVolStage) { drumMasterVolStage.value = val; drumMasterVolValStage.textContent = val + '%'; syncSlider(drumMasterVolStage); }
    if (drumMasterVol)      { drumMasterVol.value = val;      drumMasterVolVal.textContent      = val + '%'; syncSlider(drumMasterVol); }
  };
  if (drumMasterVolStage) drumMasterVolStage.oninput = () => updateDrumMasterVol(drumMasterVolStage.value);
  if (drumMasterVol)      drumMasterVol.oninput      = () => updateDrumMasterVol(drumMasterVol.value);
  updateDrumMasterVol(80); // matches engine default

  // Drum pan
  const drumPanStage = q('#drum-pan-stage'), drumPanVal = q('#drum-pan-val-stage');
  const updateDrumPan = () => {
    engine.setDrumPan(drumPanStage.value / 100);
    drumPanVal.textContent = panShort(drumPanStage.value);
    syncPanSlider(drumPanStage);
  };
  drumPanStage.oninput = updateDrumPan;
  updateDrumPan();

  // LPF on the pad bus
  const lpfStage = q('#pad-lpf-stage'), lpfToggleStage = q('#lpf-toggle-stage');
  const lpf = q('#pad-lpf'), lpfToggle = q('#lpf-toggle');
  const updateLPF = (val, on) => {
    engine.setLPF(parseInt(val), on);
    if (lpf) {
      lpf.value = val;
      lpfToggle.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpf);
    }
    if (lpfStage) {
      lpfStage.value = val;
      lpfToggleStage.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpfStage);
    }
  };
  if (lpfStage) {
    lpfStage.oninput = () => updateLPF(lpfStage.value, lpfToggleStage.classList.contains('on'));
    bindToggle(lpfToggleStage, on => updateLPF(lpfStage.value, on));
  }
  if (lpf) {
    lpf.oninput = () => updateLPF(lpf.value, lpfToggle.classList.contains('on'));
    bindToggle(lpfToggle, on => updateLPF(lpf.value, on));
    syncSlider(lpf);
  }
  if (lpfStage) syncSlider(lpfStage);

  // Master volume (final stage)
  const mvol = q('#master-vol'), mvolVal = q('#master-vol-val');
  mvol.oninput = () => {
    engine.setMasterVolume(mvol.value / 100);
    mvolVal.textContent = mvol.value + '%';
    syncSlider(mvol);
  };
  syncSlider(mvol);
}

function bindMetronomeControls() {
  // Start/Stop
  q('#btn-metro-main').onclick = toggleMetro;

  // BPM controls — all delegate to the module-level applyBpm() helper.
  const bpmSlider = q('#bpm-slider'), bpmDisp = q('#bpm-display');
  bpmSlider.oninput = () => applyBpm(parseInt(bpmSlider.value));
  q('#bpm-minus').onclick = () => applyBpm(metro.bpm - 1);
  q('#bpm-plus').onclick  = () => applyBpm(metro.bpm + 1);
  q('#tap-tempo').onclick = () => applyBpm(metro.tap());
  syncSlider(bpmSlider);
  q('#metro-bpm-live').textContent = metro.bpm + ' BPM';

  // Click-to-edit inline BPM
  bpmDisp.style.cursor = 'pointer';
  bpmDisp.title = 'Hacer clic para editar BPM';
  bpmDisp.onclick = () => {
    if (q('#bpm-inline-input')) return; // already editing

    const currentBpm = metro.bpm;
    const input = document.createElement('input');
    input.id = 'bpm-inline-input';
    input.type = 'text';
    input.value = currentBpm;

    input.onkeydown = (e) => {
      // Allow control keys (Backspace, Delete, arrows, Enter, Tab, Escape).
      if (e.key.length === 1 && (e.key < '0' || e.key > '9')) e.preventDefault();
    };

    bpmDisp.innerHTML = '';
    bpmDisp.appendChild(input);
    input.focus();
    input.select();

    const commitChange = () => {
      let val = parseInt(input.value);
      if (isNaN(val) || val < 30) val = 30;
      if (val > 300) val = 300;
      applyBpm(val);
    };

    input.onblur = () => {
      commitChange();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        commitChange();
      } else if (e.key === 'Escape') {
        bpmDisp.textContent = currentBpm;
      }
    };
  };

  // Time signatures (ahora es un select dropdown)
  const sigSelect = q('#metro-sig-select');
  if (sigSelect) {
    sigSelect.value = '4'; // 4/4 por defecto
    sigSelect.onchange = (e) => {
      const n = parseInt(e.target.value);
      metro.setBeats(n);
      buildMetroBeatDots(n);
    };
  }
  metro.setBeats(4);
  buildMetroBeatDots(4);

  // Multiplier
  q('#btn-mult-1').onclick = () => {
    metro.multiplier = 1;
    q('#btn-mult-1').classList.add('active');
    q('#btn-mult-2').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };
  q('#btn-mult-2').onclick = () => {
    metro.multiplier = 2;
    q('#btn-mult-2').classList.add('active');
    q('#btn-mult-1').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };

  // Accent toggle — acentúa el primer tiempo del compás (Removed, now click dots)


  // Click sound — Select dropdown
  metro.sound = 'cowbell';   // default
  const soundSelect = q('#metro-sound-select');
  if (soundSelect) {
    soundSelect.value = 'cowbell';
    soundSelect.onchange = (e) => {
      const newSound = e.target.value;
      // Decode the new sound's mp3 pair on demand (idempotent + deduped).
      // Fire-and-forget — by the time the next beat schedules, buffers are ready.
      engine.ensureClickSound(newSound);
      metro.sound = newSound;
    };
  }

  // Metro volume + pan
  const metroVolSlider = q('#metro-vol-slider'), metroVolVal = q('#metro-vol-val');
  metroVolSlider.oninput = () => {
    metro.volume = metroVolSlider.value / 100;
    metroVolVal.textContent = metroVolSlider.value + '%';
    syncSlider(metroVolSlider);
  };
  syncSlider(metroVolSlider);

  const metroPanSlider = q('#metro-pan-slider'), metroPanVal = q('#metro-pan-val');
  const updateMetroPan = () => {
    metro.pan = metroPanSlider.value / 100;
    metroPanVal.textContent = panShort(metroPanSlider.value);
    syncPanSlider(metroPanSlider);
  };
  metroPanSlider.oninput = updateMetroPan;
  updateMetroPan();

  // Notation — Select dropdown
  const notSelect = q('#metro-notation-select');
  if (notSelect) {
    notSelect.addEventListener('change', (e) => {
      useFlats = e.target.value === 'flats';
      buildKeyGrid();
    });
  }
}

function bindRestOfApp() {
  // GI-Setlist tab toggle. The header-button visibility (Import / Sync /
  // AddPreset) per active tab is driven by a `data-active-tab` attribute
  // on #panel-setlist, so the CSS owns the show/hide rules — much cleaner
  // than 9 imperative `style.display = ...` assignments.
  const panelSetlist = q('#panel-setlist');
  qa('.s-toggle').forEach(btn => {
    btn.onclick = () => {
      qa('.s-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      q('#setlist-list').classList.add('hidden');
      q('#gi-setlist-list').classList.add('hidden');
      q('#service-setlist-list').classList.add('hidden');
      q('#' + btn.dataset.target).classList.remove('hidden');
      if (panelSetlist) panelSetlist.dataset.activeTab = btn.dataset.target;
    };
  });

  // Initial sync of setlist header buttons
  const activeToggle = q('.s-toggle.active');
  if (activeToggle) activeToggle.click();

  // Clear service list
  const btnClear = q('#btn-clear-service');
  if (btnClear) btnClear.onclick = clearServiceList;

  const btnPrev = q('#btn-service-prev');
  if (btnPrev) btnPrev.onclick = servicePrevSong;
  const btnNext = q('#btn-service-next');
  if (btnNext) btnNext.onclick = serviceNextSong;

  const btnSyncGi = q('#btn-sync-gi');
  if (btnSyncGi) {
    btnSyncGi.onclick = async () => {
      if (!window.electronAPI) return;
      try {
        btnSyncGi.style.animation = 'pulse 1s infinite';
        btnSyncGi.style.color = '#fbae00';
        
        const mongoSongs = await window.electronAPI.syncMongoSetlist();
        
        if (!mongoSongs || !mongoSongs.length) {
           throw new Error("No se encontraron canciones en MongoDB");
        }
        
        let updatedCount = 0;
        let newCount = 0;

        mongoSongs.forEach(mSong => {
          const existingIdx = giSetlistSongs.findIndex(s => 
            (s._id && s._id === mSong._id) || 
            (s.title.toLowerCase() === mSong.title.toLowerCase() && (s.artist || '').toLowerCase() === (mSong.artist || '').toLowerCase())
          );

          if (existingIdx >= 0) {
            const existing = giSetlistSongs[existingIdx];
            let changed = false;
            if (!existing._id) { existing._id = mSong._id; changed = true; }
            if (existing.lyrics !== mSong.lyrics) { existing.lyrics = mSong.lyrics; changed = true; }
            if (existing.bpm !== mSong.bpm) { existing.bpm = mSong.bpm; changed = true; }
            if (existing.key !== mSong.key) { existing.key = mSong.key; changed = true; }
            if (existing.genre !== mSong.genre) { existing.genre = mSong.genre; changed = true; }
            
            if (changed) updatedCount++;
          } else {
            giSetlistSongs.push({
              id: 'song_sync_' + Date.now() + '_' + Math.random().toString(36).substring(2,7),
              _id: mSong._id,
              title: mSong.title,
              artist: mSong.artist || '',
              bpm: mSong.bpm || '',
              key: mSong.key || '',
              genre: mSong.genre || '',
              lyrics: mSong.lyrics || ''
            });
            newCount++;
          }
        });
        
        if (updatedCount > 0 || newCount > 0) {
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          updateFilterCounts();
          renderGiList(q('#gi-search').value);
          showToast(`Sincronización exitosa. Nuevas: ${newCount}, Actualizadas: ${updatedCount}`, 'success');
        } else {
          showToast('Tu librería ya está al día, sin cambios.', 'success');
        }
      } catch (e) {
        console.error('Error sincronizando con MongoDB:', e);
        showToast('Error de red. Operando en Modo Local.', 'warning');
      } finally {
        btnSyncGi.style.animation = '';
        btnSyncGi.style.color = '';
      }
    };
  }

  q('#btn-import-gi').onclick = () => q('#gi-file-input').click();
  q('#gi-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (json.data && json.data.songs) {
          giSetlistSongs = json.data.songs.map((s, idx) => {
            if (!s.id) s.id = 'song_imp_' + idx + '_' + Date.now();
            return s;
          });
          if (window.electronAPI && window.electronAPI.saveGiSetlist) {
            window.electronAPI.saveGiSetlist(giSetlistSongs);
          }
          updateFilterCounts();
          renderGiList();
          // Switch to GI tab automatically
          q('.s-toggle[data-target="gi-setlist-list"]').click();
        } else {
          alert('El archivo no parece ser un export de GI-Setlist válido.');
        }
      } catch (err) {
        alert('Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  q('#gi-search').oninput = debounce((e) => renderGiList(e.target.value), 180);
  
  const btnAddGiSong = q('#btn-add-gi-song');
  if (btnAddGiSong) {
    btnAddGiSong.onclick = () => {
      const newSong = {
        id: 'song_' + Date.now(),
        title: 'Nueva Canción',
        artist: '',
        bpm: '',
        key: '',
        genre: 'adoracion',
        audio: {
          sequence: null,
          original: null
        }
      };
      giSetlistSongs.push(newSong);
      if (window.electronAPI && window.electronAPI.saveGiSetlist) {
        window.electronAPI.saveGiSetlist(giSetlistSongs);
      }
      updateFilterCounts();
      renderGiList(q('#gi-search').value, newSong.id);
    };
  }
  
  // Genre filter dropdown — replaces the inline chips with a popover menu
  // anchored to the filter icon next to the search input. Keeps the search
  // row compact so the first song card sits closer to the header.
  const filterToggle = q('#btn-gi-filter-toggle');
  const filterMenu = q('#gi-filter-menu');
  const filterDot = q('#gi-filter-dot');

  const refreshFilterActiveStates = () => {
    qa('.gi-filter-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.genre === currentGiGenre);
    });
    const customFilter = currentGiGenre !== 'all';
    if (filterToggle) filterToggle.classList.toggle('active', customFilter);
    if (filterDot) filterDot.hidden = !customFilter;
  };
  refreshFilterActiveStates();

  const closeFilterMenu = () => {
    if (!filterMenu) return;
    filterMenu.classList.add('hidden');
    if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
  };

  if (filterToggle && filterMenu) {
    filterToggle.onclick = (e) => {
      e.stopPropagation();
      const willOpen = filterMenu.classList.contains('hidden');
      filterMenu.classList.toggle('hidden');
      filterToggle.setAttribute('aria-expanded', String(willOpen));
    };
    // Click anywhere outside closes the menu.
    document.addEventListener('click', (e) => {
      if (filterMenu.classList.contains('hidden')) return;
      if (filterMenu.contains(e.target) || filterToggle.contains(e.target)) return;
      closeFilterMenu();
    });
  }

  qa('.gi-filter-option').forEach(opt => {
    opt.onclick = (e) => {
      e.stopPropagation();
      currentGiGenre = opt.dataset.genre;
      refreshFilterActiveStates();
      closeFilterMenu();
      renderGiList(q('#gi-search').value);
    };
  });

  bindMidiHandlers();
  bindGlobalHandlers();
}

// MIDI listener (incoming notes/CC → mapped action) + the document-level
// click capture that runs while Learn mode is active.
function bindMidiHandlers() {
  engine.initMIDI(msg => {
    const [cmd, data1, data2] = msg.data;
    const isNoteOn = cmd >= 144 && cmd <= 159;
    const isCC = cmd >= 176 && cmd <= 191;

    if (!isNoteOn && !isCC) return;
    const mapKey = isCC ? `cc_${data1}` : `note_${data1}`;

    if (isMidiLearnMode && midiLearnTarget) {
      if (data2 > 0) {
        clearMappingForTarget(midiLearnTarget, false);
        addMapping(mapKey, midiLearnTarget);
        q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${midiLearnTarget.action.toUpperCase()} al control MIDI. Selecciona otro o sal.`;
        midiLearnTarget = null;
      }
      return;
    }

    const mapping = getMapping(mapKey, data1);
    if (mapping) {
      if (mapping.action === 'slider') {
        const sliderEl = q('#' + mapping.id);
        if (sliderEl) {
          const min = parseFloat(sliderEl.min) || 0;
          const max = parseFloat(sliderEl.max) || 100;
          sliderEl.value = min + ((data2 / 127) * (max - min));
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }

      if (data2 > 0) {
        if (mapping.action === 'pad') {
          onKeyClick(mapping.id);
        } else if (mapping.action === 'drum') {
          const kit = KIT_BANKS[kitBankIdx];
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
      }
      return;
    }

    // Hardcoded fallback map
    if (isNoteOn && data2 > 0) {
      if (data1 >= 60 && data1 <= 71) {
        const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
        onKeyClick(keys[data1 - 60]);
      } else {
        const kit = KIT_BANKS[kitBankIdx];
        if (!kit) return;
        const typeMap = { 36:'kick',38:'snare',40:'snare',39:'clap',42:'hihatC',44:'hihatC',46:'hihatO',50:'tomH',47:'tomM',43:'tomL',41:'tomL',49:'crash',55:'crash',51:'ride',54:'tamb',56:'cowbell',81:'shaker',82:'shaker' };
        const mappedType = typeMap[data1];
        if (mappedType) {
          const pad = kit.pads.find(p => p.type === mappedType || p.id.includes(mappedType));
          if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
        }
      }
    }
  });

  // Midi Learn Intercept
  document.addEventListener('click', (e) => {
    if (!isMidiLearnMode) return;
    
    if (e.target.closest('#midi-learn-overlay')) {
       isMidiLearnMode = false;
       q('#midi-learn-overlay').style.display = 'none';
       midiLearnTarget = null;
       e.stopPropagation(); e.preventDefault();
       return;
    }

    const keyBtn = e.target.closest('.key-btn');
    const drumBtn = e.target.closest('.drum-btn');
    const metroBtn = e.target.closest('#btn-metro-main');
    const playSeqBtn = e.target.closest('#tp-play-btn');
    const stopSeqBtn = e.target.closest('#tp-stop-btn');
    const loopBtn = e.target.closest('#tp-loop-btn');
    const prevBtn = e.target.closest('#btn-service-prev');
    const nextBtn = e.target.closest('#btn-service-next');
    const slider = e.target.closest('input[type="range"]');

    let target = null;
    if (keyBtn) target = { action: 'pad', id: keyBtn.dataset.key };
    else if (drumBtn) target = { action: 'drum', id: drumBtn.dataset.type };
    else if (metroBtn) target = { action: 'metro' };
    else if (playSeqBtn) target = { action: 'play_seq' };
    else if (stopSeqBtn) target = { action: 'stop_seq' };
    else if (loopBtn) target = { action: 'loop_seq' };
    else if (prevBtn) target = { action: 'prev_song' };
    else if (nextBtn) target = { action: 'next_song' };
    else if (slider && slider.id) target = { action: 'slider', id: slider.id };
    else return; // unmappable

    e.stopPropagation();
    e.preventDefault();
    midiLearnTarget = target;
    q('#midi-learn-overlay').innerHTML = `🎹 Esperando MIDI para: <b>${target.action.toUpperCase()} ${target.id || ''}</b>... Toca tu controlador.`;
  }, true);
}

// Document-level handlers that don't fit anywhere else: dialog cancel,
// keyboard shortcuts, and click-outside-to-close for the bank pickers.
function bindGlobalHandlers() {
  q('#dialog-cancel').onclick = hideDialog;
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', () => {
    q('#pad-bank-picker').classList.add('hidden');
    q('#kit-bank-picker').classList.add('hidden');
  });
}

function toggleMetro() {
  metroRunning = metro.toggle();
  const btn = q('#btn-metro-main');
  btn.innerHTML = metroRunning
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><polygon points="5,3 19,12 5,21"/></svg>';
  btn.classList.toggle('running', metroRunning);
  if (!metroRunning) {
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

function triggerMasterPlayPause() {
  // A session is "currently active" if the loaded track is playing, or — if
  // no track is loaded — the metronome is running.
  const isCurrentlyActive = isTrackLoaded() ? isTrackPlaying() : metroRunning;

  if (isCurrentlyActive) {
    triggerMasterStop();
  } else {
    // 1. Play the pad if not already active (if it crossfaded, it's already active!)
    if (preparedPadKey && !activeKey) onKeyClick(preparedPadKey);

    // 2. Play the track or the metronome
    if (isTrackLoaded()) {
      if (!isTrackPlaying()) clickPlayPause();
    } else if (!metroRunning) {
      toggleMetro();
    }
  }
}

function triggerMasterStop() {
  if (activeKey) onKeyClick(activeKey);
  if (metroRunning) toggleMetro();
  if (isTrackPlaying()) clickPlayPause();
}

function onKey(e) {
  // Don't capture keypresses meant for any text editor — INPUT, TEXTAREA,
  // SELECT, or contentEditable. Previously only INPUT was filtered, so
  // typing 'R' in the lyrics textarea would trigger the drum pad.
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  // Lyrics editor modal is open — full lockout of pad/drum/master shortcuts.
  if (document.getElementById('gi-lyrics-modal')) return;

  const k = e.code; // Use e.code (e.g. 'KeyA', 'Digit1', 'Space')
  
  if (isMidiLearnMode && midiLearnTarget) {
    e.preventDefault();
    clearMappingForTarget(midiLearnTarget, true);
    addMapping(`kbd_${k}`, midiLearnTarget);
    const kName = k.replace('Key', '').replace('Digit', '');
    q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${midiLearnTarget.action.toUpperCase()} a la tecla ${kName}. Selecciona otro o sal.`;
    midiLearnTarget = null;
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
      const kit = KIT_BANKS[kitBankIdx];
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

  if (e.code === 'Escape') { closeAllOverlays(); q('#sidebar').classList.remove('open'); engine.stopPad(); activeKey = null; preparedPadKey = null; buildKeyGrid(); }

  const padIdx = KEY_MAP_PADS.indexOf(kUpper);
  if (padIdx !== -1) { const keys = useFlats ? KEYS_FLAT : KEYS_SHARP; onKeyClick(keys[padIdx]); }

  const drumIdx = KEY_MAP_DRUMS.indexOf(kUpper);
  if (drumIdx !== -1) {
    const kit = KIT_BANKS[kitBankIdx];
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
const updateFilterCounts = () => updateFilterCountsModule(giSetlistSongs);

async function loadGiSetlistFromFile() {
  const songs = await loadGiSetlistFromFileModule();
  if (!songs) return;
  giSetlistSongs = songs;
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


// Targeted highlight update: toggles the `.active-song` class on at most
// two cards per list — orders of magnitude cheaper than a full re-render of
// 81 library cards when the user just switches songs in live.
function refreshActiveSongHighlights() {
  const giContainer = q('#gi-songs-container');
  if (giContainer) {
    giContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    if (activeGiSongId != null) {
      const match = getGiCardBySongId(activeGiSongId);
      if (match) match.classList.add('active-song');
    }
  }

  const svcContainer = q('#service-songs-container');
  if (svcContainer) {
    svcContainer.querySelectorAll('.gi-song-item.active-song').forEach(el => el.classList.remove('active-song'));
    const idx = getActiveServiceIndex();
    if (idx >= 0) {
      const songs = getServiceSongs();
      const target = songs[idx];
      if (target && target.serviceId != null) {
        const sel = `.gi-song-item[data-service-id="${CSS.escape(String(target.serviceId))}"]`;
        const match = svcContainer.querySelector(sel);
        if (match) match.classList.add('active-song');
      }
    }
  }
}

// Toggle a song's lyrics accordion open/closed WITHOUT a full re-render.
// Closes any other accordion (in either container) first to keep state
// consistent with the global "only one accordion open at a time" rule.
function toggleLyricsAccordion(song, isService) {
  const id = isService ? song.serviceId : song.id;
  const wasOpen = isService
    ? (openAccordionServiceId === id)
    : (openAccordionSongId === id);

  // Close any currently-open accordion across both lists.
  qa('.gi-lyrics-accordion.open').forEach(a => a.classList.remove('open'));
  qa('.action-btn.btn-lyrics.active').forEach(b => b.classList.remove('active'));

  if (wasOpen) {
    // It was open → user clicked again to close it. State cleared.
    openAccordionSongId = null;
    openAccordionServiceId = null;
    return;
  }

  // Set the new active accordion + close the other container's pointer.
  if (isService) { openAccordionServiceId = id; openAccordionSongId = null; }
  else           { openAccordionSongId = id; openAccordionServiceId = null; }

  // Apply the visual change only to the affected card.
  const containerSel = isService ? '#service-songs-container' : '#gi-songs-container';
  const attr = isService ? 'data-service-id' : 'data-song-id';
  const card = q(`${containerSel} .gi-song-item[${attr}="${CSS.escape(String(id))}"]`);
  if (card) {
    const accordion = card.querySelector('.gi-lyrics-accordion');
    const btn = card.querySelector('.btn-lyrics');
    if (accordion) accordion.classList.add('open');
    if (btn) btn.classList.add('active');
  }
}

// Apply the chord-visibility state to a single song card (whichever
// container it lives in). Only touches 2 DOM elements per card.
function paintChordVisibility(card, showChords) {
  if (!card) return;
  const textContent = card.querySelector('.lyrics-text-content');
  const toggleBtn = card.querySelector('.chord-toggle-btn');
  if (textContent) textContent.classList.toggle('hide-chords', !showChords);
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', showChords);
    toggleBtn.textContent = showChords ? 'Con acordes' : 'Solo letra';
    toggleBtn.title = showChords ? 'Ocultar acordes' : 'Mostrar acordes';
  }
}

// Flip a song's `showChords` flag and update the visible cards in place —
// no full re-render. When `syncToLibrary` is true, mirrors the change onto
// the matching library song so both lists stay aligned.
function toggleChordVisibility(song, isService, syncToLibrary = false) {
  song.showChords = !song.showChords;

  // Update the originating card (service or library, depending on context).
  const ownContainerSel = isService ? '#service-songs-container' : '#gi-songs-container';
  const ownAttr = isService ? 'data-service-id' : 'data-song-id';
  const ownId = isService ? song.serviceId : song.id;
  paintChordVisibility(
    q(`${ownContainerSel} .gi-song-item[${ownAttr}="${CSS.escape(String(ownId))}"]`),
    song.showChords
  );

  // If service-side, also mirror state + UI onto the matching library song.
  if (syncToLibrary && isService) {
    const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
    if (giSong) {
      giSong.showChords = song.showChords;
      paintChordVisibility(getGiCardBySongId(giSong.id), giSong.showChords);
    }
  }
}

function applyGiSong(song) {
  // Sync activeGiSongId
  activeGiSongId = song.id;

  // Sync active service-list pointer by matching title+artist.
  syncActiveByTitleArtist(song);

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
      useFlats = true;
      if (notSel) notSel.value = 'flats';
    } else {
      useFlats = false;
      if (notSel) notSel.value = 'sharps';
    }
    buildKeyGrid();
    
    // Stop metronome if it is running
    if (metroRunning) {
      toggleMetro();
    }
    
    // Smooth transition or prepare the new key
    const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
    if (keys.includes(key)) {
      if (activeKey) {
        // If a pad is playing, smoothly crossfade to the new key
        onKeyClick(key);
      } else {
        // If no pad is playing, just prepare the key for master trigger
        preparedPadKey = key;
        qa('.key-btn').forEach(b => {
          b.classList.remove('active', 'prepared');
          if (b.dataset.key === key) b.classList.add('prepared');
        });
      }
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
}

