// Pruebas de interfaz de LivePads (Electron real, perfil temporal, sin cuenta).
//
//   npm run test:ui
//
// Abre la app con un perfil nuevo en una carpeta temporal (nunca toca los datos
// del usuario), entra "sin cuenta" y recorre Pads y Stems comprobando lo que
// más se rompe al tocar la interfaz: que arranque sin errores, el Play y el
// metrónomo, el plan Gratis en Stems, el panel de Biblioteca, el menú Exportar
// y que el timeline siga visible en una portátil de 1366×768.
// Se controla por el protocolo de depuración de Chromium (CDP) con `ws`.
// Sale con código 1 si alguna prueba falla.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = require('electron');            // ruta del binario
const PORT = 9500 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Arranque ───────────────────────────────────────────────────────────────
const profile = mkdtempSync(join(tmpdir(), 'livepads-ui-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(ELECTRON, [
  ROOT, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  // Que dibuje aunque la ventana quede tapada (si no, las capturas se cuelgan).
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
], { cwd: ROOT, env, stdio: 'ignore' });

// Cierra Electron, ESPERA a que salga (Windows no suelta los archivos del
// perfil hasta entonces) y borra el perfil temporal, con reintentos.
async function cleanup() {
  const exited = app.exitCode !== null ? Promise.resolve() : new Promise((r) => app.once('exit', r));
  try { app.kill(); } catch (_) {}
  await Promise.race([exited, sleep(8000)]);
  for (let i = 0; i < 10; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch (_) { await sleep(500); }
  }
  console.warn(`(no se pudo borrar el perfil temporal ${profile})`);
}
const watchdog = setTimeout(async () => { console.error('✖ Tiempo agotado (3 min)'); await cleanup(); process.exit(1); }, 180000);

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page) return page;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('La app no abrió su ventana en 60 s');
}

// ── Cliente CDP mínimo ─────────────────────────────────────────────────────
let ws, msgId = 0;
const pending = new Map();
const exceptions = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function waitFor(expression, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`!!(${expression})`)) return true;
    await sleep(200);
  }
  throw new Error(`No se cumplió a tiempo: ${expression}`);
}

