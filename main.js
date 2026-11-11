const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, safeStorage, desktopCapturer, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const dns = require('dns');
const companionServer = require('./companion/server');
const QRCode = require('qrcode');

// Register the livepads:// scheme as privileged BEFORE app is ready.
// This lets the renderer fetch userData assets safely with webSecurity enabled.
protocol.registerSchemesAsPrivileged([
  { scheme: 'livepads', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

// Bypasses Cloudflare WARP & local proxy DNS SRV query blocks on Windows
try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (e) {
  console.warn("Could not set DNS servers:", e.message);
}

let mainWindow;

/* ── Deep-link (livepads://join?token=…) + instancia única ─────────────
 * Un enlace de invitación abre/enfoca LA app y la une a la librería. Requiere
 * instancia única: si ya hay una abierta, la 2da (la que lanza el SO al hacer
 * clic en el enlace) le pasa su URL y se cierra. */
let pendingDeepLink = null;   // token a procesar cuando el renderer esté listo

// Parsea un enlace livepads://join?token=XXXX y lo encola/envía al renderer.
function handleDeepLink(url) {
  try {
    const u = new URL(url);
    const isJoin = u.hostname === 'join' || u.pathname.replace(/\//g, '') === 'join';
    if (!isJoin) return;
    const token = u.searchParams.get('token');
    if (!token) return;
    pendingDeepLink = token;
    sendDeepLinkToRenderer();
  } catch (_) { /* URL inválida: se ignora */ }
}
// Envía el token pendiente al renderer si la ventana ya cargó (si no, lo hará
// el did-finish-load de createWindow).
function sendDeepLinkToRenderer() {
  if (!pendingDeepLink) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('deep-link-join', pendingDeepLink);
      pendingDeepLink = null;
    } catch (_) {}
  }
}

// App de directo: Chromium NO debe frenar la ventana cuando queda tapada, minimizada o
// en segundo plano (sus temporizadores bajaban a uno por segundo: el metrónomo y la
// interfaz se entrecortaban si alguien abría otra ventana encima en pleno servicio).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Windows/Linux: el deep-link de la 2da instancia llega en su argv.
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      try { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } catch (_) {}
    }
    const url = argv.find(a => typeof a === 'string' && a.startsWith('livepads://join'));
    if (url) handleDeepLink(url);
  });
  // macOS: los deep-links llegan por este evento.
  app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLink(url); });
}

/* ── Portable Defaults Sync & Path-Rewriting Architecture ── */

// Resolve the bundled defaults folder. In dev it sits next to main.js; when
// packaged (asar enabled) it lives outside the archive under resourcesPath.
function getDefaultsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'defaults')
    : path.join(__dirname, 'defaults');
}

// Copy everything from packaged defaults folder to userData on first boot
function initializeUserData() {
  const userDataPath = app.getPath('userData');
  const defaultsPath = getDefaultsPath();

  // Only walk/copy the defaults tree on first install or after a version
  // bump — a marker file lets every normal boot skip the recursive scan
  // (which previously ran synchronously on every launch).
  const marker = path.join(userDataPath, '.defaults-version');
  let upToDate = false;
  try { upToDate = fs.existsSync(marker) && fs.readFileSync(marker, 'utf-8') === app.getVersion(); } catch (e) {}

  if (!upToDate && fs.existsSync(defaultsPath)) {
    const copyRecursive = (src, dest) => {
      if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach((child) => {
          copyRecursive(path.join(src, child), path.join(dest, child));
        });
      } else {
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    };
    copyRecursive(defaultsPath, userDataPath);
    try { fs.writeFileSync(marker, app.getVersion(), 'utf-8'); } catch (e) {}
  }

}

// Escritura atómica: escribe a un .tmp y renombra sobre el destino. Evita que
// un corte (cierre/crash) o que OneDrive lea a mitad de la escritura dejen el
// JSON truncado/corrupto — crítico ahora que el documento de la librería vive
// en una carpeta sincronizada. El rename es atómico en el mismo volumen.
function writeFileAtomic(filePath, contentString) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.livepads-tmp';
  fs.writeFileSync(tmp, contentString, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// Guarda en userData (la copia viva). NOTA: antes también espejaba a defaults/
// en dev, pero eso ensuciaba git en cada sesión (defaults es solo la SEMILLA de
// primer arranque, no un destino de escritura). Para actualizar la semilla a
// propósito se editan los archivos de defaults/ directamente.
function saveToBoth(relativeSubPath, contentString) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  // Escritura atómica (tmp+rename): un corte a mitad no deja el JSON de
  // presets/mapeos/kits truncado. Misma protección que ya tiene la BD.
  writeFileAtomic(userPath, contentString);
}

// ── Biblioteca de audios — carpeta configurable por máquina ────────
// Por defecto los audios (Sequences, Original Tracks) viven dentro de
// userData. Si el usuario configura una carpeta custom (típicamente una
// ruta dentro de OneDrive/Dropbox/etc.), los Sequences y Original Tracks
// pasan a vivir ahí — así puede sincronizar entre sus máquinas usando
// el servicio de sync de archivos que prefiera, sin tener que subir los
// audios a Supabase. La config se guarda en userData (NO en la carpeta
// custom — debe poder bootstrapear sin ella).
//
// Lo que SÍ se redirige a la carpeta custom: Sequences/, Original Tracks/.
// Lo que NO: UserDrums/ (samples del kit, app-data, no librería de usuario).
const AUDIO_LIBRARY_CFG_FILE = 'audio-library.json';
// Loops/ = caché local de la biblioteca de stems oficial (Loops/<pack>/<archivo>),
// para que lo ya usado en el editor siga sonando sin internet.
const AUDIO_LIBRARY_SUBFOLDERS = ['Sequences', 'Original Tracks', 'Covers', 'Stems', 'Loops'];

function readAudioLibraryConfig() {
  try {
    const file = path.join(app.getPath('userData'), AUDIO_LIBRARY_CFG_FILE);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.path === 'string' && data.path.trim()) return data.path;
    return null;
  } catch (_) { return null; }
}
function writeAudioLibraryConfig(p) {
  const file = path.join(app.getPath('userData'), AUDIO_LIBRARY_CFG_FILE);
  if (!p) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ path: p }, null, 2));
}
// ¿La carpeta custom configurada está realmente disponible (existe y es un
// directorio)? En la 2da máquina la ruta puede no existir todavía: OneDrive aún
// no montó la carpeta, distinta letra de unidad, o nunca se configuró ahí. En
// ese caso NO debemos escribir/leer en una ruta fantasma (los audios parecerían
// "perdidos"): caemos a userData y avisamos en la UI.
function isAudioLibraryAvailable() {
  const custom = readAudioLibraryConfig();
  if (!custom) return true; // sin custom => se usa userData, siempre disponible
  try {
    return fs.statSync(custom).isDirectory();
  } catch (_) {
    return false;
  }
}
function getAudioLibraryRoot() {
  const custom = readAudioLibraryConfig();
  if (custom && isAudioLibraryAvailable()) return custom;
  return app.getPath('userData');
}

// El "documento" de la librería (canciones + sus referencias de audio) vive
// JUNTO a los audios en la carpeta custom (OneDrive) cuando está configurada y
// disponible, para que TODO —archivos y referencias— sincronice en una sola
// carpeta entre máquinas. Sin carpeta custom (o no disponible), sigue en
// userData: comportamiento previo, retrocompatible.
const LIBRARY_DB_FILE = 'canciones_app.json';
// La BD vive en una subcarpeta "Datos/" dentro de la carpeta de la librería,
// para no dejar el JSON suelto junto a las carpetas de audio (orden).
const LIBRARY_DB_SUBDIR = 'Datos';
function getUserDataDbPath() {
  return path.join(app.getPath('userData'), LIBRARY_DB_FILE);
}
function getLibraryDataDir() {
  return path.join(getAudioLibraryRoot(), LIBRARY_DB_SUBDIR);
}
function getLibraryDbPath() {
  return path.join(getLibraryDataDir(), LIBRARY_DB_FILE);
}
// Ubicación previa (suelta en la raíz de la carpeta custom), para migrar la BD
// de quienes ya la tenían ahí antes de mover todo a "Datos/".
function getLegacyRootDbPath() {
  return path.join(getAudioLibraryRoot(), LIBRARY_DB_FILE);
}

// Detecta "copias en conflicto" que OneDrive crea cuando dos máquinas editan la
// BD a la vez estando offline. Sus nombres varían:
//   canciones_app-DESKTOP-ABC.json
//   canciones_app (PC's conflicted copy 2024-01-15).json
//   canciones_app-Copia.json
// Patrón: empieza por "canciones_app", termina en ".json", pero NO es el
// archivo principal. Viven junto a la BD (subcarpeta Datos/).
function listDbConflicts() {
  const dir = getLibraryDataDir();
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return []; }
  return files.filter(f =>
    /^canciones_app.+\.json$/i.test(f) &&
    f !== LIBRARY_DB_FILE &&
    !f.endsWith('.livepads-tmp')
  );
}
// Indica si una ruta relativa (ej. "Sequences/foo.mp3") cae en una
// subcarpeta que debe servirse desde la carpeta custom (si está configurada)
// o desde userData (si no).
function isAudioLibraryRelPath(rel) {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return AUDIO_LIBRARY_SUBFOLDERS.some(sub => norm === sub || norm.startsWith(sub + '/'));
}

// Defensa contra path traversal: une `rel` a `root` y verifica que el resultado
// NO escape de `root` (p.ej. una URL livepads://app/../../.. fabricada, o un
// audio.path malicioso en una librería importada/sincronizada). Devuelve la ruta
// absoluta contenida, o null si se sale. Las rutas legítimas (Sequences/…,
// Original Tracks/…, Datos/…) no llevan ".." y pasan sin problema.
function containInRoot(root, rel) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel);
  if (target === resolvedRoot || target.startsWith(resolvedRoot + path.sep)) return target;
  return null;
}

// Allowlist para read-audio-file en sus ramas file:// / ruta absoluta: el
// archivo debe vivir dentro de una raíz conocida de la app (userData, la carpeta
// de la librería, el dir de la app o la semilla). Evita que una ruta absoluta
// fabricada lea archivos arbitrarios del sistema. (La rama livepads:// ya queda
// contenida por containInRoot.)
function isWithinAllowedRoots(filePath) {
  const resolved = path.resolve(filePath);
  const roots = [app.getPath('userData'), getAudioLibraryRoot(), __dirname, getDefaultsPath()];
  return roots.some(r => {
    const rr = path.resolve(r);
    return resolved === rr || resolved.startsWith(rr + path.sep);
  });
}

function deleteFromBoth(relativeSubPath) {
  // Solo userData (la copia viva). Ya no se toca defaults/ en dev: es la semilla.
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  if (fs.existsSync(userPath)) {
    try { fs.unlinkSync(userPath); } catch(e){}
  }
}

function copyToBoth(sourcePath, relativeSubPath) {
  // Si la ruta cae en Sequences/ o Original Tracks/ y hay biblioteca
  // de audios configurada, escribimos ahí. Si no, fallback a userData.
  const root = isAudioLibraryRelPath(relativeSubPath) ? getAudioLibraryRoot() : app.getPath('userData');
  const userPath = path.join(root, relativeSubPath);

  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  if (sourcePath !== userPath) {
    try { fs.copyFileSync(sourcePath, userPath); } catch(e){ console.error("Error copying to userPath:", e); }
  }
  // Ya no se espeja a defaults/ en dev: eso metía audios personales en la semilla
  // y ensuciaba git. defaults/ es solo la semilla de primer arranque.
}

// Rewrite persisted asset paths into the privileged livepads:// scheme so the
// renderer can fetch them with webSecurity enabled. The protocol handler maps
// livepads://app/<relative> -> <userData>/<relative> at request time, so URLs
// stay portable across machines.
function rewritePaths(obj) {
  if (!obj) return obj;

  const toLivepadsUrl = (relPath) => {
    const cleaned = relPath.replace(/^\/+/, '');
    const encoded = cleaned.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
    return `livepads://app/${encoded}`;
  };

  const processValue = (val) => {
    if (typeof val !== 'string') return val;

    if (val.startsWith('livepads://')) return val;

    // Sentinel form 'file:///livepads/<rel>' -> livepads://app/<rel>
    if (val.includes('/livepads/')) {
      const parts = val.split('/livepads/');
      if (parts.length > 1) return toLivepadsUrl(parts[1]);
    }

    // Legacy migration: absolute file:/// paths referencing known userData
    // subfolders. Detect the subfolder and rebase as a livepads:// URL.
    if (val.startsWith('file:///')) {
      const normalizedVal = val.replace(/\\/g, '/');
      const knownSubs = ['UserDrums/', 'Sequences/', 'Original%20Tracks/', 'Original Tracks/', 'Stems/'];
      for (const sub of knownSubs) {
        const idx = normalizedVal.indexOf('/' + sub);
        if (idx !== -1) return toLivepadsUrl(normalizedVal.slice(idx + 1));
      }
    }

    return val;
  };

  const traverse = (item) => {
    if (Array.isArray(item)) {
      return item.map(traverse);
    } else if (item && typeof item === 'object') {
      const newObj = {};
      for (const k in item) {
        newObj[k] = traverse(item[k]);
      }
      return newObj;
    } else {
      return processValue(item);
    }
  };

  return traverse(obj);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    backgroundColor: '#07070d',
    icon: path.join(__dirname, 'src/assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // userData assets (audio samples, sequences) are served via the
      // privileged livepads:// protocol — see registerLivepadsProtocol().
      webSecurity: true,
      backgroundThrottling: false,   // ver los interruptores de arriba (app de directo)
      // Herramientas de desarrollador solo en desarrollo (`npm run dev`): en la
      // app instalada no se pueden abrir (protege los planes y la sesión).
      devTools: !app.isPackaged,
    },
  });
  // Arrancar maximizada (pantalla completa con la barra de título custom
  // visible) — la cabina aprovecha todo el monitor por defecto.
  mainWindow.maximize();
  // Clear Chromium's HTTP cache on every boot so a freshly-installed build
  // never serves stale CSS/HTML/JS that the previous version compiled into
  // `%APPDATA%\LivePads\Cache\`. Without this, NSIS upgrades can render the
  // old UI even after the .exe is replaced — the renderer's preload hits
  // the cache before loading from disk.
  //
  // Cost: 5–20 ms per launch (cache is small for a local-file Electron app).
  // The async call doesn't block window creation; loadFile() runs after,
  // and the fresh fetch lands well within the first paint.
  watchWindowHealth(mainWindow);
  mainWindow.webContents.session.clearCache()
    .then(() => mainWindow.loadFile('src/index.html'))
    .catch((err) => {
      console.warn('Cache clear failed, loading anyway:', err);
      mainWindow.loadFile('src/index.html');
    });

  // CSP como cabecera de respuesta (además del <meta> de index.html): con
  // contextIsolation el aviso de seguridad de Electron solo se apaga por esta
  // vía, y la cabecera también cubre a los mundos aislados (preload).
  const CSP = [
    "default-src 'self' livepads:",
    // blob: → AudioWorklets (SoundTouch) y workers que se crean desde código propio.
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: livepads: https:",
    "media-src 'self' data: blob: livepads: https:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: livepads: https: wss:",
    "worker-src 'self' blob:",
    // Solo el reproductor oficial de YouTube (vía la página player.html de GI) para los acordes de videos.
    "frame-src https://gi-setlist.vercel.app https://www.youtube.com https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return callback({});
    // Solo nuestras páginas locales: una URL externa (OAuth, ayuda…) trae su
    // propia política y no debe heredar la nuestra.
    if (!/^(file|livepads):/i.test(details.url || '')) return callback({});
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });

  // Permisos permitidos: MIDI (controladores) y 'media' (micrófono, para el
  // Afinador). Todo lo demás se niega. El acceso real al micro lo sigue
  // gobernando el SO (privacidad de Windows); aquí solo no lo bloqueamos.
  const ALLOWED = new Set(['midi', 'midiSysex', 'media', 'audioCapture', 'display-capture', 'speaker-selection']);
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return ALLOWED.has(permission);
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    return callback(ALLOWED.has(permission));
  });

  // El reproductor de YouTube trata como robot al navegador que se anuncia como «Electron»: LivePads se presenta
  // como el Chrome que realmente lleva dentro (cabecera y navigator.userAgent). Nada en la app depende de esa marca.
  const plainUA = mainWindow.webContents.session.getUserAgent().replace(/\s*(Electron|LivePads|livepads)\/\S+/g, '');
  mainWindow.webContents.session.setUserAgent(plainUA);

  // «Detectar acordes» de un video de YouTube: escucha el SONIDO DEL PC (loopback de Windows) mientras el
  // reproductor oficial suena, sin micrófono. getDisplayMedia exige una fuente de video: se entrega la
  // pantalla y el renderer la apaga al instante (solo usa el audio).
  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => (sources.length ? callback({ video: sources[0], audio: 'loopback' }) : callback({})))
      .catch(() => callback({}));
  });

  // Cuando el renderer termina de cargar, entrega cualquier deep-link pendiente
  // (arranque en frío por enlace de invitación).
  mainWindow.webContents.on('did-finish-load', () => sendDeepLinkToRenderer());
}

