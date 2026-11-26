// ─────────────────────────────────────────────────────────────────────────
// Reloj de la pista que suena: para todo lo que sigue a la reproducción
// (mapa de la canción, guía hablada, medley, pad que sigue acordes, click por
// sección, modulación, letra, MIDI, escenario…).
//
// Antes cada módulo tenía su propio setInterval de 5–150 ms funcionando SIEMPRE,
// aunque no sonara nada (~290 despertares por segundo con la app parada). Ahora
// los temporizadores solo existen mientras la pista suena; al pausar, terminar,
// saltar o cambiar de canción cada función se llama una vez para que se ponga al día.
// Con `idleMs`, además se llama despacio mientras no suena (lo que se ve en pantalla).
// ─────────────────────────────────────────────────────────────────────────

const subs = [];
let audio = null, playing = false, bound = false;

const safe = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (_) {} };

// Con `when` en falso (p. ej. canción sin mapa), mientras suena solo se mira cada 250 ms
// si ya hace falta; en cuanto `when` cambia, el ritmo se ajusta solo.
function rate(s) {
  if (!playing) return s.idleMs;
  return s.when && !s.when() ? Math.max(250, s.ms) : s.ms;
}
function arm() {
  for (const s of subs) {
    const want = rate(s);
    if (s.cur === want) continue;
    if (s.timer) clearInterval(s.timer);
    s.timer = want ? setInterval(() => {
      const ok = !s.when || s.when();
      if (ok) safe(s.fn);
      if (rate(s) !== s.cur) arm();
    }, want) : 0;
    s.cur = want;
  }
}
function nudge() { for (const s of subs) if (!s.when || s.when()) safe(s.fn); }

function onPlay() { playing = true; arm(); nudge(); }
function onStop() { playing = !!(audio && !audio.paused); arm(); nudge(); }

function attach(a) {
  if (audio === a) return;
  if (audio) for (const [ev, fn] of LISTEN) audio.removeEventListener(ev, fn);
  audio = a || null;
  if (audio) for (const [ev, fn] of LISTEN) audio.addEventListener(ev, fn);
  playing = !!(audio && !audio.paused);
  arm(); setTimeout(nudge, 0);           // después de que cada módulo haya guardado la pista nueva
}
const LISTEN = [['play', onPlay], ['playing', onPlay], ['pause', onStop], ['ended', onStop], ['seeked', nudge], ['emptied', onStop]];

function bind() {
  if (bound) return;
  bound = true;
  window.addEventListener('livepads:track-loaded', (e) => attach(e.detail && e.detail.audio));
  window.addEventListener('livepads:track-cleared', () => attach(null));
}

/**
 * Llama a `fn` cada `ms` mientras la pista suena (y una vez al pausar, saltar o cambiar).
 * @param {Function} fn
 * @param {number} ms
 * @param {{idleMs?:number, when?:()=>boolean}} [opts]  idleMs: ritmo lento sin sonar (0 = nada);
 *        when: si devuelve false, no se llama (p. ej. el mapa de la canción solo con mapa activo).
 * @returns {() => void}  quita la suscripción
 */
export function whilePlaying(fn, ms, { idleMs = 0, when = null } = {}) {
  bind();
  const s = { fn, ms, idleMs, when, timer: 0, cur: -1 };
  subs.push(s);
  arm();
  return () => { if (s.timer) clearInterval(s.timer); const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
}

/** ¿Suena ahora la pista? (los análisis pesados van más despacio para no quitarle procesador) */
export const isPlaying = () => !!(audio && !audio.paused);

/** Para las pruebas: cuántos temporizadores hay activos ahora. */
export const _clockDebug = () => ({ playing, subs: subs.length, timers: subs.filter((s) => s.timer).length });
