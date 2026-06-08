const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { MongoClient } = require('mongodb');
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

  // Auto-initialize an empty config.json template. The user must fill in
  // mongoUri locally — credentials are NEVER baked into the source tree.
  const configPath = path.join(userDataPath, 'config.json');
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify({
        mongoUri: "",
        _note: "Pega aqui tu URI de MongoDB Atlas. Este archivo es local y NO se sube al repo."
      }, null, 2), 'utf-8');
    } catch (e) {
      console.error("Failed to auto-create config.json:", e.message);
    }
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
const AUDIO_LIBRARY_SUBFOLDERS = ['Sequences', 'Original Tracks', 'Covers'];

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
      const knownSubs = ['UserDrums/', 'Sequences/', 'Original%20Tracks/', 'Original Tracks/'];
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
      webSecurity: true
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
  mainWindow.webContents.session.clearCache()
    .then(() => mainWindow.loadFile('src/index.html'))
    .catch((err) => {
      console.warn('Cache clear failed, loading anyway:', err);
      mainWindow.loadFile('src/index.html');
    });

  // Handle MIDI permissions to prevent drops on hot reload (Ctrl+R)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'midi' || permission === 'midiSysex') {
      return true;
    }
    return false;
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex') {
      return callback(true);
    }
    return callback(false);
  });
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
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac'] }],
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
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac'] }],
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