/* ── IPC Handlers ──────────────────────────────────── */

// Reject anything that could escape userData (path separators, traversal,
// null bytes, control chars). Returns a safe filename-only string.
function safeId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
  if (/[\/\\\0\x00-\x1f]/.test(id) || id === '.' || id === '..') return null;
  return id;
}

// Parse a JSON file, returning `fallback` (and logging) instead of throwing
// on a missing/corrupt file — so one bad file never hangs an IPC handler.
function readJsonSafe(fp, fallback = null) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) {
    console.warn('Bad JSON, ignoring:', fp, e.message);
    return fallback;
  }
}

// Cap any single audio-file read to avoid loading multi-GB files into memory.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500 MB

// Hash corto del CONTENIDO de un archivo (en bloques de 1 MB para no cargar
// audios grandes enteros en memoria). Se usa para nombrar los audios asignados:
// mismo contenido → mismo nombre (dedup natural entre máquinas, sin conflicto en
// OneDrive); archivos distintos con igual nombre → hashes distintos (sin
// colisión, no se pisan al sincronizar entre las 2 PCs).
function hashFileShort(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex').slice(0, 12);
}

// Construye un nombre de archivo seguro y único por contenido:
//   <nombre-saneado>__<hash12><.ext>   ej: "intro__a3f9c2d1b0e4.mp3"
function contentAddressedName(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  const stem = path.basename(sourcePath, path.extname(sourcePath))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '_')                   // solo chars seguros
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'audio';
  return `${stem}__${hashFileShort(sourcePath)}${ext}`;
}

function readAudioFileSafe(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Not a file: ' + filePath);
  if (stat.size > MAX_AUDIO_BYTES) {
    throw new Error(`Audio file too large (${Math.round(stat.size / 1024 / 1024)} MB, max ${MAX_AUDIO_BYTES / 1024 / 1024} MB).`);
  }
  return fs.readFileSync(filePath);
}

ipcMain.handle('open-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'aif', 'aiff'] }],
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  try {
    const buffer = readAudioFileSafe(filePath);
    return { name: path.basename(filePath), buffer: buffer.buffer, path: filePath };
  } catch (e) {
    dialog.showErrorBox('No se pudo abrir el archivo', e.message);
    return null;
  }
});

ipcMain.handle('open-audio-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'aif', 'aiff'] }],
  });
  if (result.canceled) return null;
  const out = [];
  for (const fp of result.filePaths) {
    try {
      out.push({ name: path.basename(fp), buffer: readAudioFileSafe(fp).buffer, path: fp });
    } catch (e) {
      console.warn('Skipping file:', fp, e.message);
    }
  }
  return out;
});

ipcMain.handle('save-preset', async (_e, data) => {
  const id = safeId(data && data.id);
  if (!id) throw new Error('Preset id no válido');
  saveToBoth(path.join('presets', `${id}.json`), JSON.stringify(data, null, 2));
  return path.join(app.getPath('userData'), 'presets', `${id}.json`);
});

ipcMain.handle('load-presets', async () => {
  const dir = path.join(app.getPath('userData'), 'presets');
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJsonSafe(path.join(dir, f)))
    .filter(Boolean); // skip any corrupt preset instead of failing the whole load
  return rewritePaths(list);
});

ipcMain.handle('delete-preset', async (_e, id) => {
  const safe = safeId(id);
  if (!safe) throw new Error('Preset id no válido');
  deleteFromBoth(path.join('presets', `${safe}.json`));
});

