const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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
  const raw = readJsonSafe(fp);
  return raw ? rewritePaths(raw) : null;
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
  const raw = readJsonSafe(fp);
  return raw ? rewritePaths(raw) : null;
});

ipcMain.handle('save-midi-map', async (_e, mapData) => {
  saveToBoth('midi_map.json', JSON.stringify(mapData, null, 2));
  return true;
});

ipcMain.handle('load-midi-map', async () => {
  const fp = path.join(app.getPath('userData'), 'midi_map.json');
  const raw = readJsonSafe(fp);
  return raw ? rewritePaths(raw) : null;
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
      mode: mode === '4stem' ? '4stem' : '2stem',
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
      const res = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(res.headers);
      // Expose an explicit ACAO header so the renderer can route these assets
      // through Web Audio (e.g. the track-player pan node) with
      // crossOrigin='anonymous' without the media element getting tainted.
      headers.set('Access-Control-Allow-Origin', '*');
      // Ensure Content-Length is present — without it, media elements report
      // duration === Infinity (e.g. MP3 sequences showed "Infinity:NaN").
      if (!headers.has('Content-Length')) {
        try { headers.set('Content-Length', String(fs.statSync(filePath).size)); } catch (e) {}
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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
    autoUpdater.on('update-downloaded', (info) => send('update-ready', { version: info && info.version }));
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
