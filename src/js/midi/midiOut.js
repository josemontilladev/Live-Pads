// ─────────────────────────────────────────────────────────────────────────
// Sonidos del teclado automáticos (salida MIDI). Al preparar una canción,
// LivePads envía al teclado su sonido (cambio de programa, con banco opcional);
// y mientras suena la pista, al llegar a una sección marcada (Coro, Puente…)
// envía el sonido de esa sección. El tecladista deja de buscar sonidos en vivo.
//
// Se guarda POR EQUIPO (no en la nube): los números de programa son de cada
// teclado, el de un tecladista no le sirve a otro.
//   livepads.midiOut        → { outputId, outputName, channel (1-16), enabled }
//   livepads.midiOut.songs  → { [songId]: { pc, msb, lsb, sections: { [etiqueta]: pc } } }
// Programas 1-128 (como los muestran los teclados); se envían 0-127.
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { getSongs, getActiveSongId } from '../state/store.js';

import { markersFor } from '../data/markers.js';
const DEV_KEY = 'livepads.midiOut';
const SONGS_KEY = 'livepads.midiOut.songs';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (_) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

export function deviceSettings() { return { outputId: '', outputName: '', channel: 1, enabled: true, ...read(DEV_KEY, {}) }; }
export function setDeviceSettings(p) { write(DEV_KEY, { ...deviceSettings(), ...p }); }
export function songPatch(id) { return id == null ? null : (read(SONGS_KEY, {})[id] || null); }
export function setSongPatch(id, patch) {
  const all = read(SONGS_KEY, {});
  if (patch) all[id] = patch; else delete all[id];
  write(SONGS_KEY, all);
}

let access = null;
async function midi() {
  if (access) return access;
  if (!navigator.requestMIDIAccess) return null;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch (_) { access = null; }
  return access;
}
export async function listOutputs() {
  const a = await midi();
  return a ? [...a.outputs.values()].map((o) => ({ id: o.id, name: o.name || 'Salida MIDI' })) : [];
}
async function output() {
  const a = await midi();
  if (!a) return null;
  const d = deviceSettings();
  const outs = [...a.outputs.values()];
  return outs.find((o) => o.id === d.outputId) || outs.find((o) => d.outputName && o.name === d.outputName) || null;
}

/** Mensajes MIDI de un cambio de sonido (puro; probado en tests/midiOut.test.mjs). */
export function programMessages({ pc, msb = null, lsb = null }, channel = 1) {
  const c = (Math.max(1, Math.min(16, channel | 0)) - 1) & 0x0f;
  const p = Math.max(1, Math.min(128, pc | 0)) - 1;
  const out = [];
  if (Number.isInteger(msb) && msb >= 0 && msb <= 127) out.push([0xB0 | c, 0, msb]);
  if (Number.isInteger(lsb) && lsb >= 0 && lsb <= 127) out.push([0xB0 | c, 32, lsb]);
  out.push([0xC0 | c, p]);
  return out;
}

/** Envía un sonido ya mismo. Devuelve false si no hay salida elegida o conectada. */
export async function sendProgram(patch, channel = deviceSettings().channel) {
  if (!patch || !(patch.pc >= 1)) return false;
  const o = await output();
  if (!o) return false;
  for (const m of programMessages(patch, channel)) o.send(m);
  return true;
}

/** Sección vigente en el segundo t según las marcas de la canción (o null). */
export function sectionAt(markers, t) {
  const ms = (Array.isArray(markers) ? markers : []).filter((m) => m && Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
  let cur = null;
  for (const m of ms) { if (m.t <= t + 0.05) cur = m; else break; }
  return cur;
}

// ── Automático ──
let lastSongId = null, lastSection = null, audio = null, timer = null, trackType = '';
const activeSong = () => { try { const id = getActiveSongId(); return id == null ? null : getSongs().find((s) => s.id === id) || null; } catch (_) { return null; } };

function onSongState() {
  if (!deviceSettings().enabled) return;
  const s = activeSong();
  const id = s ? s.id : null;
  if (id === lastSongId) return;
  lastSongId = id; lastSection = null;
  const p = songPatch(id);
  if (p) sendProgram(p);
}

function tick() {
  if (!audio || audio.paused || !deviceSettings().enabled) return;
  const s = activeSong();
  const p = s && songPatch(s.id);
  if (!p || !p.sections) return;
  const sec = sectionAt(markersFor(s, trackType), audio.currentTime || 0);
  const label = sec ? sec.label : null;
  if (label === lastSection) return;
  lastSection = label;
  const pc = label ? p.sections[label] : null;
  // Al volver a una parte sin sonido propio, vuelve el sonido de la canción.
  sendProgram(pc ? { pc } : p);
}

export function initMidiOut() {
  window.addEventListener('livepads:song-state', onSongState);
  window.addEventListener('livepads:track-loaded', (e) => { audio = e.detail && e.detail.audio; trackType = (e.detail && e.detail.type) || ''; lastSection = null; });
  window.addEventListener('livepads:track-cleared', () => { audio = null; lastSection = null; });
  if (typeof timer === 'function') timer();
  timer = whilePlaying(tick, 150);
  onSongState();
}
