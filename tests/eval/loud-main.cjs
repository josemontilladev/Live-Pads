// Mide la sonoridad (audio/loudness.js) de los audios descargados de la biblioteca: para elegir el nivel común.
//   npx electron tests/eval/loud-main.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
ipcMain.on('log', (_e, m) => process.stdout.write(m + '\n'));
ipcMain.on('done', () => app.quit());
app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  w.loadFile(path.join(__dirname, 'loud-eval.html'));
});