ipcMain.handle('window-action', (_e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.close();
  else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// Builds a portable livepads:// URL from a path relative to userData.
function toLivepadsUrl(relPath) {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const encoded = cleaned.split('/').map(encodeURIComponent).join('/');
  return `livepads://app/${encoded}`;
}

// Lee un archivo y devuelve su ArrayBuffer al renderer. Necesario para que
// PitchAudio pueda decodificar audio desde URLs `livepads://` o `file://`
// (Chromium bloquea fetch cross-origin contra esquemas privilegiados).
ipcMain.handle('read-audio-file', async (_e, url) => {
  if (typeof url !== 'string') throw new Error('URL inválida');
  let filePath = null;
  if (url.startsWith('livepads://')) {
    const m = url.match(/^livepads:\/\/(?:app\/)?(.*)$/i);
    const rest = m ? decodeURIComponent(m[1] || '') : '';
    // Mismo redirect que resolveLivepadsUrl: las carpetas de audios
    // (Sequences, Original Tracks) salen de la carpeta custom si la
    // hay; el resto sigue desde userData.
    const root = isAudioLibraryRelPath(rest) ? getAudioLibraryRoot() : app.getPath('userData');
    filePath = containInRoot(root, rest);
    if (!filePath) throw new Error('Ruta fuera de la carpeta permitida');
  } else if (url.startsWith('file:///')) {
    filePath = decodeURI(url.replace(/^file:\/\/\//, '')).replace(/\//g, path.sep);
  } else if (path.isAbsolute(url)) {
    filePath = url;
  } else {
    throw new Error('Esquema no soportado: ' + url);
  }
  // file:// y rutas absolutas deben caer dentro de una raíz permitida (no leer
  // archivos del sistema). livepads:// ya quedó contenido arriba.
  if (!url.startsWith('livepads://') && !isWithinAllowedRoots(filePath)) {
    throw new Error('Acceso denegado: fuera de las carpetas permitidas');
  }
  if (!fs.existsSync(filePath)) throw new Error('Archivo no encontrado: ' + filePath);
  const buf = fs.readFileSync(filePath);
  // Devuelve un ArrayBuffer "puro" (sin compartir con otros buffers de Node)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Devuelve el código del processor del AudioWorklet de SoundTouch como texto.
// El renderer lo carga vía Blob URL en audioWorklet.addModule — robusto dentro
// de asar, donde addModule(file://) puede no resolver. fs lee de asar sin
// problema (Electron lo parcha).
ipcMain.handle('get-soundtouch-worklet', async () => {
  try {
    const p = path.join(__dirname, 'src', 'vendor', 'soundtouch-worklet', 'soundtouch-processor.js');
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.warn('No se pudo leer el worklet de SoundTouch:', e.message);
    return null;
  }
});

// ── IPCs de biblioteca de audios (carpeta custom) ──────────────────
ipcMain.handle('audio-library-get', async () => {
  const customPath = readAudioLibraryConfig();    // null si no configurada
  const available = isAudioLibraryAvailable();    // ¿la custom existe en disco?
  return {
    customPath,
    defaultPath: app.getPath('userData'),         // dónde caería sin custom
    effectivePath: getAudioLibraryRoot(),         // el que se usa HOY (cae a userData si la custom no está)
    subfolders: AUDIO_LIBRARY_SUBFOLDERS,
    // true salvo que haya una custom configurada pero su carpeta no exista.
    // La UI lo usa para avisar "configurada pero no disponible — usando interna".
    available: !customPath || available,
    customConfigured: !!customPath,
  };
});

ipcMain.handle('audio-library-pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Elige la carpeta para Sequences / Original Tracks',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('audio-library-set', async (_e, { path: newPath } = {}) => {
  // null o '' => limpiar y volver a userData.
  if (!newPath) { writeAudioLibraryConfig(null); return { ok: true, customPath: null }; }
  if (typeof newPath !== 'string') throw new Error('path inválido');
  // Verifica que la carpeta exista y sea escribible (o creable).
  try {
    fs.mkdirSync(newPath, { recursive: true });
    const probe = path.join(newPath, '.livepads-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error('No se puede escribir en esa carpeta: ' + (e.message || e));
  }
  writeAudioLibraryConfig(newPath);
  return { ok: true, customPath: newPath };
});

// Copia los audios existentes (Sequences/ y Original Tracks/) desde una
// carpeta a otra. NO borra el origen — limpieza manual cuando confirme.
ipcMain.handle('audio-library-migrate', async (_e, { fromPath, toPath } = {}) => {
  if (!fromPath || !toPath) throw new Error('faltan rutas');
  if (path.resolve(fromPath) === path.resolve(toPath)) {
    return { copied: 0, skipped: 0, message: 'origen y destino iguales' };
  }
  let copied = 0, skipped = 0;
  const failed = [];   // nombres de archivos que no se pudieron copiar
  for (const sub of AUDIO_LIBRARY_SUBFOLDERS) {
    const srcDir = path.join(fromPath, sub);
    if (!fs.existsSync(srcDir)) continue;
    const dstDir = path.join(toPath, sub);
    fs.mkdirSync(dstDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      const srcFile = path.join(srcDir, f);
      const dstFile = path.join(dstDir, f);
      try {
        const srcStat = fs.statSync(srcFile);
        if (!srcStat.isFile()) continue;
        // "Ya copiado" solo si coinciden tamaño Y mtime: el size suelto da
        // falsos positivos (dos audios distintos del mismo tamaño, o un
        // placeholder de OneDrive ya presente en destino).
        if (fs.existsSync(dstFile)) {
          const dstStat = fs.statSync(dstFile);
          if (dstStat.size === srcStat.size && Math.abs(dstStat.mtimeMs - srcStat.mtimeMs) < 2000) {
            skipped++; continue;
          }
        }
        // Copia a un .tmp y rename atómico para no dejar un destino a medias
        // si OneDrive descuelga la lectura a mitad de la copia.
        const tmpFile = dstFile + '.livepads-tmp';
        fs.copyFileSync(srcFile, tmpFile);
        fs.renameSync(tmpFile, dstFile);
        copied++;
      } catch (e) {
        failed.push(f);
        console.warn('Skip migrate', srcFile, '→', dstFile, ':', e.message);
      }
    }
  }
  // Copia también el documento de la librería (canciones + referencias de
  // audio) a la subcarpeta Datos/ del destino, para que la carpeta nueva tenga
  // la BD completa, no solo los audios. Busca el origen en Datos/ y, si no, en
  // la raíz (ubicación legacy). No pisa una BD ya existente en destino (podría
  // ser la sincronizada de la otra PC).
  try {
    const srcDb = [
      path.join(fromPath, LIBRARY_DB_SUBDIR, LIBRARY_DB_FILE),
      path.join(fromPath, LIBRARY_DB_FILE),
    ].find(p => fs.existsSync(p));
    const dstDb = path.join(toPath, LIBRARY_DB_SUBDIR, LIBRARY_DB_FILE);
    if (srcDb && !fs.existsSync(dstDb)) {
      fs.mkdirSync(path.dirname(dstDb), { recursive: true });
      const tmp = dstDb + '.livepads-tmp';
      fs.copyFileSync(srcDb, tmp);
      fs.renameSync(tmp, dstDb);
    }
  } catch (e) {
    console.warn('No se pudo migrar la BD de la librería:', e.message);
  }
  return { copied, skipped, failed };
});

ipcMain.handle('assign-audio-file', async (_e, { sourcePath, type } = {}) => {
  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('sourcePath inválido');
  }
  const folder = type === 'sequence' ? 'Sequences' : 'Original Tracks';
  // Nombre único por contenido para que subir audios desde ambas PCs no se pise
  // en OneDrive (antes usaba el basename crudo → dos "intro.mp3" distintos se
  // clobbereaban). Mismo archivo → mismo nombre → dedup natural al sincronizar.
  const fileName = contentAddressedName(sourcePath);
  const relPath = path.join(folder, fileName);

  // Si ya existe (mismo contenido = mismo hash), no recopiar — es el mismo audio.
  if (!fs.existsSync(path.join(getAudioLibraryRoot(), relPath))) {
    copyToBoth(sourcePath, relPath);
  }

  return toLivepadsUrl(relPath);
});

// ── Stems POR CANCIÓN (pistas separadas para practicar) ──────────────────
// Cada canción puede tener N pistas independientes (voz, batería, bajo, teclas…)
// en Stems/<slug-de-la-canción>/<nombre>__<hash>.<ext>. Viven en la carpeta de
// audios de la librería (se sincronizan por OneDrive y suben a R2 como los
// demás archivos) y se referencian desde song.audio.stems[] con URLs livepads://.
function songStemsFolder(songSlug) {
  const slug = String(songSlug || 'cancion')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'cancion';
  return path.join('Stems', slug);
}

// Copia un archivo de audio del disco como stem de la canción. Devuelve la URL.
ipcMain.handle('assign-song-stem', async (_e, { sourcePath, songSlug } = {}) => {
  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('sourcePath inválido');
  }
  const relPath = path.join(songStemsFolder(songSlug), contentAddressedName(sourcePath));
  if (!fs.existsSync(path.join(getAudioLibraryRoot(), relPath))) copyToBoth(sourcePath, relPath);
  return toLivepadsUrl(relPath);
});

// Guarda un stem renderizado desde el timeline (buffer MP3/WAV) como pista de la
// canción. Escritura atómica y nombre por contenido, igual que assign-stems-mix.
ipcMain.handle('save-song-stem', async (_e, { buffer, songSlug, name, ext } = {}) => {
  if (!buffer) throw new Error('Buffer vacío');
  const buf = Buffer.from(buffer);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const stem = String(name || 'pista')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'pista';
  const safeExt = /^\.?(mp3|wav|ogg|m4a|aac|flac)$/i.test(String(ext || '')) ? String(ext).replace(/^\./, '') : 'mp3';
  const relPath = path.join(songStemsFolder(songSlug), `${stem}__${hash}.${safeExt}`);
  const dest = path.join(getAudioLibraryRoot(), relPath);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.livepads-tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
  }
  return toLivepadsUrl(relPath);
});

// Elige una imagen y la copia a Covers/ (nombre por contenido), devolviendo su
// URL livepads:// para usarla de carátula manual. null si se cancela.
ipcMain.handle('assign-cover-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const src = result.filePaths[0];
  try {
    const coversDir = path.join(getAudioLibraryRoot(), 'Covers');
    fs.mkdirSync(coversDir, { recursive: true });
    const ext = (path.extname(src).toLowerCase() || '.jpg').replace('.jpeg', '.jpg');
    const coverName = `img_${hashFileShort(src)}${ext}`;
    const coverPath = path.join(coversDir, coverName);
    if (!fs.existsSync(coverPath)) {
      const tmp = coverPath + '.tmp';
      fs.copyFileSync(src, tmp);
      fs.renameSync(tmp, coverPath);
    }
    return toLivepadsUrl(path.join('Covers', coverName));
  } catch (e) {
    dialog.showErrorBox('No se pudo asignar la carátula', e.message);
    return null;
  }
});

// ── Descargar audio desde YouTube (solo con internet) ────────────────────
// Usa yt-dlp (se descarga una vez a userData/bin). Baja el mejor audio nativo
// (m4a) — sin ffmpeg, ligero — y lo guarda en "Original Tracks". Uso personal.
function downloadFileTo(url, dest) {
  return new Promise((resolve, reject) => {
    const req = net.request(url); // net sigue redirects (GitHub → CDN) por defecto
    req.on('response', (res) => {
      if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => out.write(c));
      res.on('end', () => out.end(() => resolve(dest)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

async function ensureYtDlp(force = false) {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, 'yt-dlp.exe');
  if (fs.existsSync(exe) && fs.statSync(exe).size > 1_000_000) {
    // Auto-actualiza si quedó viejo (>14 días): YouTube cambia seguido y un
    // yt-dlp añejo deja de extraer. Best-effort y atómico: baja a un .new y solo
    // reemplaza si el descargado es válido; si algo falla, sigue con el actual.
    try {
      const ageDays = (Date.now() - fs.statSync(exe).mtimeMs) / 86_400_000;
      // 3 días, no 14: yt-dlp publica arreglos de YouTube casi cada semana y un
      // binario de hace un mes falla con "Sign in to confirm you're not a bot"
      // en las subidas oficiales de sellos. "force" lo baja igualmente cuando
      // una descarga ya falló: es el último cartucho antes de rendirse.
      if (force || ageDays > 3) {
        const tmp = exe + '.new';
        await downloadFileTo(YT_DLP_URL, tmp);
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1_000_000) fs.renameSync(tmp, exe);
        else { try { fs.unlinkSync(tmp); } catch (_) {} }
      }
    } catch (_) { /* sin red o falló la actualización → usar el que hay */ }
    return exe;
  }
  await downloadFileTo(YT_DLP_URL, exe);
  if (!fs.existsSync(exe) || fs.statSync(exe).size < 1_000_000) throw new Error('No se pudo descargar el componente de YouTube.');
  return exe;
}

const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip';

// Runtime de JavaScript (Deno) para que yt-dlp resuelva los "challenges" de
// YouTube — la extracción sin JS quedó deprecada y rompe en más videos cada vez.
// Se baja UNA vez (~42 MB) a userData/bin y yt-dlp lo detecta solo al tenerlo en
// el PATH. Best-effort: si falla, devuelve null y yt-dlp sigue sin runtime.
async function ensureDeno() {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, 'deno.exe');
  if (fs.existsSync(exe) && fs.statSync(exe).size > 10_000_000) return exe;
  const zip = path.join(binDir, 'deno.zip');
  try {
    await downloadFileTo(DENO_URL, zip);
    const { execFileSync } = require('child_process');
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${binDir.replace(/'/g, "''")}' -Force`],
      { windowsHide: true, timeout: 120_000 });
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(zip); } catch (_) {}
  }
  return (fs.existsSync(exe) && fs.statSync(exe).size > 10_000_000) ? exe : null;
}

// Extrae el ID del video de cualquier forma de URL de YouTube
// (watch?v=, youtu.be/, shorts/, embed/, music.youtube).
function youtubeVideoId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?#]+)/);
    if (m) return m[2];
  } catch (_) {}
  return null;
}

// Descarga bytes de una URL http(s) usando la pila de red de Electron (respeta
// proxy/DNS configurados). Resuelve a Buffer o rechaza con el status.
function fetchUrlBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        res.on('data', () => {}); // drena
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Baja la miniatura del video y la guarda en Covers/ (nombre por hash de
// contenido, atómico, sincronizable por OneDrive). Devuelve una URL
// livepads:// o null si no se pudo. Nunca lanza.
async function fetchYoutubeCover(videoId) {
  if (!videoId) return null;
  try {
    let buf = null;
    for (const variant of ['maxresdefault', 'hqdefault', 'mqdefault']) {
      try {
        const b = await fetchUrlBuffer(`https://i.ytimg.com/vi/${videoId}/${variant}.jpg`);
        if (b && b.length > 1200) { buf = b; break; } // descarta el placeholder gris (~1KB)
      } catch (_) {}
    }
    if (!buf) return null;
    const coversDir = path.join(getAudioLibraryRoot(), 'Covers');
    fs.mkdirSync(coversDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const coverName = `yt_${videoId}__${hash}.jpg`;
    const coverPath = path.join(coversDir, coverName);
    if (!fs.existsSync(coverPath)) {
      const tmp = coverPath + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, coverPath);
    }
    return toLivepadsUrl(path.join('Covers', coverName));
  } catch (_) {
    return null;
  }
}

// Miniatura de un video de YouTube como bytes (para la portada de un pack de la
// Biblioteca de stems: el renderer la recorta en cuadrado y la sube a R2).
// Prueba de mayor a menor resolución y descarta el marcador gris de "sin imagen".
ipcMain.handle('youtube-thumbnail', async (_e, rawUrl) => {
  const id = youtubeVideoId(String(rawUrl || '').trim());
  if (!id) return { error: 'Ese enlace no parece de YouTube.' };
  for (const variant of ['maxresdefault', 'sddefault', 'hqdefault']) {
    try {
      const b = await fetchUrlBuffer(`https://i.ytimg.com/vi/${id}/${variant}.jpg`);
      if (b && b.length > 1200) return { videoId: id, bytes: new Uint8Array(b) };
    } catch (_) {}
  }
  return { error: 'No se encontró la miniatura de ese video.' };
});

// ── Cuenta de YouTube DENTRO de la app ─────────────────────────────────────
// YouTube exige sesión para muchas subidas oficiales de sellos ("Sign in to
// confirm you're not a bot"). El rescate clásico —leer las cookies de Edge o
// Chrome— NO funciona en Windows con el navegador abierto: la base de cookies
// está bloqueada y ni yt-dlp ni nadie puede copiarla (EBUSY). Pedirle al
// usuario que cierre el navegador a mitad de trabajo no es una solución.
//
// Pero LivePads ES Chromium. Así que tiene su propia sesión de YouTube: el
// usuario inicia sesión UNA vez en una ventana de la app, la sesión queda
// persistida en su propia partición, y de ahí se exportan las cookies para
// yt-dlp. Sin bloqueos, sin depender de qué navegador tenga instalado y sin
// tocar su sesión personal del navegador.
const YT_PARTITION = 'persist:youtube';

function ytCookiesFile() {
  return path.join(app.getPath('userData'), 'bin', 'yt-cookies.txt');
}

// Vuelca las cookies de la sesión de YouTube de la app a un fichero en formato
// Netscape, que es el que entiende yt-dlp (--cookies). Devuelve la ruta, o null
// si no hay sesión iniciada.
async function exportYoutubeCookies() {
  const { session } = require('electron');
  let cookies = [];
  try {
    cookies = await session.fromPartition(YT_PARTITION).cookies.get({ domain: '.youtube.com' });
  } catch (_) {
    return null;
  }
  // Sin la cookie de sesión no hay nada que aportar: mejor no escribir un
  // fichero vacío que haría creer a yt-dlp que sí hay credenciales.
  const conSesion = cookies.some((c) => /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test(c.name));
  if (!conSesion) return null;

  const lineas = ['# Netscape HTTP Cookie File', '# Generado por LivePads', ''];
  for (const c of cookies) {
    const dominio = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
    const expira = c.session ? 0 : Math.floor(c.expirationDate || 0);
    lineas.push([
      (c.httpOnly ? '#HttpOnly_' : '') + dominio,
      'TRUE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(expira),
      c.name,
      c.value,
    ].join('\t'));
  }
  const ruta = ytCookiesFile();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, lineas.join('\n'), 'utf8');
  return ruta;
}

// ¿Hay una sesión de YouTube conectada en la app?
ipcMain.handle('youtube-account-status', async () => {
  const ruta = await exportYoutubeCookies();
  return { connected: !!ruta };
});

// Abre una ventana para iniciar sesión en YouTube. Se resuelve cuando el
// usuario la cierra. La partición es propia: no toca ni ve la sesión del
// navegador del usuario.
ipcMain.handle('youtube-login', async () => {
  const win = new BrowserWindow({
    width: 520,
    height: 700,
    parent: mainWindow || undefined,
    modal: false,
    autoHideMenuBar: true,
    title: 'Iniciar sesión en YouTube',
    webPreferences: {
      partition: YT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F');
  await new Promise((resolve) => win.on('closed', resolve));
  const ruta = await exportYoutubeCookies();
  return { connected: !!ruta };
});

// Cierra la sesión de YouTube de la app (borra su partición y el fichero).
ipcMain.handle('youtube-logout', async () => {
  const { session } = require('electron');
  try { await session.fromPartition(YT_PARTITION).clearStorageData(); } catch (_) {}
  try { fs.unlinkSync(ytCookiesFile()); } catch (_) {}
  return { connected: false };
});

ipcMain.handle('download-youtube-audio', async (_e, { url, title } = {}) => {
  if (typeof url !== 'string' || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url)) {
    throw new Error('Pega un enlace de YouTube válido.');
  }
  const { spawn } = require('child_process');
  const exe = await ensureYtDlp();
  const outDir = path.join(getAudioLibraryRoot(), 'Original Tracks');
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = 'yt_' + Date.now();
  const outTmpl = path.join(outDir, prefix + '.%(ext)s');
  const baseArgs = ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-part', '-o', outTmpl, url];

  // Corre yt-dlp; si se le pasa `denoDir`, lo antepone al PATH para que yt-dlp
  // encuentre deno.exe y resuelva los challenges de YouTube.
  const runYtDlp = (extraArgs, denoDir) => new Promise((resolve, reject) => {
    const env = denoDir ? { ...process.env, PATH: denoDir + path.delimiter + (process.env.PATH || '') } : process.env;
    let stderr = '';
    const child = spawn(exe, [...baseArgs, ...extraArgs], { windowsHide: true, env });
    // Sin timeout, un yt-dlp colgado (YouTube bloqueando) quedaba como proceso
    // zombie horas. 5 min alcanza de sobra para bajar un audio.
    const killer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) {}
      reject(new Error('yt-dlp timeout (5 min) — descarga cancelada'));
    }, 5 * 60 * 1000);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(killer); reject(e); });
    child.on('close', (code) => { clearTimeout(killer); code === 0 ? resolve() : reject(new Error(stderr.slice(-400))); });
  });

  // Baja Deno solo cuando hace falta (cacheado dentro de esta invocación).
  let _denoDir;
  const getDenoDir = async () => {
    if (_denoDir !== undefined) return _denoDir;
    const d = await ensureDeno();
    _denoDir = d ? path.dirname(d) : null;
    return _denoDir;
  };

  // 1º intento: sin runtime ni cookies (la mayoría de videos funcionan así).
  let done = false, firstErr = '';
  try { await runYtDlp([]); done = true; }
  catch (e) { firstErr = (e && e.message) ? e.message : String(e); }

  // 2º: si falló por el desafío de JS / formato no disponible, baja Deno y
  // reintenta con el runtime (resuelve el "n challenge" que YouTube exige).
  if (!done && /javascript runtime|challenge|requested format is not available|nsig|po token/i.test(firstErr)) {
    const dir = await getDenoDir();
    if (dir) { try { await runYtDlp([], dir); done = true; } catch (e) { firstErr = (e && e.message) ? e.message : firstErr; } }
  }

  // ¿El fallo huele a que YouTube pide cuenta? Decide los rescates de abajo.
  const authLike = /sign in|not a bot|cookies|consent|account|HTTP Error 403|HTTP Error 429/i.test(firstErr);

  // 3º: con la sesión de YouTube de la PROPIA app. Es la vía fiable: no depende
  // de qué navegador tenga el usuario ni de que lo tenga cerrado.
  let hadOwnCookies = false;
  if (!done && authLike) {
    const cookieFile = await exportYoutubeCookies();
    if (cookieFile) {
      hadOwnCookies = true;
      const dir = await getDenoDir();
      try { await runYtDlp(['--cookies', cookieFile], dir); done = true; }
      catch (e) { firstErr = (e && e.message) ? e.message : firstErr; }
    }
  }

  // 4º: cookies del navegador del sistema. Suele fallar en Windows con el
  // navegador ABIERTO —la base de cookies queda bloqueada (EBUSY)— así que se
  // deja como reserva y se GUARDA el motivo: tragárselo hacía que el usuario
  // viera "iniciá sesión" aunque el problema fuese otro.
  let browserErr = '';
  if (!done && authLike) {
    const dir = await getDenoDir();
    for (const browser of ['edge', 'chrome', 'brave', 'firefox', 'opera', 'vivaldi', 'chromium']) {
      try { await runYtDlp(['--cookies-from-browser', browser], dir); done = true; break; }
      catch (e) { if (!/could not find/i.test(e.message || '')) browserErr = e.message || ''; }
    }
  }

  // 5º: yt-dlp añejo. Si la extracción falló por algo que huele a que YouTube
  // cambió el reproductor, se fuerza la actualización y se prueba una vez más.
  if (!done && /sign in|not a bot|nsig|player|signature|unable to extract|HTTP Error 403/i.test(firstErr)) {
    try {
      const nuevoExe = await ensureYtDlp(true);
      if (nuevoExe) {
        const dir = await getDenoDir();
        const extra = hadOwnCookies ? ['--cookies', await exportYoutubeCookies()] : [];
        try { await runYtDlp(extra, dir); done = true; }
        catch (e) { firstErr = (e && e.message) ? e.message : firstErr; }
      }
    } catch (_) { /* sin red o falló la actualización */ }
  }
  if (!done) {
    const e = (firstErr || '').toLowerCase();
    let msg;
    if (/drm/.test(e)) {
      msg = 'Este video está protegido con DRM y no se puede descargar (subida oficial del sello). Usa otro enlace de la misma canción: una versión lyric, en vivo, o una subida no oficial.';
    } else if (/not available|unavailable|is private|been removed|members[- ]only|requested format is not available/.test(e)) {
      msg = 'YouTube no permite descargar este video (DRM, privado, eliminado o restringido). Prueba con otro enlace de la misma canción.';
    } else if (authLike && !hadOwnCookies) {
      // La UI reconoce este caso por el texto (las propiedades del Error no
      // sobreviven al puente IPC) y ofrece el botón de conectar la cuenta.
      msg = 'YouTube pide una cuenta para este video (pasa con las subidas oficiales de los sellos). Conecta tu cuenta de YouTube en la app y vuelve a intentarlo: se hace una sola vez.';
    } else if (authLike) {
      msg = 'YouTube rechazó la descarga incluso con tu cuenta conectada. Suele ser un video con DRM o restringido: probá con otro enlace de la misma canción.'
          + (browserErr ? ' (detalle: ' + browserErr.slice(-140) + ')' : '');
    } else {
      msg = firstErr.slice(-300);
    }
    throw new Error('La descarga falló. ' + msg);
  }

  // Localiza el archivo producido (prefijo único) y devuelve su URL livepads://.
  const file = fs.readdirSync(outDir).find((f) => f.startsWith(prefix));
  if (!file) throw new Error('No se encontró el audio descargado.');
  // Renombra a un nombre legible + hash de contenido, igual que los audios
  // asignados: determinista entre máquinas (sin Date.now()) y sin colisión al
  // sincronizar por OneDrive.
  const downloadedPath = path.join(outDir, file);
  const ext = path.extname(file).toLowerCase();
  const stem = String(title || 'YouTube')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'YouTube';
  let finalName;
  try {
    finalName = `${stem}__${hashFileShort(downloadedPath)}${ext}`;
    const finalPath = path.join(outDir, finalName);
    if (fs.existsSync(finalPath)) {
      // Mismo contenido ya presente — descarta la copia recién bajada.
      try { fs.unlinkSync(downloadedPath); } catch (_) {}
    } else {
      fs.renameSync(downloadedPath, finalPath);
    }
  } catch (_) {
    finalName = file; // si algo falla, deja el nombre temporal del descargado
  }
  // Best-effort: baja la miniatura del video para usarla de carátula. Si falla
  // (offline, video sin thumb), cover queda null y la UI muestra el fallback.
  const cover = await fetchYoutubeCover(youtubeVideoId(url));
  return { url: toLivepadsUrl(path.join('Original Tracks', finalName)), cover };
});

// Copias de seguridad rotativas de la librería (Datos/backups): antes de pisar
// canciones_app.json se guarda la versión anterior, como mucho una cada 30 min
// —o siempre que la lista vaya a encogerse de golpe (borrado masivo, mezcla
// mala)—, y se conservan las 12 últimas. Sin nube, era imposible recuperarse
// de un guardado malo.
const GI_BACKUP_KEEP = 12;
const GI_BACKUP_EVERY_MS = 30 * 60 * 1000;
let lastGiBackupAt = 0;
function backupGiSetlist(nextCount) {
  try {
    const dbPath = getLibraryDbPath();
    if (!fs.existsSync(dbPath)) return;
    const prev = readJsonSafe(dbPath);
    const prevCount = (prev && prev.data && Array.isArray(prev.data.songs)) ? prev.data.songs.length : 0;
    if (!prevCount) return;                                   // nada que proteger
    const shrink = nextCount < prevCount * 0.5 && prevCount - nextCount >= 3;
    if (!shrink && Date.now() - lastGiBackupAt < GI_BACKUP_EVERY_MS) return;
    const dir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    fs.copyFileSync(dbPath, path.join(dir, `canciones_${stamp}_${prevCount}.json`));
    lastGiBackupAt = Date.now();
    const old = fs.readdirSync(dir).filter((f) => /^canciones_\d{8}-\d{6}_\d+\.json$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - GI_BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
    }
  } catch (err) { console.warn('Copia de seguridad de la librería falló:', err.message); }
}
function saveGiSetlist(songs) {
  const list = Array.isArray(songs) ? songs : [];
  backupGiSetlist(list.length);
  // La BD se escribe en la carpeta de la librería (OneDrive si está
  // configurada) de forma atómica. Ya NO se espeja a defaults/ en dev: eso
  // ensuciaba git y, además, defaults es solo la semilla de primer arranque.
  writeFileAtomic(getLibraryDbPath(), JSON.stringify({ data: { songs: list } }, null, 2));
}
ipcMain.handle('save-gi-setlist', async (_e, songs) => {
  saveGiSetlist(songs);
  return true;
});
// Variante síncrona para el cierre (beforeunload): garantiza que el último
// cambio llega al disco antes de que la ventana se destruya.
ipcMain.on('save-gi-setlist-sync', (e, songs) => {
  let ok = true;
  try { saveGiSetlist(songs); } catch (err) { console.warn('save-gi-setlist-sync falló:', err.message); ok = false; }
  e.returnValue = ok;
});

ipcMain.handle('load-gi-setlist', async () => {
  const dbPath = getLibraryDbPath();
  let raw = readJsonSafe(dbPath);
  // Migración de ubicaciones previas hacia "Datos/<file>":
  //   1) la raíz de la carpeta custom (donde vivía la BD antes de ordenarla)
  //   2) userData (instalación previa / OneDrive aún no sincronizó)
  if (!raw) {
    const legacyRoot = getLegacyRootDbPath();
    const fromLegacy = (legacyRoot !== dbPath) ? readJsonSafe(legacyRoot) : null;
    const fromUser   = readJsonSafe(getUserDataDbPath());
    raw = fromLegacy || fromUser;
    if (raw && !fs.existsSync(dbPath)) {
      // Siembra la BD en su nueva casa (Datos/) de forma atómica…
      try { writeFileAtomic(dbPath, JSON.stringify(raw, null, 2)); } catch (_) {}
      // …y si vino del archivo suelto en la raíz custom, lo quita (orden).
      if (fromLegacy && legacyRoot !== getUserDataDbPath() && fs.existsSync(dbPath)) {
        try { fs.unlinkSync(legacyRoot); } catch (_) {}
      }
    }
  }
  return raw ? rewritePaths(raw) : null;
});

// ¿Hay copias en conflicto de OneDrive junto a la BD? La UI lo consulta al
// cargar la librería para ofrecer fusionarlas.
ipcMain.handle('library-conflicts-check', async () => {
  const conflicts = listDbConflicts();
  return { count: conflicts.length, conflicts };
});

// Fusiona las copias en conflicto dentro de la BD principal SIN perder datos:
//  · canciones que solo están en una copia → se añaden
//  · canciones que están en ambas (mismo id) → se rellenan los slots de audio
//    faltantes desde la copia (no se pisa lo que ya tiene la principal)
// Las copias originales NO se borran: se mueven a "_conflictos_resueltos/".
ipcMain.handle('library-conflicts-resolve', async () => {
  const dir = getLibraryDataDir();
  const conflicts = listDbConflicts();
  if (!conflicts.length) return { resolved: 0, addedSongs: 0, filledSlots: 0 };

  const mainData = readJsonSafe(getLibraryDbPath()) || { data: { songs: [] } };
  const primary = (mainData.data && Array.isArray(mainData.data.songs)) ? mainData.data.songs : [];
  const byId = new Map(primary.filter(s => s && s.id).map(s => [s.id, s]));

  let addedSongs = 0, filledSlots = 0;
  for (const cf of conflicts) {
    const cdata = readJsonSafe(path.join(dir, cf));
    const songs = (cdata && cdata.data && Array.isArray(cdata.data.songs)) ? cdata.data.songs : [];
    for (const s of songs) {
      if (!s || !s.id) continue;
      const existing = byId.get(s.id);
      if (!existing) { primary.push(s); byId.set(s.id, s); addedSongs++; continue; }
      const ea = existing.audio || (existing.audio = {});
      const sa = s.audio || {};
      for (const slot of ['sequence', 'original']) {
        if (!ea[slot] && sa[slot]) { ea[slot] = sa[slot]; filledSlots++; }
      }
    }
  }

  // Persiste la BD fusionada de forma atómica ANTES de mover las copias.
  writeFileAtomic(getLibraryDbPath(), JSON.stringify({ data: { songs: primary } }, null, 2));

  // Aparta las copias resueltas (no las borra — red de seguridad).
  const backupDir = path.join(dir, '_conflictos_resueltos');
  try { fs.mkdirSync(backupDir, { recursive: true }); } catch (_) {}
  for (const cf of conflicts) {
    try { fs.renameSync(path.join(dir, cf), path.join(backupDir, cf)); } catch (_) {}
  }

  return { resolved: conflicts.length, addedSongs, filledSlots, songs: primary.length };
});

// ── Orphan linker / auditoría de audios ─────────────────────────────────────
// Reconcilia la BD (qué canción usa qué audio) con los archivos reales en
// Sequences/ + Original Tracks/. Detecta: referencias rotas (canción → archivo
// inexistente), archivos huérfanos (sin canción) y placeholders de OneDrive
// (referenciados pero aún no descargados a esta máquina).
const SLOT_FOLDER = { sequence: 'Sequences', original: 'Original Tracks' };
function refFileName(url) {
  if (typeof url !== 'string' || !url) return null;
  const seg = url.split('/').pop() || '';
  try { return decodeURIComponent(seg); } catch (_) { return seg; }
}
function normTitle(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
// Stem normalizado (nombre sin __hash ni extensión) de un archivo.
function fileStem(file) {
  const noHash = file.replace(/__[a-f0-9]{8,}(\.[^.]+)$/i, '$1');
  return normTitle(noHash.replace(/\.[^.]+$/, ''));
}
function listFolderFiles(root, folder) {
  const dir = path.join(root, folder);
  try {
    return fs.readdirSync(dir).filter(f => {
      if (f.endsWith('.livepads-tmp')) return false;
      try { return fs.statSync(path.join(dir, f)).isFile(); } catch (_) { return false; }
    });
  } catch (_) { return []; }
}
// Nombres "offline" (placeholders de OneDrive sin descargar) en una carpeta.
// Best-effort vía PowerShell; [] si falla o no es Windows.
function listOfflineFiles(root, folder) {
  const dir = path.join(root, folder);
  if (process.platform !== 'win32' || !fs.existsSync(dir)) return [];
  try {
    const { execFileSync } = require('child_process');
    const ps = `Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -File | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::Offline } | ForEach-Object { $_.Name }`;
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, encoding: 'utf8', windowsHide: true });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (_) { return []; }
}

function auditLibraryAudio() {
  const root = getAudioLibraryRoot();
  const db = readJsonSafe(getLibraryDbPath()) || { data: { songs: [] } };
  const songs = (db.data && Array.isArray(db.data.songs)) ? db.data.songs : [];
  const result = { brokenRefs: [], orphanFiles: [], offline: [], songCount: songs.length };

  for (const slot of Object.keys(SLOT_FOLDER)) {
    const folder = SLOT_FOLDER[slot];
    const onDisk = new Set(listFolderFiles(root, folder));
    const referenced = new Set();
    for (const s of songs) {
      const fn = refFileName(s.audio && s.audio[slot]);
      if (!fn) continue;
      referenced.add(fn);
      if (!onDisk.has(fn)) result.brokenRefs.push({ id: s.id, title: s.title || 'Sin título', slot, file: fn });
    }
    for (const f of onDisk) {
      if (!referenced.has(f)) result.orphanFiles.push({ slot, file: f });
    }
    const offline = new Set(listOfflineFiles(root, folder));
    for (const f of referenced) {
      if (offline.has(f)) result.offline.push({ slot, file: f });
    }
  }
  return result;
}

ipcMain.handle('library-audio-audit', async () => auditLibraryAudio());

// ─────────────────────────────────────────────────────────────────────────
// Biblioteca de archivos en la NUBE (Cloudflare R2)
//
// El renderer pide a la Edge Function `r2-sign` una URL prefirmada y nos la
// pasa aquí: la transferencia de bytes ocurre en el proceso MAIN (Node), no en
// el renderer. Así evitamos CORS, no cargamos archivos de 100 MB en memoria del
// renderer, y podemos escribir a disco de forma atómica.
//
// `relPath` es la ruta relativa dentro de la biblioteca de audio, la misma que
// viaja en las canciones ("Sequences/x.mp3", "Covers/y.jpg").
// ─────────────────────────────────────────────────────────────────────────

// Convierte una ruta relativa de la biblioteca a su ruta absoluta real,
// respetando la carpeta custom (Sequences/Original Tracks/Covers) y userData.
function libraryRelToAbs(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;
  // Kits de batería personalizados (samples propios): viven en userData/UserDrums.
  // Se suben a R2 para que la app web (movil.livepads.online) los reproduzca.
  if (rel === 'UserDrums' || rel.startsWith('UserDrums/')) {
    return path.join(app.getPath('userData'), rel);
  }
  if (!isAudioLibraryRelPath(rel)) return null; // solo las carpetas de la biblioteca
  return path.join(getAudioLibraryRoot(), rel);
}

// ¿Qué archivos de la biblioteca existen ya en disco? Devuelve, para las rutas
// pedidas, cuáles faltan y cuáles están (con su tamaño) — con esto el renderer
// decide qué subir y qué bajar sin leer bytes.
ipcMain.handle('library-files-stat', async (_e, relPaths) => {
  const list = Array.isArray(relPaths) ? relPaths : [];
  const present = [];
  const missing = [];
  for (const rel of list) {
    const abs = libraryRelToAbs(rel);
    if (!abs) continue;
    try {
      const st = fs.statSync(abs);
      if (st.isFile() && st.size > 0) {
        present.push({ path: rel, size: st.size });
        continue;
      }
    } catch (_) { /* no existe */ }
    missing.push(rel);
  }
  return { present, missing };
});

// Abre en el explorador la carpeta de la biblioteca (p. ej. "Stems/<canción>").
// Solo rutas dentro de las subcarpetas de la biblioteca (libraryRelToAbs valida).
ipcMain.handle('open-library-folder', async (_e, relDir) => {
  const rel = String(relDir || 'Stems').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const abs = libraryRelToAbs(rel);
  if (!abs) throw new Error('Carpeta no permitida');
  fs.mkdirSync(abs, { recursive: true });
  const err = await shell.openPath(abs);
  if (err) throw new Error(err);
  return { path: abs };
});

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.webm': 'audio/webm', '.opus': 'audio/opus',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

// Sube un archivo local a R2 con la URL prefirmada (PUT). Devuelve su tamaño.
ipcMain.handle('r2-upload-file', async (_e, { url, relPath }) => {
  const abs = libraryRelToAbs(relPath);
  if (!abs) throw new Error('Ruta no permitida: ' + relPath);
  const st = fs.statSync(abs);
  const body = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(st.size) },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`R2 rechazó la subida (${res.status}) ${t.slice(0, 120)}`);
  }
  return { size: st.size, contentType };
});

