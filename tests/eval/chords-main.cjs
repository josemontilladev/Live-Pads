// Banco de pruebas de acordes (no es parte de la app): abre una ventana oculta que decodifica los audios
// descargados de la biblioteca con el decodificador de Chromium y mide el detector contra los acordes de
// la letra. El modelo BTC corre aquí (proceso principal), como en la app.
//   npx electron tests/eval/chords-main.cjs [máx canciones] [original|sequence]
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cm = require('../../chordModel.js');

const MODEL = path.join(process.env.APPDATA, 'livepads', 'models', 'btc_chords_voca.onnx');
const logitsCache = new Map();

ipcMain.handle('btc-logits', async (_e, { id, mono }) => {
  if (logitsCache.has(id)) return true;
  const x = mono instanceof Float32Array ? mono : new Float32Array(mono);
  const { feat, frames } = cm.logCqt(x);
  const { logits, classes } = await cm.chordLogits(feat, frames, MODEL, { mean: cm.VOCA.mean, std: cm.VOCA.std });
  logitsCache.set(id, { logits, classes, frames, duration: x.length / cm.SR });
  return true;
});
// Decodifica con distintas opciones sin volver a pasar el modelo.
ipcMain.handle('btc-decode', (_e, { id, pen, vocab, key }) => {
  const L = logitsCache.get(id);
  if (!L) return null;
  const prior = cm.buildPrior(L.classes, { vocab, key });
  const p = cm.smoothPath(L.logits, L.frames, L.classes, pen, prior);
  return cm.pathToSegments(p, L.duration);
});
ipcMain.on('log', (_e, m) => process.stdout.write(m + '\n'));
ipcMain.on('done', (_e, res) => {
  const out = path.join(process.env.EVAL_OUT || os.tmpdir(), 'chord-eval.json');
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  process.stdout.write('resultados: ' + out + '\n');
  app.quit();
});

app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  const q = new URLSearchParams({ max: process.argv[2] || '40', type: process.argv[3] || 'original', only: process.env.ONLY || '' });
  w.loadFile(path.join(__dirname, 'chords-eval.html'), { search: q.toString() });
});