async function ensureYtDlp() {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, 'yt-dlp.exe');
  if (fs.existsSync(exe) && fs.statSync(exe).size > 1_000_000) {
    // Auto-actualiza si quedó viejo (>14 días): YouTube cambia seguido y un
    // yt-dlp añejo deja de extraer. Best-effort y atómico: baja a un .new y solo
    // reemplaza si el descargado es válido; si algo falla, sigue con el actual.
    try {
      const ageDays = (Date.now() - fs.statSync(exe).mtimeMs) / 86_400_000;
      if (ageDays > 14) {
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
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-400))));
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

  // 3º: si YouTube exige iniciar sesión ("confirm you're not a bot"), reintenta
  // con las cookies del navegador (el primero instalado y con sesión), usando
  // el runtime si ya está disponible. Los navegadores ausentes se saltan.
  const authLike = /sign in|not a bot|cookies|consent|account|HTTP Error 403|HTTP Error 429/i.test(firstErr);
  if (!done && authLike) {
    const dir = await getDenoDir();
    for (const browser of ['edge', 'chrome', 'brave', 'firefox', 'opera', 'vivaldi', 'chromium']) {
      try { await runYtDlp(['--cookies-from-browser', browser], dir); done = true; break; }
      catch (_) { /* navegador ausente o sin sesión de YouTube → siguiente */ }
    }
  }
  if (!done) {
    const e = (firstErr || '').toLowerCase();
    let msg;
    if (/drm/.test(e)) {
      msg = 'Este video está protegido con DRM y no se puede descargar (subida oficial del sello). Usá otro enlace de la misma canción: una versión lyric, en vivo, o una subida no oficial.';
    } else if (/not available|unavailable|is private|been removed|members[- ]only|requested format is not available/.test(e)) {
      msg = 'YouTube no permite descargar este video (DRM, privado, eliminado o restringido). Probá con otro enlace de la misma canción.';
    } else if (authLike) {
      msg = 'YouTube pidió iniciar sesión para este video. Iniciá sesión en YouTube en Edge o Chrome (y cerrá el navegador) y reintentá, o usá otro enlace.';
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

ipcMain.handle('save-gi-setlist', async (_e, songs) => {
  const data = { data: { songs } };
  // La BD se escribe en la carpeta de la librería (OneDrive si está
  // configurada) de forma atómica. Ya NO se espeja a defaults/ en dev: eso
  // ensuciaba git y, además, defaults es solo la semilla de primer arranque.
  writeFileAtomic(getLibraryDbPath(), JSON.stringify(data, null, 2));
  return true;
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

// Reuse one connected MongoClient across syncs (it keeps its own connection
// pool) instead of opening + closing a fresh client every call. Pings to
// confirm liveness; reconnects if the cached client is stale or the URI changed.
let _mongoClient = null, _mongoUri = null;
async function getMongoClient(uri) {
  if (_mongoClient && _mongoUri === uri) {
    try { await _mongoClient.db('admin').command({ ping: 1 }); return _mongoClient; }
    catch (e) { try { await _mongoClient.close(); } catch (_) {} _mongoClient = null; }
  }
  // Generous timeouts: Atlas free-tier clusters cold-start (or wake from
  // idle) well past the old 4s, and mongodb+srv:// needs a DNS SRV/TXT
  // lookup that can be slow on Windows — both produced spurious "Modo Local"
  // errors despite a live connection.
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 20000,
  });
  await client.connect();
  _mongoClient = client; _mongoUri = uri;
  return client;
}

// Default GI.Setlist API base (HTTPS). Overridable via config.json `giApiUrl`.
const DEFAULT_GI_API = 'https://gi-setlist.vercel.app';

ipcMain.handle('sync-mongo-setlist', async () => {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  let uri = '';
  let apiBase = DEFAULT_GI_API;

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && typeof config.mongoUri === 'string') uri = config.mongoUri.trim();
      if (config && typeof config.giApiUrl === 'string' && config.giApiUrl.trim()) {
        apiBase = config.giApiUrl.trim().replace(/\/+$/, '');
      }
    }
  } catch (e) {
    console.warn('Could not read config.json:', e.message);
  }

  const normalize = (songs) => songs.map(s => {
    const obj = { ...s };
    if (obj._id) obj._id = String(obj._id);
    return obj;
  });

  // Primary: GI.Setlist HTTPS API (port 443). Works on networks that block
  // MongoDB's port 27017 — the reason the web app connects fine while the
  // desktop's direct driver times out with ReplicaSetNoPrimary.
  const fetchFromApi = async () => {
    const res = await net.fetch(`${apiBase}/api/songs`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('La respuesta de la API no es una lista');
    return normalize(data);
  };

  // Fallback: direct MongoDB driver (needs `mongoUri` + an open port 27017).
  const fetchFromMongo = async () => {
    if (!uri) throw new Error('Sin mongoUri configurada para el fallback directo.');
    const client = await getMongoClient(uri);
    const songs = await client.db('gi-setlist').collection('songs').find({}).toArray();
    return normalize(songs);
  };

  try {
    return await fetchFromApi();
  } catch (apiErr) {
    console.warn('Sync vía API HTTPS falló, intentando Mongo directo:', apiErr.message);
    try {
      return await fetchFromMongo();
    } catch (mongoErr) {
      try { if (_mongoClient) await _mongoClient.close(); } catch (_) {}
      _mongoClient = null;
      console.error('Sync falló (API + Mongo):', mongoErr.message);
      throw mongoErr;
    }
  }
});

