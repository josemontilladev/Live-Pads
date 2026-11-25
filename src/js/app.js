import { SynthEngine } from './audio/SynthEngine.js';
import { Metronome }   from './audio/Metronome.js';
import { PAD_BANKS, KIT_BANKS, THEMES } from './data/banks.js';
import { savedThemeId } from './ui/themeVars.js';
import { FREE_PAD_BANK } from './billing/plans.js';
import { hasFeature, requireFeature, initLicense } from './billing/license.js';
import { q, qa, esc } from './utils/dom.js';
import { openLyricsEditorModal } from './ui/lyricsEditor.js';
import { TIME_SIG_BEATS as SONG_TIME_SIG_BEATS } from './ui/songEditForm.js';
import { openMetronomeModal } from './ui/metronomeModal.js';
import { openTunerModal } from './ui/tunerModal.js';
import { initDeepLink } from './cloud/deepLink.js';
import { hideDialog, confirmDialogAsync } from './ui/dialog.js';
import { openCheatSheet, closeCheatSheet, isCheatSheetOpen, ensureShortcutsRendered } from './ui/cheatSheet.js';
import { initAudioLibrarySetting } from './ui/audioLibrarySetting.js';
import { initBackupSetting } from './ui/backupSetting.js';
import { openPreflight, closePreflight } from './ui/preflight.js';
import { openMappingsList } from './ui/mappingsList.js';
import { openCompanionPanel, closeCompanionPanel, isCompanionPanelOpen, watchCompanionBadge } from './ui/companionPanel.js';
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
let stemsMountPromise = null;   // mount() es async: quien necesite el editor listo puede esperarlo
function ensureStemsMounted() {
  return ensureStemsWorkspace().then(ws => {
    if (!stemsMounted) { stemsMountPromise = Promise.resolve(ws.mount()).catch(() => {}); stemsMounted = true; }
    return ws;
  });
}
import { maybeStartTour, startTour } from './stems/tour.js';
import { initAuthGate } from './cloud/authUI.js';
import { initLibrarySelector } from './cloud/librarySelector.js';

// Pads workspace guided tour (mirrors the Stems one). Targets stable static
// elements in the Pads layout. Its own one-time localStorage flag.
const PADS_TOUR_KEY = 'livepads-pads-tour-seen-v3';
const PADS_TOUR_STEPS = [
  { target: '#btn-account-chip', title: 'Tu cuenta y tu repertorio', body: 'Aquí ves con qué cuenta y repertorio trabajas. Al tocarlo abres <b>Mi cuenta</b>: cambiar de librería, <b>invitar al equipo</b> (solo ver o editar) y sincronizar. La app <b>sincroniza sola</b> al abrir: canciones, servicios, carátulas y audios (los audios siguen bajando en segundo plano).' },
  { target: '#key-grid',        title: 'Pads de adoración',     body: 'Los 12 tonos. Pulsa uno para lanzar un colchón continuo; al cambiar de tono hace <b>crossfade</b> automático, sin silencios. También responden al teclado/MIDI.' },
  { target: '#pad-bank-select', title: 'Bancos de sonido',      body: 'Cambia el carácter del pad (cálido, etéreo, etc.). Cada banco tiene los 12 tonos precargados para que el cambio sea instantáneo.' },
  { target: '#bpm-display',     title: 'Metrónomo',             body: 'Tempo, <b>compás</b> (4/4, 3/4, 6/8…), sonido del click y multiplicador 1x/2x. Cada canción puede llevar su compás y al lanzarla el metrónomo lo adopta. Timing sample-accurate.' },
  { target: '#drum-grid',       title: 'Batería',               body: 'Pads de percusión mapeables a teclado/MIDI. Puedes crear kits propios y asignar tus propios samples.' },
  { target: '#mixer-bar',       title: 'Mezclador',             body: 'Volumen y paneo de <b>pads, batería, click, pista y maestro</b>, con mute del maestro y crossfade configurable. Los faders (Vol) y perillas (Pan) son mapeables a MIDI.' },
  { target: '#src-seq',         title: 'Reproductor y fuentes', body: 'Elige la fuente: <b>Secuencia</b>, <b>Click</b> u <b>Original</b>. El Play reproduce o pausa según lo seleccionado, y el botón de al lado controla <b>solo la secuencia</b> — todo mapeable a MIDI.' },
  { target: '#gi-search',       title: 'Setlist y librería',    body: 'Busca por título, artista, letra, <b>tono:G</b> o <b>tag:navidad</b>. Cada card muestra tono · BPM · compás; al pulsarla, el metrónomo toma su tempo, compás y tono. Arma el servicio arrastrando.' },
  { target: '.ws-tab[data-workspace="stems"]', title: 'Editor de Stems', body: 'La pestaña Stems abre el editor con <b>separación por IA</b> (voz/batería/bajo/otros), recorte y fades por clip, y click inteligente alineado a la canción.' },
  { target: '#btn-live-mode',  title: 'Modo en vivo',          body: 'Deja solo lo esencial para el servicio: el setlist, la canción en curso y la siguiente, con la letra y los acordes. Se activa y se sale con <b>Ctrl+L</b>.' },
  { target: '#btn-menu',        title: 'Menú y Ajustes',        body: 'Desde aquí: <b>Mapeo MIDI/Teclado (Learn)</b>, temas, atajos de teclado, companion y más. Casi todo se controla sin ratón — mapea cualquier control a tu controlador.' },
];
function maybeStartPadsTour() { maybeStartTour(PADS_TOUR_KEY, PADS_TOUR_STEPS); }
// Pantalla a la vista AHORA (la guía se pide con retraso: tras el login y la carga
// de Stems; para entonces el usuario pudo haber cambiado de pestaña).
function activeWorkspace() {
  const t = document.querySelector('.ws-tab.is-active');
  return t ? t.dataset.workspace : 'pads';
}

// El tour de bienvenida no debe solaparse con la pantalla de login: esperamos
// a que el usuario termine con el auth gate (inicie sesión o entre sin cuenta).
let authGateReady = Promise.resolve();
window.__padsShowTour = () => startTour(PADS_TOUR_STEPS, PADS_TOUR_KEY);
import { openSpotlight, isSpotlightOpen, closeSpotlight, registerSpotlightProvider } from './ui/spotlight.js';
import { initLiveMode, toggleLiveMode, isLiveMode } from './ui/liveMode.js';
import { registerPlayingProbe } from './state/performing.js';
import { applySavedOutput } from './audio/audioOutput.js';
import { initAudioOutputSetting } from './ui/audioOutputSetting.js';
import { initSoundSetting } from './ui/soundSetting.js';
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
  serviceNextSong, servicePrevSong, syncServiceWithLibrary, getEffectiveKey, clearKeyOverride, getKeyOverride, setKeyOverride
} from './data/service.js';
import { parseKey, keyDelta } from './utils/musicKeys.js';
import { isKeyLinked, linkedKeyChange, linkedPitchStep, recordingSemitone, shiftKey, reconcileLinkedPitch, resetStrayPitches } from './utils/keyLink.js';
import {
  initTrackPlayer, loadAndPlayTrack, clearTrackUI,
  bindTrackPlayerControls, isTrackLoaded, isTrackPlaying, clickPlayPause, getCurrentSong, getCurrentType,
  setPlayBtnIcon, reapplyKeyShift, getTrackPitch
} from './audio/trackPlayer.js';
import {
  setMidiMap, getMapping, addMapping, clearMappingForTarget, findKeyboardMappingFor, setMidiScope
} from './midi/midiMap.js';
import { bindMidiHandlers } from './midi/midiBindings.js';
import { hydrateCustomKitsInto } from './data/customKits.js';
import { loadGiSetlistFromFile as loadGiSetlistFromFileModule } from './data/giSetlistLoader.js';
import { htmlToPlainLyrics } from './utils/text.js';
import { initSeqWaveform } from './ui/seqWaveform.js';
import { initPracticeMode } from './ui/practiceMode.js';
import { initLiveLyrics } from './ui/liveLyrics.js';
import { applyChordNumbers } from './utils/chordNumbers.js';
import { initChordDiagrams } from './ui/chordDiagram.js';
import { initMidiOut } from './midi/midiOut.js';
import { initDirectorCues } from './live/directorCues.js';
import { initStagePublish } from './live/stagePublish.js';
import { initModulation } from './live/modulation.js';
import { initMedley } from './live/medley.js';
import { initKeyTransition } from './live/keyTransition.js';
import { initTempoFollow } from './live/tempoFollow.js';
import { initGrooves, groovePlaying, stopGrooves } from './live/grooveUI.js';
import { initSongMix } from './live/songMix.js';
import { initClickSections } from './live/clickSections.js';
import { initVoiceGuide, speakCount, leadInWanted } from './live/voiceGuide.js';
import { initArrange } from './live/arrange.js';
import { fadeMainBuses, restoreMainBuses } from './audio/mainBus.js';
import { initBandFollow } from './live/bandFollow.js';
import { initPadFollow } from './live/padFollow.js';
import { initMinistry } from './live/ministry.js';
import { KEYS_FLAT as TR_FLAT, KEYS_SHARP as TR_SHARP } from './data/musicConstants.js';
import { transposeAll } from './ui/chordTransposer.js';
import { prefersFlats } from './utils/musicKeys.js';
import { initUpdateIndicator, _testState as updTestState } from './ui/updateIndicator.js';
import { initLyricsOverlay } from './ui/lyricsOverlay.js';
// mongoSync (legacy GI.Setlist/MongoDB) retirado — la sincronización vive en
// la nube Supabase vía Mi cuenta → librería activa.
import { bindSetlistTabs } from './ui/setlistTabs.js';
import { bindGiToolbar } from './ui/giToolbar.js';
import { updateFilterCounts as updateFilterCountsModule } from './ui/genreFilter.js';
import { openSidebarTab, closeAllOverlays } from './ui/overlays.js';
import { initDrumGrid, buildDrumGrid, hitDrum, resolveDrumPad } from './ui/drumGrid.js';
import { initMetroBeatDots, buildMetroBeatDots, onMetroBeat } from './ui/metroBeatDots.js';
import { initMetroOptions } from './ui/metroOptions.js';
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

// Índice de semitono (0-11) de la nota raíz de la canción cargada, sin contar
// el pitch shift del reproductor. Se fija al aplicar la canción (applyGiSong) y
// se usa para calcular qué botón del pad de notas resaltar cuando el usuario
// sube/baja el tono con los botones del reproductor.
let _songBaseKeySemitone = null; // null = no hay canción con tono conocido

