// Rasteriza scripts/brand/logo.svg a PNG con Chromium (Electron offscreen).
// Renderiza UNA vez a 512px y reescala para los tamaños menores.
// Ejecutar (sin ELECTRON_RUN_AS_NODE):  electron scripts/brand/render-logo.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SVG = fs.readFileSync(path.join(__dirname, 'logo.svg'), 'utf8');
const BASE = 512;

const TARGETS = [
  { file: 'src/assets/icon.png',                  size: 512 },
  { file: 'src/assets/logo.png',                  size: 512 },
  { file: 'docs/assets/logo.png',                 size: 512 },
  { file: 'companion/client/icons/icon-512.png',  size: 512 },
  { file: 'companion/client/icons/icon-192.png',  size: 192 },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: BASE, height: BASE, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true },
  });
  const svg = SVG.replace('width="256" height="256"', `width="${BASE}" height="${BASE}"`);
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
    </head><body>${svg}</body></html>`;
  const tmp = path.join(__dirname, '.render.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 500));
  const base = await win.webContents.capturePage();
  win.destroy();
  try { fs.unlinkSync(tmp); } catch (_) {}

  for (const t of TARGETS) {
    const img = t.size === BASE ? base
      : base.resize({ width: t.size, height: t.size, quality: 'best' });
    const out = path.join(ROOT, t.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.toPNG());
    console.log('wrote', t.file, `(${t.size}px)`);
  }
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
