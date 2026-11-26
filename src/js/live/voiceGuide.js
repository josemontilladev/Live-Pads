// ─────────────────────────────────────────────────────────────────────────
// Voz por los in-ears (bus del click), con las voces en español de la app:
//  · Cuenta hablada: «uno, dos, tres, cuatro» sobre la cuenta de entrada.
//  · Guía hablada automática: un compás antes de cada sección del espectro dice
//    «Verso 2», «Coro», «Puente»… Para originales y secuencias SIN guía propia
//    (si la secuencia ya trae guía en el canal izquierdo, se calla).
// Preferencias: «livepads-countin-voice» (sí por defecto) y «livepads.voiceGuide» (no por defecto).
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { markersFor } from '../data/markers.js';
import { numberFile, sectionFile, nextCue } from './voiceCuesCore.js';
import { guideStatsFast, guideWordsAsync } from './guideCues.js';
import { getPendingJump } from './arrange.js';
import { muteTrackLeft } from '../audio/trackPlayer.js';
import { placePop, claimPop } from '../utils/placePop.js';

const voiceGain = () => { try { const v = parseFloat(localStorage.getItem('livepads.voiceGain')); return v >= 0 && v <= 1.5 ? v : 0.9; } catch (_) { return 0.9; } };
export const countVoiceOn = () => { try { return localStorage.getItem('livepads-countin-voice') !== '0'; } catch (_) { return true; } };
export const voiceGuideOn = () => { try { return localStorage.getItem('livepads.voiceGuide') === '1'; } catch (_) { return false; } };

let deps = { getEngine: () => null };
const cache = new Map();

async function buffer(file) {
  const ctx = deps.getEngine()?.ctx;
  if (!ctx || !file) return null;
  let p = cache.get(file);
  if (!p) { p = fetch(encodeURI(file)).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)); cache.set(file, p); }
  try { return await p; } catch (_) { cache.delete(file); return null; }
}
/** Suena una voz en el momento `when` (reloj del motor) por el bus del click. */
async function playAt(file, when) {
  const e = deps.getEngine(), ctx = e && e.ctx;
  const buf = await buffer(file);
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = voiceGain();
  src.connect(g); g.connect(e.clickBus || ctx.destination);
  src.start(Math.max(ctx.currentTime, when));
}

/** Dice una sección o indicación ya (p. ej. al preparar un salto del arreglo), si la guía hablada está activa. */
export function sayNow(label) {
  if (!voiceGuideOn()) return;
  const ctx = deps.getEngine()?.ctx;
  const f = sectionFile(label);
  if (ctx && f) playAt(f, ctx.currentTime + 0.03);
}

/** Cuenta hablada sobre la cuenta de entrada: números en cada pulso (t0 = primer pulso, reloj del motor). */
export function speakCount(beats, t0, interval) {
  // Con la guía hablada y una pista que empieza por una sección: «Intro… tres, cuatro».
  const first = leadInLabel();
  const f0 = first && sectionFile(first);
  if (f0) {
    playAt(f0, t0);
    for (let i = Math.max(1, beats - 2); i < beats; i++) { const f = numberFile(i + 1); if (f) playAt(f, t0 + i * interval); }
    return;
  }
  if (!countVoiceOn()) return;
  for (let i = 0; i < beats; i++) { const f = numberFile(i + 1); if (f) playAt(f, t0 + i * interval); }
}
/** Sección con la que empieza la pista (si la guía hablada está activa, la pista no trae guía y está al principio). */
function leadInLabel() {
  if (!voiceGuideOn() || !audio || !song || isOwnGuide()) return null;
  if ((audio.currentTime || 0) > 0.5) return null;
  const first = markersFor(song, type).slice().sort((a, b) => a.t - b.t)[0];
  return first && first.t < barSec() ? first.label : null;
}
/** ¿Hace falta un compás de entrada antes de arrancar? (guía hablada activa y pista al principio) */
export function leadInWanted() { return !!leadInLabel(); }
/** Para tenerlas listas antes de la primera cuenta. */
export function preloadCount() { for (let n = 1; n <= 7; n++) buffer(numberFile(n)); }

// ── Guía automática ─────────────────────────────────────────────────────
let audio = null, song = null, type = '', ownGuide = null, said = new Set(), lastT = 0, timer = 0;

