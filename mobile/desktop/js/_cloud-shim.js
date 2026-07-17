// ─────────────────────────────────────────────────────────────────────────
// SHIM CLOUD del renderer de LivePads en el navegador (desktop).
//
// Da a electronAPI un sustituto de navegador para que el renderer REAL corra y,
// sobre todo, para que su PROPIO motor de nube (songSync / setlistSync /
// libraryLive) funcione igual que en la app de escritorio:
//   · La SESIÓN se guarda en localStorage (en vez de safeStorage de Electron).
//   · El catálogo de canciones se guarda en localStorage (caché offline); la
//     fuente de verdad es Supabase y el renderer la sincroniza solo.
//   · El login con Google usa el flujo WEB (redirect) en vez del de Electron.
// Debe cargarse ANTES de app.js.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const noop = () => {};
  const asyncNull = () => Promise.resolve(null);

  // Claves locales (compartidas con cloud-boot).
  const SESSION_KEY = 'lp-session';
  const CATALOG_KEY = 'lp-catalog';
  const DRUMS_KEY = 'lp-drums';
  const MIDI_KEY = 'lp-midimap';
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} return Promise.resolve(true); };

  const SUPABASE_URL = 'https://hmrviyzisgoovyttnsth.supabase.co';

  const stubs = {
    getAppVersion: () => Promise.resolve('cloud'),

    // ── Sesión: localStorage (el renderer la persiste/restaura por aquí) ──
    authLoadSession: () => Promise.resolve(lsGet(SESSION_KEY)),
    authSaveSession: (s) => lsSet(SESSION_KEY, s),
    authClearSession: () => { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} return Promise.resolve(true); },
    // Google en el navegador: redirige a Supabase/GoTrue. La promesa nunca
    // resuelve porque la página navega; al volver, cloud-boot lee los tokens.
    authOAuth: ({ provider }) => {
      const redirectTo = location.origin + location.pathname;
      location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider || 'google')}` +
        `&redirect_to=${encodeURIComponent(redirectTo)}`;
      return new Promise(() => {});
    },

    // ── Catálogo de canciones: caché local (la nube manda y sincroniza) ──
    loadGiSetlist: () => {
      const songs = lsGet(CATALOG_KEY);
      return Promise.resolve(Array.isArray(songs) ? { data: { songs } } : null);
    },
    saveGiSetlist: (songs) => lsSet(CATALOG_KEY, songs || []),

    loadPresets: () => Promise.resolve(null),
    savePreset: asyncNull,
    deletePreset: asyncNull,
    // Kits de batería: caché local; user_settings los sincroniza a la nube.
    loadUserDrums: () => Promise.resolve(lsGet(DRUMS_KEY)),
    saveUserDrums: (d) => lsSet(DRUMS_KEY, d),
    loadMidiMap: () => Promise.resolve(lsGet(MIDI_KEY)),
    saveMidiMap: (m) => lsSet(MIDI_KEY, m),
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