// Baja un archivo de R2 (GET prefirmado) y lo escribe en la biblioteca local.
// Escribe a un temporal y renombra: si la app muere a medias no queda un audio
// corrupto que luego "existe" pero no suena.
ipcMain.handle('r2-download-file', async (_e, { url, relPath }) => {
  const abs = libraryRelToAbs(relPath);
  if (!abs) throw new Error('Ruta no permitida: ' + relPath);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`R2 rechazó la descarga (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.livepads-tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
  return { size: buf.length };
});

// Sube bytes (no un archivo de la biblioteca) con una URL prefirmada de R2.
// Lo usa el panel de administración de la biblioteca de stems: audio, escucha
// previa y portada se generan en el renderer. Va por aquí porque desde el
// renderer el PUT a R2 lo bloquearía CORS. Solo acepta URLs de R2 por HTTPS.
ipcMain.handle('r2-put-bytes', async (_e, { url, bytes, contentType }) => {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error('URL inválida'); }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('Destino no permitido');
  }
  const body = Buffer.from(bytes);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(body.length) },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`R2 rechazó la subida (${res.status}) ${t.slice(0, 120)}`);
  }
  return { size: body.length };
});

// Repara: (1) vincula huérfanos a canciones cuyo título coincide con el nombre
// del archivo (si el slot está vacío/roto); (2) limpia las referencias rotas
// que queden. Escribe la BD de forma atómica. Devuelve { linked, cleared }.
ipcMain.handle('library-audio-repair', async () => {
  const root = getAudioLibraryRoot();
  const db = readJsonSafe(getLibraryDbPath()) || { data: { songs: [] } };
  const songs = (db.data && Array.isArray(db.data.songs)) ? db.data.songs : [];
  let linked = 0, cleared = 0;

  for (const slot of Object.keys(SLOT_FOLDER)) {
    const folder = SLOT_FOLDER[slot];
    const onDisk = new Set(listFolderFiles(root, folder));
    const referenced = new Set(songs.map(s => refFileName(s.audio && s.audio[slot])).filter(Boolean));

    for (const f of onDisk) {
      if (referenced.has(f)) continue;            // ya referenciado, no es huérfano
      const stem = fileStem(f);
      if (!stem) continue;
      const match = songs.find(s => {
        if (normTitle(s.title) !== stem) return false;
        const cur = refFileName(s.audio && s.audio[slot]);
        return !cur || !onDisk.has(cur);          // slot vacío o roto
      });
      if (match) {
        if (!match.audio) match.audio = {};
        match.audio[slot] = toLivepadsUrl(path.join(folder, f));
        referenced.add(f);
        linked++;
      }
    }
    for (const s of songs) {
      const cur = refFileName(s.audio && s.audio[slot]);
      if (cur && !onDisk.has(cur)) { s.audio[slot] = null; cleared++; }
    }
  }

  writeFileAtomic(getLibraryDbPath(), JSON.stringify({ data: { songs } }, null, 2));
  return { linked, cleared };
});

ipcMain.handle('get-absolute-path', (_e, relativePath) => {
  if (typeof relativePath !== 'string') return '';

  // livepads://app/<rel> -> userData/<rel> (contenido: sin escape por '..')
  if (relativePath.startsWith('livepads://')) {
    const rest = relativePath.slice('livepads://'.length).replace(/^app\//, '');
    return containInRoot(app.getPath('userData'), decodeURIComponent(rest)) || '';
  }
  if (relativePath.includes('/livepads/')) {
    const parts = relativePath.split('/livepads/');
    return containInRoot(app.getPath('userData'), decodeURIComponent(parts[1] || '')) || '';
  }
  return containInRoot(path.join(__dirname, 'src'), relativePath) || '';
});

// Custom Drums
ipcMain.handle('assign-drum-sample', async (_e, { sourcePath, padName, kitId } = {}) => {
  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('sourcePath inválido');
  }
  if (typeof padName !== 'string' || padName.length === 0) throw new Error('padName inválido');
  // Include kitId in prefix so each kit's files are isolated — prevents cross-kit deletion
  const safeKitId = (kitId || 'kit').replace(/[^a-z0-9]/gi, '_');
  const safePadName = padName.replace(/[^a-z0-9]/gi, '_');
  const prefix = `${safeKitId}_${safePadName}_`;
  
  // Clean old files for THIS specific kit+pad combo only
  const cleanDir = (dir) => {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.startsWith(prefix)) {
          try { fs.unlinkSync(path.join(dir, f)); } catch(e){}
        }
      }
    }
  };
  cleanDir(path.join(app.getPath('userData'), 'UserDrums'));
  // (Ya no se limpia defaults/UserDrums en dev: defaults es la semilla, no un
  // destino de escritura.)

  // Generate unique filename with kit+pad prefix
  const fileName = `${prefix}${Date.now()}_${path.basename(sourcePath).replace(/[^a-z0-9.]/gi, '_')}`;
  const relPath = path.join('UserDrums', fileName);
  
  copyToBoth(sourcePath, relPath);

  return toLivepadsUrl(relPath);
});

ipcMain.handle('save-user-drums', async (_e, kitMap) => {
  saveToBoth('user_drums.json', JSON.stringify(kitMap, null, 2));
  return true;
});

ipcMain.handle('load-user-drums', async () => {
  const fp = path.join(app.getPath('userData'), 'user_drums.json');
  const raw = readJsonSafe(fp);
  return raw ? rewritePaths(raw) : null;
});

ipcMain.handle('save-midi-map', async (_e, mapData) => {
  saveToBoth('midi_map.json', JSON.stringify(mapData, null, 2));
  return true;
});

// Synchronous variant — used from the renderer's `beforeunload` so the final
// mapping state is guaranteed to hit disk before the window closes (the async
// save can be dropped if the window tears down mid-flight).
ipcMain.on('save-midi-map-sync', (e, mapData) => {
  let ok = true;
  try {
    saveToBoth('midi_map.json', JSON.stringify(mapData, null, 2));
  } catch (err) {
    // Antes se tragaba en silencio: si falla la escritura final de mapeos en el
    // beforeunload (disco lleno, permisos), el usuario perdía sus asignaciones
    // sin enterarse. Al menos dejamos rastro en el log.
    console.warn('save-midi-map-sync falló:', err.message);
    ok = false;
  }
  e.returnValue = ok;
});

ipcMain.handle('load-midi-map', async () => {
  const fp = path.join(app.getPath('userData'), 'midi_map.json');
  const raw = readJsonSafe(fp);
  return raw ? rewritePaths(raw) : null;
});

// ── Sesión de la nube (Supabase) — cifrada con safeStorage ────────────────
// El token de acceso/refresh NUNCA se guarda en texto plano: safeStorage usa
// el llavero del SO (DPAPI en Windows). Si el cifrado no está disponible (caso
// raro), no persistimos la sesión en vez de dejarla expuesta.
function authSessionPath() {
  return path.join(app.getPath('userData'), 'cloud_session.bin');
}
ipcMain.handle('auth-save-session', async (_e, sessionObj) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const enc = safeStorage.encryptString(JSON.stringify(sessionObj));
    fs.writeFileSync(authSessionPath(), enc);
    return true;
  } catch (err) { return false; }
});
ipcMain.handle('auth-load-session', async () => {
  try {
    const fp = authSessionPath();
    if (!fs.existsSync(fp) || !safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(fp);
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch (err) { return null; }
});
ipcMain.handle('auth-clear-session', async () => {
  try { const fp = authSessionPath(); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
  return true;
});

// ── Inicio de sesión con OAuth (Google) ──────────────────────────────────
// Google BLOQUEA el login dentro de ventanas embebidas (política anti-webview).
// Por eso abrimos el navegador del SISTEMA hacia /authorize de Supabase y
// recibimos la sesión de vuelta en un mini-servidor local (loopback).
// Supabase devuelve los tokens en el fragmento (#access_token=…), que el
// navegador NO manda al servidor; por eso la página de callback los lee con JS
// y los reenvía a /token.
const OAUTH_PORT = 8788; // debe figurar en Supabase → Auth → Redirect URLs como http://127.0.0.1:8788/callback
ipcMain.handle('auth-oauth', async (_e, opts) => {
  const http = require('http');
  const provider = (opts && opts.provider) || 'google';
  const supabaseUrl = opts && opts.supabaseUrl;
  if (!supabaseUrl) return { error: 'Falta supabaseUrl' };

  return new Promise((resolve) => {
    let settled = false;
    let server = null;
    const finish = (result) => {
      if (settled) return; settled = true;
      try { if (server) server.close(); } catch (_) {}
      resolve(result);
    };

    server = http.createServer((req, res) => {
      let u;
      try { u = new URL(req.url, `http://127.0.0.1:${OAUTH_PORT}`); } catch (_) { res.writeHead(400); res.end(); return; }

      if (u.pathname === '/callback') {
        // Página puente: lee el #fragmento (o ?query) y lo reenvía a /token.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LivePads · Inicio de sesión</title>
<style>
  *{box-sizing:border-box} html,body{height:100%;margin:0}
  body{display:grid;place-items:center;padding:24px;background:#08090b radial-gradient(90% 70% at 50% 0%,#1a1d14 0%,#08090b 62%);
    color:#f4f5f7;font-family:Inter,"Segoe UI",system-ui,sans-serif}
  .card{width:min(420px,100%);padding:36px 32px 30px;border-radius:20px;text-align:center;
    background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .brand{display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:800;letter-spacing:-.01em;margin-bottom:26px}
  .brand i{width:30px;height:30px;border-radius:9px;background:#c6f432;display:grid;place-items:center}
  .brand i b{display:flex;gap:2px;align-items:center}.brand i b span{width:3px;border-radius:2px;background:#0c0d08}
  .icon{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;
    background:rgba(198,244,50,.12);border:1px solid rgba(198,244,50,.35);color:#c6f432}
  .icon.err{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.4);color:#ff6b6b}
  .spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(198,244,50,.25);border-top-color:#c6f432;animation:s .8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{margin:0 0 8px;font-size:22px;font-weight:700}
  p{margin:0;color:#a3a8b1;font-size:14.5px;line-height:1.55}
  .foot{margin-top:24px;font-size:12px;color:#6f7580}
  .foot a{color:#a3a8b1}
</style></head>
<body><main class="card">
  <div class="brand"><i><b><span style="height:8px"></span><span style="height:14px"></span><span style="height:10px"></span><span style="height:16px"></span></b></i>LivePads</div>
  <div class="icon" id="ic"><div class="spin"></div></div>
  <h1 id="t">Iniciando sesión…</h1>
  <p id="m">Un momento, estamos conectando tu cuenta con la app.</p>
  <div class="foot"><a href="https://livepads.online" target="_blank" rel="noopener">livepads.online</a></div>
</main>
<script>
  var data = location.hash ? location.hash.slice(1) : location.search.slice(1);
  var ok = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var bad = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  function show(good, title, text){ var ic=document.getElementById('ic'); ic.className='icon'+(good?'':' err'); ic.innerHTML=good?ok:bad;
    document.getElementById('t').textContent=title; document.getElementById('m').textContent=text; }
  if (/error/.test(data) && !/access_token/.test(data)) {
    var q = new URLSearchParams(data);
    fetch('/token?' + data).catch(function(){});
    show(false, 'No se pudo iniciar sesión', (q.get('error_description') || 'Vuelve a LivePads e inténtalo de nuevo.').replace(/\+/g,' '));
  } else {
    fetch('/token?' + data).then(function(){
      show(true, '¡Listo! Ya entraste', 'Vuelve a LivePads: tu cuenta ya está conectada. Puedes cerrar esta pestaña.');
      setTimeout(function(){ try { window.close(); } catch(e){} }, 2500);
    }).catch(function(){ show(false, 'No se pudo completar', 'Vuelve a LivePads e inténtalo de nuevo.'); });
  }
</script>
</body></html>`);
        return;
      }

      if (u.pathname === '/token') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
        const p = u.searchParams;
        if (p.get('error') || p.get('error_description')) return finish({ error: p.get('error_description') || p.get('error') });
        const access_token = p.get('access_token');
        if (access_token) {
          // Que la app vuelva al frente sola (el usuario estaba en el navegador).
          try { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } } catch (_) {}
          return finish({ access_token, refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
        }
        return; // ?code= (PKCE) no usado en flujo implícito
      }

      res.writeHead(404); res.end();
    });

    server.on('error', (err) => finish({ error: `No se pudo abrir el puerto ${OAUTH_PORT} (${err.code}). Cierra lo que lo use e inténtalo de nuevo.` }));

    server.listen(OAUTH_PORT, '127.0.0.1', () => {
      const redirectTo = `http://127.0.0.1:${OAUTH_PORT}/callback`;
      const authorizeUrl = `${supabaseUrl}/auth/v1/authorize?provider=${encodeURIComponent(provider)}`
        + `&redirect_to=${encodeURIComponent(redirectTo)}`;
      shell.openExternal(authorizeUrl).catch((e) => finish({ error: e.message }));
    });

    // Si el usuario nunca completa, no dejamos el servidor colgado.
    setTimeout(() => finish({ error: 'Tiempo de espera agotado. Inténtalo de nuevo.' }), 300000);
  });
});

// ── Google directo (cliente OAuth de tipo "App de escritorio") ─────────────
// Antes Google volvía a <proyecto>.supabase.co, y por eso la pantalla de Google
// mostraba esa dirección y la marca no se podía verificar (supabase.co no es un
// dominio nuestro). Ahora la app habla con Google directamente: PKCE + loopback
// (http://127.0.0.1:8788/callback, permitido para clientes de escritorio),
// cambia el código por un id_token de Google y el renderer se lo da a Supabase
// (grant_type=id_token), que crea la misma sesión de siempre.
// Página de resultado servida por el loopback (sin JS: ya sabemos el resultado).
function oauthResultPage(ok, title, text) {
  const esc = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = ok
    ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LivePads · Inicio de sesión</title>
<style>
  *{box-sizing:border-box} html,body{height:100%;margin:0}
  body{display:grid;place-items:center;padding:24px;background:#08090b radial-gradient(90% 70% at 50% 0%,#1a1d14 0%,#08090b 62%);
    color:#f4f5f7;font-family:Inter,"Segoe UI",system-ui,sans-serif}
  .card{width:min(420px,100%);padding:36px 32px 30px;border-radius:20px;text-align:center;
    background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .brand{display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:800;letter-spacing:-.01em;margin-bottom:26px}
  .brand i{width:30px;height:30px;border-radius:9px;background:#c6f432;display:grid;place-items:center}
  .brand i b{display:flex;gap:2px;align-items:center}.brand i b span{width:3px;border-radius:2px;background:#0c0d08}
  .icon{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;
    background:rgba(198,244,50,.12);border:1px solid rgba(198,244,50,.35);color:#c6f432}
  .icon.err{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.4);color:#ff6b6b}
  h1{margin:0 0 8px;font-size:22px;font-weight:700}
  p{margin:0;color:#a3a8b1;font-size:14.5px;line-height:1.55}
  .foot{margin-top:24px;font-size:12px;color:#6f7580} .foot a{color:#a3a8b1}
</style></head>
<body><main class="card">
  <div class="brand"><i><b><span style="height:8px"></span><span style="height:14px"></span><span style="height:10px"></span><span style="height:16px"></span></b></i>LivePads</div>
  <div class="icon${ok ? '' : ' err'}">${icon}</div>
  <h1>${esc(title)}</h1>
  <p>${esc(text)}</p>
  <div class="foot"><a href="https://livepads.online" target="_blank" rel="noopener">livepads.online</a></div>
</main>${ok ? '<script>setTimeout(function(){try{window.close()}catch(e){}},2500)</script>' : ''}</body></html>`;
}

ipcMain.handle('auth-google-desktop', async (_e, opts) => {
  const http = require('http');
  const crypto = require('crypto');
  const clientId = opts && opts.clientId;
  const clientSecret = (opts && opts.clientSecret) || '';
  if (!clientId) return { error: 'Falta el cliente de Google.' };
  const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  // Nonce: a Google va el hash; a Supabase, el valor original (él lo hashea y compara).
  const nonce = b64url(crypto.randomBytes(16));
  const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');
  const redirectUri = `http://127.0.0.1:${OAUTH_PORT}/callback`;

  return new Promise((resolve) => {
    let settled = false;
    let server = null;
    const finish = (result) => {
      if (settled) return; settled = true;
      setTimeout(() => { try { if (server) server.close(); } catch (_) {} }, 500);
      resolve(result);
    };
    const page = (res, ok, title, text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(oauthResultPage(ok, title, text)); };

    server = http.createServer(async (req, res) => {
      let u;
      try { u = new URL(req.url, redirectUri); } catch (_) { res.writeHead(400); res.end(); return; }
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const q = u.searchParams;
      if (q.get('error')) {
        const cancelled = q.get('error') === 'access_denied';
        page(res, false, cancelled ? 'Inicio de sesión cancelado' : 'No se pudo iniciar sesión',
          cancelled ? 'Vuelve a LivePads si quieres intentarlo de nuevo.' : (q.get('error_description') || q.get('error')));
        return finish({ error: cancelled ? 'Cancelaste el inicio de sesión con Google.' : (q.get('error_description') || q.get('error')) });
      }
      if (q.get('state') !== state || !q.get('code')) {
        page(res, false, 'Enlace no válido', 'Vuelve a LivePads e inicia sesión desde ahí.');
        return;   // visita suelta: el flujo real sigue esperando
      }
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: q.get('code'), client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.id_token) throw new Error(j.error_description || j.error || `Google respondió ${r.status}`);
        page(res, true, '¡Listo! Ya entraste', 'Vuelve a LivePads: tu cuenta ya está conectada. Puedes cerrar esta pestaña.');
        try { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } } catch (_) {}
        finish({ id_token: j.id_token, nonce });
      } catch (e) {
        page(res, false, 'No se pudo completar', 'Vuelve a LivePads e inténtalo de nuevo.');
        finish({ error: e.message });
      }
    });

    server.on('error', (err) => finish({ error: `No se pudo abrir el puerto ${OAUTH_PORT} (${err.code}). Cierra lo que lo use e inténtalo de nuevo.` }));
    server.listen(OAUTH_PORT, '127.0.0.1', () => {
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256',
        state, nonce: nonceHash, prompt: 'select_account',
      }).toString();
      shell.openExternal(auth.toString()).catch((e) => finish({ error: e.message }));
    });
    setTimeout(() => finish({ error: 'Tiempo de espera agotado. Inténtalo de nuevo.' }), 300000);
  });
});

// Abrir un enlace externo (web de confirmación de correo, etc.) en el navegador.
ipcMain.handle('open-external', async (_e, url) => {
  try {
    if (typeof url === 'string' && /^(https?|mailto):/i.test(url)) { await shell.openExternal(url); return true; }
  } catch (_) {}
  return false;
});

// Export the full mapping (both Pads + Stems scopes) to a user-chosen file —
// lets the user back up or move their setup to another PC/controller.
ipcMain.handle('export-midi-map', async (_e, maps) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar mapeos MIDI',
    defaultPath: 'livepads-midi-map.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return false;
  try { fs.writeFileSync(res.filePath, JSON.stringify(maps, null, 2), 'utf-8'); return true; }
  catch (e) { dialog.showErrorBox('No se pudo exportar', e.message); return false; }
});

ipcMain.handle('import-midi-map', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar mapeos MIDI',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  try { return JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8')); }
  catch (e) { dialog.showErrorBox('No se pudo importar', e.message); return null; }
});

// ── Chord/Lyrics URL importer ────────────────────────────────
// Whitelist of public chord sites we trust to fetch from. Renderer cannot
// reach arbitrary URLs directly (webSecurity:true); this handler does the
// fetch in main with strict timeout + domain validation, then returns the
// raw HTML for the renderer to parse.
const CHORD_SOURCE_WHITELIST = new Set([
  'acordes.lacuerda.net',
  'lacuerda.net',
  'www.lacuerda.net',
  // Cifra Club: es de donde sale la mayoría del repertorio en español. Su
  // <pre> conserva la alineación de los acordes sobre la sílaba, cosa que
  // copiar y pegar desde la página renderizada destruye.
  'www.cifraclub.com.br',
  'cifraclub.com.br',
  'www.cifraclub.com',
  'cifraclub.com'
]);

ipcMain.handle('fetch-chord-url', async (_e, url) => {
  if (typeof url !== 'string' || !url.trim()) throw new Error('URL vacía');
  let parsed;
  try { parsed = new URL(url.trim()); }
  catch { throw new Error('URL inválida'); }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Sólo http/https');
  }
  if (!CHORD_SOURCE_WHITELIST.has(parsed.hostname)) {
    throw new Error(`Dominio no soportado: ${parsed.hostname}\nActualmente: ${[...CHORD_SOURCE_WHITELIST].join(', ')}`);
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'LivePads/1.0 (offline-music-app)' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      throw new Error('La página no es HTML: ' + ct);
    }
    return await resp.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout (>10s)');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
});