function barSec() {
  const bpm = parseFloat(song && song.bpm) || 0;
  const beats = parseInt(String((song && song.timeSig) || '4/4').split('/')[0], 10) || 4;
  return bpm > 0 ? (60 / bpm) * beats : 2;
}
// ¿La secuencia ya trae su guía grabada? (se mira una vez por pista)
function isOwnGuide() {
  if (ownGuide == null && audio && audio.buffer) {
    try { ownGuide = type === 'sequence' && audio.buffer.numberOfChannels > 1 && guideStatsFast(audio.buffer.getChannelData(0), audio.buffer.getChannelData(1), audio.buffer.sampleRate).guide; }
    catch (_) { ownGuide = false; }
  }
  return !!ownGuide;
}
let ownWords = null, ownWordsP = null;
function recordedWords() {
  if (ownWords == null && !ownWordsP && audio && audio.buffer) {
    const a = audio;
    ownWordsP = guideWordsAsync(a.buffer.getChannelData(0), a.buffer.sampleRate).then((w) => { if (audio === a) ownWords = w; }).catch(() => { ownWords = []; });
  }
  return ownWords || [];
}

// Salto preparado con el arreglo en vivo: un compás antes del salto se dice la sección
// a la que se va (no la que venía en la pista). Si la secuencia trae guía grabada, esa
// palabra se calla para que no diga la sección equivocada.
function announceJump(pj, now, e) {
  const bar = barSec();
  const key = `jump:${pj.at}:${pj.to}`;
  if (said.has(key) || now < pj.at - bar - 0.6) return;
  said.add(key);
  // El aviso natural de la sección que iba a venir en ese punto ya no toca.
  for (const m of markersFor(song, type)) if (Math.abs(m.t - pj.at) < 0.15) said.add(m.id || `${m.label}@${m.t}`);
  if (isOwnGuide()) for (const w of recordedWords()) if (w.e > pj.at - bar * 1.6 && w.s < pj.at + 0.05) muteTrackLeft(w.s - 0.03, w.e + 0.05);
  const f = sectionFile(pj.label);
  const rate = audio.playbackRate || 1;
  if (f) playAt(f, e.ctx.currentTime + Math.max(0, (pj.at - bar - now) / rate));
}

function tick() {
  if (!audio || audio.paused || !song) return;
  const e = deps.getEngine();
  if (!e || !e.ctx) return;
  const now = audio.currentTime || 0;
  if (now < lastT - 1) said = new Set();          // volvió atrás (o repitió): se puede avisar otra vez
  lastT = now;
  const pj = getPendingJump();
  // Con guía grabada, el salto se corrige siempre; con la guía de LivePads, si está activa.
  if (pj && isOwnGuide()) recordedWords();   // empieza a buscarlas en cuanto hay un salto preparado
  if (pj && (isOwnGuide() || voiceGuideOn())) announceJump(pj, now, e);
  if (!voiceGuideOn() || isOwnGuide()) return;
  const rate = audio.playbackRate || 1;
  const cue = nextCue(markersFor(song, type), now, barSec());   // tiempos de la pista (no cambian con la velocidad)
  if (!cue) return;
  const id = cue.marker.id || `${cue.marker.label}@${cue.marker.t}`;
  if (said.has(id)) return;
  said.add(id);
  if (pj && Math.abs(cue.marker.t - pj.at) < 0.15) return;   // en ese punto se salta a otra sección
  const f = sectionFile(cue.marker.label);
  if (f) playAt(f, e.ctx.currentTime + Math.max(0, (cue.at - now) / rate));
}

