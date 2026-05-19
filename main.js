const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { MongoClient } = require('mongodb');
const dns = require('dns');

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
  
  if (fs.existsSync(defaultsPath)) {
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

// Mirror dynamic updates back into the project's defaults folder in development
function saveToBoth(relativeSubPath, contentString) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, contentString, 'utf-8');

  // Only mirror back to defaults in development (not when packaged inside read-only app.asar)
  if (!app.isPackaged) {
    const defPath = path.join(__dirname, 'defaults', relativeSubPath);
    try {
      fs.mkdirSync(path.dirname(defPath), { recursive: true });
      fs.writeFileSync(defPath, contentString, 'utf-8');
    } catch (e) {
      console.warn("Could not save to defaults folder in development:", e.message);
    }
  }
}

function deleteFromBoth(relativeSubPath) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  if (fs.existsSync(userPath)) {
    try { fs.unlinkSync(userPath); } catch(e){}
  }

  // Only delete from defaults in development
  if (!app.isPackaged) {
    const defPath = path.join(__dirname, 'defaults', relativeSubPath);
    if (fs.existsSync(defPath)) {
      try { fs.unlinkSync(defPath); } catch(e){}
    }
  }
}

function copyToBoth(sourcePath, relativeSubPath) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  if (sourcePath !== userPath) {
    try { fs.copyFileSync(sourcePath, userPath); } catch(e){ console.error("Error copying to userPath:", e); }
  }
  
  // Only copy to defaults in development (packaged app.asar is read-only)
  if (!app.isPackaged) {
    const defPath = path.join(__dirname, 'defaults', relativeSubPath);
    try {
      fs.mkdirSync(path.dirname(defPath), { recursive: true });
      if (sourcePath !== defPath) fs.copyFileSync(sourcePath, defPath);
    } catch (e) {
      console.warn("Could not copy to defaults folder in development:", e.message);
    }
  }
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
    icon: path.join(__dirname, 'src/assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // userData assets (audio samples, sequences) are served via the
      // privileged livepads:// protocol — see registerLivepadsProtocol().
      webSecurity: true
    },
  });
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

// Cap any single audio-file read to avoid loading multi-GB files into memory.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500 MB

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
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
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

ipcMain.handle('assign-audio-file', async (_e, { sourcePath, type } = {}) => {
  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('sourcePath inválido');
  }
  const folder = type === 'sequence' ? 'Sequences' : 'Original Tracks';
  const fileName = path.basename(sourcePath);
  const relPath = path.join(folder, fileName);

  copyToBoth(sourcePath, relPath);

  return toLivepadsUrl(relPath);
});

ipcMain.handle('save-gi-setlist', async (_e, songs) => {
  const data = { data: { songs } };
  saveToBoth('canciones_app.json', JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('load-gi-setlist', async () => {
  const fp = path.join(app.getPath('userData'), 'canciones_app.json');
  if (fs.existsSync(fp)) {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return rewritePaths(raw);
  }
  return null;
});

ipcMain.handle('sync-mongo-setlist', async () => {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  let uri = '';

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && typeof config.mongoUri === 'string') uri = config.mongoUri.trim();
    }
  } catch (e) {
    console.warn("Could not read config.json:", e.message);
  }

  if (!uri) {
    const msg = `MongoDB URI no configurada. Edita ${configPath} y pega tu cadena de conexion en "mongoUri".`;
    console.warn(msg);
    throw new Error(msg);
  }

  try {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 4000 // 4 seconds timeout for fast offline detection
    });
    await client.connect();
    const db = client.db('gi-setlist');
    const collection = db.collection('songs');
    const songs = collection ? await collection.find({}).toArray() : [];
    await client.close();
    return songs.map(s => {
      const obj = { ...s };
      if (obj._id) obj._id = obj._id.toString();
      return obj;
    });
  } catch (err) {
    console.error('Mongo sync error:', err);
    throw err;
  }
});

ipcMain.handle('get-absolute-path', (_e, relativePath) => {
  if (typeof relativePath !== 'string') return '';

  // livepads://app/<rel> -> userData/<rel>
  if (relativePath.startsWith('livepads://')) {
    const rest = relativePath.slice('livepads://'.length).replace(/^app\//, '');
    return path.join(app.getPath('userData'), decodeURIComponent(rest));
  }
  if (relativePath.includes('/livepads/')) {
    const parts = relativePath.split('/livepads/');
    return path.join(app.getPath('userData'), decodeURIComponent(parts[1]));
  }
  return path.join(__dirname, 'src', relativePath);
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
  if (!app.isPackaged) {
    cleanDir(path.join(__dirname, 'defaults', 'UserDrums'));
  }

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
  if (fs.existsSync(fp)) {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return rewritePaths(raw);
  }
  return null;
});

ipcMain.handle('save-midi-map', async (_e, mapData) => {
  saveToBoth('midi_map.json', JSON.stringify(mapData, null, 2));
  return true;
});

ipcMain.handle('load-midi-map', async () => {
  const fp = path.join(app.getPath('userData'), 'midi_map.json');
  if (fs.existsSync(fp)) {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return rewritePaths(raw);
  }
  return null;
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

/* ── App lifecycle ─────────────────────────────────── */

initializeUserData(); // Run copy of defaults to userData on boot

// Resolve a livepads://app/<rel> URL to an absolute file path under userData.
function resolveLivepadsUrl(reqUrl) {
  const after = reqUrl.slice('livepads://'.length); // e.g. 'app/UserDrums/foo.mp3'
  const withoutHost = after.replace(/^app\/?/, '');
  const decoded = decodeURIComponent(withoutHost);
  return path.join(app.getPath('userData'), decoded);
}

app.whenReady().then(() => {
  protocol.handle('livepads', async (request) => {
    try {
      const filePath = resolveLivepadsUrl(request.url);
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      console.warn('livepads:// fetch failed for', request.url, e.message);
      return new Response('Not Found', { status: 404 });
    }
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