// ── Companion (LAN viewer) ────────────────────────────
// LAN-only HTTP+WS server (see companion/server.js). Off by default — the
// renderer toggles it explicitly. The renderer also pushes song state via
// 'companion-publish-song' whenever the active song changes.

ipcMain.handle('companion-start', async () => {
  try {
    return await companionServer.start();
  } catch (e) {
    console.error('Companion start failed:', e);
    throw e;
  }
});

ipcMain.handle('companion-stop', async () => {
  return await companionServer.stop();
});

// Add a Windows Firewall inbound-allow rule for the Companion port range so
// phones on the LAN can reach the laptop. Firewall changes need elevation, so
// we trigger a single UAC prompt via PowerShell Start-Process -Verb RunAs.
ipcMain.handle('companion-allow-firewall', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  const { spawn } = require('child_process');
  // Inner command (runs elevated): drop any old rule, then add a fresh one
  // covering the whole 3001-3010 range the server may bind to.
  const inner = 'netsh advfirewall firewall delete rule name=LivePadsCompanion 2>$null; ' +
                'netsh advfirewall firewall add rule name=LivePadsCompanion dir=in action=allow protocol=TCP localport=3001-3010';
  const psCmd = `Start-Process -Verb RunAs -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','${inner}'`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
    child.on('error', (e) => resolve({ ok: false, reason: e.message }));
    // Start-Process exits 0 once the elevated process launches; a non-zero
    // code means the user dismissed the UAC prompt.
    child.on('exit', (code) => resolve({ ok: code === 0, code }));
  });
});

