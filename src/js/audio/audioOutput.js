// Salida de audio: elegir por qué dispositivo suena la app y, en interfaces con
// 4 o más salidas, enviar el click y la guía por las salidas 3-4 (los in-ears)
// mientras el resto sigue por 1-2 (la sala).
//
// Todo el audio de la app comparte UN AudioContext (pads, batería, pista, Stems),
// así que basta con cambiarle el dispositivo (setSinkId) y la forma de la salida.
//
//   listOutputs()                  → [{ id, label }] (el '' es «Predeterminada del sistema»)
//   getSavedOutput() / getClickAlt()
//   applySavedOutput(engine)       → al arrancar: dispositivo guardado + ruta del click
//   setOutput(engine, id, label)   → cambia de dispositivo (y lo recuerda)
//   setClickAlt(engine, on)        → click + guía por 3-4 (devuelve si quedó activo)
//   outputChannels(engine)         → canales del dispositivo actual (2, 4, 8…)
//
// Stems enruta sus pistas de click/guía escuchando el evento 'livepads:audio-routing'.

import { forceStereoOutput } from './stereoOut.js';

const LS_OUT = 'livepads-audio-out';       // { id, label }
const LS_ALT = 'livepads-click-alt';       // '1' = click y guía por 3-4

export function getSavedOutput() {
  try { const j = JSON.parse(localStorage.getItem(LS_OUT) || 'null'); return j && typeof j.id === 'string' ? j : { id: '', label: '' }; }
  catch (_) { return { id: '', label: '' }; }
}
export function getClickAlt() { try { return localStorage.getItem(LS_ALT) === '1'; } catch (_) { return false; } }

export async function listOutputs() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Salida ${i + 1}` }));
  } catch (_) { return []; }
}

export function outputChannels(engine) {
  try { return Number(engine.ctx.destination.maxChannelCount) || 2; } catch (_) { return 2; }
}

// Forma de la salida: estéreo normal, o 4 canales «discretos» (1-2 sala, 3-4 click).
function shapeDestination(ctx, alt) {
  const dest = ctx.destination;
  if (alt && (Number(dest.maxChannelCount) || 0) >= 4) {
    try {
      dest.channelCount = 4;
      dest.channelCountMode = 'explicit';
      dest.channelInterpretation = 'discrete';   // lo estéreo cae en 1-2; 3-4 solo lo que se envíe ahí
      return true;
    } catch (_) { /* cae a estéreo */ }
  }
  forceStereoOutput(ctx);
  return false;
}

// Click del metrónomo de Pads: limitador → salidas 1-2 (normal) o 3-4.
function routePadsClick(engine, alt) {
  const ctx = engine.ctx, lim = engine.clickLimiter;
  if (!lim) return;
  try { lim.disconnect(); } catch (_) {}
  if (alt) {
    if (!engine._clickAlt) {
      const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(4);
      sp.connect(mg, 0, 2); sp.connect(mg, 1, 3);
      mg.connect(ctx.destination);
      engine._clickAlt = sp;
    }
    lim.connect(engine._clickAlt);
  } else {
    lim.connect(ctx.destination);
  }
}

function applyRouting(engine) {
  if (!engine || !engine.ctx) return false;
  const alt = shapeDestination(engine.ctx, getClickAlt());
  routePadsClick(engine, alt);
  try { window.dispatchEvent(new CustomEvent('livepads:audio-routing', { detail: { alt } })); } catch (_) {}
  return alt;
}

/** ¿Está activo ahora mismo el envío por 3-4? (lo consulta Stems al montar). */
export function isAltActive(ctx) {
  try { return getClickAlt() && ctx.destination.channelCount >= 4; } catch (_) { return false; }
}

export async function setOutput(engine, id, label = '') {
  const ctx = engine && engine.ctx;
  if (!ctx || typeof ctx.setSinkId !== 'function') throw new Error('Este equipo no permite elegir la salida desde la app.');
  await ctx.setSinkId(id || '');
  try { localStorage.setItem(LS_OUT, JSON.stringify({ id: id || '', label })); } catch (_) {}
  // Otro dispositivo, otros canales: se vuelve a dar forma a la salida y a enrutar el click.
  return applyRouting(engine);
}

export function setClickAlt(engine, on) {
  try { localStorage.setItem(LS_ALT, on ? '1' : '0'); } catch (_) {}
  return applyRouting(engine);
}

/** Al arrancar: vuelve al dispositivo elegido (si sigue conectado) y a la ruta del click. */
export async function applySavedOutput(engine) {
  const ctx = engine && engine.ctx;
  if (!ctx) return;
  const saved = getSavedOutput();
  if (saved.id && typeof ctx.setSinkId === 'function') {
    try {
      const outs = await listOutputs();
      if (outs.some((o) => o.id === saved.id)) await ctx.setSinkId(saved.id);
      // Si ya no está (interfaz desenchufada) se queda en la predeterminada, sin borrar la elección.
    } catch (_) {}
  }
  if (getClickAlt()) applyRouting(engine);
}