// Push the local library UP to GI.Setlist via its HTTPS API. Serves both as
// a cloud backup and the "reverse" direction of sync. Songs with a known
// `_id` are updated (PUT); songs without one are created (POST) and their new
// cloud id is returned so the renderer can store it (no duplicates next time).
// Plain-text lyrics are wrapped back into the <p>-per-line HTML the web app
// expects, so the round-trip stays clean.
function plainLyricsToHtml(text) {
  if (!text) return '';
  return String(text).replace(/\r/g, '').split('\n')
    .map(line => line.trim() === '' ? '<p><br></p>'
      : `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('');
}

ipcMain.handle('push-mongo-setlist', async (_e, songs) => {
  if (!Array.isArray(songs)) throw new Error('Lista de canciones inválida.');
  let apiBase = DEFAULT_GI_API;
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && typeof config.giApiUrl === 'string' && config.giApiUrl.trim()) {
        apiBase = config.giApiUrl.trim().replace(/\/+$/, '');
      }
    }
  } catch (e) { /* fall back to default */ }

  const idMap = {};   // localId -> new mongo _id (for newly created songs)
  let created = 0, updated = 0;
  const errors = [];

  for (const s of songs) {
    if (!s || !s.title) continue;
    const body = {
      title: s.title,
      // GI.Setlist requires a non-empty artist — fall back so songs without
      // one still upload instead of being silently rejected (HTTP 500).
      artist: (s.artist && s.artist.trim()) ? s.artist : 'Desconocido',
      lyrics: plainLyricsToHtml(s.lyrics || ''),
      bpm: s.bpm || '',
      key: s.key || '',
      genre: s.genre || '',
    };
    // Solo se manda el enlace de YouTube cuando LO HAY: así rellena el campo
    // `youtubeUrl` en GI.Setlist (la web usa eso para mostrar la carátula) sin
    // pisar con vacío lo que ya estuviera puesto allá.
    if (s.youtubeUrl && String(s.youtubeUrl).trim()) body.youtubeUrl = String(s.youtubeUrl).trim();
    try {
      if (s._id) {
        const res = await net.fetch(`${apiBase}/api/songs/${s._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) updated++;
        else errors.push(`${s.title} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      } else {
        const res = await net.fetch(`${apiBase}/api/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const doc = await res.json();
          if (doc && doc._id) idMap[s.id] = String(doc._id);
          created++;
        } else {
          errors.push(`${s.title} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
        }
      }
    } catch (err) {
      errors.push(`${s.title} → ${err.message}`);
    }
  }
  if (errors.length) console.warn('[push] fallos:\n' + errors.join('\n'));
  return { created, updated, idMap, errors };
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
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>LivePads</title></head>
<body style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#0a0a0a;color:#fff;text-align:center;padding-top:90px">
  <div style="font-size:24px;font-weight:800">Live<span style="color:#FBAE00">Pads</span></div>
  <p id="m" style="color:#a3a3a3">Procesando inicio de sesión…</p>
  <script>
    var data = location.hash ? location.hash.slice(1) : location.search.slice(1);
    fetch('/token?' + data).then(function(){
      document.getElementById('m').innerHTML = '✓ Sesión iniciada. Vuelve a LivePads; ya puedes cerrar esta pestaña.';
    }).catch(function(){ document.getElementById('m').textContent = 'No se pudo completar. Vuelve a la app e inténtalo de nuevo.'; });
  </script>
</body></html>`);
        return;
      }

      if (u.pathname === '/token') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
        const p = u.searchParams;
        if (p.get('error') || p.get('error_description')) return finish({ error: p.get('error_description') || p.get('error') });
        const access_token = p.get('access_token');
        if (access_token) return finish({ access_token, refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
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
  'www.lacuerda.net'
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

// Companion prefs live in their own file (kept out of config.json so the
// MongoDB-only template stays clean). Currently a single flag, but easy to
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

ipcMain.handle('stems-save-current', async (_e, state) => {
  ensureStemsDir();
  const fp = path.join(stemsRoot(), 'project.json');
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8');
  return true;
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
  const fileName = `${id}_${safeName}`;
  const relPath = path.join('StemProjects', 'current', 'stems', fileName);
  const absPath = path.join(app.getPath('userData'), relPath);
  fs.writeFileSync(absPath, Buffer.from(buffer));
  return toLivepadsUrl(relPath);
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

// Resolve the bundled separation models directory (extraResources in prod).
function separationModelsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
}

// Local stem separation (MDX-Net via onnxruntime-node). Receives decoded
// Float32 PCM from the renderer; mode '2stem' (voz/instrumental) or '4stem'
// (voz/batería/bajo/otros). Returns an array of stems. Progress streams
// back over 'stems-separate-progress'.
ipcMain.handle('stems-separate', async (e, { channels, sampleRate, mode, ep } = {}) => {
  if (!channels || !channels[0]) throw new Error('Audio vacío');
  const { separate, MODELS } = require('./stemSeparator');
  const modelsDir = separationModelsDir();
  // Verify the models this mode needs are present.
  const needed = (mode === '4stem')
    ? ['k_vocals', 'k_drums', 'k_bass', 'k_other']
    : (mode === 'otros')
      ? ['k_other']
      : ['inst_hq3'];
  for (const k of needed) {
    if (!fs.existsSync(path.join(modelsDir, MODELS[k].file))) {
      throw new Error(`Modelo no encontrado: ${MODELS[k].file}`);
    }
  }
  const send = (fraction, stage) => {
    try { if (!e.sender.isDestroyed()) e.sender.send('stems-separate-progress', { fraction, stage }); } catch (_) {}
  };
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
  const decoded = decodeURIComponent(rest);
  // Only allow deletions under StemProjects/ — defense in depth.
  if (!decoded.replace(/\\/g, '/').startsWith('StemProjects/')) return false;
  const abs = path.join(app.getPath('userData'), decoded);
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

app.whenReady().then(() => {
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

  // Honour the autostart preference — start the LAN viewer transparently so
  // musicians can scan the QR right after the app opens. Failure is silent;
  // the user can still toggle from the panel.
  const prefs = readCompanionPrefs();
  if (prefs.autostart) {
    companionServer.start().catch(e => console.warn('Companion autostart failed:', e.message));
  }

  checkForUpdates();
});

// Auto-update via electron-updater + GitHub Releases. Only in the packaged
// app; failures (offline, no release yet, misconfig) are swallowed so they
// never block startup. Downloads in the background and installs on quit.
let _autoUpdater = null;
let _updaterWired = false;
// Lazily load electron-updater and register its event listeners once. Events
// are forwarded to the renderer: live download progress, ready-to-install,
// and errors — so the UI can show a real progress bar and clear feedback.
function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return null; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  _autoUpdater = autoUpdater;
  if (!_updaterWired) {
    _updaterWired = true;
    const send = (channel, payload) => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch (_) {}
    };
    autoUpdater.on('download-progress', (p) => send('update-progress', {
      percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond,
    }));
    autoUpdater.on('update-downloaded', (info) => {
      // releaseNotes can be a string or an array of {version, note} — normalise
      // to a short plain-text string for the in-app "what's new" line.
      let notes = info && info.releaseNotes;
      if (Array.isArray(notes)) notes = notes.map(n => (n && n.note) || '').join('\n');
      if (typeof notes === 'string') notes = notes.replace(/<[^>]+>/g, '').trim().slice(0, 600);
      send('update-ready', { version: info && info.version, notes: notes || '' });
    });
    autoUpdater.on('error', (err) => send('update-error', { message: (err && err.message) || String(err) }));
  }
  return autoUpdater;
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  const au = getAutoUpdater();
  if (!au) return;
  au.checkForUpdates().catch(e => console.warn('Update check failed:', e && e.message));
}

// Quit and install a downloaded update (triggered from the renderer banner).
// quitAndInstall(isSilent=true, isForceRunAfter=true): install silently to the
// existing location (no setup wizard) and relaunch with the new version.
ipcMain.handle('update-install', () => {
  try { if (_autoUpdater) _autoUpdater.quitAndInstall(true, true); } catch (e) { console.warn('quitAndInstall failed:', e.message); }
});

ipcMain.handle('app-version', () => app.getVersion());

// Manual "check for updates" from the Info panel. Returns a status the
// renderer can show. In dev (not packaged) there's nothing to check. When an
// update exists, the download starts and progress streams over 'update-progress'.
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  const au = getAutoUpdater();
  if (!au) return { status: 'error', message: 'updater no disponible' };
  try {
    const r = await au.checkForUpdates();
    const latest = r && r.updateInfo && r.updateInfo.version;
    if (latest && latest !== app.getVersion()) {
      return { status: 'available', version: latest };
    }
    return { status: 'latest', version: app.getVersion() };
  } catch (e) {
    return { status: 'error', message: e && e.message };
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  try { await companionServer.stop(); } catch (e) {}
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
