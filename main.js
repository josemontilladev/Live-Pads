const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
  const dir = path.join(app.getPath('userData'), 'presets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${data.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return fp;
});

ipcMain.handle('load-presets', async () => {
  const dir = path.join(app.getPath('userData'), 'presets');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
});

ipcMain.handle('delete-preset', async (_e, id) => {
  const fp = path.join(app.getPath('userData'), 'presets', `${id}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
});

ipcMain.handle('window-action', (_e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.close();
});

ipcMain.handle('assign-audio-file', async (_e, { sourcePath, type }) => {
  const folder = type === 'sequence' ? 'Sequences' : 'Original Tracks';
  const destDir = path.join(app.getPath('userData'), folder);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  
  const fileName = path.basename(sourcePath);
  const destPath = path.join(destDir, fileName);
  
  if (sourcePath !== destPath) {
    fs.copyFileSync(sourcePath, destPath);
  }
  
  return `file:///${destPath.replace(/\\/g, '/')}`;
});

ipcMain.handle('save-gi-setlist', async (_e, songs) => {
  const fp = path.join(app.getPath('userData'), 'canciones_app.json');
  const data = { data: { songs } };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('load-gi-setlist', async () => {
  const fp = path.join(app.getPath('userData'), 'canciones_app.json');
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  }
  return null;
});

ipcMain.handle('get-absolute-path', (_e, relativePath) => {
  return path.join(__dirname, 'src', relativePath);
});

// Custom Drums
ipcMain.handle('assign-drum-sample', async (_e, { sourcePath, padName }) => {
  const destDir = path.join(app.getPath('userData'), 'UserDrums');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  
  // Clean filename to avoid issues
  const fileName = `${padName.replace(/[^a-z0-9]/gi, '_')}_${path.basename(sourcePath)}`;
  const destPath = path.join(destDir, fileName);
  if (sourcePath !== destPath) fs.copyFileSync(sourcePath, destPath);
  
  return `file:///${destPath.replace(/\\/g, '/')}`;
});

ipcMain.handle('save-user-drums', async (_e, kitMap) => {
  const fp = path.join(app.getPath('userData'), 'user_drums.json');
  fs.writeFileSync(fp, JSON.stringify(kitMap, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('load-user-drums', async () => {
  const fp = path.join(app.getPath('userData'), 'user_drums.json');
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  return null;
});

/* ── App lifecycle ─────────────────────────────────── */

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('save-midi-map', async (_e, mapData) => {
  const fp = path.join(app.getPath('userData'), 'midi_map.json');
  fs.writeFileSync(fp, JSON.stringify(mapData, null, 2));
  return true;
});

ipcMain.handle('load-midi-map', async () => {
  const fp = path.join(app.getPath('userData'), 'midi_map.json');
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  return null;
});