// ── Pruebas ────────────────────────────────────────────────────────────────
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`✔ ${name}`); }
  catch (e) { results.push([false, name]); console.log(`✖ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
  const page = await pageTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  await check('La app arranca y muestra la entrada (con o sin cuenta)', async () => {
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Entrar sin cuenta' && b.offsetParent)`, 30000);
  });

  await check('"Entrar sin cuenta" lleva a Pads en plan Gratis', async () => {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Entrar sin cuenta').click()`);
    await waitFor(`document.body.dataset.workspace === 'pads' && document.querySelector('#btn-metro-main')?.offsetParent`, 20000);
    const plan = await evaluate(`import('./js/billing/license.js').then(m => m.getPlanInfo().plan)`);
    assert(plan === 'free', `plan = ${plan}`);
  });

  await check('Pads: el botón grande es el metrónomo y el Play principal es el de abajo', async () => {
    // El color de acento depende del tema elegido: se resuelve el del tema activo.
    const r = await evaluate(`(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--accent)'; document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color.replace(/\\s/g, ''); probe.remove();
      const m = document.querySelector('#btn-metro-main'), p = document.querySelector('#tp-play-btn');
      const bg = (getComputedStyle(m).backgroundImage + getComputedStyle(m).backgroundColor).replace(/\\s/g, '');
      return { triangulo: !!m.querySelector('polygon'), play: !!p, atajo: /Espacio/.test(p?.title || ''), acento: bg.includes(accent.replace(/^rgba?\\(|\\)$/g, '').split(',').slice(0, 3).join(',')), accent };
    })()`);
    assert(!r.triangulo, 'el metrónomo muestra un triángulo de Play');
    assert(r.play && r.atajo, 'falta el Play principal o su atajo (Espacio)');
    assert(!r.acento, `el metrónomo en reposo no debería ir con el color de acento (${r.accent})`);
  });

  await check('Pads: sin pista, la barra inferior solo muestra la guía', async () => {
    const r = await evaluate(`(() => {
      const bar = document.getElementById('track-player-bar');
      const shown = (sel) => getComputedStyle(bar.querySelector(sel)).display !== 'none';
      return { conPista: bar.classList.contains('has-track'), progreso: shown('#tp-progress'), tiempos: shown('.tp-time'), titulo: document.getElementById('tp-title').textContent };
    })()`);
    assert(!r.conPista && !r.progreso && !r.tiempos, `barra sin pista: ${JSON.stringify(r)}`);
    assert(/elige una canción/.test(r.titulo), `título: "${r.titulo}"`);
  });

  await check('Stems abre con plan Gratis (sin ventana de planes)', async () => {
    await evaluate(`document.querySelector('button[data-workspace=stems]').click()`);
    await waitFor(`document.body.dataset.workspace === 'stems' && document.getElementById('stems-library')`, 15000);
    await sleep(500);
    assert(!(await evaluate(`!!document.getElementById('plans-overlay')`)), 'se abrió la ventana de planes');
    const empty = await evaluate(`[...document.querySelectorAll('#stems-empty p')].filter(p => getComputedStyle(p).display !== 'none').map(p => p.textContent).join(' ')`);
    assert(/Biblioteca/.test(empty), `el estado vacío no invita a la Biblioteca: "${empty}"`);
  });

  await check('Biblioteca: riel plegado que se expande y se contrae', async () => {
    const w0 = await evaluate(`document.getElementById('stems-library').getBoundingClientRect().width`);
    assert(w0 < 60, `plegado mide ${w0}px`);
    await evaluate(`document.querySelector('#stems-library .stl-rail').click()`);
    await sleep(600);
    const w1 = await evaluate(`document.getElementById('stems-library').getBoundingClientRect().width`);
    assert(w1 > 300, `expandido mide ${w1}px`);
    const msg = await evaluate(`document.querySelector('#stems-library .stl-list').textContent`);
    assert(/Inicia sesión/.test(msg), 'sin cuenta debería pedir iniciar sesión');
    await evaluate(`document.querySelector('#stems-library [data-act=close]').click()`);
    await sleep(600);
    assert(await evaluate(`document.getElementById('stems-library').classList.contains('collapsed')`), 'no se contrajo');
  });

  await check('Menú Exportar: deshabilitado sin pistas y con sus 3 opciones', async () => {
    const r = await evaluate(`({ off: document.getElementById('stems-export-trigger').disabled,
      items: [...document.querySelectorAll('#stems-export-pop button')].map(b => b.id) })`);
    assert(r.off, 'Exportar debería estar deshabilitado sin pistas');
    assert(['stems-assign', 'stems-export', 'stems-save-song-stems'].every((id) => r.items.includes(id)), `opciones: ${r.items}`);
  });

  await check('Importar con plan Gratis abre los planes sin abrir el selector de archivos', async () => {
    const r = await evaluate(`(async () => {
      let dialogs = 0; const orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { if (this.type === 'file') { dialogs++; return; } return orig.call(this); };
      document.getElementById('stems-import').click();
      await new Promise(r => setTimeout(r, 600));
      HTMLInputElement.prototype.click = orig;
      const o = document.getElementById('plans-overlay');
      const reason = o?.querySelector('.pl-reason')?.textContent || '';
      o?.querySelector('button')?.click(); o?.remove();
      return { dialogs, reason };
    })()`);
    assert(r.dialogs === 0, 'se abrió el selector de archivos');
    assert(/Importar/.test(r.reason), `motivo de la ventana de planes: "${r.reason}"`);
  });

  await check('Generar click crea una pista y Exportar se habilita', async () => {
    await evaluate(`document.getElementById('stems-generators-trigger').click()`);
    await sleep(300);
    await evaluate(`document.getElementById('stems-add-click').click()`);
    await waitFor(`document.querySelectorAll('.stems-row').length >= 1`, 20000);
    assert(!(await evaluate(`document.getElementById('stems-export-trigger').disabled`)), 'Exportar sigue deshabilitado');
  });

  await check('Timeline visible en una portátil de 1366×768', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const h = await evaluate(`Math.round(document.getElementById('stems-arrange').getBoundingClientRect().height)`);
    await send('Emulation.clearDeviceMetricsOverride');
    assert(h >= 150, `el timeline mide solo ${h}px de alto`);
  });

  await check('Sin excepciones de JavaScript durante el recorrido', async () => {
    assert(!exceptions.length, exceptions.slice(0, 3).join(' | '));
  });
} catch (e) {
  results.push([false, 'arranque']);
  console.log(`✖ ${e.message}`);
} finally {
  clearTimeout(watchdog);
  try { ws?.close(); } catch (_) {}
  await cleanup();
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas de interfaz correctas`);
process.exit(failed ? 1 : 0);
