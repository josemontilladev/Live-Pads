const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const dns = require('dns');

// Bypasses Cloudflare WARP & local proxy DNS SRV query blocks on Windows
try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (e) {
  console.warn("Could not set DNS servers:", e.message);
}

let mainWindow;

/* ── Portable Defaults Sync & Path-Rewriting Architecture ── */

// Copy everything from packaged defaults folder to userData on first boot
function initializeUserData() {
  const userDataPath = app.getPath('userData');
  const defaultsPath = path.join(__dirname, 'defaults');
  
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
  
  // Auto-initialize config.json for secure credentials customization
  const configPath = path.join(userDataPath, 'config.json');
  if (!fs.existsSync(configPath)) {
    const defaultUri = 'mongodb+srv://kronnicxz_db_user:YHCzmMtoTqWcXJw6@cluster0.a2nvpzm.mongodb.net/gi-setlist?retryWrites=true&w=majority';
    try {
      fs.writeFileSync(configPath, JSON.stringify({ mongoUri: defaultUri }, null, 2), 'utf-8');
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

// Rewrite absolute file:/// paths dynamically on loading to make them cross-platform/user-portable
function rewritePaths(obj) {
  if (!obj) return obj;
  const userDataPath = app.getPath('userData').replace(/\\/g, '/');
  
  const processValue = (val) => {
    if (typeof val !== 'string') return val;

    // New sentinel format: rewrite to current userData
    if (val.includes('/livepads/')) {
      const parts = val.split('/livepads/');
      if (parts.length > 1) {
        return `file:///${userDataPath}/${parts[1]}`;
      }
    }

    // Legacy migration: absolute file:/// paths referencing known subfolders.
    // Detects the subfolder name and re-roots it under current userData,
    // so existing data survives across machines after building the .exe.
    if (val.startsWith('file:///')) {
      const normalizedVal = val.replace(/\\/g, '/');
      const knownSubs = ['UserDrums/', 'Sequences/', 'Original%20Tracks/', 'Original Tracks/'];
      for (const sub of knownSubs) {
        const idx = normalizedVal.indexOf('/' + sub);
        if (idx !== -1) {
          const relPart = normalizedVal.slice(idx + 1); // e.g. "UserDrums/file.mp3"
          return `file:///${userDataPath}/${relPart}`;
        }
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
      webSecurity: false
    },
  });
  mainWindow.loadFile('src/index.html');

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

ipcMain.handle('open-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac'] }],
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return { name: path.basename(filePath), buffer: buffer.buffer, path: filePath };
});

ipcMain.handle('open-audio-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac'] }],
  });
  if (result.canceled) return null;
  return result.filePaths.map(fp => ({
    name: path.basename(fp),
    buffer: fs.readFileSync(fp).buffer,
    path: fp,
  }));
});

ipcMain.handle('save-preset', async (_e, data) => {
  saveToBoth(path.join('presets', `${data.id}.json`), JSON.stringify(data, null, 2));
  return path.join(app.getPath('userData'), 'presets', `${data.id}.json`);
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
  deleteFromBoth(path.join('presets', `${id}.json`));
});

ipcMain.handle('window-action', (_e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.close();
  else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.handle('assign-audio-file', async (_e, { sourcePath, type }) => {
  const folder = type === 'sequence' ? 'Sequences' : 'Original Tracks';
  const fileName = path.basename(sourcePath);
  const relPath = path.join(folder, fileName);
  
  copyToBoth(sourcePath, relPath);

  // Use sentinel format so rewritePaths() can relocate on any machine
  return `file:///livepads/${relPath.replace(/\\/g, '/')}`;
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
  let uri = 'mongodb+srv://kronnicxz_db_user:YHCzmMtoTqWcXJw6@cluster0.a2nvpzm.mongodb.net/gi-setlist?retryWrites=true&w=majority';
  const configPath = path.join(app.getPath('userData'), 'config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.mongoUri) {
        uri = config.mongoUri;
      }
    } else {
      // Auto-create config.json with default so they can customize it easily in userData directory
      fs.writeFileSync(configPath, JSON.stringify({ mongoUri: uri }, null, 2), 'utf-8');
    }
  } catch (e) {
    console.warn("Could not read config.json, using default:", e.message);
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
  if (relativePath.includes('/livepads/')) {
    const parts = relativePath.split('/livepads/');
    return path.join(app.getPath('userData'), parts[1]);
  }
  return path.join(__dirname, 'src', relativePath);
});

// Custom Drums
ipcMain.handle('assign-drum-sample', async (_e, { sourcePath, padName, kitId }) => {
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

  // Use sentinel format so rewritePaths() can relocate on any machine
  return `file:///livepads/${relPath.replace(/\\/g, '/')}`;
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

/* ── App lifecycle ─────────────────────────────────── */

initializeUserData(); // Run copy of defaults to userData on boot

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
