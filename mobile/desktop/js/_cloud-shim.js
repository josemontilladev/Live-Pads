// ─────────────────────────────────────────────────────────────────────────
// SHIM CLOUD del renderer de LivePads en el navegador (desktop).
// Reemplaza a _demo-shim.js: mismos stubs de electronAPI, pero loadGiSetlist
// devuelve las canciones REALES de la nube (Supabase), que cloud-boot.js deja
// en window.__CLOUD_SONGS__ tras el login. Debe cargarse ANTES de app.js.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const noop = () => {};
  const asyncNull = () => Promise.resolve(null);

  const stubs = {
    getAppVersion: () => Promise.resolve('cloud'),
    // Canciones de la nube. El renderer arranca normal (oculta su preloader) y
    // esta llamada ESPERA a que cloud-boot termine el login y traiga las
    // canciones. Si ya están, resuelve al instante.
    loadGiSetlist: () => new Promise((resolve) => {
      if (window.__CLOUD_SONGS__) return resolve({ data: { songs: window.__CLOUD_SONGS__ } });
      window.__onCloudSongs = () => resolve({ data: { songs: window.__CLOUD_SONGS__ || [] } });
    }),
    saveGiSetlist: asyncNull,
    loadPresets: () => Promise.resolve(null),
    savePreset: asyncNull,
    deletePreset: asyncNull,
    // Kits de batería personalizados desde la nube (user_settings.data.drums).
    // Espera a que cloud-boot los traiga tras el login.
    loadUserDrums: () => new Promise((resolve) => {
      if (window.__CLOUD_DRUMS_READY__) return resolve(window.__CLOUD_DRUMS__ || null);
      window.__onCloudDrums = () => resolve(window.__CLOUD_DRUMS__ || null);
    }),
    saveUserDrums: asyncNull,
    loadMidiMap: () => Promise.resolve(null),
    saveMidiMap: asyncNull,
    saveMidiMapSync: noop,
    audioLibraryGet: () => Promise.resolve(null),
    audioLibrarySet: asyncNull,
    libraryConflictsCheck: () => Promise.resolve({ count: 0, conflicts: [] }),
    // Sin sistema de archivos en el navegador.
    openAudioFile: () => Promise.resolve(null),
    openAudioFiles: () => Promise.resolve(null),
    assignAudioFile: () => Promise.resolve(null),
    readAudioFile: () => Promise.resolve(null),
    getAbsolutePath: (p) => Promise.resolve(p),
    companionStatus: () => Promise.resolve({ running: false }),
    onUpdateReady: noop, onUpdateProgress: noop, onUpdateError: noop,
    openExternal: (url) => { try { window.open(url, '_blank', 'noopener'); } catch (e) {} return Promise.resolve(null); },
    windowAction: noop,
  };

  window.electronAPI = new Proxy(stubs, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return asyncNull;
    },
  });

  document.documentElement.classList.add('is-web-demo', 'is-cloud');
})();
