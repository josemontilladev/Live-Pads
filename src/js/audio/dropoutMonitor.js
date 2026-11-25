// ─────────────────────────────────────────────────────────────────────────
// Monitor de cortes de audio. Cuando el equipo no llega a tiempo a entregar el
// audio (otra app pesada, ahorro de energía, Bluetooth, USB saturado…) se oye
// un clic o un hueco. Chromium los cuenta (AudioContext.playbackStats:
// underrunEvents); aquí se vigilan cada 2 s y, si pasan MIENTRAS suena algo, se
// avisa con qué hacer. Ajustes → Audio muestra el recuento de la sesión y el
// interruptor «Audio estable» (más búfer: algo más de latencia, menos cortes).
//
// Sin dependencias (lo importan SynthEngine, trackPlayer y Stems al crear su contexto).
// ─────────────────────────────────────────────────────────────────────────

const STABLE_KEY = 'livepads.audioStable';
const contexts = new Set();
const last = new WeakMap();      // ctx → underrunEvents de la última lectura
const events = [];               // marcas de tiempo (ms) de cortes con algo sonando
let total = 0, totalIdle = 0, lastWarn = 0, timer = null;
let deps = { isBusy: () => true };
const listeners = new Set();

export function stableAudioOn() { try { return localStorage.getItem(STABLE_KEY) === '1'; } catch (_) { return false; } }
export function setStableAudio(on) { try { localStorage.setItem(STABLE_KEY, on ? '1' : '0'); } catch (_) {} }
/** latencyHint para un AudioContext nuevo: búfer mínimo, o más holgado en «Audio estable». */
export function audioLatencyHint() { return stableAudioOn() ? 'playback' : 'interactive'; }

export function registerAudioContext(ctx) {
  if (!ctx || contexts.has(ctx)) return;
  contexts.add(ctx);
  start();
}

export function dropoutStats() {
  const now = Date.now();
  return { total, lastMinute: events.filter((t) => now - t < 60000).length, lastAt: events.length ? events[events.length - 1] : 0, supported: supported() };
}
export function onDropout(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function supported() {
  for (const c of contexts) { try { if (c.playbackStats && typeof c.playbackStats.underrunEvents === 'number') return true; } catch (_) {} }
  return false;
}

function read(ctx) {
  try { const s = ctx.playbackStats; return s && typeof s.underrunEvents === 'number' ? s.underrunEvents : null; } catch (_) { return null; }
}

function check() {
  if (document.hidden) return;
  let fresh = 0;
  for (const ctx of contexts) {
    if (ctx.state === 'closed') { contexts.delete(ctx); continue; }
    if (ctx.state !== 'running') continue;
    const n = read(ctx);
    if (n == null) continue;
    const prev = last.get(ctx);
    last.set(ctx, n);
    if (prev != null && n > prev) fresh += n - prev;
  }
  if (!fresh) return;
  let busy = true;
  try { busy = !!deps.isBusy(); } catch (_) {}
  if (!busy) { totalIdle += fresh; return; }   // cortes de silencio: no se oyen
  total += fresh;
  const now = Date.now();
  for (let i = 0; i < fresh; i++) events.push(now);
  while (events.length > 200) events.shift();
  for (const fn of listeners) { try { fn(dropoutStats()); } catch (_) {} }
  warn(now);
}

function warn(now) {
  if (now - lastWarn < 90000) return;     // como mucho un aviso cada minuto y medio
  lastWarn = now;
  const n = events.filter((t) => now - t < 60000).length;
  const tip = stableAudioOn()
    ? 'Cierra otras apps, conecta el cargador y usa el modo de energía de máximo rendimiento.'
    : 'Cierra otras apps y conecta el cargador; si sigue, activa «Audio estable» en Ajustes → Audio.';
  window.showToast?.(`Se cortó el audio ${n === 1 ? 'una vez' : `${n} veces`} en el último minuto. ${tip}`, 'warning', stableAudioOn() ? {} : {
    action: { label: 'Ajustes de audio', onClick: () => import('../ui/overlays.js').then((m) => m.openSidebarTab('audio')).catch(() => {}) },
  });
}

function start() {
  if (timer) return;
  timer = setInterval(check, 2000);
}

export function initDropoutMonitor(d = {}) {
  deps = { ...deps, ...d };
  start();
}