let engine, metro;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  // Deep-link de invitación: registrar el receptor IPC cuanto antes para no
  // perder el token si la app se abrió en frío desde un enlace livepads://.
  try { initDeepLink(); } catch (_) {}

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
  // Actualización obligatoria: si la web exige una versión más nueva, bloquea hasta actualizar.
  import('./ui/forceUpdate.js').then(m => m.startForceUpdateWatch()).catch(() => {});
  const licenseReady = initLicense().catch(() => {});
  // Aviso de una sola vez: «ahora hay planes» (texto según el plan de cada uno).
  authGateReady.then(() => licenseReady).then(() => setTimeout(() => {
    import('./billing/announce.js').then(m => m.maybeAnnouncePlans()).catch(() => {});
    // «Qué hay de nuevo» tras una actualización (no coincide con el de planes:
    // si ese está abierto, espera a la próxima vez).
    import('./ui/whatsNew.js').then(m => m.maybeShowWhatsNew({
      onTryLibrary: () => {
        window.__lpOpenLibrary = true;   // por si Stems aún no está montado
        applyWorkspace('stems');
        window.dispatchEvent(new Event('livepads:open-library'));
      },
    })).catch(() => {});
    // Avisos de la comunidad de la Biblioteca (envíos aprobados/rechazados; al
    // administrador, lo pendiente de revisar). "Revisar"/"Ver" abre la ventana.
    const openStemsWindow = (opts) => {
      applyWorkspace('stems');
      import('./stems/packUploader.js').then(m => m.openPackUploader({
        ...opts, onChanged: () => window.dispatchEvent(new Event('livepads:stem-library-changed')),
      })).catch(() => {});
    };
    import('./cloud/communityNotify.js').then(m => m.startCommunityNews({
      openReview: () => openStemsWindow({ tab: 'review' }),
      openMine: () => openStemsWindow({ community: true, tab: 'packs' }),
    })).catch(() => {});
  }, 2500));
  // Si el plan cambia (prueba terminada, pago, cancelación) la app se ajusta en caliente.
  window.addEventListener('livepads:plan-changed', () => {
    try {
      buildBankSelects();
      const cur = PAD_BANKS[getPadBankIdx()];
      if (cur && cur.id !== FREE_PAD_BANK && !hasFeature('padBanks')) loadPadBank(getPadBankIdx(), { silent: true });
      // Si el plan llegó tarde y ahora sí incluye todo: vuelve a lo que la persona tenía elegido.
      if (hasFeature('padBanks')) {
        const saved = parseInt(localStorage.getItem('lastPadBankIdx'));
        if (!isNaN(saved) && saved !== getPadBankIdx()) loadPadBank(saved, { silent: true });
      }
      if (hasFeature('cloud')) import('./cloud/libraryLive.js').then(m => m.startLibraryLiveSync()).catch(() => {});
      q('#btn-chords-pads')?.classList.toggle('lp-locked', !hasFeature('chords'));
      syncCompanionCloudPlan();
      // Stems ya no se bloquea entero: con Gratis se entra para usar los loops
      // gratis de la Biblioteca; lo Pro se pide dentro (stems/workspace.js).
    } catch (_) {}
  });

  // Feedback de arranque: el preloader muestra QUÉ se está cargando (antes la
  // barra corría a ciegas y en boots lentos no se sabía si estaba colgado).
  const bootStatus = (t) => { const el = q('#preloader-status'); if (el) el.textContent = t; };

  engine = new SynthEngine();
  bootStatus('Iniciando audio…');

  // Boot phase 1: kick off everything that can run in parallel.
  //   - Engine init (must complete before we touch audio nodes)
  //   - Default click sound decode (depends on engine.ctx)
  //   - User drums + MIDI map from disk (Node-side IPC, independent)
  await engine.init();
  // Contexto COMPARTIDO de la app: el motor de Stems (y con el el piano) lo
  // adopta en vez de abrir el suyo, para que el piano y la cancion suenen a la
  // vez y no en dos contextos de audio separados.
  try { window.__livepadsSharedCtx = engine.ctx; } catch (_) {}
  // Si la SALIDA del equipo es mono, el paneo no existe: el click que mandas a
  // la izquierda se suma con la musica de la derecha y sale por los dos lados.
  // Es exactamente el fallo que aparece en una laptop y no en otra, asi que se
  // avisa en vez de dejar que se descubra en medio del servicio.
  if (engine.outputInfo && engine.outputInfo.stereo === false) {
    setTimeout(() => showToast(
      'Salida de audio MONO: el paneo no se oira. Conecta auriculares o una interfaz, ' +
      'y revisa "Audio mono" en la configuracion de accesibilidad del sistema.',
      'error'), 2500);
  }
  const clickWarmup = engine.loadClickBuffers(); // default = 'cowbell'
  const userDrumsP = window.electronAPI?.loadUserDrums
    ? window.electronAPI.loadUserDrums()
    : Promise.resolve(null);
  const midiMapP = window.electronAPI?.loadMidiMap
    ? window.electronAPI.loadMidiMap()
    : Promise.resolve(null);

  // Pad Amb files are lazy-loaded on first keypress (~48MB each, see _ensurePadAmb).
  metro = new Metronome(engine);
  // «¿Se está tocando?» para pausar las tareas de fondo (sync, actualizaciones).
  registerPlayingProbe(() => metro.running);
  registerPlayingProbe(() => isTrackPlaying());
  registerPlayingProbe(() => (engine.activePadNodes || []).length > 0);
  initMetroBeatDots(metro);
  metro.onBeat = onMetroBeat;
  metro.sound = 'cowbell';

  bootStatus('Cargando sonidos y configuración…');
  const [, rawDrums, rawMidi] = await Promise.all([clickWarmup, userDrumsP, midiMapP]);

  // Prepend custom drum kits (loaded from disk or one empty default) into KIT_BANKS.
  hydrateCustomKitsInto(KIT_BANKS, rawDrums);

  // MIDI map was loaded in parallel above; just commit it now.
  setMidiMap(rawMidi);

  applyTheme(getCurrentTheme());
  bootStatus('Cargando librería…');
  initService({ render: renderServiceList, applyGiSong });
  // Persistencia de la librería con debounce: cada edición disparaba un
  // JSON.stringify de TODAS las canciones + IPC (editando rápido, 10+/seg).
  // 800ms agrupa las ráfagas; beforeunload hace flush para no perder nada.
  window.addEventListener('beforeunload', () => {
    if (giSaveTimer) {
      clearTimeout(giSaveTimer); giSaveTimer = null;
      // Síncrono: el invoke asíncrono puede perderse si la ventana se destruye a mitad.
      if (window.electronAPI) (window.electronAPI.saveGiSetlistSync || window.electronAPI.saveGiSetlist)(getSongs());
    }
  });
  // Note: GI library state (songs, genre, active id, accordion ids) lives
  // in src/js/state/store.js. The modules below read/write it directly —
  // we only inject side-effectful callbacks they can't supply themselves.
  initGiList({
    persist: persistGiSongs,
    onApplySong: applyGiSong,
    loadAndPlayTrack,
    onPlaySongSource: playSongSource,
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
    onPlaySongSource: playSongSource,
    removeFromService,
    reorderService,
    openLyricsEditorModal,
    toggleLyricsAccordion,
    toggleChordVisibility,
    // Cambió el tono con el que se toca esta canción HOY. Si es la que está
    // activa, hay que re-preparar el pad: de nada sirve que la card diga G si
    // el pad sigue sonando en Mi. Persistir/publicar lo hace data/service.
    onKeyChanged: (song) => {
      const i = getActiveServiceIndex();
      if (i >= 0 && getServiceSongs()[i] === song) applyGiSong(song);
      reapplyKeyShift(song);   // la secuencia/original cargada pasa al tono nuevo
      // Letra en vivo, panel de letra y otra pantalla: en el tono del día.
      window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
    },
    persistLibrary: persistGiSongs,
    syncLyricsToLibrary: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      giSong.lyrics = song.lyrics;
      persistGiSongs();
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
    syncFavoriteToLibrary: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (!giSong) return;
      giSong.favorite = !!song.favorite;
      persistGiSongs();
      updateFilterCounts();
      const giCard = getGiCardBySongId(giSong.id);
      if (giCard) repaintGiCard(giCard, giSong);
    },
    syncMetaToLibrary: (oldKey, song) => {
      // Por identidad (cloudId / id) primero; título+artista solo para copias viejas.
      const giSong = getSongs().find(s => (song.cloudId && s.cloudId === song.cloudId) || (song.id != null && String(s.id) === String(song.id)))
        || getSongs().find(s => (s.title + '\x00' + s.artist) === oldKey);
      if (!giSong) return;
      giSong.title = song.title;
      giSong.artist = song.artist;
      giSong.bpm = song.bpm;
      giSong.key = song.key;
      giSong.genre = song.genre;
      persistGiSongs();
      // Editar desde el Servicio también se sube a la nube: antes solo se guardaba
      // en este equipo y los compañeros nunca veían, p. ej., el tono nuevo.
      try { window.dispatchEvent(new Event('livepads:cloud-dirty')); } catch (_) {}
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
      persistGiSongs();
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

  initSeqWaveform(); // onda + secciones sobre el reproductor
  initPracticeMode(); // modo práctica: velocidad sin cambiar el tono + tramo A–B
  initLiveLyrics();   // letra con acordes en vivo (karaoke) en su propia columna
  applyChordNumbers(); // acordes como grados (1·4·5) si la persona lo eligió
  initChordDiagrams(); // tocar un acorde de la letra = cómo se toca en guitarra y piano
  initMidiOut();       // sonidos del teclado automáticos (salida MIDI) por canción y sección
  q('#tp-softend-btn')?.addEventListener('click', softEnd); paintSoftEnd(false);
  initSongMix();      // cada canción recuerda su mezcla (Pads, Batería, Click, Pista)
  initClickSections({ getMetro: () => metro });   // click distinto por sección
  initVoiceGuide({ getEngine: () => engine });     // cuenta hablada + guía hablada automática
  initArrange();      // arreglo en vivo: repetir / saltar de sección sin cortar el compás
  // Botón «Voces» de la cabecera: calentamiento vocal en el tono de la 1.ª del servicio (o de la preparada).
  q('#btn-vocal')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const first = getServiceSongs()[0] || (getCurrentSong ? getCurrentSong() : null);
    let leader = ''; try { leader = localStorage.getItem('livepads.leader') || ''; } catch (_) {}
    import('./ui/cardMoreMenu.js').then(({ openCardMoreMenu }) => openCardMoreMenu(btn, [
      { label: 'Calentamiento vocal…', hint: 'Ejercicios con piano en el tono de la primera canción', onSelect: () => import('./live/warmup.js').then((m) => m.openWarmup(first ? (getEffectiveKey(first) || first.key || '') : '')) },
      { label: 'Prueba de rango vocal…', hint: 'Tu nota más grave y más aguda: tonos sugeridos para tu voz', onSelect: () => import('./live/vocalRange.js').then((m) => m.openVocalRange(leader)) },
    ]));
  });
  initDirectorCues({ getEngine: () => engine, panic: () => panicStopAll() });   // indicaciones a la banda + control desde el móvil
  initStagePublish();  // monitor de escenario (Companion con ?escenario)
  initModulation();    // subir el tono en el último coro (punto marcado por canción)
  initMedley({ playCurrent: () => triggerSourcePlayPause() });   // medleys: unir con la siguiente sin silencio
  // Transición entre tonos: el pad recorre el puente hasta el tono de la siguiente canción.
  // Pad que sigue los acordes de la pista: cambio con fundido corto (0,6 s) en vez del de 2 s.
  initPadFollow({
    padActive: () => !!getActiveKey(),
    playPadChord: (pc, minor) => playPadChordClean(pc, minor, 0.6),
    // Los acordes de la canción, ya en memoria antes de que suenen.
    prefetchChord: (pc, minor) => {
      const bank = PAD_BANKS[getPadBankIdx()];
      engine.prefetchPad((getUseFlats() ? TR_FLAT : TR_SHARP)[pc], !!(minor && bank && bank.minor));
    },
  });
  // Modo ministración: progresión sin fin con el pad (fundido normal, más suave).
  // Click que sigue al baterista (micrófono → tempo y pulso).
  initTempoFollow({ getEngine: () => engine, getMetro: () => metro, applyBpm });
  // Caja de ritmos: herramienta aparte (botón en la cabecera).
  initGrooves({ getEngine: () => engine, getMetro: () => metro, applyBpm, getPadKey: () => getActiveKey() });
  initBandFollow();
  initMinistry({
    playPadChord: (pc, minor) => playPadChordClean(pc, minor, null),
    prefetchChord: (pc, minor) => {
      const bank = PAD_BANKS[getPadBankIdx()];
      engine.prefetchPad((getUseFlats() ? TR_FLAT : TR_SHARP)[pc], !!(minor && bank && bank.minor));
    },
    bpm: () => parseInt(q('#bpm-display')?.textContent || '0', 10) || 0,
    currentKey: () => { const s = getServiceSongs()[getActiveServiceIndex()] || (getCurrentSong ? getCurrentSong() : null); return s ? (getEffectiveKey(s) || s.key || '') : (getActiveKey() || ''); },
  });
  initKeyTransition({
    playPadKey: (pc, minor) => {
      const names = (getUseFlats() ? TR_FLAT : TR_SHARP);
      const bank = PAD_BANKS[getPadBankIdx()];
      if (bank && bank.minor && padMinorWanted() !== !!minor) setPadMinor(!!minor);
      if (getActiveKey() !== names[pc]) onKeyClick(names[pc]);
    },
    bpm: () => parseInt(q('#bpm-display')?.textContent || '0', 10) || 0,
    keys: () => {
      const cur = getCurrentSong ? getCurrentSong() : null;
      const songs = getServiceSongs(), idx = getActiveServiceIndex();
      const now = songs[idx] || cur;
      const next = idx >= 0 ? songs[idx + 1] : null;
      return { from: now ? (getEffectiveKey(now) || now.key || '') : '', to: next ? (getEffectiveKey(next) || next.key || '') : '' };
    },
  });
  // El click sigue la velocidad elegida en el modo práctica.
  window.addEventListener('livepads:practice-rate', (ev) => {
    const r = Number(ev && ev.detail && ev.detail.rate) || 1;
    if (metro) metro.tempoScale = r;
  });
  // Hook the track player to app.js helpers so it stays decoupled.
  initTrackPlayer({
    // Un solo AudioContext para Pads+Pista (menos hilos de audio y latencia
    // uniforme). La Pista mantiene su cadena propia directa a destination.
    getSharedCtx: () => engine?.ctx || null,
    syncSlider,
    // Persiste cualquier cambio en la canción (ej. pitch del track player).
    persistSong: (song) => {
      const same = (s) => (song.cloudId && s.cloudId === song.cloudId) || (song.id != null && String(s.id) === String(song.id));
      const giSong = getSongs().find(same) || getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong && giSong !== song) {
        if (!giSong.audio) giSong.audio = {};
        Object.assign(giSong.audio, song.audio || {});
      }
      // Las copias de esa canción en el servicio, con el mismo ajuste (y a disco).
      let svcChanged = false;
      for (const c of getServiceSongs()) {
        if (c === song || !(same(c) || (giSong && ((giSong.cloudId && c.cloudId === giSong.cloudId) || String(c.id) === String(giSong.id))))) continue;
        if (!c.audio) c.audio = {};
        c.audio.pitch = (song.audio || {}).pitch;
        c.audio.pitchAuto = (song.audio || {}).pitchAuto;
        c.audio.keyPitch = (song.audio || {}).keyPitch;
        c.audio.keyPitchSet = !!(song.audio || {}).keyPitchSet;
        svcChanged = true;
      }
      if (svcChanged || getServiceSongs().includes(song)) saveServiceSongs();
      persistGiSongs();
    },
    onAudioPathAssigned: (song, type, newPath) => {
      // Sync the new file path back into the library + persist + refresh views.
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong) {
        if (!giSong.audio) giSong.audio = {};
        giSong.audio[type] = newPath;
      }
      persistGiSongs();
      saveServiceSongs();
      const searchInput = q('#gi-search');
      if (searchInput) renderGiList(searchInput.value);
      renderServiceList();
      // Sube la canción (con su secuencia/original) y el archivo: la otra PC lo
      // recibe al momento por tiempo real.
      try { window.dispatchEvent(new CustomEvent('livepads:cloud-dirty')); } catch (_) {}
    },
    // Cache audio duration onto the library song the first time it plays,
    // so the service-list total-time estimate (4-min heuristic by default)
    // upgrades to real values as the user works through their setlist.
    onDurationDiscovered: (song) => {
      const giSong = getSongs().find(s => s.title === song.title && s.artist === song.artist);
      if (giSong && (!giSong.durationSec || giSong.durationSec !== song.durationSec)) {
        giSong.durationSec = song.durationSec;
        persistGiSongs();
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
        showToast('Siguiente preparada: pulsa Espacio para lanzar', 'info');
      }
    },
    // El botón Play del reproductor reproduce/pausa SEGÚN LA FUENTE seleccionada
    // (Secuencia/Click/Original), de forma desacoplada (ver triggerSourcePlayPause).
    onPlayPauseButton: () => triggerSourcePlayPause(),
    // Refleja el botón "solo secuencia" (encendido/apagado) en cada cambio de
    // estado de la pista (play/pause/fin).
    onPlayState: () => reflectSeqOnlyBtn(),
    // Al cambiar el tono (+1/-1 semitono), actualiza el pad de notas para que
    // el botón resaltado refleje la tonalidad real de la canción en ese momento.
    onPitchChange: (pitchSemitones, _song) => applyNotepadPitchShift(pitchSemitones),
    // ▼ ▲ a mano con «Tono ligado»: la tarjeta y los acordes de la letra siguen al audio.
    onManualPitchStep: (song, delta) => linkedPitchFollow(song, delta),
    // Se volvió a ligar el tono: lo que suena es ahora el tono de la tarjeta; el
    // pad recalcula su base (grabación = tarjeta − keyPitch).
    onKeyLinkAdopted: (song) => {
      const live = libraryLive(song);
      if (live && live !== song) { if (!live.audio) live.audio = {}; live.audio.keyPitch = song.audio.keyPitch; live.audio.pitch = song.audio.pitch; live.audio.keyPitchSet = !!song.audio.keyPitchSet; persistGiSongs(); syncServiceWithLibrary(); }
      const rs = recordingSemitone(live || song);
      if (rs != null && isActiveLibrarySong(live || song)) { _songBaseKeySemitone = rs; applyNotepadPitchShift(getTrackPitch()); }
    },
    // Semitonos de la grabación (tono de la librería) al tono de este servicio.
    getKeyShift: (song) => {
      if (!song || !song.key) return 0;
      const eff = getEffectiveKey(song);
      if (!eff || eff === song.key) return 0;
      return keyDelta(song.key, eff) || 0;
    },
  });

  await licenseReady;
  buildBankSelects();
  
  // Restore last selected Pad Bank or default to Chris Rocha (index 2)
  const savedPadIdx = localStorage.getItem('lastPadBankIdx');
  if (savedPadIdx !== null) {
    loadPadBank(parseInt(savedPadIdx), { silent: true });
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
  initBackupSetting({
    getSongCount: () => getSongs().length,
    flushSongs: async () => { if (window.electronAPI) await window.electronAPI.saveGiSetlist(getSongs()); },
  });
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

  // Collapsing the header makes the scroller taller, which shrinks its max
  // scrollTop. If the list overflows by less than the reclaimed height, the
  // browser clamps the scroll back under the threshold, the header re-expands
  // and the loop repeats — the last cards become unreachable. Only collapse
  // when the list overflows well beyond what the header gives back.
  const header = q('.setlist-header');
  const headerReclaim = header
    ? header.offsetHeight + parseFloat(getComputedStyle(header).marginBottom || '0')
    : 0;
  const wireScrollChrome = (scroller) => {
    if (!scroller || !panelSetlist) return;
    const update = () => {
      const collapsed = panelSetlist.classList.contains('songs-scrolled');
      const overflowExpanded = scroller.scrollHeight - scroller.clientHeight + (collapsed ? headerReclaim : 0);
      const scrolled = scroller.scrollTop > 8 && overflowExpanded > headerReclaim * 2;
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

  // Sincronización de arranque: con el preloader aún visible, baja lo nuevo del
  // repertorio (canciones, servicios, carátulas) y dice qué está haciendo. Tiene
  // tope de tiempo: sin red ni sesión no retrasa nada (el login no se espera: la
  // sesión se restaura al principio del arranque).
  try {
    // Arranque local primero: la app ya está lista con lo que hay en este equipo.
    // A la nube se le dan como mucho 2,5 s con el preloader; si tarda más (WiFi de
    // iglesia, internet caído con el WiFi conectado), la app abre igual y la
    // sincronización termina en segundo plano (la lista se actualiza sola).
    const { bootSyncOnce } = await import('./cloud/libraryLive.js');
    const sync = bootSyncOnce({ onStatus: bootStatus, maxMs: 12000 }).catch(() => {});
    await Promise.race([sync, new Promise((r) => setTimeout(r, 2500))]);
    bootStatus('Todo al día');
  } catch (_) {}

  // Hide preloader smoothly (sin espera fija: antes se añadían 800 ms porque sí).
  requestAnimationFrame(() => {
    const preloader = q('#preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
      setTimeout(() => preloader.remove(), 800); // clean from DOM
    }
  });
});

/* ── BANK SELECTS ── */
function buildBankSelects() {
  const padSel = q('#pad-bank-select');
  const kitSel = q('#kit-bank-select');
  if (padSel) {
    const lockPads = !hasFeature('padBanks');
    padSel.innerHTML = PAD_BANKS.map((b, i) => `<option value="${i}">${esc(b.name)}${lockPads && b.id !== FREE_PAD_BANK ? ' · PRO' : ''}</option>`).join('');
    padSel.value = getPadBankIdx();
    padSel.onchange = (e) => loadPadBank(parseInt(e.target.value));
  }
  if (kitSel) {
    kitSel.innerHTML = KIT_BANKS.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    kitSel.value = getKitBankIdx();
    kitSel.onchange = (e) => loadKitBank(parseInt(e.target.value));
  }
}

/* ── PADS MAYORES / MENORES ── */
// Solo los bancos con pads menores (p. ej. Chris Rocha) muestran el selector.
// La elección se recuerda; con «Menor», la tecla A suena Am, C suena Cm, etc.
const PAD_MINOR_KEY = 'livepads-pad-minor';
function padMinorWanted() { try { return localStorage.getItem(PAD_MINOR_KEY) === '1'; } catch { return false; } }
function syncPadMode() {
  const bank = PAD_BANKS[getPadBankIdx()];
  const has = !!(bank && bank.minor);
  const minor = has && padMinorWanted();
  engine.setPadMinor(minor);
  const seg = q('#pad-mode');
  if (seg) {
    seg.hidden = !has;
    seg.querySelectorAll('.pad-mode-btn').forEach((b) => {
      const on = (b.dataset.mode === 'minor') === minor;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.body.classList.toggle('pads-minor', minor);
}
// Acorde del pad para «Sigue acordes» y «Ministración»: primero se asegura el pad REAL de ese
// acorde en memoria (el anterior sigue sonando mientras tanto, como mucho 2,5 s) y luego entra
// con un solo fundido. Sin esto, un acorde aún no cargado sonaba un instante con el pad
// sintetizado de relleno (el «corte» al pasar de mayor a menor). fade = s de fundido (null = el normal).
let _padChordSeq = 0;
async function playPadChordClean(pc, minor, fade) {
  const names = (getUseFlats() ? TR_FLAT : TR_SHARP);
  const bank = PAD_BANKS[getPadBankIdx()];
  const wantMinor = !!(minor && bank && bank.minor);
  const my = ++_padChordSeq;
  await Promise.race([engine.prefetchPad(names[pc], wantMinor), new Promise((r) => setTimeout(r, 2500))]);
  if (my !== _padChordSeq) return;            // ya se pidió otro acorde
  const prev = engine._crossfadeDur;
  if (fade != null) engine.setCrossfade(fade);
  try {
    const modeChanged = bank && bank.minor && padMinorWanted() !== wantMinor;
    if (modeChanged) setPadModeQuiet(wantMinor);
    if (getActiveKey() !== names[pc]) onKeyClick(names[pc]);
    else if (modeChanged) engine.playPad(names[pc], bank.synth);   // misma nota, otro modo
  } finally { if (fade != null) setTimeout(() => engine.setCrossfade(prev), 80); }
}
// Cambio de modo sin volver a lanzar el acorde que suena (Sigue acordes / Ministración):
// el acorde nuevo entra con un solo fundido, sin pasar por el anterior en el otro modo.
function setPadModeQuiet(on) {
  try { localStorage.setItem(PAD_MINOR_KEY, on ? '1' : '0'); } catch {}
  engine.setPadMinor(!!on, { preload: false });
  syncPadMode();
}
function setPadMinor(on) {
  try { localStorage.setItem(PAD_MINOR_KEY, on ? '1' : '0'); } catch {}
  syncPadMode();
  // Si hay un pad sonando, pasa a la otra tonalidad con el crossfade de siempre.
  if (getActiveKey()) engine.playPad(getActiveKey(), PAD_BANKS[getPadBankIdx()].synth);
}
// Modo (mayor/menor) que pide la canción preparada. Se aplica al lanzar su pad
// (no antes: si suena el pad de la canción anterior, no se le cambia el modo).
// null = la canción no tiene tono reconocible; se deja el modo que haya.
let _preparedPadMinor = null;
function preparePadModeFor(song) {
  const p = parseKey(song && song.key);
  _preparedPadMinor = p ? p.minor : null;
  if (_preparedPadMinor === null) return;
  // Sin pad sonando, se alinea ya: el selector Mayor/Menor muestra lo que sonará.
  if (!getActiveKey()) applyPreparedPadMode({ replay: false, consume: false });
}
// Pone el modo de la canción preparada. Solo en bancos con pads menores. Al
// lanzar la canción se «consume»: si luego alguien cambia Mayor/Menor a mano,
// no se le deshace al cambiar de fuente.
function applyPreparedPadMode({ replay, consume = true }) {
  if (_preparedPadMinor === null) return;
  const want = _preparedPadMinor;
  if (consume) _preparedPadMinor = null;
  const bank = PAD_BANKS[getPadBankIdx()];
  if (!(bank && bank.minor)) return;
  if (padMinorWanted() === want) return;
  if (replay) setPadMinor(want);
  else {
    try { localStorage.setItem(PAD_MINOR_KEY, want ? '1' : '0'); } catch {}
    syncPadMode();
  }
}
q('#pad-mode')?.addEventListener('click', (e) => {
  const b = e.target.closest('.pad-mode-btn');
  if (b) setPadMinor(b.dataset.mode === 'minor');
});

/* ── PAD BANK ── */
function loadPadBank(idx, { silent = false } = {}) {
  let forcedByPlan = false;
  // Plan Gratis: solo el banco de Chris Rocha.
  const want = PAD_BANKS[((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length];
  if (want && want.id !== FREE_PAD_BANK && !hasFeature('padBanks')) {
    const free = PAD_BANKS.findIndex(b => b.id === FREE_PAD_BANK);
    if (!silent) {
      requireFeature('padBanks');
      const sel = q('#pad-bank-select');
      if (sel) sel.value = getPadBankIdx();
      return;
    }
    if (free < 0) return;
    idx = free;
    forcedByPlan = true;
  }
  setPadBankIdx(((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length);
  const bank = PAD_BANKS[getPadBankIdx()];
  const padSel = q('#pad-bank-select');
  if (padSel) padSel.value = getPadBankIdx();
  engine.setPadBank(bank);
  syncPadMode();
  if (getActiveKey()) engine.playPad(getActiveKey());
  
  // Save last selected Pad Bank persistently (no si fue un cambio forzado por el plan)
  if (!forcedByPlan) localStorage.setItem('lastPadBankIdx', getPadBankIdx());
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
  updateKeyIndicator();
}

// Transpone el pad de notas activo/preparado `pitchSemitones` semitonos
// respecto de la nota base de la canción cargada (_songBaseKeySemitone).
// Se llama cada vez que el usuario ajusta el tono del reproductor.
function applyNotepadPitchShift(pitchSemitones) {
  if (_songBaseKeySemitone === null) return; // sin canción con tono conocido

  // Calcular el índice de nota destino (0–11) aplicando el desplazamiento.
  const targetSemitone = ((_songBaseKeySemitone + pitchSemitones) % 12 + 12) % 12;

  // Obtener la lista de notas según la notación actual (sostenidos/bemoles).
  const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP;
  // Ambas listas tienen exactamente 12 notas en orden cromático, por lo que el
  // índice coincide directamente con el semitono.
  const targetKey = keys[targetSemitone];
  if (!targetKey) return;

  const activeKey   = getActiveKey();
  const preparedKey = getPreparedPadKey();

  if (activeKey) {
    // Hay un pad sonando: transicionar suavemente a la nueva nota.
    if (activeKey !== targetKey) onKeyClick(targetKey);
  } else if (preparedKey) {
    // Hay un pad preparado (sin sonar): mover la preparación.
    if (preparedKey !== targetKey) {
      setPreparedPadKey(targetKey);
      qa('.key-btn').forEach(b => {
        b.classList.remove('prepared');
        if (b.dataset.key === targetKey) b.classList.add('prepared');
      });
    }
  }
  updateKeyIndicator();
}

// Indicador de tono sonante del pad (arriba del grid). Muestra la nota
// preparada/activa en grande; si difiere del tono ESCRITO de la canción (porque
// está transpuesta), muestra "escrito → sonante" (p. ej. C → B).
// Etiqueta "SIG." en la tecla del tono de la siguiente canción del servicio.
function paintNextSongKeyHint() {
  qa('.key-btn.next-key').forEach(b => b.classList.remove('next-key'));
  const idx = getActiveServiceIndex();
  if (idx < 0) return;
  const next = getServiceSongs()[idx + 1];
  if (!next) return;
  const parsed = parseKey(getEffectiveKey(next));
  if (!parsed) return;
  const key = (getUseFlats() ? KEYS_FLAT : KEYS_SHARP)[parsed.semitone];
  q(`.key-btn[data-key="${key}"]`)?.classList.add('next-key');
}

function cardKeySemitone() {
  const id = getActiveSongIdFromStore();
  if (id == null) return null;
  const song = getSongs().find((x) => String(x.id) === String(id));
  const pk = song ? parseKey(getEffectiveKey(song)) : null;
  return pk ? pk.semitone : null;
}
function updateKeyIndicator() {
  paintNextSongKeyHint();
  const el = q('#key-indicator');
  if (!el) return;
  const sounding = getActiveKey() || getPreparedPadKey();
  if (!sounding) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const active = !!getActiveKey();
  const keys = getUseFlats() ? KEYS_FLAT : KEYS_SHARP;
  // Se compara con el tono de la TARJETA (o el fijado para el servicio), no con
  // el de la grabación: una canción grabada en D y pasada a C con el tono ligado
  // debe decir «C», no «D → C». La flecha solo sale si el audio suena distinto a
  // lo que dice la tarjeta (▼ ▲ con el 🔗 apagado).
  const cardSemi = cardKeySemitone();
  const written = cardSemi != null ? keys[cardSemi] : null;
  const transposed = !!(written && written !== sounding);
  el.classList.remove('hidden');
  el.classList.toggle('is-active', active);          // sonando (vs solo preparado)
  el.classList.toggle('is-transposed', transposed);
  el.innerHTML = transposed
    ? `<span class="ki-label">Tono</span><span class="ki-body"><span class="ki-written">${written}</span><span class="ki-arrow">→</span><span class="ki-sounding">${sounding}</span></span>`
    : `<span class="ki-label">Tono</span><span class="ki-body"><span class="ki-sounding">${sounding}</span></span>`;
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
    // La tecla de la canción preparada suena en el modo de la canción.
    if (key === getPreparedPadKey()) applyPreparedPadMode({ replay: false });
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
  updateKeyIndicator();
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
  window.addEventListener('error', (e) => {
    try { console.error('[LivePads] error:', e.message); } catch (_) {}
    // También al registro en disco (logs/app.log): en la app instalada no hay consola.
    if (/ResizeObserver loop/.test(e.message || '')) return;   // aviso inofensivo del navegador
    try { window.electronAPI?.appLog?.('error', `${e.message} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', (e) => { try { console.error('[LivePads] promise rejection:', e.reason); } catch (_) {} });
  bindClickWithSeqToggle();
  bindCountInToggle();
  initMetroOptions();
  // Salida de audio elegida (y click por 3-4): se aplica ya, y la lista de Ajustes se rellena sola.
  applySavedOutput(engine).catch(() => {}).then(() => initAudioOutputSetting(() => engine));
  initSoundSetting();
  bindPadsPianoToggle();
  q('#btn-metro-pads')?.addEventListener('click', () => openMetronomeModal());
  q('#btn-tuner-pads')?.addEventListener('click', () => openTunerModal());
  // Detector de acordes: módulo + motor + CSS se cargan SOLO al abrirlo (no pesa al arrancar).
  q('#btn-chords-pads')?.addEventListener('click', () => {
    if (!requireFeature('chords')) return;
    import('./ui/chordDetectModal.js').then(m => m.openChordDetect()).catch(e => console.error('[LivePads] acordes:', e));
  });

  // Doble clic en CUALQUIER slider de paneo → vuelve al centro (0). Delegado
  // para cubrir todos (mezclador, metro, pads, batería) sin wiring individual;
  // el dispatch de 'input' reusa el handler normal (engine + UI + persist).
  document.addEventListener('dblclick', (e) => {
    const pan = e.target.closest('input[type="range"].pan-slider');
    if (!pan) return;
    pan.value = 0;
    pan.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Refresh the on-pad key hints whenever mappings are cleared/changed.
  document.addEventListener('livepads:mappings-changed', () => {
    if (typeof updateKeyHints === 'function') updateKeyHints();
  });
  bindTrackPlayerControls();
  bindAutoAdvanceToggle();
  bindKitControls({ buildBankSelects, loadKitBank });
  bindWindowControls();
  bindSidebarAndTabs();
  initLiveMode();
  registerSpotlightProvider(spotlightProviderItems);
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
  // (El engranaje se retiró; el panel de Ajustes se abre con el menú ☰.)
  const gear = q('#btn-settings-toggle');
  if (gear) gear.onclick = () => q('#sidebar').classList.toggle('open');
  // El velo de Ajustes vive fuera del panel: dentro, el transform del panel lo
  // limitaba al propio panel y el resto de la app seguía a pleno brillo y activa.
  { const ov = q('#sidebar-overlay'); if (ov && ov.parentElement !== document.body) document.body.appendChild(ov); }
  q('#sidebar-overlay').onclick = () => q('#sidebar').classList.remove('open');
  const btnClose = q('#btn-sidebar-close');
  if (btnClose) btnClose.onclick = () => q('#sidebar').classList.remove('open');

  qa('.stab').forEach(btn => {
    btn.onclick = () => openSidebarTab(btn.dataset.tab);
  });
  window.addEventListener('livepads:sidebar-tab', (ev) => {
    try { localStorage.setItem(SIDEBAR_TAB_KEY, ev.detail.tab); } catch (_) {}
  });
}

const SIDEBAR_TAB_KEY = 'livepads:sidebar-tab';
const lastSidebarTab = () => {
  let t = null;
  try { t = localStorage.getItem(SIDEBAR_TAB_KEY); } catch (_) {}
  // «Cuenta» ya no es un panel del menú lateral (abre el Centro de cuenta aparte): el ☰
  // nunca debe reabrir en esa pestaña, o solo se vería la ventana de cuenta.
  if (t === 'account') t = null;
  return t && q(`.stab[data-tab="${t}"]`) ? t : 'audio';
};

function bindHamburgerMenu() {
  // El botón ☰ ahora ABRE el panel de Ajustes centralizado (antes mostraba un
  // popover). El #menu-popover sigue en el DOM (oculto) solo para reutilizar sus
  // handlers desde los launchers del sidebar.
  q('#btn-menu').onclick = () => openSidebarTab(lastSidebarTab());
  window.closeMenu = closeAllOverlays;

  q('#menu-open-settings').onclick = () => { closeMenu(); openSidebarTab('audio'); };
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

  // Companion: herramienta de la cabecera (como el metrónomo o la caja de ritmos).
  q('#btn-companion')?.addEventListener('click', () => {
    if (isCompanionPanelOpen()) closeCompanionPanel(); else openCompanionPanel();
  });
  watchCompanionBadge();

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
      q('#midi-learn-overlay').innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="15" height="15" style="vertical-align:-2px;margin-right:6px"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v9M15 4v9M7.5 4v6M12 4v6M16.5 4v6"/></svg>Modo Mapeo: haz clic en un control <b>resaltado</b> y toca tu controlador. Puedes mapear varios seguidos. (Clic aquí para salir)';
      q('#midi-learn-overlay').style.display = 'block';
      // Body-level flag → CSS dims the whole UI to emphasize learn-mode
      // is modal. Exit (in midiBindings.js) removes the class.
      document.body.classList.add('midi-learning');
    };
  }

  // ── Launchers del panel de Ajustes centralizado (nav lateral) ──────────
  // Cada panel se abre como SECCIÓN nativa del sidebar: la misma función
  // "open" del modal recibe { mount } y pinta ahí dentro (sin velo ni Esc).
  const wire = (id, fn) => { const b = q(id); if (b) b.onclick = fn; };
  const closeSidebar = () => q('#sidebar')?.classList.remove('open');

  // MIDI Learn es una ACCIÓN (resalta la app) → cierra el panel.
  wire('#set-midi-learn', () => { closeSidebar(); q('#menu-midi-learn')?.click(); });
  wire('#set-mappings',  () => openMappingsList({ mount: q('#embed-midi') }));
  wire('#set-midi-rescan', () => { try { window.__livepadsRescanMidi?.(); } catch (_) {} });

  // ── Selector de controlador MIDI ───────────────────────────────────────
  // La lista se repuebla cada vez que se abre el panel y en cada cambio de
  // dispositivos, para que refleje lo que hay enchufado AHORA. La eleccion se
  // guarda solo en LOCAL (a proposito: el id del puerto es de esta maquina, no
  // tiene sentido sincronizarlo a la cuenta).
  const MIDI_INPUT_KEY = 'livepads-midi-input';
  const paintMidiInputs = () => {
    const sel = q('#set-midi-input');
    const state = q('#set-midi-input-state');
    if (!sel) return;
    const list = (engine && typeof engine.listMidiInputs === 'function') ? engine.listMidiInputs() : [];
    const saved = localStorage.getItem(MIDI_INPUT_KEY) || '';
    sel.innerHTML = '<option value="">Todos los controladores</option>' +
      list.map(d => {
        const label = d.manufacturer ? `${d.name} — ${d.manufacturer}` : d.name;
        const safe = label.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        return `<option value="${d.id}">${safe}</option>`;
      }).join('');
    sel.value = list.some(d => d.id === saved) ? saved : '';
    if (state) {
      const none = list.length === 0;
      state.classList.toggle('is-none', none);
      state.textContent = none
        ? 'No se detecta ningun controlador. Enchufalo y usa «Reconectar MIDI».'
        : `${list.length} dispositivo${list.length > 1 ? 's' : ''} conectado${list.length > 1 ? 's' : ''}.`;
    }
  };
  const midiInputSel = q('#set-midi-input');
  if (midiInputSel) {
    midiInputSel.onchange = () => {
      const id = midiInputSel.value || '';
      try { localStorage.setItem(MIDI_INPUT_KEY, id); } catch (_) {}
      try { engine.setMidiInput?.(id); } catch (_) {}
      const name = midiInputSel.options[midiInputSel.selectedIndex]?.textContent || '';
      showToast(id ? `Usando: ${name}` : 'Escuchando todos los controladores.', 'success');
    };
  }
  // Sensibilidad a la fuerza del golpe (velocity) en la batería. Activada por defecto.
  const VEL_KEY = 'livepads-midi-velocity';
  const velOn = (() => { try { return localStorage.getItem(VEL_KEY) !== '0'; } catch (_) { return true; } })();
  const velBox = q('#set-midi-velocity');
  if (velBox) {
    velBox.checked = velOn;
    velBox.onchange = () => {
      try { localStorage.setItem(VEL_KEY, velBox.checked ? '1' : '0'); } catch (_) {}
      if (engine) engine.velocitySensitive = velBox.checked;
    };
  }
  // Repinta al abrir la pestana MIDI y cuando cambian los dispositivos.
  document.querySelector('.stab[data-tab="midi"]')?.addEventListener('click', () => setTimeout(paintMidiInputs, 60));
  window.addEventListener('livepads:midi-devices', paintMidiInputs);
  setTimeout(paintMidiInputs, 1500);
  // Servicio: Pre-vuelo y Companion son MUTUAMENTE EXCLUSIVOS (uno u otro).
  // "Revisar de nuevo" cierra y reabre para recalcular los checks.
  wire('#set-preflight', () => {
    closeCompanionPanel();
    closePreflight();
    openPreflight({ getEngine: () => engine, mount: q('#embed-preflight') });
  });
  // Las secciones que embeben un panel se abren SOLAS al entrar en su pestaña:
  // el usuario no tiene que pulsar un botón intermedio para ver el contenido.
  const AUTO_EMBED = {
    preflight: ['#embed-preflight', '#set-preflight'],
    account:   ['#embed-account',   '#set-account'],
    midi:      ['#embed-midi',      '#set-mappings'],
  };
  window.addEventListener('livepads:sidebar-tab', (ev) => {
    // Cuenta y librerías ya NO viven apretadas en el menú lateral: se abren como
    // Centro de cuenta en la pantalla principal (también desde el chip de arriba).
    if (ev.detail.tab === 'account') {
      q('#sidebar')?.classList.remove('open');
      import('./cloud/accountPanel.js').then((m) => m.openAccountPanel()).catch((e) => {
        window.showToast?.(`No se pudo abrir Mi cuenta: ${(e && e.message) || e}`, 'error');
      });
      return;
    }
    const spec = AUTO_EMBED[ev.detail.tab];
    if (!spec) return;
    const pane = q(spec[0]);
    const body = q(`#tab-${ev.detail.tab}`);
    if (!pane || !body) return;
    if (pane.childElementCount > 0) { body.classList.add('has-panel'); return; }
    body.classList.remove('has-panel');
    q(spec[1])?.click();
    // The account panel embeds asynchronously — flag the section (which hides
    // the now-redundant launcher) only once the panel is really there.
    let tries = 0;
    const mark = () => {
      if (pane.childElementCount > 0) body.classList.add('has-panel');
      else if (++tries < 12) setTimeout(mark, 250);
    };
    mark();
  });

  // Ojo: se ESPERA a openAccountPanel antes de embeber (crea el overlay y
  // pinta su contenido de forma asíncrona; embeber antes dejaba el panel
  // vacío). Y el error se muestra: el `.catch(()=>{})` de antes lo tragaba,
  // así que un fallo aquí se veía como "el botón no hace nada".
  wire('#set-account', async () => {
    try {
      const m = await import('./cloud/accountPanel.js');
      await m.openAccountPanel({ mount: q('#embed-account') });
    } catch (e) {
      console.error('[LivePads] no se pudo abrir Mi cuenta:', e);
      window.showToast?.(`No se pudo abrir Mi cuenta: ${e && e.message || e}`, 'error');
    }
  });
}


// Entradas dinámicas de la paleta Ctrl+K: paneles del sidebar, modo en vivo,
// espacio de trabajo, navegación del servicio, temas y canciones del servicio.
const SIDEBAR_PANELS = [
  ['audio', 'Ajustes: Audio'], ['midi', 'Ajustes: MIDI / Teclado'], ['themes', 'Ajustes: Temas'],
  ['library', 'Ajustes: Biblioteca de audios'], ['account', 'Cuenta y librerías'],
  ['preflight', 'Pre-vuelo del servicio'],
  ['shortcuts', 'Atajos de teclado'], ['about', 'Acerca de LivePads'],
];
function spotlightProviderItems() {
  const items = [];
  const idx = getActiveServiceIndex();
  const svc = getServiceSongs();
  const gotoService = (i) => {
    q('.s-toggle[data-target="service-setlist-list"]')?.click();
    const s = svc[i];
    if (!s) return;
    setTimeout(() => {
      const card = q(`#service-songs-container .gi-song-item[data-service-id="${CSS.escape(String(s.serviceId))}"]`);
      if (card) card.click(); else applyGiSong(s);
    }, 60);
  };
  if (svc[idx + 1]) {
    const n = svc[idx + 1];
    items.push({ id: 'svc:next', kind: 'service', featured: true, label: `Siguiente: ${n.title || 'Sin título'}`, sub: `Servicio · ${getEffectiveKey(n) || ''}`, search: 'siguiente canción next', run: () => gotoService(idx + 1) });
  }
  items.push({ id: 'cmd:live', kind: 'command', featured: true, label: isLiveMode() ? 'Salir del modo en vivo' : 'Entrar en modo en vivo', sub: 'Ctrl+L', search: 'modo en vivo live directo', run: toggleLiveMode });
  items.push({ id: 'cmd:panic', kind: 'command', label: 'Pánico: detener todo', sub: 'Esc', search: 'pánico panico detener parar stop todo', run: panicStopAll });
  items.push({ id: 'cmd:prev', kind: 'command', label: 'Canción anterior del servicio', sub: '↑', search: 'anterior previa servicio', run: servicePrevSong });
  items.push({ id: 'cmd:next', kind: 'command', label: 'Canción siguiente del servicio', sub: '↓', search: 'siguiente próxima servicio', run: serviceNextSong });
  items.push({ id: 'cmd:ws-pads', kind: 'command', label: 'Ir a Pads', sub: 'Tab', search: 'pads workspace espacio', run: () => q('.ws-tab[data-workspace="pads"]')?.click() });
  items.push({ id: 'cmd:ws-stems', kind: 'command', label: 'Ir a Stems', sub: 'Tab', search: 'stems workspace espacio editor', run: () => q('.ws-tab[data-workspace="stems"]')?.click() });
  for (const [tab, label] of SIDEBAR_PANELS) {
    items.push({ id: `tab:${tab}`, kind: 'panel', label, sub: 'Panel', search: `${label} ajustes panel abrir`, run: () => openSidebarTab(tab) });
  }
  items.push({ id: 'tool:companion', kind: 'panel', label: 'Companion (móvil)', sub: 'Herramienta', search: 'companion móvil movil qr letra acordes músicos código', run: () => openCompanionPanel() });
  for (const [id, t] of Object.entries(THEMES)) {
    items.push({ id: `theme:${id}`, kind: 'theme', label: `Tema: ${t.name}`, sub: getCurrentTheme() === id ? 'Tema actual' : (t.desc || 'Tema'), search: `tema theme ${t.name} ${t.desc || ''}`, run: () => applyTheme(id) });
  }
  svc.forEach((s, i) => {
    items.push({ id: `svc:${i}`, kind: 'service', label: `${i + 1}. ${s.title || 'Sin título'}`, sub: `Servicio · ${s.artist || ''}${getEffectiveKey(s) ? ' · ' + getEffectiveKey(s) : ''}`, search: `servicio ${s.title || ''} ${s.artist || ''}`, run: () => gotoService(i) });
  });
  return items;
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
    persistGiSongs();
    renderGiList(q('#gi-search')?.value || '');
    updateFilterCounts();
    // Los setlists guardan una COPIA de cada canción. Sin esto, una canción que
    // actualizó un compañero se refrescaba en la Librería pero el servicio
    // seguía mostrando (y tocando) el tono, BPM y letra viejos.
    if (syncServiceWithLibrary()) renderServiceList();
  });

  // Se cambió el tono de una canción (al editarla, en la Librería o en el Servicio).
  // El tono fijado «para este servicio» manda sobre el de la librería: si se
  // quedaba, la tarjeta mostraba el nuevo (Cm) pero el pad seguía en el viejo
  // (D#), y el servicio lo marcaba como «baja de tono». Elegir un tono nuevo lo
  // reemplaza: se quita el del servicio, se refrescan sus copias y, si es la
  // canción cargada, el pad pasa ya al tono nuevo (en mayor o menor).
  window.addEventListener('livepads:song-key-changed', (ev) => {
    const song = ev?.detail?.song;
    if (!song) return;
    clearKeyOverride(song);
    // «Tono ligado»: ¿se transporta todo (letra + audio) o solo se corrige el tono?
    // Se pregunta ANTES de recargar la pista (un aviso de audio no pisa el diálogo).
    const oldKey = ev.detail.oldKey || '';
    const live = libraryLive(song) || song;
    const ch = (isKeyLinked() && oldKey && live.key && oldKey !== live.key) ? linkedKeyChange(live, oldKey, live.key) : null;
    const hasChords = /[[A-G]/.test(live.lyrics || '');
    const hasAudio = !!(live.audio && (live.audio.sequence || live.audio.original));
    if (!ch || (!hasChords && !hasAudio)) { refreshAfterKeyEdit(song); return; }
    const what = [hasChords && 'los acordes de la letra', hasAudio && 'el audio (secuencia / original)'].filter(Boolean).join(' y ');
    confirmDialogAsync({
      title: `Cambiar tono de ${oldKey} a ${live.key}`,
      message: `¿Paso también ${what} a ${live.key} (${ch.delta > 0 ? '+' : ''}${ch.delta} semitono${Math.abs(ch.delta) === 1 ? '' : 's'})?

«Solo corregir» deja la letra y el audio como están: útil si el tono estaba mal anotado.`,
      confirmLabel: 'Transportar todo',
      cancelLabel: 'Solo corregir',
      danger: false,
    }).then((ok) => {
      if (!live.audio) live.audio = {};
      if (ok) {
        live.lyrics = ch.lyrics;
        live.audio.pitch = ch.pitch;
        live.audio.keyPitch = ch.keyPitch; live.audio.keyPitchSet = true; live.audio.keyPitchSet = true;
      } else {
        // «Solo corregir»: el tono de la tarjeta pasa a ser el que SUENA ahora
        // (grabación + transporte), así el pad no arrastra un transporte anterior.
        live.audio.keyPitch = Number(live.audio.pitch) || 0; live.audio.keyPitchSet = true;
      }
      persistGiSongs();
      window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
      if (ok) renderGiList(q('#gi-search')?.value || '');
      refreshAfterKeyEdit(live);
      if (ok) showToast(`${live.title || 'Canción'}: letra y audio pasados a ${live.key}.`, 'success');
    });
  });

  // Llegó de la nube un cambio de tono ligado (un compañero transportó la
  // canción): si es la que está cargada, audio y pad se ponen al día ya.
  window.addEventListener('livepads:library-synced', () => {
    const cs = getCurrentSong();
    if (!cs) return;
    const live = libraryLive(cs);
    if (live && isActiveLibrarySong(live)) {
      const rs = recordingSemitone(live);
      if (rs != null) _songBaseKeySemitone = rs;
    }
    reapplyKeyShift(cs);
  });

  // Descarga automática de carátulas y audios (sin pulsar "Sincronizar"): un aviso
  // al empezar y otro al terminar; el progreso fino vive en el panel Mi cuenta.
  window.addEventListener('livepads:file-sync', (ev) => {
    const d = (ev && ev.detail) || {};
    if (d.finished) {
      showToast(d.failed ? `Archivos al día (${d.downloaded} descargados, ${d.failed} fallaron).` : `${d.downloaded} archivo(s) descargados: carátulas y audios al día.`, d.failed ? 'info' : 'success');
    } else if (d.announce && d.total) {
      showToast(`Descargando ${d.total} archivo(s) del repertorio en segundo plano…`, 'info');
    }
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
    // Las listas/setlists guardan una COPIA de la canción; al crear la secuencia
    // (u otra edición) en Stems, re-sincronizamos esas copias con la librería
    // para que el setlist refleje el cambio (badge de secuencia, reproducción…).
    if (syncServiceWithLibrary()) renderServiceList();
    scheduleCloudAutoSync();
  });

  // "Pistas separadas · practicar" desde el menú de una canción en Pads: abre
  // Stems y carga solo las pistas elegidas.
  window.addEventListener('livepads:practice-song-stems', async (ev) => {
    const { song, stems } = ev.detail || {};
    if (!song || !stems?.length) return;
    applyWorkspace('stems');
    try {
      const ws = await ensureStemsMounted();
      await stemsMountPromise;   // la primera vez, esperar a que el editor termine de montarse
      await ws.practiceSongStems(song, stems);
    } catch (e) { console.warn('[LivePads] no se pudieron cargar las pistas:', e); }
  });

  // Auto-sync a la nube (Supabase) tras crear/editar: empuja la librería activa
  // en background para que la otra app (misma BD) lo vea sin pulsar "Subir".
  // Debounced para agrupar ráfagas de ediciones; best-effort (silencioso si no
  // hay sesión/red). Avisa con un toast sutil solo cuando SUBE canciones nuevas.
  let cloudSyncTimer = null;
  // Reintento con espera creciente (30 s, 1, 2, 4 min… hasta 5) si la subida
  // falla: antes un fallo (sin red, sesión caducada) dejaba el cambio solo en
  // este equipo hasta la siguiente edición.
  let cloudRetryTimer = null, cloudRetryDelay = 30000;
  function scheduleCloudAutoSync() {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    if (cloudRetryTimer) { clearTimeout(cloudRetryTimer); cloudRetryTimer = null; }
    cloudSyncTimer = setTimeout(async () => {
      cloudSyncTimer = null;
      try {
        const { autoPushActiveLibrary } = await import('./cloud/songSync.js');
        const r = await autoPushActiveLibrary();
        cloudRetryDelay = 30000;   // subió bien: el próximo fallo vuelve a esperar poco
        if (r && r.created > 0) {
          showToast(`${r.created} canción(es) sincronizada(s) con la nube.`, 'success');
        }
        // Y sube los ARCHIVOS que falten (audio + carátulas). Sin esto, una
        // canción nueva llegaba a la nube pero su audio NO, y las apps web no
        // tenían nada que descargar. Solo sube lo que falta (idempotente).
        try {
          const { subirBiblioteca } = await import('./cloud/fileSync.js');
          const f = await subirBiblioteca();
          if (f && f.uploaded > 0) {
            showToast(`${f.uploaded} archivo(s) de audio subidos a la nube.`, 'success');
          }
        } catch (fe) {
          try { console.warn('[LivePads] auto-subida de audio falló:', fe && fe.message); } catch (_) {}
        }
      } catch (e) {
        // Sin sesión/red se reintenta en el próximo cambio — pero DEJAR RASTRO:
        // un fallo persistente aquí estuvo meses mudo (lotes con claves mixtas
        // rechazados por PostgREST) y las letras nunca llegaban a GI.Setlist.
        try { console.warn('[LivePads] auto-push a la nube falló:', e && e.message); } catch (_) {}
        cloudRetryTimer = setTimeout(() => { cloudRetryTimer = null; scheduleCloudAutoSync(); }, cloudRetryDelay);
        cloudRetryDelay = Math.min(cloudRetryDelay * 2, 300000);
      }
    }, 2000);
  }
  // Lo que quedó sin subir (app cerrada antes de los 2 s, sin red, un fallo) se
  // sube en cuanto se puede: tras cada bajada de la nube (también la del
  // arranque) y al recuperar la conexión.
  // Como mucho una vez por minuto: con un conflicto sin resolver la subida se
  // aplaza y pide otra bajada, que volvería a llamar aquí (bucle cada 2-3 s).
  let lastPendingPush = 0;
  async function pushIfPending() {
    try {
      if (Date.now() - lastPendingPush < 60000 || cloudSyncTimer || cloudRetryTimer) return;
      const { countPendingSongs } = await import('./cloud/songSync.js');
      if (countPendingSongs() > 0) { lastPendingPush = Date.now(); scheduleCloudAutoSync(); }
    } catch (_) {}
  }
  window.addEventListener('livepads:library-synced', pushIfPending);
  window.addEventListener('online', () => { cloudRetryDelay = 30000; scheduleCloudAutoSync(); });
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
    const title = ev?.detail?.title;
    // Si la nube no deja borrarla (rol de solo lectura) o falla la red, avisar:
    // antes fallaba en silencio y la canción «volvía» en la siguiente bajada.
    const onlyHere = () => showToast(`«${title || 'La canción'}» solo se eliminó en este equipo: no se pudo borrar de la librería compartida (sin permiso de edición o sin conexión). Volverá a aparecer al sincronizar.`, 'warning');
    import('./cloud/songSync.js')
      .then(m => m.deleteCloudSong(cloudId, title, ev?.detail?.libraryId || null))
      .then((ok) => { if (ok === false) onlyHere(); })
      .catch((e) => {
        const msg = String(e && e.message || '');
        // Sin sesión o sin librería: uso solo local, no hay nada que avisar.
        if (/Inicia sesión|librería activa/i.test(msg)) return;
        onlyHere();
      });
    // Registra el borrado en el historial del equipo (best-effort).
    import('./cloud/libraries.js').then(({ getActiveLibraryId }) => {
      const libId = getActiveLibraryId();
      if (libId) import('./cloud/activity.js').then(a => a.logActivity(libId, 'deleted', title)).catch(() => {});
    }).catch(() => {});
  });

  // ── Sincronización "en vivo": cambios que hacen otros miembros del equipo ──
  // libraryLive.js baja en background y, cuando OTRO miembro cambió algo, emite
  // este evento. Avisamos con un toast — pero NO en pleno directo: si hay música
  // sonando, acumulamos y lo mostramos al parar (no molestar en escenario).
  let pendingActivity = [];
  const isPlayingNow = () => (isTrackLoaded() && isTrackPlaying()) || getMetroRunning();
  function showActivityToast(all) {
    const gone = all.filter(c => c.deleted);
    if (gone.length) {
      const t = [...new Set(gone.map(c => c.title).filter(Boolean))];
      if (t.length === 1) showToast(`«${t[0]}» se eliminó de la librería compartida.`, 'info');
      else if (t.length) showToast(`${t.length} canciones se eliminaron de la librería compartida.`, 'info');
    }
    const changes = all.filter(c => !c.deleted);
    const titles = [...new Set(changes.map(c => c.title).filter(Boolean))];
    const names  = [...new Set(changes.map(c => c.byName).filter(Boolean))];
    if (!titles.length) return;
    let text;
    if (titles.length === 1) {
      text = names[0] ? `${names[0]} actualizó «${titles[0]}»` : `Se actualizó «${titles[0]}»`;
    } else {
      const who = names.length === 1 ? ` por ${names[0]}` : ' por tu equipo';
      text = `${titles.length} canciones actualizadas${who}`;
    }
    showToast(text, 'info');
  }
  function flushActivity() {
    if (!pendingActivity.length || isPlayingNow()) return;
    const changes = pendingActivity; pendingActivity = [];
    showActivityToast(changes);
  }
  window.addEventListener('livepads:library-activity', (ev) => {
    const changes = (ev?.detail?.changes) || [];
    if (changes.length) pendingActivity.push(...changes);
    // Borrados del equipo: la canción ya desapareció de la lista local. Avisar
    // es obligatorio — que algo se esfume sin explicación asusta en un ensayo.
    const removed = (ev?.detail?.removed) || [];
    if (removed.length) {
      pendingActivity.push(...removed.filter(Boolean).map(t => ({ title: t, deleted: true })));
    }
    flushActivity();
  });

  // Conflictos: se resuelven en un diálogo (mía / de ellos). No interrumpimos un
  // directo: si hay música sonando, esperan hasta que pare.
  let pendingConflicts = [];
  function flushConflicts() {
    if (!pendingConflicts.length || isPlayingNow()) return;
    const list = pendingConflicts; pendingConflicts = [];
    import('./cloud/conflictDialog.js').then(m => m.showConflictsModal(list)).catch(() => {});
  }
  window.addEventListener('livepads:library-conflict', (ev) => {
    const list = (ev?.detail?.conflicts) || [];
    if (list.length) pendingConflicts.push(...list);
    flushConflicts();
  });

  // Reintenta mostrar avisos/conflictos pendientes cuando la música pare.
  setInterval(() => { flushActivity(); flushConflicts(); }, 15000);

  // Arranca el motor de bajada automática (arranque/focus/intervalo). Se
  // auto-protege: sin sesión / librería / red no hace nada.
  import('./cloud/libraryLive.js').then(m => m.startLibraryLiveSync()).catch(() => {});
  // Chip de cuenta (avatar + librería activa) en la barra superior.
  import('./cloud/accountChip.js').then(m => m.startAccountChip()).catch(() => {});
  // "Qué suena ahora" → nube (para el móvil de la banda fuera de la WiFi).
  import('./cloud/nowPlaying.js').then(m => m.startNowPlayingPublisher()).catch(() => {});
  // Buzón de invitaciones: si alguien te invitó por email, te aparece dentro de
  // la app (sin códigos que pegar). Mismas guardas: sin sesión/red, no hace nada.
  import('./cloud/inviteInbox.js').then(m => m.startInviteInbox()).catch(() => {});

  // Auto-sync de setlists: publica los servicios EDITADOS aquí y baja los del
  // resto del equipo. Best-effort (sin sesión/red no hace nada).
  //
  // La pasada del arranque la hace ahora libraryLive (baja primero, publica
  // después). Antes había aquí un `setTimeout(subirTodos, 8000)` que subía
  // TODOS los setlists locales sin mirar fechas: arrancar la app con datos
  // viejos pisaba los servicios que el equipo había cambiado. Ese era el
  // agujero principal por el que "a veces no se actualizaba".
  let setlistSyncTimer = null;
  window.addEventListener('livepads:setlists-changed', () => {
    clearTimeout(setlistSyncTimer);
    setlistSyncTimer = setTimeout(() => {
      import('./cloud/setlistSync.js').then(m => m.autoSyncSetlists()).catch(() => {});
    }, 2500);
  });
  bindMidiHandlers({
    getEngine: () => engine,
    onKeyClick,
    toggleMetro,
    triggerMasterPlayPause,
    triggerMasterStop,
    triggerSourcePlayPause,   // play/pause del reproductor según la fuente
    toggleSequenceOnly,       // acción dedicada: solo la secuencia
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
    authGateReady.then(() => ensureStemsMounted().then(() => {
      // La consola de Stems se monta tarde: con el tema plano sus perillas se crean ahora.
      if (document.documentElement.dataset.themeStyle === 'flat') import('./ui/flatKnobs.js').then(m => m.ensureFlatKnobs()).catch(() => {});
      if (activeWorkspace() === 'stems') maybeStartTour();
    }));
  } else {
    authGateReady.then(() => { if (activeWorkspace() === 'pads') maybeStartPadsTour(); });
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
    const deselectSong = (e) => {
      if (e) e.stopPropagation();
      setActiveSongId(null);
      setActiveServiceIndex(-1);
      qa('.gi-song-item.queued-next').forEach(c => c.classList.remove('queued-next'));
      refreshActiveSongHighlights();
      updateKeyIndicator();
    };
    const npClose = q('#np-close-btn');
    if (npClose) npClose.onclick = deselectSong;
    // La franja «Preparada» ya no se muestra (la tarjeta y el reproductor bastan): la X del reproductor,
    // además de cerrar la pista (trackPlayer.js), deselecciona la canción como hacía la de la franja.
    const tpClose = q('#tp-close-btn');
    if (tpClose) tpClose.addEventListener('click', () => deselectSong());
  }
}

function toggleMetro() {
  setMetroRunning(metro.toggle());
  const btn = q('#btn-metro-main');
  // Icono de metrónomo (no un triángulo de Play): el Play de la canción es el
  // de la barra inferior, y dos "Play" iguales confundían cuál lanzar.
  btn.innerHTML = getMetroRunning()
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M10.4 3.2A1.6 1.6 0 0 1 12 2a1.6 1.6 0 0 1 1.6 1.2l4.5 16.4A1.9 1.9 0 0 1 16.3 22H7.7a1.9 1.9 0 0 1-1.8-2.4z"/><path d="M8.5 17h7"/><path d="M12 17 18 5.5"/><circle cx="15" cy="11.25" r="1.6" fill="currentColor"/></svg>';
  btn.classList.toggle('running', getMetroRunning());
  if (!getMetroRunning()) {
    qa('.beat-dot').forEach(d => d.classList.remove('on'));
  }
  refreshPlayBtnIcon(); // en modo Click, el icono del reproductor sigue al metrónomo
}

// El icono del botón Play del reproductor según la FUENTE: en Click lo dicta el
// metrónomo (no hay pista que emita eventos); en Secuencia/Original, la pista.
function refreshPlayBtnIcon() {
  const playing = (masterSource === 'click')
    ? getMetroRunning()
    : (isTrackLoaded() && isTrackPlaying());
  setPlayBtnIcon(playing);
  reflectSeqOnlyBtn();
}

// Botón "solo secuencia": ENCENDIDO solo cuando la SECUENCIA está sonando.
function reflectSeqOnlyBtn() {
  const btn = q('#tp-seqonly-btn');
  if (!btn) return;
  const running = isTrackLoaded() && getCurrentType() === 'sequence' && isTrackPlaying();
  btn.classList.toggle('is-running', running);
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
  preparePadModeFor(song);
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
  updateKeyIndicator();
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
      // Guía hablada activa y el original al principio: «Intro… tres, cuatro» antes de arrancar.
      if (!isTrackPlaying() && leadInWanted()) { doCountIn(() => { if (!isTrackPlaying()) clickPlayPause(); refreshNowPlayingLiveState(); }); return; }
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
  else if (getActiveKey() && getActiveKey() === getPreparedPadKey()) applyPreparedPadMode({ replay: true });
  if (isSequenceLoaded()) {
    // Cuenta de entrada (si está activa): un compás de clicks y luego arranca
    // la secuencia justo en el "1".
    if (!isTrackPlaying() && (countInEnabled() || leadInWanted())) {
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

// ── Play/Pause del REPRODUCTOR según la fuente seleccionada (desacoplado) ──
// A diferencia del Play maestro (Espacio), este NO acopla el pad con la
// secuencia/original: el pad queda independiente. El usuario lo pidió así:
//   · Secuencia → reproduce/pausa SOLO la secuencia.
//   · Original  → reproduce/pausa SOLO la original.
//   · Click     → reproduce/pausa el metrónomo + el pad juntos.
function triggerSourcePlayPause() {
  const now = Date.now();
  if (now - lastMasterToggle < 250) return;   // mismo debounce que el maestro
  lastMasterToggle = now;
  if (countingIn) return;

  if (masterSource === 'click') {
    // Click = metrónomo + pad. Toggle de ambos juntos.
    if (getMetroRunning()) {
      toggleMetro();
      if (getActiveKey()) onKeyClick(getActiveKey()); // apaga el pad
    } else {
      ensurePadPlaying();
      if (!getMetroRunning()) toggleMetro();
    }
    refreshNowPlayingLiveState();
    return;
  }
  // Secuencia / Original = solo esa pista.
  togglePlayPauseTrack(masterSource === 'reference' ? 'original' : 'sequence');
}

// Reproduce/pausa SOLO la pista del tipo dado (sin tocar pad ni metrónomo). Si
// la pista cargada ya es de ese tipo, togglea; si no, la carga y arranca.
function togglePlayPauseTrack(type) {
  if (isTrackLoaded() && getCurrentType() === type) {
    // Arrancar (no pausar): cuenta de entrada si está activa, o el compás de entrada
    // hablado («Intro… tres, cuatro») si la guía hablada lo pide.
    if (!isTrackPlaying() && (countInEnabled() || leadInWanted())) {
      doCountIn(() => { if (!isTrackPlaying()) clickPlayPause(); refreshNowPlayingLiveState(); });
      refreshNowPlayingLiveState();
      return;
    }
    clickPlayPause();                              // pausa/reanuda la pista
  } else {
    const song = getActiveSongForSource();
    const slot = type === 'sequence' ? 'secuencia' : 'original';
    if (!song || !(song.audio && song.audio[type])) {
      showToast(`Esta canción no tiene ${slot} asignada.`, 'info');
      return;
    }
    loadAndPlayTrack(song, type);
  }
  refreshNowPlayingLiveState();
}

// Acción dedicada (MIDI/botón): reproduce/pausa SOLO la secuencia, sin importar
// qué fuente esté seleccionada y sin tocar pad/metrónomo. El click del músico ya
// tiene su botón aparte; con esto puede parar/arrancar la secuencia por separado.
function toggleSequenceOnly() {
  const now = Date.now();
  if (now - lastMasterToggle < 250) return;
  lastMasterToggle = now;
  if (countingIn) return;
  togglePlayPauseTrack('sequence');
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

// Guardado de la librería GI con debounce (ver comentario en boot).
let giSaveTimer = null;
function persistGiSongs() {
  if (!window.electronAPI) return;
  if (giSaveTimer) clearTimeout(giSaveTimer);
  giSaveTimer = setTimeout(() => {
    giSaveTimer = null;
    window.electronAPI.saveGiSetlist(getSongs());
  }, 800);
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
  if (!btn) return;
  // Mismo botón del topbar en ambas pantallas: en Stems togglea el piano de
  // Stems (que graba/edita MIDI); en Pads, el piano de Pads.
  btn.onclick = () => {
    if (document.body.dataset.workspace === 'stems') {
      import('./stems/pianoPanel.js').then(m => m.togglePiano()).catch(() => {});
    } else {
      togglePadsPiano(reflectPadsPianoBtn);
    }
  };
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
  const interval = 60 / ((metro.bpm || 120) * (metro.tempoScale || 1));
  const t0 = engine.ctx.currentTime + 0.06;
  for (let i = 0; i < beats; i++) {
    const accent = i === 0 || (Array.isArray(metro.accents) && metro.accents.includes(i));
    engine.playClick(accent, metro.sound, metro.volume, metro.pan, t0 + i * interval);
  }
  try { speakCount(beats, t0, interval); } catch (_) {}   // «uno, dos, tres, cuatro» (si está activada)
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
  else if (getActiveKey() && getActiveKey() === getPreparedPadKey()) applyPreparedPadMode({ replay: true });
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
  paintSourceSegs();                               // ilumina la fuente elegida
  refreshNowPlayingLiveState();                    // feedback inmediato del segmento
  refreshPlayBtnIcon();                            // el icono del Play sigue a la nueva fuente
}

// Reproduce una fuente desde el ICONO de una card (secuencia/original) Y fija la
// selección de fuente abajo: así los 3 botones (Secuencia/Click/Original) reflejan
// lo que tocaste en la card. type = 'sequence' | 'original'.
function playSongSource(song, type) {
  masterSource = (type === 'original') ? 'reference' : 'sequence';
  loadAndPlayTrack(song, type);
  paintSourceSegs();
  refreshNowPlayingLiveState();
  refreshPlayBtnIcon();
  reflectSeqOnlyBtn();
}

// Ilumina el botón de la fuente SELECCIONADA (masterSource), suene o no — así se
// ve cuál disparará el Play sin tener que darle primero.
function paintSourceSegs() {
  const map = { sequence: 'src-seq', click: 'src-click', reference: 'src-ref' };
  for (const [src, id] of Object.entries(map)) {
    const b = document.getElementById(id);
    if (!b) continue;
    const on = masterSource === src;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function bindSourceControl() {
  const map = { 'src-seq': 'sequence', 'src-click': 'click', 'src-ref': 'reference' };
  for (const [id, which] of Object.entries(map)) {
    const b = q('#' + id);
    if (b) b.onclick = () => selectSource(which);
  }
  // Botón dedicado "solo secuencia" (play/pause de la secuencia, independiente).
  const seqOnly = q('#tp-seqonly-btn');
  if (seqOnly) seqOnly.onclick = () => toggleSequenceOnly();
  paintSourceSegs(); // estado inicial (Secuencia por defecto)
}

// PÁNICO: corta absolutamente todo y cierra cualquier overlay/ayuda, pase lo que
// pase. Es la tecla de seguridad en vivo (Esc) — el director nunca debe dudar de
// que esto silencia el escenario.
// ── Terminar suave ───────────────────────────────────────────────────────
// Baja todo (secuencia, pad, batería, caja de ritmos) en unos segundos y luego lo para:
// para cerrar una canción sin corte. Volver a pulsar durante el fundido = parar ya.
// Duración: «livepads.softEnd» (segundos, 5 por defecto).
let softEndTimer = null;
const softEndSecs = () => { try { const v = parseFloat(localStorage.getItem('livepads.softEnd')); return v >= 1 && v <= 20 ? v : 5; } catch (_) { return 5; } };
function paintSoftEnd(on) {
  const b = q('#tp-softend-btn');
  if (b) { b.classList.toggle('is-on', !!on); b.title = on ? 'Terminando… (pulsa otra vez para parar ya)' : `Terminar suave: baja todo en ${softEndSecs()} s y para (pad, pista, batería)`; }
}
function cancelSoftEnd() {
  if (!softEndTimer) return;
  clearTimeout(softEndTimer); softEndTimer = null;
  restoreMainBuses(); paintSoftEnd(false);
}
function softEnd() {
  if (softEndTimer) { clearTimeout(softEndTimer); softEndTimer = null; stopAllSound(); setTimeout(restoreMainBuses, 120); paintSoftEnd(false); return; }
  const sounding = (isTrackLoaded() && isTrackPlaying()) || !!getActiveKey() || getMetroRunning() || groovePlaying();
  if (!sounding) return;
  const sec = softEndSecs();
  fadeMainBuses(sec);
  paintSoftEnd(true);
  window.showToast?.(`Terminando suave (${sec} s)…`, 'info');
  softEndTimer = setTimeout(() => {
    softEndTimer = null;
    stopAllSound();
    setTimeout(restoreMainBuses, 150);   // el volumen vuelve cuando ya está todo parado
    paintSoftEnd(false);
  }, sec * 1000 + 60);
}

function panicStopAll() {
  // Cerrar overlays/ayuda/sidebar primero (no bloquean el corte de audio).
  if (isCheatSheetOpen()) closeCheatSheet();
  closeAllOverlays();
  q('#sidebar').classList.remove('open');
  cancelSoftEnd();
  stopAllSound();
}

// Para TODO lo que suena (sin tocar ventanas ni paneles): lo usan el pánico y «Terminar suave».
function stopAllSound() {
  // Cortar TODA fuente de sonido: pad, metrónomo, caja de ritmos y la pista (secuencia U original).
  try { stopGrooves(); } catch (_) {}
  engine.stopPad();
  setActiveKey(null);
  setPreparedPadKey(null);
  buildKeyGrid();
  updateKeyIndicator();
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
  // Ctrl/Cmd+L alterna el modo en vivo (también antes del filtro de inputs).
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    toggleLiveMode();
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
    q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado a la tecla ${kName}! Selecciona otro control o sal.`;
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
    } else {
      // El resto de acciones (fuente, transponer, tempo, letra…) equivalen a pulsar
      // su botón. Antes, asignadas a una tecla, no hacían nada.
      import('./midi/extraButtons.js').then(m => m.runClickAction(mapping)).catch(() => {});
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
  // Repertorio limpio (una sola vez por equipo): los semitonos guardados por
  // versiones anteriores (sin la marca de «cambio hecho con el tono ligado»)
  // hacían sonar canciones en un tono que ya no iba. Se ponen a 0: cada canción
  // suena en el tono de su tarjeta. Se sube a la nube para que el equipo también.
  let cleaned = 0;
  try {
    if (localStorage.getItem(PITCH_CLEANUP_KEY) !== '1') {
      cleaned = resetStrayPitches(songs);
      localStorage.setItem(PITCH_CLEANUP_KEY, '1');
      if (cleaned) changed++;
    }
  } catch (_) {}
  setSongs(songs);
  if (changed && window.electronAPI) window.electronAPI.saveGiSetlist(songs);
  if (cleaned) {
    try { syncServiceWithLibrary(); } catch (_) {}
    window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
    setTimeout(() => showToast(`Repertorio revisado: ${cleaned} ${cleaned === 1 ? 'canción tenía' : 'canciones tenían'} semitonos guardados de versiones anteriores. Ahora todas suenan en el tono de su tarjeta.`, 'info'), 1500);
  }
  updateFilterCounts();
  renderGiList();
  if (!skipConflictCheck) checkLibraryConflicts();
}
const PITCH_CLEANUP_KEY = 'livepads-pitch-cleanup-v2';

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
      message: `OneDrive creó ${count} copia(s) en conflicto de tu librería (pasa si editas en las dos PCs antes de que sincronice):\n\n${conflicts.join('\n')}\n\n¿Fusionarlas ahora? Se agregan las canciones que falten y se completan los audios faltantes — sin pisar lo que ya tienes. Las copias se archivan en "_conflictos_resueltos/" por si acaso.`,
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



// ── Tono ligado ─────────────────────────────────────────────────────────
function libraryLive(song) {
  if (!song) return null;
  return getSongs().find((s) => (song.cloudId && s.cloudId === song.cloudId) || (song.id != null && String(s.id) === String(song.id))) || null;
}
function isActiveLibrarySong(live) {
  const id = getActiveSongIdFromStore();
  return !!(live && id != null && String(id) === String(live.id));
}
/** Tras cambiar tono/letra/audio de una canción: servicio, reproductor y pad al día. */
function refreshAfterKeyEdit(song) {
  syncServiceWithLibrary();
  renderServiceList();
  reapplyKeyShift(song);
  const live = libraryLive(song);
  if (isActiveLibrarySong(live)) applyGiSong(live);
}
/** ▼ ▲ del reproductor con «Tono ligado»: el audio ya se movió `delta`; la tarjeta
 *  (y el tono fijado para el servicio, si lo hay) y los acordes le siguen. */
function linkedPitchFollow(song, delta) {
  if (!delta || !isKeyLinked()) return;
  const live = libraryLive(song);
  if (!live || !live.key) return;
  // En el SERVICIO (ensayos): ▼ ▲ cambia el tono del día (el chip). La letra y el
  // tono de la librería se quedan en el original; la letra se MUESTRA en el tono
  // del chip. El ajuste manual vuelve a donde estaba: el chip lo absorbe, así el
  // audio suena igual y el pad no se mueve dos veces.
  const svcVisible = !q('#service-setlist-list')?.classList.contains('hidden');
  const inService = getServiceSongs().some((c) => (live.cloudId && c.cloudId === live.cloudId) || String(c.id) === String(live.id));
  if (svcVisible && inService) {
    const eff = getEffectiveKey(live) || live.key;
    const manual = (Number(song.audio && song.audio.pitch) || 0) - delta;
    if (song.audio) song.audio.pitch = manual;
    if (!live.audio) live.audio = {};
    live.audio.pitch = manual;
    setKeyOverride(live, shiftKey(eff, delta));
    persistGiSongs();
    syncServiceWithLibrary();
    reapplyKeyShift(song);
    renderServiceList();
    window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
    window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
    updateKeyIndicator();
    return;
  }
  const ch = linkedPitchStep(live, delta);
  if (!ch) return;
  const ov = getKeyOverride(live);
  live.key = ch.key;
  live.lyrics = ch.lyrics;
  if (!live.audio) live.audio = {};
  live.audio.keyPitch = ch.keyPitch; live.audio.keyPitchSet = true;
  if (song && song !== live && song.audio) live.audio.pitch = song.audio.pitch;
  if (ov) setKeyOverride(live, shiftKey(ov, delta));
  persistGiSongs();
  syncServiceWithLibrary();
  renderServiceList();
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  // Tarjetas, letra en vivo y carril de acordes se repintan; el audio y el pad ya
  // están en su sitio (sin recargar la pista: se puede pulsar en pleno directo).
  window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
  updateKeyIndicator();
}

// Tono ligado: un semitono guardado que no está en el tono de la tarjeta (restos
// de antes del tono ligado) se descarta, para que la tarjeta mande sobre el audio
// y el pad. Se corrige en la librería y en sus copias del servicio.
function normalizeLinkedPitch(song) {
  if (!isKeyLinked() || !song || !song.audio) return false;
  const r = reconcileLinkedPitch(song.audio);
  if (!r.changed) return false;
  song.audio.pitch = r.pitch;
  song.audio.keyPitch = r.keyPitch;
  const live = libraryLive(song);
  if (live && live !== song) { if (!live.audio) live.audio = {}; live.audio.pitch = r.pitch; live.audio.keyPitch = r.keyPitch; }
  persistGiSongs();
  syncServiceWithLibrary();
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  return true;
}

function applyGiSong(song) {
  normalizeLinkedPitch(song);
  // Switching songs → fold away the previous song's open lyrics so the list
  // stays tidy.
  closeAllLyrics();

  // Sync active library song id in the store.
  setActiveSongId(song.id);
  // Aviso de «el usuario eligió esta canción» (aunque ya fuera la activa): la Letra en vivo
  // se reabre si se había cerrado con «‹ Canciones».
  try { window.dispatchEvent(new CustomEvent('livepads:song-picked', { detail: { id: song.id } })); } catch (_) {}

  // Nueva canción → la fuente del Play maestro vuelve a "Secuencia" por defecto.
  masterSource = 'sequence';
  paintSourceSegs();
  refreshPlayBtnIcon();

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

  // Update compás (clave del metrónomo): poné el metrónomo en el compás de la
  // canción (3/4, 6/8, etc.). El value del #metro-sig-select es el numerador.
  if (song.timeSig && SONG_TIME_SIG_BEATS[song.timeSig]) {
    const sigSel = q('#metro-sig-select');
    if (sigSel) {
      sigSel.value = String(SONG_TIME_SIG_BEATS[song.timeSig]);
      sigSel.dispatchEvent(new Event('change', { bubbles: true })); // → metro.setBeats + beat dots
    }
  }

  // Update Key
  // El tono que manda en vivo es el del SERVICIO (si ese día se acordó tocarla
  // en otro), no el que figura en la librería. Fuera del servicio getEffectiveKey
  // devuelve song.key, así que la Librería y Stems siguen igual.
  const liveKey = getEffectiveKey(song);
  if (liveKey) {
    let key = liveKey.replace('m', '').trim();
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
      // Guardar el semitono base (0-11) de la nota raíz de esta canción para
      // poder recalcular el pad correcto cuando el usuario transponga el tono
      // del reproductor con los botones ▲/▼ del track player.
      // Base = tono de la LIBRERÍA (el de la grabación). El pad suena en base +
      // transporte del audio, que ya incluye el del servicio: así no se cuenta dos
      // veces (antes, con el servicio en F y la secuencia bajada a mano, el pad
      // acababa en D#).
      { const rs = recordingSemitone(song); _songBaseKeySemitone = rs != null ? rs : keys.indexOf(key); }
      // Modo del pad (mayor/menor) según el tono de la canción ("Am" → menor).
      const pk = parseKey(liveKey);
      _preparedPadMinor = pk ? pk.minor : null;
      if (getActiveKey() === key) {
        // Ya suena esa nota (p. ej. de A a Am): se queda sonando y, si cambia el
        // modo, pasa a él con el fundido. (onKeyClick la habría apagado.)
        applyPreparedPadMode({ replay: true });
      } else if (getActiveKey()) {
        // If a pad is playing, smoothly crossfade to the new key (ya en su modo)
        applyPreparedPadMode({ replay: false });
        onKeyClick(key);
      } else {
        // Sin pad sonando: el selector Mayor/Menor muestra ya lo que sonará.
        applyPreparedPadMode({ replay: false, consume: false });
        // If no pad is playing, just prepare the key for master trigger
        setPreparedPadKey(key);
        qa('.key-btn').forEach(b => {
          b.classList.remove('active', 'prepared');
          if (b.dataset.key === key) b.classList.add('prepared');
        });
      }
      updateKeyIndicator();
    } else {
      // Key doesn't map to any of the 12 chromatic pads (e.g. "Em7b5",
      // unusual jazz extensions). Surface a warning so the user knows
      // why the pad didn't auto-prepare instead of silently failing.
      _songBaseKeySemitone = null;
      showToast(`Tono "${liveKey}" no se reconoce — el pad no se preparó automáticamente.`, 'warning');
    }
  } else {
    // La canción no tiene tono definido: deshabilitar la transposición del pad.
    _songBaseKeySemitone = null;
    updateKeyIndicator();
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

  // Si la canción tiene un pitch guardado (de una sesión anterior), aplicarlo
  // también al pad de notas — el track player lo restaura al audio en
  // startTrackPlayback, pero no llama onPitchChange automáticamente.
  //
  // SOLO si hay una SECUENCIA que se auto-carga y va a sonar en ese tono: el pad
  // debe igualar el tono SONANTE del track. Sin secuencia, el pad refleja el tono
  // ESCRITO de la canción; aplicar un pitch guardado (p. ej. de un original que
  // no se auto-carga) desplazaría el pad "en fantasma" — C se prepararía como B
  // aunque el contador de transposición muestre 0 y nada suene transpuesto.
  const savedPitch = Number((song.audio && song.audio.pitch) || 0) || 0;
  if (savedPitch !== 0 && song.audio && song.audio.sequence) applyNotepadPitchShift(savedPitch);

  // Mirror to the LAN Companion (no-op if server is off).
  if (window.electronAPI && window.electronAPI.companionPublishSong) {
    window.electronAPI.companionPublishSong({
      id: song.id,
      title: song.title,
      artist: song.artist,
      key: companionKey(song),
      bpm: song.bpm,
      lyrics: companionLyrics(song)
    }).catch(() => {});
  }
}

// El Companion por internet es de Pro: el proceso principal solo conecta la nube si el plan lo incluye.
let lastCompanionCloudPlan = null;
function syncCompanionCloudPlan() {
  const allowed = hasFeature('companionCloud');
  if (allowed === lastCompanionCloudPlan) return;
  lastCompanionCloudPlan = allowed;
  window.electronAPI?.companionSetCloud?.({ allowed }).catch?.(() => {});
}
setTimeout(syncCompanionCloudPlan, 0);

// El Companion se pinta con el tema activo de LivePads (al arrancar y al cambiarlo).
function companionTheme() {
  const id = savedThemeId(), t = THEMES[id];
  if (!t || !window.electronAPI?.companionSetTheme) return;
  window.electronAPI.companionSetTheme({
    id, bg: t.bg1, bg2: t.bg2, bg3: t.bg3, accent: t.blue, accent2: t.accent2 || t.blue,
    text: t.text || '#ffffff', muted: t.textMuted || '#a3a3a3', border: t.border || '',
    onAccent: t.onAccent || '', gradient: t.gradient || '',
  }).catch(() => {});
}
document.addEventListener('livepads:theme-change', companionTheme);
setTimeout(companionTheme, 0);

// El Companion recibe la canción en el tono de HOY (el del servicio si lo cambió), con los acordes ya
// transpuestos: así cada músico parte del tono real (antes veía el tono original de la canción).
function companionKey(song) { return getEffectiveKey(song) || song.key || ''; }
function companionLyrics(song) {
  const base = song.key || '', live = companionKey(song);
  const d = base && live && base !== live ? (keyDelta(base, live) || 0) : 0;
  return d && song.lyrics ? transposeAll(song.lyrics, d, prefersFlats(live)) : (song.lyrics || '');
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
        else if (r.status === 'ready')     statusEl.textContent = `✓ Versión ${r.version || 'nueva'} descargada — listo para reiniciar`;
        else                               { statusEl.textContent = `No se pudo comprobar: ${r.message || 'error desconocido'}`; statusEl.classList.add('is-error'); }
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

// Actualización lista: aviso inferior + botón fijo en la barra superior + botón en
// «Acerca». El botón fijo no desaparece al cerrar el aviso, así siempre se puede aplicar.
function showUpdateReady(info) {
  const version = info && info.version ? ` (v${info.version})` : '';
  const install = () => window.electronAPI.installUpdate();

  // 1) El icono de actualizaciones del header pasa a «Reiniciar» solo (ui/updateIndicator.js).

  // 2) Estado + botón en «Acerca»
  const st = document.getElementById('update-status');
  if (st) {
    st.className = 'about-update-status';
    st.textContent = '✓ Descarga completa — listo para reiniciar';
    let b = document.getElementById('update-restart-about');
    if (!b) {
      b = document.createElement('button');
      b.id = 'update-restart-about';
      b.className = 'sb-btn sb-btn--primary';
      b.textContent = 'Reiniciar e instalar ahora';
      st.insertAdjacentElement('afterend', b);
      b.onclick = install;
    }
    const notes = info && info.notes ? String(info.notes).trim() : '';
    const prev = document.getElementById('update-notes');
    if (prev) prev.remove();
    if (notes) {
      const nb = document.createElement('div');
      nb.id = 'update-notes';
      nb.className = 'about-update-notes';
      nb.innerHTML = `<strong>Novedades v${(info && info.version) || ''}</strong><br>${notes.replace(/\n/g, '<br>')}`;
      b.insertAdjacentElement('afterend', nb);
    }
  }

  // 3) Aviso inferior (se puede cerrar; el botón de arriba se queda)
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.innerHTML = `
    <span>Actualización lista${version} — reinicia para aplicarla.</span>
    <button id="update-restart">Reiniciar ahora</button>
    <button id="update-later" class="update-banner__later ui-close ui-close--sm" aria-label="Más tarde">✕</button>`;
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('is-in'));
  bar.querySelector('#update-restart').onclick = install;
  bar.querySelector('#update-later').onclick = () => bar.remove();
}

// Carátula que no carga (archivo movido, sin conexión): se cambia por la inicial.
// (Los eventos «error» de imágenes no burbujean: se escuchan en captura.)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const box = img.closest('.gi-song-cover');
  if (!box || !box.querySelector('.gi-cover-fallback')) return;
  box.classList.add('no-cover');
  img.remove();
}, true);

window.__showUpdateReady = showUpdateReady; // (también sirve para probar la interfaz)
window.__updState = updTestState;            // (prueba del icono del header)
initUpdateIndicator();
initLyricsOverlay();
if (window.electronAPI && window.electronAPI.onUpdateReady) {
  window.electronAPI.onUpdateReady(showUpdateReady);
  // Si ya había una descarga lista (p. ej. tras recargar la ventana), mostrarla.
  if (window.electronAPI.getUpdateStatus) {
    window.addEventListener('DOMContentLoaded', () => {
      window.electronAPI.getUpdateStatus().then((info) => { if (info) showUpdateReady(info); }).catch(() => {});
    });
  }
}