// Open Windows' Mobile Hotspot settings so the laptop can become its own
// access point — the fully-offline "church mode": phones join the laptop's
// WiFi and just scan the QR. Windows doesn't expose a reliable API to toggle
// the hotspot itself, so we deep-link to the settings page.
ipcMain.handle('companion-open-hotspot', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  try {
    await shell.openExternal('ms-settings:network-mobilehotspot');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// ¿El adaptador WiFi soporta crear una red local (hosted network)? Muchos
// drivers modernos lo quitaron; lo comprobamos para avisar al usuario.
ipcMain.handle('companion-softap-supported', async () => {
  if (process.platform !== 'win32') return { supported: false };
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('netsh wlan show drivers', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ supported: false });
      const s = String(stdout);
      const supported = /Hosted network supported\s*:\s*Yes/i.test(s) || /red hospedada\s*:\s*S/i.test(s);
      resolve({ supported });
    });
  });
});

// Crea una red WiFi LOCAL en la laptop (sin internet) para el Companion:
// los teléfonos se conectan a "LivePads" y abren el QR. Requiere elevación.
const SOFTAP_SSID = 'LivePads';
const SOFTAP_KEY = 'livepads2026';
ipcMain.handle('companion-create-softap', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  const { spawn } = require('child_process');
  const inner = `netsh wlan set hostednetwork mode=allow ssid=${SOFTAP_SSID} key=${SOFTAP_KEY}; netsh wlan start hostednetwork`;
  const psCmd = `Start-Process -Verb RunAs -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','${inner}'`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
    child.on('error', (e) => resolve({ ok: false, reason: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, code, ssid: SOFTAP_SSID, key: SOFTAP_KEY }));
  });
});

ipcMain.handle('companion-stop-softap', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  const { spawn } = require('child_process');
  const psCmd = `Start-Process -Verb RunAs -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','netsh wlan stop hostednetwork'`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
    child.on('error', (e) => resolve({ ok: false, reason: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, code }));
  });
});

ipcMain.handle('companion-status', async () => {
  return companionServer.getStatus();
});

ipcMain.handle('companion-publish-song', async (_e, song) => {
  companionServer.publishSong(song);
  return true;
});

ipcMain.handle('companion-publish-playing', async (_e, playing) => {
  companionServer.publishPlaying(!!playing);
  return true;
});

// Companion prefs live in their own file. Currently a single flag, but easy to
// extend without touching schema migration logic.
function companionPrefsPath() {
  return path.join(app.getPath('userData'), 'companion_prefs.json');
}
function readCompanionPrefs() {
  try {
    const fp = companionPrefsPath();
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) || {};
  } catch (e) { return {}; }
}
function writeCompanionPrefs(prefs) {
  try { fs.writeFileSync(companionPrefsPath(), JSON.stringify(prefs, null, 2), 'utf-8'); }
  catch (e) { console.warn('Could not save companion prefs:', e.message); }
}

ipcMain.handle('companion-get-prefs', async () => readCompanionPrefs());
ipcMain.handle('companion-set-prefs', async (_e, prefs) => {
  const merged = Object.assign(readCompanionPrefs(), prefs || {});
  writeCompanionPrefs(merged);
  return merged;
});

// User override for the LAN IP — VPN tunnels (Cloudflare WARP, Tailscale,
// WireGuard) often outrank the real WiFi IP in auto-detection. The panel
// lets the user pick from the candidate list.
ipcMain.handle('companion-set-ip', async (_e, ip) => {
  companionServer.setPreferredIp(ip || null);
  return companionServer.getStatus();
});

// ── Stem editor project persistence ───────────────────────────────
// Each "current" project lives in a single folder so the user only ever
// loses work if they hit "Nuevo proyecto" deliberately. The renderer
// references stems via livepads:// URLs so playback works with
// webSecurity enabled.
function stemsRoot() {
  return path.join(app.getPath('userData'), 'StemProjects', 'current');
}
function stemsFolder() {
  return path.join(stemsRoot(), 'stems');
}
function ensureStemsDir() {
  fs.mkdirSync(stemsFolder(), { recursive: true });
}

// Escritura atómica (tmp + rename): un corte a mitad ya no deja project.json
// truncado (antes el proyecto «aparecía vacío» al reabrir).
function saveStemsCurrent(state) {
  ensureStemsDir();
  writeFileAtomic(path.join(stemsRoot(), 'project.json'), JSON.stringify(state, null, 2));
}
ipcMain.handle('stems-save-current', async (_e, state) => {
  saveStemsCurrent(state);
  return true;
});
// Variante síncrona para el cierre de la ventana (beforeunload): el guardado
// asíncrono puede perderse si la ventana se destruye a mitad.
ipcMain.on('stems-save-current-sync', (e, state) => {
  let ok = true;
  try { saveStemsCurrent(state); } catch (err) { console.warn('stems-save-current-sync falló:', err.message); ok = false; }
  e.returnValue = ok;
});

ipcMain.handle('stems-load-current', async () => {
  const fp = path.join(stemsRoot(), 'project.json');
  if (!fs.existsSync(fp)) return null;
  try {
    return rewritePaths(JSON.parse(fs.readFileSync(fp, 'utf-8')));
  } catch (e) {
    console.warn('Failed to parse stem project.json:', e.message);
    return null;
  }
});

ipcMain.handle('stems-clear-current', async () => {
  const root = stemsRoot();
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return true;
});

// ── Named project library (Save As / Open / List / Delete) ──────────
// Sits alongside StemProjects/current/. Each named project gets its own
// folder under StemProjects/<safe-name>/ with the same project.json +
// stems/ structure so loading just swaps which folder feeds the renderer.
function stemProjectsRoot() {
  return path.join(app.getPath('userData'), 'StemProjects');
}
function safeProjectName(name) {
  return String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 64);
}

