// ─────────────────────────────────────────────────────────────────────────
// Talkback: el director habla por un micrófono y su voz llega SOLO a los
// in-ears de la banda (salidas 3-4, las del click), nunca a la sala.
//   · Botón «Hablar a la banda» en «Indicaciones a la banda»: mantener pulsado =
//     hablar mientras se pulsa; un toque = queda abierto hasta otro toque.
//   · Asignable a un pedal o botón MIDI (o a una tecla) con «Aprender».
//   · Sin salidas 3-4 activas no suena (saldría también por la sala), salvo que se
//     indique que las salidas 1-2 del equipo solo van a los in-ears.
//   · Abierto y olvidado: se cierra solo a los 2 minutos.
// ─────────────────────────────────────────────────────────────────────────

import { isAltActive } from '../audio/audioOutput.js';

const PREF = 'livepads.talkback';
const AUTO_OFF_MS = 120000;
let deps = { getEngine: () => null };
let live = null;          // { stream, nodes…, ctx }
let starting = false, autoOff = null;
const listeners = new Set();

export function talkbackPrefs() {
  const p = { mic: '', volume: 1, mainOk: false };
  try { Object.assign(p, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (_) {}
  p.volume = Math.max(0.2, Math.min(2, Number(p.volume) || 1));
  return p;
}
export function setTalkbackPrefs(patch) {
  const p = { ...talkbackPrefs(), ...patch };
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) {}
  if (live && live.gain && patch.volume != null) { try { live.gain.gain.setTargetAtTime(p.volume, live.ctx.currentTime, 0.03); } catch (_) {} }
  return p;
}

/** Por dónde saldría la voz: 'alt' (3-4, in-ears), 'main' (1-2, solo si se permitió) o null. */
export function talkbackRoute() {
  const e = deps.getEngine();
  if (!e || !e.ctx) return null;
  if (isAltActive(e.ctx)) return 'alt';
  return talkbackPrefs().mainOk ? 'main' : null;
}

export const isTalking = () => !!live;
export function onTalkbackChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() {
  for (const fn of listeners) { try { fn(!!live); } catch (_) {} }
  document.getElementById('btn-cues')?.classList.toggle('is-talking', !!live);
  paintPill();
}

// Entrada a las salidas 3-4 (el mismo divisor que usa el click: audio/audioOutput.js).
function altInput(engine) {
  if (engine._clickAlt) return engine._clickAlt;
  const ctx = engine.ctx;
  const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(4);
  sp.connect(mg, 0, 2); sp.connect(mg, 1, 3);
  mg.connect(ctx.destination);
  engine._clickAlt = sp;
  return sp;
}

export async function startTalkback() {
  if (live || starting) return true;
  const engine = deps.getEngine();
  const route = talkbackRoute();
  if (!engine || !engine.ctx) return false;
  if (!route) {
    window.showToast?.('Para hablar solo a los in-ears activa «Click y guía por las salidas 3-4» (Ajustes → Audio), o marca que tus salidas 1-2 solo van a los in-ears.', 'warning');
    return false;
  }
  starting = true;
  const p = talkbackPrefs();
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: p.mic ? { exact: p.mic } : undefined,
      echoCancellation: false, noiseSuppression: true, autoGainControl: true,
    } });
  } catch (_) {
    try { stream = p.mic ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }) : null; } catch (__) { stream = null; }
  }
  starting = false;
  if (!stream) { window.showToast?.('No se pudo abrir el micrófono para hablar a la banda.', 'error'); return false; }
  const ctx = engine.ctx;
  try { if (ctx.state === 'suspended') await ctx.resume(); } catch (_) {}
  // Voz clara y protegida: sin graves (golpes, ruido de escenario) y con limitador.
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(hp); hp.connect(comp); comp.connect(gain);
  gain.connect(route === 'alt' ? altInput(engine) : ctx.destination);
  try { gain.gain.setTargetAtTime(p.volume, ctx.currentTime, 0.02); } catch (_) { gain.gain.value = p.volume; }
  live = { ctx, stream, src, hp, comp, gain };
  clearTimeout(autoOff);
  autoOff = setTimeout(() => { if (live) { stopTalkback(); window.showToast?.('Talkback cerrado: llevaba 2 minutos abierto.', 'info'); } }, AUTO_OFF_MS);
  emit();
  return true;
}

export function stopTalkback() {
  clearTimeout(autoOff); autoOff = null;
  if (!live) return;
  const l = live; live = null;
  try { l.gain.gain.setTargetAtTime(0, l.ctx.currentTime, 0.02); } catch (_) {}
  setTimeout(() => {
    try { l.src.disconnect(); l.hp.disconnect(); l.comp.disconnect(); l.gain.disconnect(); } catch (_) {}
    try { l.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  }, 120);
  emit();
}

export function toggleTalkback() { if (live) stopTalkback(); else startTalkback(); }

// ── Indicador mientras está abierto (se ve desde cualquier pantalla) ──
let pill = null;
function paintPill() {
  if (!live) { if (pill) { pill.remove(); pill = null; } return; }
  if (!pill) {
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'tb-pill';
    pill.innerHTML = '<i></i><b>Hablando a la banda</b><span>Toca para cortar</span>';
    pill.addEventListener('click', () => stopTalkback());
    document.body.appendChild(pill);
  }
}

// ── Botón (en la paleta de indicaciones): mantener = hablar; toque = abierto ──
export function bindTalkbackButton(btn) {
  let downAt = 0, wasOn = false, releasedHeld = false;
  btn.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    downAt = Date.now(); wasOn = isTalking(); releasedHeld = false;
    if (!wasOn) {
      await startTalkback();
      // Se soltó (tras mantenerlo) antes de que el micrófono terminara de abrirse.
      if (releasedHeld) { releasedHeld = false; stopTalkback(); }
    }
  });
  const up = () => {
    if (!downAt) return;
    const held = Date.now() - downAt; downAt = 0;
    if (wasOn) stopTalkback();               // estaba abierto: este toque lo cierra
    else if (held > 350) { if (isTalking()) stopTalkback(); else releasedHeld = true; }   // mantenido: al soltar se calla
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', () => { if (downAt && Date.now() - downAt > 350) up(); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTalkback(); } });
  const paint = (on) => { btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  paint(isTalking());
  return onTalkbackChange(paint);
}

export function initTalkback(d) {
  deps = { ...deps, ...d };
  // Si cambia la salida (otra interfaz, 3-4 apagado) mientras se habla, se corta por seguridad.
  window.addEventListener('livepads:audio-routing', () => { if (live && talkbackRoute() !== 'alt' && !talkbackPrefs().mainOk) stopTalkback(); });
}
