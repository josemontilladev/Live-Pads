// Arnés de las pruebas de extremo a extremo (Electron real, perfil temporal).
//
// Igual que tests/ui/run.mjs, pero el perfil temporal se siembra con COPIAS de
// canciones reales de la biblioteca instalada (%APPDATA%/LivePads): su ficha en
// Datos/canciones_app.json y sus audios. Nunca escribe en los datos del usuario.
//
// Los modelos de IA (Whisper, separación) se bajan una sola vez a una caché fuera
// de la carpeta sincronizada (LIVEPADS_E2E_MODELS, por defecto
// %LOCALAPPDATA%/LivePads-e2e-models) y se pasan con LIVEPADS_MODELS_DIR; lo que
// la app descargue durante la prueba se copia a esa caché al cerrar.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = require('electron');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const USER_DATA = process.env.LIVEPADS_E2E_SOURCE || join(process.env.APPDATA || '', 'LivePads');
export const MODELS_CACHE = process.env.LIVEPADS_E2E_MODELS || join(process.env.LOCALAPPDATA || tmpdir(), 'LivePads-e2e-models');

/** Canciones de la biblioteca instalada (solo lectura). */
export function librarySongs() {
  const raw = JSON.parse(readFileSync(join(USER_DATA, 'Datos', 'canciones_app.json'), 'utf8'));
  let d = raw.data; if (typeof d === 'string') d = JSON.parse(d);
  return d.songs || [];
}

const urlToRel = (u) => decodeURIComponent(String(u).replace(/^livepads:\/\/app\//i, ''));

/** Busca una canción por título (sin tildes ni mayúsculas) que tenga audio original. */
export function findSong(title) {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, '').trim().toLowerCase();
  const s = librarySongs().find((x) => n(x.title) === n(title) && x.audio && x.audio.original);
  if (!s) throw new Error(`No está en la biblioteca (con audio original): ${title}`);
  return s;
}

/**
 * Abre LivePads con un perfil temporal que contiene `songs` (copias) y entra sin cuenta.
 * @returns {{ evaluate, waitFor, close, profile, exceptions, consoleErrors }}
 */
export async function launch({ songs = [], timeoutMs = 600000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'livepads-e2e-'));
  mkdirSync(join(profile, 'Datos'), { recursive: true });
  for (const s of songs) {
    for (const u of Object.values(s.audio || {})) {
      if (typeof u !== 'string' || !/^livepads:\/\/app\//i.test(u)) continue;
      const rel = urlToRel(u), src = join(USER_DATA, rel), dst = join(profile, rel);
      if (!existsSync(src)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
  }
  writeFileSync(join(profile, 'Datos', 'canciones_app.json'), JSON.stringify({ data: { songs } }));
  mkdirSync(MODELS_CACHE, { recursive: true });
  // Los modelos que ya tiene la app instalada (pulso, acordes…) se copian a la caché una vez.
  try {
    const um = join(USER_DATA, 'models');
    for (const f of readdirSync(um)) if (/\.onnx$/i.test(f) && !existsSync(join(MODELS_CACHE, f))) copyFileSync(join(um, f), join(MODELS_CACHE, f));
  } catch (_) {}

  const port = 9500 + Math.floor(Math.random() * 400);
  const env = { ...process.env, LIVEPADS_MODELS_DIR: MODELS_CACHE };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(ELECTRON, [
    ROOT, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required',
  ], { cwd: ROOT, env, stdio: 'ignore' });

  let ws, msgId = 0;
  const pending = new Map();
  const exceptions = [], consoleErrors = [];

  async function close() {
    // Guarda en la caché los modelos que la app haya bajado en este perfil.
    try {
      const md = join(profile, 'models');
      if (existsSync(md)) for (const f of readdirSync(md)) {
        const dst = join(MODELS_CACHE, f);
        if (!existsSync(dst) && statSync(join(md, f)).size > 1000000) copyFileSync(join(md, f), dst);
      }
    } catch (_) {}
    try { ws && ws.close(); } catch (_) {}
    const exited = app.exitCode !== null ? Promise.resolve() : new Promise((r) => app.once('exit', r));
    try { app.kill(); } catch (_) {}
    await Promise.race([exited, sleep(8000)]);
    for (let i = 0; i < 10; i++) {
      try { rmSync(profile, { recursive: true, force: true }); break; } catch (_) { await sleep(500); }
    }
    clearTimeout(watchdog);
  }
  const watchdog = setTimeout(async () => { console.error(`✖ Tiempo agotado (${Math.round(timeoutMs / 60000)} min)`); await close(); process.exit(1); }, timeoutMs);

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
  async function waitFor(expression, ms = 10000, every = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evaluate(`!!(${expression})`)) return true;
      await sleep(every);
    }
    throw new Error(`No se cumplió a tiempo (${ms} ms): ${expression}`);
  }

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
    } catch (_) {}
    if (!page) await sleep(1000);
  }
  if (!page) { await close(); throw new Error('La app no abrió su ventana en 60 s'); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Entrar sin cuenta' && b.offsetParent)`, 30000);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Entrar sin cuenta').click()`);
  await waitFor(`document.body.dataset.workspace === 'pads' && document.querySelector('#btn-metro-main')?.offsetParent`, 20000);

  return { evaluate, waitFor, close, profile, exceptions, consoleErrors, send };
}

// ── Informe ────────────────────────────────────────────────────────────────
export function reporter() {
  const results = [];
  return {
    async check(name, fn) {
      const t0 = Date.now();
      try { const note = await fn(); results.push([true, name]); console.log(`✔ ${name}${note ? `  — ${note}` : ''}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
      catch (e) { results.push([false, name]); console.log(`✖ ${name}\n    ${e.message}`); }
    },
    summary() {
      const bad = results.filter((r) => !r[0]).length;
      console.log(`\n${results.length - bad}/${results.length} correctas`);
      return bad;
    },
  };
}
export function assert(cond, msg) { if (!cond) throw new Error(msg); }
