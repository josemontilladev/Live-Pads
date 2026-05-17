const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
}

// Mirror dynamic updates back into the project's defaults folder in development
function saveToBoth(relativeSubPath, contentString) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  const defPath = path.join(__dirname, 'defaults', relativeSubPath);
  
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.mkdirSync(path.dirname(defPath), { recursive: true });
  
  fs.writeFileSync(userPath, contentString, 'utf-8');
  fs.writeFileSync(defPath, contentString, 'utf-8');
}

function deleteFromBoth(relativeSubPath) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  const defPath = path.join(__dirname, 'defaults', relativeSubPath);
  
  if (fs.existsSync(userPath)) {
    try { fs.unlinkSync(userPath); } catch(e){}
  }
  if (fs.existsSync(defPath)) {
    try { fs.unlinkSync(defPath); } catch(e){}
  }
}

function copyToBoth(sourcePath, relativeSubPath) {
  const userPath = path.join(app.getPath('userData'), relativeSubPath);
  const defPath = path.join(__dirname, 'defaults', relativeSubPath);
  
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.mkdirSync(path.dirname(defPath), { recursive: true });
  
  if (sourcePath !== userPath) fs.copyFileSync(sourcePath, userPath);
  if (sourcePath !== defPath) fs.copyFileSync(sourcePath, defPath);
}

// Rewrite absolute file:/// paths dynamically on loading to make them cross-platform/user-portable
function rewritePaths(obj) {
  if (!obj) return obj;
  const userDataPath = app.getPath('userData').replace(/\\/g, '/');
  
  const processValue = (val) => {
    if (typeof val === 'string' && val.includes('/livepads/')) {
      const parts = val.split('/livepads/');
      if (parts.length > 1) {
        return `file:///${userDataPath}/${parts[1]}`;
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
  mainWindow.webContents.openDevTools();

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
});

ipcMain.handle('assign-audio-file', async (_e, { sourcePath, type }) => {
  const folder = type === 'sequence' ? 'Sequences' : 'Original Tracks';
  const fileName = path.basename(sourcePath);
  const relPath = path.join(folder, fileName);
  
  copyToBoth(sourcePath, relPath);
  
  const destPath = path.join(app.getPath('userData'), relPath);
  return `file:///${destPath.replace(/\\/g, '/')}`;
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

ipcMain.handle('get-absolute-path', (_e, relativePath) => {
  return path.join(__dirname, 'src', relativePath);
});

// Custom Drums
ipcMain.handle('assign-drum-sample', async (_e, { sourcePath, padName }) => {
  const prefix = padName.replace(/[^a-z0-9]/gi, '_') + '_';
  
  // Clean old files for this pad in both directories
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
  cleanDir(path.join(__dirname, 'defaults', 'UserDrums'));

  // Generate unique filename
  const fileName = `${prefix}${Date.now()}_${path.basename(sourcePath).replace(/[^a-z0-9.]/gi, '_')}`;
  const relPath = path.join('UserDrums', fileName);
  
  copyToBoth(sourcePath, relPath);
  
  const destPath = path.join(app.getPath('userData'), relPath);
  return `file:///${destPath.replace(/\\/g, '/')}`;
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
