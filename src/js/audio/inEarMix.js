// ─────────────────────────────────────────────────────────────────────────
// Mezcla de los in-ears (salidas 3-4). Con «Click y guía por las salidas 3-4»
// activo, por 3-4 salen el click y la guía; aquí se añade, A UN VOLUMEN PROPIO,
// lo que la banda quiere oír además: pads, batería y pista. La sala (1-2) no
// cambia: son envíos aparte, después del fader de cada parte.
// Sin 3-4 activo los envíos quedan a cero (nada se cuela en la sala).
//   registerInEarSource(ctx, 'pads' | 'drums' | 'track', nodo)   ← SynthEngine / trackPlayer
//   inEarLevels() / setInEarLevel(kind, 0..1.5)
// ─────────────────────────────────────────────────────────────────────────

import { getClickAlt } from './audioOutput.js';

const PREF = 'livepads.inEarMix';
export const IN_EAR_KINDS = { pads: 'Pads', drums: 'Batería', track: 'Pista' };
const states = new Set();

export function inEarLevels() {
  const d = { pads: 0, drums: 0, track: 0 };
  try { Object.assign(d, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (_) {}
  for (const k of Object.keys(d)) d[k] = Math.max(0, Math.min(1.5, Number(d[k]) || 0));
  return d;
}

function active(ctx) {
  try { return getClickAlt() && ctx.destination.channelCount >= 4; } catch (_) { return false; }
}

function ensure(ctx) {
  for (const s of states) if (s.ctx === ctx) return s;
  const sends = {};
  const sum = ctx.createGain();
  for (const k of Object.keys(IN_EAR_KINDS)) { sends[k] = ctx.createGain(); sends[k].gain.value = 0; sends[k].connect(sum); }
  // Protección de oídos: limitador propio antes de los auriculares.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
  const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(4);
  sum.connect(lim); lim.connect(sp);
  sp.connect(mg, 0, 2); sp.connect(mg, 1, 3);
  mg.connect(ctx.destination);
  const s = { ctx, sends };
  states.add(s);
  apply(s);
  return s;
}

function apply(s) {
  const on = active(s.ctx), lv = inEarLevels(), t = s.ctx.currentTime;
  for (const [k, g] of Object.entries(s.sends)) {
    const v = on ? lv[k] : 0;
    try { g.gain.setTargetAtTime(v, t, 0.03); } catch (_) { g.gain.value = v; }
  }
}

/** Conecta una parte (después de su fader) al envío de los in-ears. */
export function registerInEarSource(ctx, kind, node) {
  if (!ctx || !node || !IN_EAR_KINDS[kind]) return;
  try { node.connect(ensure(ctx).sends[kind]); } catch (_) {}
}

export function setInEarLevel(kind, v) {
  if (!IN_EAR_KINDS[kind]) return;
  const lv = { ...inEarLevels(), [kind]: Math.max(0, Math.min(1.5, Number(v) || 0)) };
  try { localStorage.setItem(PREF, JSON.stringify(lv)); } catch (_) {}
  for (const s of states) apply(s);
}

/** ¿Está sonando la mezcla de in-ears? (3-4 activo en un AudioContext registrado). */
export const inEarActive = () => [...states].some((s) => active(s.ctx));

if (typeof window !== 'undefined') window.addEventListener('livepads:audio-routing', () => { for (const s of states) apply(s); });