ipcMain.handle('stems-list-projects', async () => {
  const root = stemProjectsRoot();
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'current')
    .map(d => {
      const projectPath = path.join(root, d.name, 'project.json');
      let projectName = d.name;
      let updatedAt = null;
      try {
        if (fs.existsSync(projectPath)) {
          const j = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
          if (j.projectName) projectName = j.projectName;
          updatedAt = fs.statSync(projectPath).mtimeMs;
        }
      } catch (e) {}
      return { slug: d.name, name: projectName, updatedAt };
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return dirs;
});

ipcMain.handle('stems-save-as', async (_e, { name } = {}) => {
  const slug = safeProjectName(name);
  if (!slug) throw new Error('Nombre vacío o inválido');
  const root = stemProjectsRoot();
  const src = path.join(root, 'current');
  const dst = path.join(root, slug);
  if (!fs.existsSync(src)) throw new Error('No hay proyecto actual para guardar');
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  // Rewrite only the per-track `path` fields from the `current` folder to the
  // new slug — structurally, so a stray substring in lyrics/names is never
  // clobbered (the old global string-replace could).
  const projectFp = path.join(dst, 'project.json');
  const j = readJsonSafe(projectFp);
  if (j) {
    remapStemProjectPaths(j, 'StemProjects/current/', `StemProjects/${slug}/`);
    j.projectName = name;
    fs.writeFileSync(projectFp, JSON.stringify(j, null, 2), 'utf-8');
  }
  return slug;
});

// Rewrite the slug segment in each track's saved-file path. Only touches
// `tracks[].path`, never the rest of the JSON.
function remapStemProjectPaths(json, fromSeg, toSeg) {
  if (json && Array.isArray(json.tracks)) {
    for (const t of json.tracks) {
      if (t && typeof t.path === 'string') t.path = t.path.split(fromSeg).join(toSeg);
    }
  }
  return json;
}

ipcMain.handle('stems-load-project', async (_e, slug) => {
  const safe = safeProjectName(slug);
  if (!safe) throw new Error('Slug inválido');
  const root = stemProjectsRoot();
  const src = path.join(root, safe);
  const dst = path.join(root, 'current');
  if (!fs.existsSync(src)) throw new Error('Proyecto no encontrado');
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  // Rewrite track paths back to `current/` (structurally).
  const projectFp = path.join(dst, 'project.json');
  const j = readJsonSafe(projectFp);
  if (j) {
    remapStemProjectPaths(j, `StemProjects/${safe}/`, 'StemProjects/current/');
    fs.writeFileSync(projectFp, JSON.stringify(j, null, 2), 'utf-8');
    return rewritePaths(j);
  }
  return null;
});

ipcMain.handle('stems-delete-project', async (_e, slug) => {
  const safe = safeProjectName(slug);
  if (!safe) throw new Error('Slug inválido');
  const target = path.join(stemProjectsRoot(), safe);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  return true;
});

ipcMain.handle('stems-save-file', async (_e, { id, name, buffer } = {}) => {
  if (!id || !buffer) throw new Error('Falta id o buffer');
  ensureStemsDir();
  // Strip the path-unsafe bits but keep the extension so decoders
  // pick the right format on rehydrate.
  const safeName = String(name || 'stem').replace(/[^a-z0-9._-]/gi, '_');
  const fileName = `${String(id).replace(/[^a-z0-9._-]/gi, '_')}_${safeName}`;
  const relPath = path.join('StemProjects', 'current', 'stems', fileName);
  const absPath = path.join(app.getPath('userData'), relPath);
  fs.writeFileSync(absPath, Buffer.from(buffer));
  return toLivepadsUrl(relPath);
});

// Guarda un ZIP (descarga completa de las pistas de una canción).
ipcMain.handle('save-zip-file', async (_e, { suggestedName, buffer } = {}) => {
  if (!buffer) throw new Error('Buffer vacío');
  const cleanName = String(suggestedName || 'pistas').replace(/[^a-z0-9._ -]/gi, '_');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar descarga completa',
    defaultPath: `${cleanName}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, Buffer.from(buffer));
  return result.filePath;
});

ipcMain.handle('stems-export-mp3', async (_e, { suggestedName, buffer } = {}) => {
  if (!buffer) throw new Error('Buffer vacío');
  const cleanName = String(suggestedName || 'mezcla').replace(/[^a-z0-9._ -]/gi, '_');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar mezcla a MP3',
    defaultPath: `${cleanName}.mp3`,
    filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, Buffer.from(buffer));
  return result.filePath;
});

// Asigna una mezcla MP3 (buffer) DIRECTO a la librería como audio de una canción
// (slot 'sequence' u 'original'), sin "Guardar como" + reimportar a mano. Nombre
// por contenido (sin colisiones), escrito en Sequences/ u Original Tracks/ de la
// carpeta de la librería (OneDrive) → sincroniza solo a la otra PC. Devuelve la
// URL livepads:// para guardarla en la canción.
ipcMain.handle('assign-stems-mix', async (_e, { buffer, type, name } = {}) => {
  if (!buffer) throw new Error('Buffer vacío');
  const folder = type === 'original' ? 'Original Tracks' : 'Sequences';
  const buf = Buffer.from(buffer);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const stem = String(name || 'mezcla')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'mezcla';
  const relPath = path.join(folder, `${stem}__${hash}.mp3`);
  const dest = path.join(getAudioLibraryRoot(), relPath);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.livepads-tmp';
    fs.writeFileSync(tmp, buf);          // escritura atómica
    fs.renameSync(tmp, dest);
  }
  return toLivepadsUrl(relPath);
});

// ── Modelos de IA: se bajan al usarlos por primera vez ───────────────────
// Antes iban dentro del instalador (~282 MB de 448): cada actualización los
// volvía a descargar aunque no se usaran. Ahora viven en userData/models, se
// bajan una sola vez cuando hacen falta (separar stems, analizar pulsos/acordes)
// y las actualizaciones pesan mucho menos. Cada archivo se verifica (tamaño y
// SHA-256) antes de darlo por bueno.
const MODEL_REL = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models';
const MODEL_OWN = 'https://github.com/josemontilladev/Live-Pads/releases/download/models-v1';
const MODEL_FILES = {
  'UVR-MDX-NET-Inst_HQ_3.onnx': { url: `${MODEL_REL}/UVR-MDX-NET-Inst_HQ_3.onnx`, size: 66759214, sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc' },
  'kuielab_a_vocals.onnx':      { url: `${MODEL_REL}/kuielab_a_vocals.onnx`,      size: 29703204, sha256: 'daba83c2ee1afee9139766ad64c9b6808d6b6f092fff04bed3338be50baac721' },
  'kuielab_a_drums.onnx':       { url: `${MODEL_REL}/kuielab_a_drums.onnx`,       size: 29703204, sha256: '40f586b7091934dd6f5563f0cba8f14bad57ce88440da1098bf388ea716c2901' },
  'kuielab_a_bass.onnx':        { url: `${MODEL_REL}/kuielab_a_bass.onnx`,        size: 29703204, sha256: '0c3e77b9963185b1ea6bb46a4b8924137d9370fc1ccdefec7b1b416ef550dcaa' },
  'kuielab_a_other.onnx':       { url: `${MODEL_REL}/kuielab_a_other.onnx`,       size: 29703204, sha256: '7b67a1dcb5f232153528c59960b4c7bf8dc736b8114de360af0e719633f53358' },
  'beat_this_final0.onnx':      { url: `${MODEL_OWN}/beat_this_final0.onnx`,      size: 82952770, sha256: '41c9d33718e005db4241ab856cf55f2b9a0a7918d54957cf2d0276ad4bc80f28' },
  'btc_chords_voca.onnx':       { url: `${MODEL_OWN}/btc_chords_voca.onnx`,       size: 13038363, sha256: 'd0738965a2cbd5c9ab88735fa74dd62a0ec534d6172a34e5447357e6e144bb7d' },
};
function userModelsDir() { return path.join(app.getPath('userData'), 'models'); }
// Carpetas donde puede haber modelos, por orden: la de desarrollo, la del usuario
// (descargados) y la del instalador (instalaciones antiguas que aún los traen).
function modelDirs() {
  const dirs = [];
  if (!app.isPackaged && process.env.LIVEPADS_MODELS_DIR) dirs.push(process.env.LIVEPADS_MODELS_DIR);
  dirs.push(userModelsDir());
  dirs.push(app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models'));
  return dirs;
}
function findModel(file) {
  for (const d of modelDirs()) {
    const fp = path.join(d, file);
    try { if (fs.statSync(fp).size > 1000000) return fp; } catch (_) {}
  }
  return null;
}
const _modelDownloads = new Map();   // file → Promise (una sola descarga por archivo)
function downloadModel(file, onProgress) {
  if (_modelDownloads.has(file)) return _modelDownloads.get(file);
  const spec = MODEL_FILES[file];
  const job = (async () => {
    if (!spec) throw new Error(`Modelo desconocido: ${file}`);
    const dir = userModelsDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, file), part = dest + '.part';
    const res = await net.fetch(spec.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        got += buf.length;
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        if (onProgress) onProgress(got, spec.size);
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (got !== spec.size || hash.digest('hex') !== spec.sha256) {
      try { fs.unlinkSync(part); } catch (_) {}
      throw new Error('La descarga llegó incompleta o dañada');
    }
    fs.renameSync(part, dest);
    appLog('warn', `modelo descargado: ${file}`);
    return dest;
  })().finally(() => _modelDownloads.delete(file));
  _modelDownloads.set(file, job);
  return job;
}
// Asegura que TODOS los archivos pedidos estén en una misma carpeta y la devuelve.
// onProgress(fracción 0..1, etiqueta) mientras descarga.
async function ensureModels(files, onProgress) {
  for (const d of modelDirs()) {
    if (files.every((f) => { try { return fs.statSync(path.join(d, f)).size > 1000000; } catch (_) { return false; } })) return d;
  }
  const dir = userModelsDir();
  const missing = files.filter((f) => { try { return fs.statSync(path.join(dir, f)).size <= 1000000; } catch (_) { return true; } });
  const total = missing.reduce((n, f) => n + ((MODEL_FILES[f] && MODEL_FILES[f].size) || 0), 0) || 1;
  const mb = Math.round(total / 1048576);
  let before = 0;
  for (const f of missing) {
    try {
      await downloadModel(f, (got) => {
        if (onProgress) onProgress((before + got) / total, `Descargando el modelo de IA (solo la primera vez) · ${Math.round(((before + got) / total) * 100)} % de ${mb} MB`);
      });
    } catch (err) {
      appLog('error', `modelo ${f}: ${(err && err.message) || err}`);
      throw new Error(`No se pudo descargar el modelo de IA (${mb} MB). Hace falta internet la primera vez que se usa; después funciona sin conexión.`);
    }
    before += (MODEL_FILES[f] && MODEL_FILES[f].size) || 0;
  }
  return dir;
}
// Modelos de análisis (pulsos, acordes): si faltan, la app usa sus detectores clásicos
// esta vez y el modelo se va bajando en segundo plano para la próxima.
function modelOrFetchLater(file) {
  const fp = findModel(file);
  if (fp) return fp;
  if (net.isOnline()) downloadModel(file).catch((err) => appLog('warn', `modelo ${file} (segundo plano): ${(err && err.message) || err}`));
  return null;
}

// ── Análisis musical en local (Beat This!: pulsos y compases) ─────────────
// Recibe audio mono a 22 050 Hz y devuelve { beats, downbeats, bpm, beatsPerBar, ep }.
// Sin el modelo (instalaciones viejas) responde { unavailable: true } y la app
// usa su detector anterior.
// Audio para análisis subido por trozos desde la interfaz (analysisAudio.js):
// token → Float32Array (mono 22 050 Hz). Se olvida a los 5 min o si hay más de 4.
const analysisAudio = new Map();
ipcMain.handle('analysis-audio-chunk', (_e, { token, offset, total, data } = {}) => {
  if (!token || !(total > 0) || !data) return false;
  let e = analysisAudio.get(token);
  if (!e) {
    e = { buf: new Float32Array(total), filled: 0, timer: null };
    analysisAudio.set(token, e);
    while (analysisAudio.size > 4) { const k = analysisAudio.keys().next().value; clearTimeout(analysisAudio.get(k).timer); analysisAudio.delete(k); }
  }
  clearTimeout(e.timer);
  e.timer = setTimeout(() => analysisAudio.delete(token), 5 * 60 * 1000);
  const n = Math.min(data.length, total - offset);
  if (data instanceof Float32Array) e.buf.set(data.subarray(0, n), offset);
  else for (let i = 0; i < n; i++) e.buf[offset + i] = data[i] / 32768;   // Int16 (versiones anteriores)
  e.filled += n;
  return true;
});
// Audio de un análisis: { token } (subido por trozos) o { mono } (compatibilidad).
function analysisMono({ token, mono } = {}) {
  if (token) {
    const e = analysisAudio.get(token);
    if (!e || e.filled < e.buf.length) return { missing: true };
    return { mono: e.buf };
  }
  if (mono && mono.length) return { mono: mono instanceof Float32Array ? mono : new Float32Array(mono) };
  return {};
}

// ── Ventana de la letra (lyrics.html) ─────────────────────────────────────
// «Letra» en una canción abre su letra en una ventana propia, que se puede llevar
// a otra pantalla (TV, segundo monitor): la pantalla de Pads no cambia (el
// baterista sigue viendo sus pads). Con «Seguir canción» cambia sola a la que suena.
let lyricsWin = null, lyricsFollow = true, lastLyrics = null;
function lyricsWindow() {
  if (lyricsWin && !lyricsWin.isDestroyed()) return lyricsWin;
  lyricsWin = new BrowserWindow({
    width: 820, height: 900, minWidth: 360, minHeight: 300,
    title: 'Letra · LivePads', backgroundColor: '#07070d', autoHideMenuBar: true,
    icon: path.join(__dirname, 'src/assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, devTools: !app.isPackaged,
    },
  });
  lyricsWin.loadFile('src/lyrics.html');
  lyricsWin.webContents.on('did-finish-load', () => { if (lastLyrics) lyricsWin.webContents.send('lyrics-data', lastLyrics); });
  lyricsWin.on('closed', () => { lyricsWin = null; });
  return lyricsWin;
}
ipcMain.handle('lyrics-window-show', (_e, data) => {
  lastLyrics = data || null;
  const w = lyricsWindow();
  if (!w.webContents.isLoading()) w.webContents.send('lyrics-data', lastLyrics);
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
  return true;
});
// La canción que suena cambió: si la ventana está abierta y sigue la canción, se actualiza
// (sin robarle el foco a la ventana principal).
ipcMain.handle('lyrics-window-follow', (_e, data) => {
  if (!lyricsWin || lyricsWin.isDestroyed() || !lyricsFollow || !data) return false;
  lastLyrics = data;
  lyricsWin.webContents.send('lyrics-data', data);
  return true;
});
ipcMain.handle('lyrics-window-set-follow', (_e, on) => { lyricsFollow = !!on; return lyricsFollow; });

// Corre en el hilo de análisis (analysisWorker.js): el espectrograma y la
// inferencia no bloquean el proceso principal.
function runAnalysisWorker(workerData) {
  const { Worker } = require('worker_threads');
  const worker = new Worker(path.join(__dirname, 'analysisWorker.js'), { workerData });
  const promise = new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; resolve(v); try { worker.terminate(); } catch (_) {} };
    worker.on('message', (m) => {
      if (m && m.type === 'done') done(m.result);
      else if (m && m.type === 'error') done({ error: m.error });
    });
    worker.on('error', (err) => done({ error: String((err && err.message) || err) }));
    worker.on('exit', () => done({ cancelled: true }));
  });
  return { worker, promise };
}
ipcMain.handle('analysis-beats', async (_e, args = {}) => {
  const modelPath = modelOrFetchLater('beat_this_final0.onnx');
  if (!modelPath) return { unavailable: true };
  const { mono, missing } = analysisMono(args);
  if (missing) return { missing: true };
  if (!mono || !mono.length) throw new Error('Audio vacío');
  const r = await runAnalysisWorker({ task: 'beats', mono, modelPath }).promise;
  if (r && r.error) throw new Error(r.error);
  return r;
});

// Local stem separation (MDX-Net via onnxruntime-node). Receives decoded
// Float32 PCM from the renderer; mode '2stem' (voz/instrumental) or '4stem'
// (voz/batería/bajo/otros). Returns an array of stems. Progress streams
// back over 'stems-separate-progress'.
// ── Acordes con el modelo BTC, en un hilo aparte ─────────────────────────
// Recibe la pista en mono a 22 050 Hz y devuelve los tramos de acordes
// [{ s, e, r, q }]. Corre fuera del hilo principal (CQT + transformer, unos
// segundos; con o sin GPU). Si la persona separa stems, cede el paso.
let chordJob = null;   // { worker, promise }
function cancelChordJob() {
  const j = chordJob;
  if (!j) return Promise.resolve();
  try { j.worker.terminate(); } catch (_) {}
  return j.promise;
}
ipcMain.handle('analysis-chords', async (_e, args = {}) => {
  const modelPath = modelOrFetchLater('btc_chords_voca.onnx');
  if (!modelPath) return { unavailable: true };
  const { mono, missing } = analysisMono(args);
  if (missing) return { missing: true };
  if (!mono || !mono.length) return { error: 'Audio vacío' };
  if (chordJob) return { busy: true };
  const job = runAnalysisWorker({ task: 'chords', mono, modelPath });
  job.promise = job.promise.then((r) => {
    if (chordJob === job) chordJob = null;
    return r && Array.isArray(r.seg) ? { seg: r.seg, ep: r.ep } : r;
  });
  chordJob = job;
  return job.promise;
});

ipcMain.handle('stems-separate', async (e, { channels, sampleRate, mode, ep } = {}) => {
  if (!channels || !channels[0]) throw new Error('Audio vacío');
  await cancelChordJob();   // la separación que pide la persona tiene prioridad
  const { separate, MODELS } = require('./stemSeparator');
  const needed = (mode === '4stem')
    ? ['k_vocals', 'k_drums', 'k_bass', 'k_other']
    : (mode === 'otros')
      ? ['k_other']
      : ['inst_hq3'];
  const send = (fraction, stage, ep) => {
    try { if (!e.sender.isDestroyed()) e.sender.send('stems-separate-progress', { fraction, stage, ep }); } catch (_) {}
  };
  // Los modelos que pide este modo: si no están en el equipo, se bajan ahora (una vez).
  const modelsDir = await ensureModels(needed.map((k) => MODELS[k].file), (f, label) => send(f, label));
  separationCancel = false;
  try {
    const result = await separate({
      channels: channels.map(c => (c instanceof Float32Array ? c : new Float32Array(c))),
      sampleRate: sampleRate || 44100,
      mode: (mode === '4stem' || mode === 'otros') ? mode : '2stem',
      modelsDir,
      ep: ep || undefined,  // undefined → auto (DML then CPU)
      onProgress: send,
      shouldCancel: () => separationCancel,
    });
    return { sampleRate: result.sampleRate, ep: result.ep, stems: result.stems };
  } catch (err) {
    if (err && err.cancelled) return { cancelled: true };
    throw err;
  }
});

// Cooperative cancel — checked between inference windows/models.
let separationCancel = false;
ipcMain.handle('stems-separate-cancel', () => { separationCancel = true; return true; });

// ── Cloud separation (hybrid) ─────────────────────────────────────────
// Optional: when the user has configured a provider + API key AND there's
// internet, separation is offloaded to a cloud service (faster + richer
// stems). The renderer ALWAYS falls back to the local model on any failure,
// so this can never block live use. Currently wired for Replicate (Demucs).
async function cloudSeparateReplicate(wavBytes, apiKey, mode) {
  const dataUri = 'data:audio/wav;base64,' + Buffer.from(wavBytes).toString('base64');
  // 6-stem model so guitar/piano are pulled OUT of "other" — leaving only the
  // synths/organ/strings the band doesn't already cover. For "otros" we ask
  // for just that stem.
  const input = { audio: dataUri, model: 'htdemucs_6s' };
  if (mode === 'otros') input.stem = 'other';

  const create = await net.fetch('https://api.replicate.com/v1/models/ryan5453/demucs/predictions', {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input }),
  });
  if (!create.ok) throw new Error(`Replicate ${create.status}: ${(await create.text()).slice(0, 160)}`);
  let pred = await create.json();

  const t0 = Date.now();
  while (pred.status && !['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - t0 > 300000) throw new Error('Replicate: tiempo agotado');
    await new Promise(r => setTimeout(r, 2500));
    const poll = await net.fetch(pred.urls.get, { headers: { Authorization: `Token ${apiKey}` } });
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate: ${pred.status} ${pred.error || ''}`);

  // Output is either a single URL (when one stem requested) or a map of stems.
  let url = null;
  const out = pred.output;
  if (typeof out === 'string') url = out;
  else if (Array.isArray(out)) url = out[0];
  else if (out && typeof out === 'object') url = out.other || Object.values(out).find(v => typeof v === 'string');
  if (!url) throw new Error('Replicate: sin stem de salida');

  const dl = await net.fetch(url);
  if (!dl.ok) throw new Error(`Descarga del stem falló: ${dl.status}`);
  const audio = Buffer.from(await dl.arrayBuffer());
  return { audio, name: 'Otros', kind: 'other' };
}

ipcMain.handle('stems-separate-cloud', async (_e, { wav, provider, apiKey, mode } = {}) => {
  if (!apiKey) throw new Error('Falta la API key de la nube.');
  if (!wav) throw new Error('Audio vacío.');
  if (provider === 'replicate') return await cloudSeparateReplicate(wav, apiKey, mode);
  throw new Error('Proveedor de nube no soportado: ' + provider);
});

ipcMain.handle('stems-remove-file', async (_e, livepadsUrl) => {
  if (typeof livepadsUrl !== 'string') return false;
  const rest = livepadsUrl.startsWith('livepads://')
    ? livepadsUrl.slice('livepads://'.length).replace(/^app\//, '')
    : livepadsUrl;
  let decoded;
  try { decoded = decodeURIComponent(rest); } catch (_) { return false; }
  // Solo se borra DENTRO de StemProjects/ (ruta resuelta: «StemProjects/../../x» no pasa).
  const abs = containInRoot(path.join(app.getPath('userData'), 'StemProjects'), decoded.replace(/\\/g, '/').replace(/^StemProjects\//, ''));
  if (!abs || !decoded.replace(/\\/g, '/').startsWith('StemProjects/')) return false;
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch (e) { console.warn('Stem rm failed:', e.message); }
  }
  return true;
});

// Generate a QR code (SVG string) for an arbitrary URL. Used by the
// Companion panel to render the pairing QR — generating in main avoids
// bundling a browser QR lib and lets us return a crisp scalable SVG.
ipcMain.handle('companion-qr', async (_e, url) => {
  if (typeof url !== 'string' || !url) throw new Error('URL inválida');
  return await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0a0a14', light: '#FFFFFF' }
  });
});

/* ── App lifecycle ─────────────────────────────────── */

initializeUserData(); // Run copy of defaults to userData on boot

// Resolve a livepads://app/<rel> URL to an absolute file path under userData.
const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.opus': 'audio/opus', '.webm': 'audio/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.json': 'application/json',
};
function mimeForPath(fp) {
  return MIME_BY_EXT[path.extname(fp).toLowerCase()] || 'application/octet-stream';
}