// ── Panel «Voz» (botón del espectro) ────────────────────────────────────
// Los mismos interruptores que en Opciones del metrónomo, donde uno los busca:
// junto a las secciones. Se mantienen sincronizados (misma preferencia).
const SWITCHES = [
  { key: 'livepads.voiceGuide', def: '0', mirror: 'voice-guide-toggle', title: 'Guía hablada', sub: 'Un compás antes de cada sección dice «Verso», «Coro», «Puente»… (si la secuencia ya trae guía, se calla).' },
  { key: 'livepads-countin', def: '0', mirror: 'countin-toggle', title: 'Cuenta de entrada', sub: 'Un compás antes de arrancar la secuencia.' },
  { key: 'livepads-countin-voice', def: '1', mirror: 'countin-voice-toggle', title: 'Cuenta hablada', sub: 'Con la cuenta de entrada: «uno, dos, tres, cuatro».' },
];
const getPref = (k, d) => { try { return (localStorage.getItem(k) ?? d) === '1'; } catch (_) { return d === '1'; } };
function paintVoiceBtn() {
  const b = document.getElementById('sw-voice');
  if (!b) return;
  const on = voiceGuideOn();
  b.classList.toggle('is-on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
let panel = null;
let releasePop = null;

function closeVoicePanel() {
  if (!panel) return;
  panel.remove(); panel = null;
  document.removeEventListener('pointerdown', outside, true);

  if (releasePop) { releasePop(); releasePop = null; }
}
function outside(e) { if (panel && !panel.contains(e.target) && !e.target.closest('#sw-voice')) closeVoicePanel(); }
export function toggleVoicePanel(anchor) {
  if (panel) { closeVoicePanel(); return; }
  panel = document.createElement('div');
  panel.className = 'vg-pop';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `<div class="vg-title">Voz por los in-ears</div>${SWITCHES.map((s) => `<label class="vg-row"><span><b>${s.title}</b><small>${s.sub}</small></span><input type="checkbox" class="mo-switch" data-key="${s.key}" ${getPref(s.key, s.def) ? 'checked' : ''}></label>`).join('')}
    <label class="vg-vol"><span>Volumen de la voz</span><input type="range" min="0" max="1.5" step="0.05" value="${voiceGain()}" data-ref="vol"></label>
    <button type="button" class="vg-test" data-ref="test">Probar la voz</button>`;
  document.body.appendChild(panel);
  releasePop = claimPop('voice', closeVoicePanel);   // «Arreglo» u otro panel abierto: se cierra
  placePop(panel, anchor);

  panel.addEventListener('change', (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    try { localStorage.setItem(k, e.target.checked ? '1' : '0'); } catch (_) {}
    const s = SWITCHES.find((x) => x.key === k), m = s && document.getElementById(s.mirror);
    if (m) m.checked = e.target.checked;
    if (k === 'livepads-countin-voice' && e.target.checked) preloadCount();
    paintVoiceBtn();
  });
  panel.querySelector('[data-ref="vol"]').addEventListener('input', (e) => { try { localStorage.setItem('livepads.voiceGain', e.target.value); } catch (_) {} });
  panel.querySelector('[data-ref="test"]').addEventListener('click', () => { const ctx = deps.getEngine()?.ctx; if (ctx) playAt(sectionFile('Coro'), ctx.currentTime + 0.05); });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

export function initVoiceGuide(d) {
  deps = { ...deps, ...d };
  window.addEventListener('livepads:track-loaded', (ev) => {
    audio = ev.detail && ev.detail.audio; song = ev.detail && ev.detail.song; type = (ev.detail && ev.detail.type) || '';
    ownGuide = null; ownWords = null; ownWordsP = null; said = new Set(); lastT = 0;
  });
  window.addEventListener('livepads:track-cleared', () => { audio = null; song = null; });
  if (typeof timer === 'function') timer();
  timer = whilePlaying(tick, 100);
  // Interruptores en Opciones del metrónomo.
  const bind = (id, key, def) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    try { cb.checked = (localStorage.getItem(key) ?? def) === '1'; } catch (_) {}
    cb.onchange = () => { try { localStorage.setItem(key, cb.checked ? '1' : '0'); } catch (_) {} if (cb.checked && id === 'countin-voice-toggle') preloadCount(); };
  };
  bind('countin-voice-toggle', 'livepads-countin-voice', '1');
  bind('voice-guide-toggle', 'livepads.voiceGuide', '0');
  document.getElementById('voice-guide-toggle')?.addEventListener('change', paintVoiceBtn);
  document.getElementById('sw-voice')?.addEventListener('click', (e) => { e.stopPropagation(); toggleVoicePanel(e.currentTarget); });
  paintVoiceBtn();
  if (countVoiceOn()) setTimeout(preloadCount, 4000);
}
