// Pruebas de administración y comunidad de la Biblioteca de stems, contra la
// nube REAL (Supabase + R2) con la cuenta del administrador.
//
//   LP_ADMIN_PROFILE="C:\ruta\al\perfil" npm run test:admin
//
// LP_ADMIN_PROFILE = carpeta de un perfil de Electron (--user-data-dir) con la
// sesión del administrador ya iniciada, y con la app CERRADA en ese perfil. No
// uses el de la app instalada mientras la tengas abierta.
//
// Crea sus propios packs ("QA <fecha>"), recorre subir / re-subir / editar /
// uso / sensación / sin conexión / comunidad / moderación / reportes / avisos,
// y al terminar BORRA exactamente los packs que creó (también si algo falla).
// No corre en CI (necesita la cuenta). Sale con código 1 si algo falla.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = require('electron');
const PROFILE = process.env.LP_ADMIN_PROFILE;
if (!PROFILE || !existsSync(PROFILE)) {
  console.error('Falta LP_ADMIN_PROFILE: la carpeta de un perfil de Electron con la sesión del administrador iniciada.');
  process.exit(2);
}
const PORT = 9500 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(ELECTRON, [ROOT, `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
{ cwd: ROOT, env, stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
// Corre una función async en la página; `args` viaja como JSON.
const run = (fn, args = {}) => evaluate(`(${fn})(${JSON.stringify(args)})`);

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`✔ ${name}`); }
  catch (e) { results.push([false, name]); console.log(`✖ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── Código que corre en la página ────────────────────────────────────────
const PAGE_HELPERS = `
  window.__qa = window.__qa || {};
  window.__qa.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__qa.toast = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).slice(-1)[0] || '';
  window.__qa.wav = async (name, kind, bpm = 90, bars = 2) => {
    const { audioBufferToWav } = await import('./js/stems/clickGenerator.js');
    const sr = 44100, dur = bars * 4 * 60 / bpm;
    const off = new OfflineAudioContext(2, Math.round(dur * sr), sr);
    if (kind === 'drums') {
      for (let b = 0; b < bars * 4; b++) { const o = off.createOscillator(), g = off.createGain(); o.frequency.value = 80; const t = b * 60 / bpm; g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(g).connect(off.destination); o.start(t); o.stop(t + 0.2); }
    } else { [220, 277.18, 329.63].forEach((f) => { const o = off.createOscillator(), g = off.createGain(); o.frequency.value = f; g.gain.value = 0.15; o.connect(g).connect(off.destination); o.start(0); o.stop(dur); }); }
    return new File([audioBufferToWav(await off.startRendering())], name, { type: 'audio/wav' });
  };
  window.__qa.png = async () => { const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#3a5'; g.fillRect(0, 0, 600, 600); const b = await new Promise((r) => c.toBlob(r, 'image/png')); return new File([b], 'cover.png', { type: 'image/png' }); };
  window.__qa.drop = (ov, files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); ov.querySelector('[data-ref=drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
  window.__qa.waitRows = async (ov, n) => { for (let i = 0; i < 60 && ov.querySelectorAll('[data-ref=rows] tbody tr').length < n; i++) await window.__qa.sleep(250); await window.__qa.sleep(800); };
  window.__qa.waitUploaded = async (ov) => { for (let i = 0; i < 160; i++) { await window.__qa.sleep(500); if (!ov.querySelectorAll('[data-ref=rows] tbody tr').length && ov.querySelector('[data-ref=progress]').hidden) { await window.__qa.sleep(300); return; } } throw new Error('la subida no terminó'); };
  window.__qa.uploader = async (opts) => { const { openPackUploader } = await import('./js/stems/packUploader.js'); openPackUploader(opts); await window.__qa.sleep(1800); return document.getElementById('spu-overlay'); };
  window.__qa.lib = () => import('./js/cloud/stemLibrary.js');
  true;
`;

const created = new Set();   // ids de packs creados por esta prueba (se borran al final)
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OFFICIAL = `QA Oficial ${STAMP}`, COMMUNITY = `QA Comunidad ${STAMP}`;

try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && /index\.html/.test(t.url)); } catch (_) {}
    if (!page) await sleep(1000);
  }
  if (!page) throw new Error('La app no abrió su ventana');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await sleep(7000);
  await evaluate(PAGE_HELPERS);

  await check('Sesión de administrador y función desplegada', async () => {
    const r = await run(async () => {
      document.getElementById('whats-new')?.remove();
      document.querySelector('button[data-workspace=stems]')?.click();
      await window.__qa.sleep(1500);
      const lib = await window.__qa.lib();
      let fn = '';
      try { await (await import('./js/cloud/supabase.js')).invokeFunction('stem-library-admin', { action: 'list_loops', packId: 'x' }); } catch (e) { fn = e.message; }
      return { admin: await lib.isLibraryAdmin(), fn };
    });
    assert(r.admin, 'el perfil no tiene la sesión del administrador');
    assert(/Parámetros inválidos/.test(r.fn), `la función stem-library-admin no es la versión nueva (${r.fn})`);
  });

  await check('Subir un pack oficial desde la ventana y publicarlo', async () => {
    const r = await run(async ({ title }) => {
      const ov = await window.__qa.uploader({});
      ov.querySelector('[data-ref=title]').value = title;
      ov.querySelector('[data-ref=title]').dispatchEvent(new Event('input', { bubbles: true }));
      const tier = ov.querySelector('[data-ref=tier]'); tier.value = 'free'; tier.dispatchEvent(new Event('change', { bubbles: true }));
      window.__qa.files = [await window.__qa.wav('QA Bateria 90bpm.wav', 'drums'), await window.__qa.wav('QA Pad 90bpm.wav', 'pad')];
      window.__qa.drop(ov, window.__qa.files);
      await window.__qa.waitRows(ov, 2);
      const feel = ov.querySelectorAll('[data-ref=rows] tbody tr')[1].querySelector('[data-f=feel]'); feel.value = 'intimo'; feel.dispatchEvent(new Event('change', { bubbles: true }));
      ov.querySelector('[data-ref=publish]').checked = true;
      ov.querySelector('[data-act=upload]').click();
      await window.__qa.waitUploaded(ov);
      ov.querySelector('[data-act=close]').click();
      const pack = (await (await window.__qa.lib()).adminListPacks()).find((p) => p.title === title);
      return { toast: window.__qa.toast(), id: pack?.id, loops: pack?.loops, published: pack?.published };
    }, { title: OFFICIAL });
    if (r.id) created.add(r.id);
    assert(r.id && r.loops === 2 && r.published, `pack: ${JSON.stringify(r)}`);
  });

  await check('Re-subir conserva ids, la marca PRO puesta a mano y la sensación', async () => {
    const r = await run(async ({ title }) => {
      const lib = await window.__qa.lib();
      const pack = (await lib.adminListPacks()).find((p) => p.title === title);
      const before = await lib.adminListLoops(pack.id);
      await lib.setLoopTier(before.find((l) => l.instrument === 'drums').id, 'pro');
      const ov = await window.__qa.uploader({});
      ov.querySelector('input[value=existing]').checked = true;
      ov.querySelector('input[value=existing]').dispatchEvent(new Event('change', { bubbles: true }));
      const sel = ov.querySelector('[data-ref=existing]'); sel.value = pack.id; sel.dispatchEvent(new Event('change', { bubbles: true }));
      window.__qa.drop(ov, window.__qa.files);
      await window.__qa.waitRows(ov, 2);
      const badges = ov.querySelectorAll('.spu-upd').length;
      ov.querySelector('[data-act=upload]').click();
      await window.__qa.waitUploaded(ov);
      ov.querySelector('[data-act=close]').click();
      const after = await lib.adminListLoops(pack.id);
      return {
        badges, toast: window.__qa.toast(),
        sameIds: JSON.stringify(before.map((l) => l.id).sort()) === JSON.stringify(after.map((l) => l.id).sort()),
        drumsTier: after.find((l) => l.instrument === 'drums').tier, padTags: after.find((l) => l.instrument === 'pad').tags,
      };
    }, { title: OFFICIAL });
    assert(r.badges === 2 && r.sameIds && r.drumsTier === 'pro' && r.padTags.includes('intimo') && /2 actualizados/.test(r.toast), JSON.stringify(r));
  });

  await check('Editar un loop desde "Mis packs" y cambiar la portada', async () => {
    const r = await run(async ({ title }) => {
      const ov = await window.__qa.uploader({ tab: 'packs' });
      await window.__qa.sleep(400);
      [...ov.querySelectorAll('.spu-packrow')].find((x) => x.textContent.includes(title)).querySelector('[data-open]').click();
      for (let i = 0; i < 30 && !ov.querySelector('.spu-loops'); i++) await window.__qa.sleep(250);
      const row = [...ov.querySelectorAll('.spu-loops tr[data-loop]')].find((tr) => tr.querySelector('[data-lf=instrument]').value === 'pad');
      const ti = row.querySelector('[data-lf=title]'); ti.value = 'Pad QA editado'; ti.dispatchEvent(new Event('input', { bubbles: true }));
      row.querySelector('[data-act=saveLoop]').click();
      await window.__qa.sleep(2500);
      const input = ov.querySelector('[data-cover-input]');
      const dt = new DataTransfer(); dt.items.add(await window.__qa.png()); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 30 && !/Portada/.test(window.__qa.toast()); i++) await window.__qa.sleep(300);
      ov.querySelector('[data-act=close]').click();
      const lib = await window.__qa.lib();
      const pack = (await lib.adminListPacks()).find((p) => p.title === title);
      return { titles: (await lib.adminListLoops(pack.id)).map((l) => l.title), cover: pack.cover_path };
    }, { title: OFFICIAL });
    assert(r.titles.includes('Pad QA editado') && /\/cover-\d+\.png$/.test(r.cover || ''), JSON.stringify(r));
  });

  await check('Uso: resumen y las cuatro vistas', async () => {
    const r = await run(async () => {
      const ov = await window.__qa.uploader({ tab: 'stats' });
      await window.__qa.sleep(2500);
      const kpis = ov.querySelectorAll('.spu-kpi').length;
      const out = {};
      for (const v of ['top', 'unused', 'listened', 'packs']) {
        const s = ov.querySelector('[data-ref=statsView]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }));
        await window.__qa.sleep(1800);
        out[v] = !/No se pudo/.test(ov.querySelector('[data-ref=stats]').textContent);
      }
      ov.querySelector('[data-act=close]').click();
      return { kpis, ...out };
    });
    assert(r.kpis === 4 && r.top && r.unused && r.listened && r.packs, JSON.stringify(r));
  });

  await check('Panel: sensación, búsqueda por pack, descarga y copia sin conexión', async () => {
    const r = await run(async ({ title }) => {
      const lib = await window.__qa.lib();
      await lib.listPacks({ refresh: true });
      const el = document.getElementById('stems-library');
      if (el.classList.contains('collapsed')) el.querySelector('.stl-rail').click();
      await window.__qa.sleep(2000);
      window.dispatchEvent(new Event('livepads:stem-library-changed'));
      await window.__qa.sleep(2000);
      [...el.querySelectorAll('.stl-chip')].find((c) => c.textContent.includes(title)).click();
      await window.__qa.sleep(1200);
      const feel = el.querySelector('[data-ref=feel]'); feel.value = 'intimo'; feel.dispatchEvent(new Event('change'));
      await window.__qa.sleep(600);
      const intimo = el.querySelectorAll('.stl-loop').length;
      feel.value = ''; feel.dispatchEvent(new Event('change'));
      await window.__qa.sleep(600);
      el.querySelector('[data-ref=download]').click();
      for (let i = 0; i < 80 && !/Disponible/.test(el.querySelector('[data-ref=download]')?.textContent || ''); i++) await window.__qa.sleep(500);
      const dl = el.querySelector('[data-ref=download]').textContent;
      const real = window.fetch;
      window.fetch = (u, o) => (/supabase\.co/.test(String(u)) ? Promise.reject(new TypeError('Failed to fetch')) : real(u, o));
      await lib.listPacks({ refresh: true });
      const offline = lib.isUsingOfflineCopy();
      window.fetch = real;
      await lib.listPacks({ refresh: true });
      return { intimo, dl, offline, back: !lib.isUsingOfflineCopy() };
    }, { title: OFFICIAL });
    assert(r.intimo === 1 && /Disponible sin conexión \(2\)/.test(r.dl) && r.offline && r.back, JSON.stringify(r));
  });

  await check('Comunidad: enviar, editar un loop, rechazar con nota, avisar y aprobar', async () => {
    const r = await run(async ({ title }) => {
      const lib = await window.__qa.lib();
      // Enviar desde la ventana de comunidad
      let ov = await window.__qa.uploader({ community: true });
      ov.querySelector('[data-ref=title]').value = title;
      ov.querySelector('[data-ref=title]').dispatchEvent(new Event('input', { bubbles: true }));
      ov.querySelector('[data-ref=author]').value = 'Ministerio QA';
      window.__qa.drop(ov, [await window.__qa.wav('QA Comunidad Pad 90bpm.wav', 'pad')]);
      await window.__qa.waitRows(ov, 1);
      const blocked = ov.querySelector('[data-act=upload]').disabled;
      ov.querySelector('[data-ref=rights]').checked = true;
      ov.querySelector('[data-ref=rights]').dispatchEvent(new Event('change', { bubbles: true }));
      ov.querySelector('[data-act=upload]').click();
      await window.__qa.waitUploaded(ov);
      ov.querySelector('[data-act=close]').click();
      let mine = (await lib.myCommunityPacks()).find((p) => p.title === title);
      const id = mine.id;
      // Quien envía corrige un dato sin volver a subir
      const [loop] = await lib.listOwnPackLoops(id);
      await lib.communityUpdateLoop(loop.id, { title: 'Pad comunidad corregido' });
      const edited = (await lib.listOwnPackLoops(id))[0].title;
      const hidden = !(await lib.listPacks({ refresh: true })).some((p) => p.id === id);
      // Aviso al administrador
      localStorage.removeItem('lp.community.adminSeen');
      const notify = await import('./js/cloud/communityNotify.js');
      await notify.checkCommunityNews({});
      const adminToast = window.__qa.toast();
      // Rechazar con nota desde Moderación
      ov = await window.__qa.uploader({ tab: 'review' });
      await window.__qa.sleep(500);
      [...ov.querySelectorAll('[data-ref=reviewList] .spu-packrow')].find((x) => x.textContent.includes(title)).querySelector('[data-open]').click();
      for (let i = 0; i < 30 && !ov.querySelector('[data-ref=reviewList] [data-act=reject]'); i++) await window.__qa.sleep(250);
      ov.querySelector('[data-ref-note]').value = 'Nota QA: falta el fade.';
      ov.querySelector('[data-ref=reviewList] [data-act=reject]').click();
      await window.__qa.sleep(2500);
      ov.querySelector('[data-act=close]').click();
      // Aviso a quien lo envió
      await notify.checkCommunityNews({});
      const userToast = window.__qa.toast();
      // Volver a enviar y aprobar
      await lib.communitySubmit(id);
      await lib.adminReview(id, true);
      const pub = (await lib.listPacks({ refresh: true })).find((p) => p.id === id);
      mine = (await lib.myCommunityPacks()).find((p) => p.id === id);
      return { id, blocked, edited, hidden, adminToast, userToast, pub: pub && pub.author_name, status: mine.status };
    }, { title: COMMUNITY });
    if (r.id) created.add(r.id);
    assert(r.blocked && r.edited === 'Pad comunidad corregido' && r.hidden, `envío: ${JSON.stringify(r)}`);
    assert(/por revisar/.test(r.adminToast), `aviso al admin: "${r.adminToast}"`);
    assert(/no se aprobó: Nota QA/.test(r.userToast), `aviso a quien envió: "${r.userToast}"`);
    assert(r.pub === 'Ministerio QA' && r.status === 'approved', `aprobado: ${JSON.stringify(r)}`);
  });

  await check('Reportar un loop de la comunidad, verlo en Moderación y descartarlo', async () => {
    const r = await run(async ({ title }) => {
      const lib = await window.__qa.lib();
      const pack = (await lib.listPacks({ refresh: true })).find((p) => p.title === title);
      const [loop] = await lib.listLoops({ packId: pack.id }, { refresh: true });
      const first = await lib.reportLoop(loop.id, 'quality', 'QA: suena saturado');
      const again = await lib.reportLoop(loop.id, 'quality');
      const ov = await window.__qa.uploader({ tab: 'review' });
      await window.__qa.sleep(1500);
      const shown = !!ov.querySelector(`[data-report="${loop.id}"]`);
      ov.querySelector(`[data-report="${loop.id}"] [data-act=dismissReport]`)?.click();
      await window.__qa.sleep(2000);
      ov.querySelector('[data-act=close]').click();
      const left = (await lib.adminReports()).some((x) => x.loop_id === loop.id);
      return { first, again, shown, left };
    }, { title: COMMUNITY });
    assert(r.first === 'ok' && r.again === 'already' && r.shown && !r.left, JSON.stringify(r));
  });
} catch (e) {
  results.push([false, 'arranque']);
  console.log(`✖ ${e.message}`);
} finally {
  // Limpieza: SOLO los packs que creó esta prueba (por id).
  if (ws && created.size) {
    try {
      const ids = [...created];
      const left = await run(async ({ ids }) => {
        const lib = await window.__qa.lib();
        for (const id of ids) { try { await lib.adminDeletePack(id); } catch (_) {} }
        const rest = await lib.adminListPacks();
        return ids.filter((id) => rest.some((p) => p.id === id));
      }, { ids });
      console.log(left.length ? `⚠ No se pudieron borrar: ${left.join(', ')}` : `(limpieza: ${ids.length} pack(s) de prueba borrados)`);
    } catch (e) { console.log(`⚠ Limpieza falló: ${e.message}`); }
  }
  try { ws?.close(); } catch (_) {}
  const exited = app.exitCode !== null ? Promise.resolve() : new Promise((r) => app.once('exit', r));
  try { app.kill(); } catch (_) {}
  await Promise.race([exited, sleep(8000)]);
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas de administración correctas`);
process.exit(failed ? 1 : 0);