function resolveLivepadsUrl(reqUrl) {
  const after = reqUrl.slice('livepads://'.length); // e.g. 'app/UserDrums/foo.mp3'
  const withoutHost = after.replace(/^app\/?/, '');
  const decoded = decodeURIComponent(withoutHost);
  // Redirige a la carpeta custom solo si está configurada Y la ruta
  // pertenece a una subcarpeta de biblioteca de audios. Mantiene
  // compatibilidad: UserDrums y demás siguen en userData.
  const root = isAudioLibraryRelPath(decoded) ? getAudioLibraryRoot() : app.getPath('userData');
  const contained = containInRoot(root, decoded);
  if (!contained) throw new Error('Ruta fuera de la carpeta permitida: ' + decoded);
  return contained;
}

// App instalada: no se deja controlar desde fuera. Abrirla con puertos de
// depuración (DevTools remoto) o con flags del motor JS la cierra al instante.
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-port', 'js-flags', 'remote-allow-origins']
  .some((sw) => app.commandLine.hasSwitch(sw))) {
  app.exit(0);
}

// Endurecimiento de todas las ventanas: sin <webview>, sin abrir DevTools en
// la app instalada y sin navegar fuera de la app en la ventana principal.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
  // Ventanas emergentes: nunca dentro de la app; los enlaces web van al navegador.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  // La ventana principal solo muestra la app (file://); recargar sigue permitido.
  contents.on('will-navigate', (ev, url) => {
    if (contents.getType() !== 'window' || url.startsWith('file://')) return;
    if (contents === mainWindow?.webContents) {
      ev.preventDefault();
      if (/^(https:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  if (app.isPackaged) {
    contents.on('devtools-opened', () => { try { contents.closeDevTools(); } catch (_) {} });
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // 2da instancia: ya reenvió su deep-link y se cierra

  // App instalada: sin el menú por defecto de Electron (sus atajos ocultos
  // abren DevTools / recargan). Copiar y pegar siguen funcionando en Windows.
  if (app.isPackaged) Menu.setApplicationMenu(null);

  // Registra a LivePads como manejador del esquema livepads:// en el SO (para
  // que los enlaces de invitación abran la app). En dev (electron .) hay que
  // pasar la ruta del script; empaquetada basta el nombre.
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('livepads', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('livepads');
    }
  } catch (_) {}

  protocol.handle('livepads', async (request) => {
    try {
      const filePath = resolveLivepadsUrl(request.url);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return new Response('Not Found', { status: 404 });
      const total = stat.size;

      const baseHeaders = {
        'Access-Control-Allow-Origin': '*',
        // Advertise byte-range support so media elements can SEEK and read the
        // real duration. Without this the <audio> tag couldn't seek/length the
        // stream — which made tracks jump back to 0 mid-play and cut off at the
        // end. We honour Range with 206 below.
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeForPath(filePath),
      };

      const rangeHeader = request.headers.get('Range') || request.headers.get('range');
      const m = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (m) {
        let start = m[1] === '' ? 0 : parseInt(m[1], 10);
        let end   = m[2] === '' ? total - 1 : parseInt(m[2], 10);
        if (!isFinite(start)) start = 0;
        if (!isFinite(end) || end >= total) end = total - 1;
        if (start > end || start >= total) {
          return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` } });
        }
        const chunkSize = end - start + 1;
        const buf = Buffer.alloc(chunkSize);
        const fd = await fs.promises.open(filePath, 'r');
        try { await fd.read(buf, 0, chunkSize, start); } finally { await fd.close(); }
        return new Response(buf, {
          status: 206,
          headers: { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunkSize) },
        });
      }

      const buf = await fs.promises.readFile(filePath);
      return new Response(buf, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(total) } });
    } catch (e) {
      console.warn('livepads:// fetch failed for', request.url, e.message);
      return new Response('Not Found', { status: 404 });
    }
  });
  createWindow();

  // Arranque en frío: si la app se abrió al hacer clic en un enlace de
  // invitación (Windows/Linux lo pasan en argv), procésalo. El token se envía
  // al renderer en cuanto la ventana termine de cargar (did-finish-load).
  const initialUrl = process.argv.find(a => typeof a === 'string' && a.startsWith('livepads://join'));
  if (initialUrl) handleDeepLink(initialUrl);

  // Honour the autostart preference — start the LAN viewer transparently so
  // musicians can scan the QR right after the app opens. Failure is silent;
  // the user can still toggle from the panel.
  const prefs = readCompanionPrefs();
  if (prefs.autostart) {
    companionServer.start().catch(e => console.warn('Companion autostart failed:', e.message));
  }

  checkForUpdates({ quiet: true });
  // Quien deja la app abierta días también recibe la actualización: se revisa cada 30 min.
  setInterval(async () => {
    // En pleno servicio (Modo en vivo o audio sonando) no se busca ni se descarga:
    // verificar un instalador grande carga disco y CPU. Se reintenta en la siguiente ronda.
    try {
      if (mainWindow && !mainWindow.isDestroyed()
        && await mainWindow.webContents.executeJavaScript('!!(window.__lpPerforming && window.__lpPerforming())', true)) return;
    } catch (_) {}
    checkForUpdates({ quiet: true });
  }, 30 * 60 * 1000);
});

// ── Actualizaciones (electron-updater + GitHub Releases) ──────────────────
// Solo en la app instalada. Un único estado que la interfaz sigue en vivo
// (icono del header, panel «Acerca», actualización obligatoria):
//   idle · checking · downloading (percent) · ready (version, notes) · latest · error (message)
// Robustez (antes una búsqueda podía quedarse «Buscando…» para siempre):
//  · Descarga COMPLETA, nunca diferencial: con la compresión máxima y los modelos
//    casi todo el instalador cambia entre versiones, y la diferencial pedía miles
//    de trozos sueltos a GitHub (lentísima, sin progreso y con respuestas 503).
//  · Tiempo máximo para buscar (45 s) y vigilancia de la descarga: si no avanza en
//    90 s se cancela y se reintenta una vez; si vuelve a fallar, error con su motivo.
//  · Fuente directa (latest/download), sin las páginas de GitHub que a veces se cuelgan.
//  · Registro en <datos de la app>/logs/updater.log para poder diagnosticar.
let _autoUpdater = null;
let _updateReady = null;   // { version, notes } cuando ya se descargó una actualización
let _upd = { state: 'idle' };
let _updCheck = null;      // búsqueda en curso (para no lanzar dos)
let _updDownload = null;   // { token, promise, last, retried }

// Registro general de la app (logs/app.log, rotado a 512 KB): errores del proceso
// principal y de la ventana. Sin esto, un fallo en casa de un usuario no dejaba rastro.
function appLog(level, msg) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'app.log');
    try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.1'); } catch (_) {}
    fs.appendFileSync(f, `${new Date().toISOString()} [${level}] v${app.getVersion()} ${String(msg).slice(0, 4000)}\n`);
  } catch (_) {}
}
// Un error suelto en el proceso principal ya no muestra el diálogo de Electron
// sobre la app (en pleno servicio): se anota y la app sigue.
process.on('uncaughtException', (err) => { appLog('error', 'main uncaughtException: ' + ((err && err.stack) || err)); });
process.on('unhandledRejection', (err) => { appLog('warn', 'main unhandledRejection: ' + ((err && err.stack) || err)); });
ipcMain.on('app-log', (_e, level, msg) => { appLog(level === 'warn' ? 'warn' : 'error', 'renderer: ' + msg); });

// Si la ventana muere (p. ej. sin memoria en Stems) o se cuelga, se recarga sola
// en vez de quedarse en blanco. Tope de 3 recargas por minuto para no entrar en bucle.
let _reloads = [];
function watchWindowHealth(win) {
  const reload = (why) => {
    appLog('error', 'ventana: ' + why);
    const now = Date.now();
    _reloads = _reloads.filter((t) => now - t < 60000);
    if (_reloads.length >= 3 || win.isDestroyed()) return;
    _reloads.push(now);
    try { win.webContents.reload(); } catch (_) {}
  };
  win.webContents.on('render-process-gone', (_e, d) => { if (d && d.reason !== 'clean-exit') reload('render-process-gone ' + d.reason + ' (' + d.exitCode + ')'); });
  win.on('unresponsive', () => appLog('warn', 'ventana: unresponsive'));
}

function updLog(level, msg) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'updater.log');
    try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.1'); } catch (_) {}
    fs.appendFileSync(f, `${new Date().toISOString()} [${level}] ${String(msg).slice(0, 2000)}\n`);
  } catch (_) {}
}
function updSend(channel, payload) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch (_) {}
}
function setUpd(patch) {
  _upd = { ...patch, current: app.getVersion() };
  updSend('update-state', _upd);
}

function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return null; }
  autoUpdater.autoDownload = false;              // la descarga la lleva downloadNow() (para poder vigilarla)
  if (UPDATER_DEV) autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;
  // Fuente: el enlace directo a los archivos de la última versión publicada
  // («releases/latest/download/latest.yml», una redirección al CDN de GitHub). El
  // método «github» de electron-updater consulta releases.atom y /releases/latest,
  // páginas web de GitHub que a veces tardan minutos o devuelven 504: era lo que
  // dejaba la búsqueda colgada. Las prereleases (models-v1) no cuentan como «latest».
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: 'https://github.com/josemontilladev/Live-Pads/releases/latest/download' });
  } catch (e) { updLog('warn', 'setFeedURL: ' + (e && e.message)); }
  autoUpdater.logger = {
    info: (m) => updLog('info', m), warn: (m) => updLog('warn', m),
    error: (m) => updLog('error', m), debug: () => {},
  };
  autoUpdater.on('download-progress', (p) => {
    if (_updDownload) _updDownload.last = Date.now();
    setUpd({ state: 'downloading', version: _upd.version, percent: p.percent, bytesPerSecond: p.bytesPerSecond, total: p.total });
    updSend('update-progress', { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info) => {
    // releaseNotes puede ser texto o [{version, note}]: se deja en texto plano corto.
    let notes = info && info.releaseNotes;
    if (Array.isArray(notes)) notes = notes.map(n => (n && n.note) || '').join('\n');
    if (typeof notes === 'string') notes = notes.replace(/<[^>]+>/g, '').trim().slice(0, 600);
    _updateReady = { version: info && info.version, notes: notes || '' };
    setUpd({ state: 'ready', ..._updateReady });
    updSend('update-ready', _updateReady);
  });
  _autoUpdater = autoUpdater;
  return autoUpdater;
}

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
function friendlyUpdError(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_PROXY|ERR_CONNECTION|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE/i.test(m)) return 'Sin conexión con GitHub (revisa internet, o un proxy o firewall que lo bloquee).';
  if (/no respondió|timeout|ETIMEDOUT|ERR_TIMED_OUT/i.test(m)) return 'GitHub no respondió a tiempo. Vuelve a intentarlo en un rato.';
  if (/\b(503|502|429)\b/.test(m)) return 'GitHub está saturado ahora mismo. Vuelve a intentarlo en unos minutos.';
  if (/ENOSPC/i.test(m)) return 'No hay espacio libre en el disco para descargar la actualización.';
  if (/EPERM|EACCES/i.test(m)) return 'Windows no dejó guardar la descarga (permisos o antivirus).';
  return m.split('\n')[0].slice(0, 160) || 'Error desconocido';
}

// Descarga con vigilancia: si en 90 s no llega progreso, se cancela y se reintenta una vez.
function downloadNow(au, version) {
  if (_updDownload) return _updDownload.promise;
  const { CancellationToken } = require('electron-updater');
  const run = (retried) => {
    const token = new CancellationToken();
    const d = { token, last: Date.now(), retried, promise: null };
    _updDownload = d;
    setUpd({ state: 'downloading', version, percent: 0 });
    const watch = setInterval(() => {
      if (Date.now() - d.last > 90000) { updLog('warn', 'Descarga sin progreso 90 s: se cancela'); clearInterval(watch); token.cancel(); }
    }, 5000);
    d.promise = au.downloadUpdate(token)
      .then(() => { clearInterval(watch); if (_updDownload === d) _updDownload = null; })
      .catch((e) => {
        clearInterval(watch); if (_updDownload === d) _updDownload = null;
        updLog('error', 'Descarga: ' + ((e && e.stack) || e));
        if (!retried) return run(true);
        const message = token.cancelled ? 'La descarga se detuvo (la conexión no avanza). Vuelve a intentarlo.' : friendlyUpdError(e);
        setUpd({ state: 'error', message, version });
        updSend('update-error', { message });
      });
    return d.promise;
  };
  return run(false);
}

// Busca (y, si hay versión nueva, empieza a descargar). Nunca se queda colgada.
// quiet: búsquedas automáticas (al abrir y cada 30 min): no mueven el icono ni muestran
// errores (en pleno directo no debe aparecer nada); solo se nota si hay algo que descargar.
// Solo para probar el actualizador en desarrollo: LIVEPADS_UPDATER_DEV=1 (sin efecto en la app instalada).
const UPDATER_DEV = !app.isPackaged && process.env.LIVEPADS_UPDATER_DEV === '1';
async function checkForUpdates({ quiet = false } = {}) {
  if (!app.isPackaged && !UPDATER_DEV) return { status: 'dev' };
  const au = getAutoUpdater();
  if (!au) return { status: 'error', message: 'El actualizador no está disponible.' };
  if (_updateReady) return { status: 'ready', version: _updateReady.version };
  if (_updDownload) return { status: 'available', version: _upd.version, downloading: true };
  if (_updCheck) {
    if (quiet) return _updCheck;
    // Se pulsó el icono durante una búsqueda silenciosa: se muestra y se espera su resultado.
    setUpd({ state: 'checking' });
    const r = await _updCheck;
    if (r.status === 'latest') setUpd({ state: 'latest' });
    else if (r.status === 'error') setUpd({ state: 'error', message: r.message });
    return r;
  }
  if (!quiet) setUpd({ state: 'checking' });
  _updCheck = (async () => {
    try {
      const r = await withTimeout(au.checkForUpdates(), 45000, 'GitHub no respondió (45 s)');
      const latest = r && r.updateInfo && r.updateInfo.version;
      if (latest && r.isUpdateAvailable !== false && latest !== app.getVersion()) {
        downloadNow(au, latest);
        return { status: 'available', version: latest };
      }
      if (!quiet) setUpd({ state: 'latest' });
      return { status: 'latest', version: app.getVersion() };
    } catch (e) {
      updLog('error', 'Búsqueda: ' + ((e && e.stack) || e));
      const message = friendlyUpdError(e);
      if (!quiet) setUpd({ state: 'error', message });
      return { status: 'error', message };
    } finally { _updCheck = null; }
  })();
  return _updCheck;
}

// Quit and install a downloaded update (triggered from the renderer banner).
// quitAndInstall(isSilent=true, isForceRunAfter=true): install silently to the
// existing location (no setup wizard) and relaunch with the new version.
ipcMain.handle('update-install', () => {
  try { if (_autoUpdater) _autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('quitAndInstall failed:', e.message); }
});

ipcMain.handle('app-version', () => app.getVersion());

// Versión mínima permitida (actualización obligatoria). La publica la web:
// https://livepads.online/app-version.json → { "min": "1.0.185", "message": "…" }.
// Sin conexión devuelve null y la app no se bloquea (se puede tocar offline).
ipcMain.handle('min-version', async () => {
  try {
    const r = await net.fetch(`https://livepads.online/app-version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.min === 'string' ? { min: j.min, message: typeof j.message === 'string' ? j.message : '' } : null;
  } catch (_) { return null; }
});
ipcMain.handle('is-packaged', () => app.isPackaged);

// ¿Hay ya una actualización descargada? (la UI lo pregunta al abrir o recargar)
ipcMain.handle('update-status', () => _updateReady);

// Buscar actualizaciones a mano (icono del header, «Acerca»). Devuelve enseguida si ya
// hay una descarga en curso o lista; el progreso llega por 'update-state'.
ipcMain.handle('check-for-updates', () => checkForUpdates());
ipcMain.handle('update-get-state', () => ({ ..._upd, current: app.getVersion(), packaged: app.isPackaged }));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  try { await companionServer.stop(); } catch (e) {}
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
