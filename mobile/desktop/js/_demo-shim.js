// ─────────────────────────────────────────────────────────────────────────
// SHIM del DEMO WEB. Reemplaza window.electronAPI (que no existe en el
// navegador) con stubs seguros, para que el renderer real de LivePads arranque
// como demo. Debe cargarse ANTES de js/app.js (script clásico, sin defer).
//
// Estrategia: stubs específicos para los métodos que el boot consume con una
// forma concreta + un Proxy que, para cualquier otro método, devuelve una
// función no-op que resuelve a null (así `if (x)` salta y nada lanza).
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const noop = () => {};
  const asyncNull = () => Promise.resolve(null);

  // Stubs con forma específica (lo que el arranque espera).
  const stubs = {
    getAppVersion: () => Promise.resolve('demo'),
    // null → loadGiSetlistFromFile cae al fetch del catálogo demo bundleado.
    loadGiSetlist: () => Promise.resolve(null),
    saveGiSetlist: asyncNull,
    loadPresets: () => Promise.resolve(null),
    savePreset: asyncNull,
    deletePreset: asyncNull,
    loadUserDrums: () => Promise.resolve(null),
    saveUserDrums: asyncNull,
    loadMidiMap: () => Promise.resolve(null),
    saveMidiMap: asyncNull,
    saveMidiMapSync: noop,
    audioLibraryGet: () => Promise.resolve(null),
    audioLibrarySet: asyncNull,
    // Chequeo de conflictos de librería: forma segura (el código destructura {count}).
    libraryConflictsCheck: () => Promise.resolve({ count: 0, conflicts: [] }),
    // Selección de archivos: deshabilitada en el demo (no hay FS).
    openAudioFile: () => Promise.resolve(null),
    openAudioFiles: () => Promise.resolve(null),
    assignAudioFile: () => Promise.resolve(null),
    readAudioFile: () => Promise.resolve(null),
    getAbsolutePath: (p) => Promise.resolve(p),
    // Companion / actualizaciones / nube: no aplican en el demo.
    companionStatus: () => Promise.resolve({ running: false }),
    onUpdateReady: noop, onUpdateProgress: noop, onUpdateError: noop,
    // Abrir enlaces externos → nueva pestaña del navegador.
    openExternal: (url) => { try { window.open(url, '_blank', 'noopener'); } catch (e) {} return Promise.resolve(null); },
    // Controles de ventana (no hay marco en el navegador).
    windowAction: noop,
  };

  // Proxy: cualquier método no listado → función no-op que resuelve a null.
  window.electronAPI = new Proxy(stubs, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Devolvemos SIEMPRE una función para que `electronAPI.loQueSea(...)` no lance.
      return asyncNull;
    },
  });

  // Marca para que el CSS/JS pueda ajustar el chrome del demo si hace falta.
  document.documentElement.classList.add('is-web-demo');
})();
