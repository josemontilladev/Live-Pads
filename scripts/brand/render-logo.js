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

  // .ico multi-resolución (Windows): tamaños chicos nítidos para la barra de
  // tareas. El formato ICO admite PNGs embebidos (Vista+), así que lo armamos
  // a mano sin herramientas externas.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(s => base.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const ico = buildIco(sizes, pngs);
  const icoOut = path.join(ROOT, 'src/assets/icon.ico');
  fs.writeFileSync(icoOut, ico);
  console.log('wrote src/assets/icon.ico', `(${sizes.length} tamaños, ${(ico.length/1024).toFixed(1)}KB)`);
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });

// Ensambla un .ico con payloads PNG.
function buildIco(sizes, pngs) {
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type 1 = icon
  header.writeUInt16LE(count, 4);  // número de imágenes

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  sizes.forEach((s, i) => {
    const png = pngs[i];
    const e = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e + 0);     // ancho (0 = 256)
    dir.writeUInt8(s >= 256 ? 0 : s, e + 1);     // alto
    dir.writeUInt8(0, e + 2);                    // paleta
    dir.writeUInt8(0, e + 3);                    // reservado
    dir.writeUInt16LE(1, e + 4);                 // planos de color
    dir.writeUInt16LE(32, e + 6);                // bits por píxel
    dir.writeUInt32LE(png.length, e + 8);        // tamaño de los datos
    dir.writeUInt32LE(offset, e + 12);           // offset de los datos
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}
