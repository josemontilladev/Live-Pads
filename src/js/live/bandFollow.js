// ─────────────────────────────────────────────────────────────────────────
// La letra sigue a la banda (sin pista). Panel «Letra» → Herramientas →
// «La letra sigue a la banda».
// El micrófono reconoce el acorde que está tocando la banda (el mismo motor de
// «Detectar acordes») y la letra avanza hasta la línea donde está ese acorde:
// busca un poco por delante y, si no lo encuentra, salta al comienzo de una
// sección que empiece así (repetir coro, volver al verso…).
// Límites: necesita la letra con acordes; con progresiones iguales en varias
// secciones (p. ej. verso y coro con G–D–Em–C) puede quedarse en la sección
// equivocada hasta oír un acorde distinto: el líder puede tocar una línea para
// recolocarlo. No reconoce la voz (lo que se canta), solo la armonía.
// ─────────────────────────────────────────────────────────────────────────

import { CHORD_SR, makeResampler } from '../chords/chordEngine.js';
import { analyzeInWorker } from '../chords/chordWorker.js';
import { chordTokens, advance } from './bandFollowCore.js';

const KEEP_S = 6, WINDOW_S = 4;
let L = null; // { ctx, stream, src, proc, mute, ring, len, timer, busy, cand, hits, tokens, rows, pos, sig }

const vis = (e) => !!(e && e.offsetParent !== null);
const body = () => [...document.querySelectorAll('.lyp-body, .ll-body')].find(vis) || null;
const button = () => document.getElementById('ll-band');
export const isBandFollowing = () => !!L;
export function toggleBandFollow() { if (L) stopBandFollow(); else startBandFollow(); }

function chordsOf(el) {
  const names = el.querySelectorAll('.cn-name');
  if (names.length) return Array.from(names, (n) => n.textContent.trim());
  if (el.classList.contains('chord-line')) return el.textContent.trim().split(/\s+/);
  return Array.from(el.querySelectorAll('.inline-chord'), (n) => n.textContent.trim());
}

/** Lee la hoja que se ve ahora (se rehace si cambia de canción o de tono). */
function readSheet() {
  const b = body();
  if (!b) return;
  const sig = b.innerHTML.length + ':' + (b.firstElementChild?.textContent || '');
  if (L.sig === sig) return;
  L.sig = sig;
  const rows = [], lines = [];
  let pendingSection = true;
  b.querySelectorAll('.section-header-line, .chord-line, .lyric-line').forEach((el) => {
    if (el.classList.contains('section-header-line')) { pendingSection = true; return; }
    const chords = chordsOf(el);
    rows.push(el);
    lines.push({ chords, section: pendingSection && chords.length > 0 });
    if (chords.length) pendingSection = false;
  });
  L.rows = rows;
  L.tokens = chordTokens(lines);
  L.pos = -1;
}

function show(pos) {
  if (!L || pos < 0 || !L.tokens[pos]) return;
  const t = L.tokens[pos];
  // La línea de acordes va pegada a la de letra que tiene debajo: se marca esa.
  let el = L.rows[t.line];
  if (el && el.classList.contains('chord-line') && el.nextElementSibling?.classList.contains('lyric-line')) el = el.nextElementSibling;
  document.querySelectorAll('.ll-band-now').forEach((x) => x.classList.remove('ll-band-now'));
  if (!el) return;
  el.classList.add('ll-band-now');
  const b = body();
  if (b) b.scrollTo({ top: Math.max(0, el.offsetTop - b.clientHeight * 0.34), behavior: 'smooth' });
}

async function tick() {
  const S = L;
  if (!S || S.busy || S.len < CHORD_SR * 2) return;
  if (!body()) { stopBandFollow(); return; } // se cerró la letra
  readSheet();
  if (!S.tokens.length) { button()?.setAttribute('title', 'Esta letra no tiene acordes: no se puede seguir a la banda.'); return; }
  const n = Math.min(S.len, CHORD_SR * WINDOW_S);
  const x = S.ring.slice(S.len - n, S.len);
  let rms = 0;
  for (let i = 0; i < x.length; i += 8) rms += x[i] * x[i];
  if (Math.sqrt(rms / (x.length / 8)) < 0.004) return;
  S.busy = true;
  try {
    const a = await analyzeInWorker(x);
    if (L !== S) return;
    let now = null;
    for (let k = a.seg.length - 1; k >= 0; k--) {
      const s = a.seg[k];
      if (s.r < 0) continue;
      if (s.e >= a.d - 1.6) now = s;
      break;
    }
    if (!now) return;
    const heard = { pc: now.r, minor: now.q === 1 || now.q === 4 };
    const key = heard.pc + (heard.minor ? 'm' : '');
    if (S.cand === key) S.hits++; else { S.cand = key; S.hits = 1; }
    if (S.hits !== 2) return; // confirmado dos veces seguidas, una sola vez
    const next = advance(S.tokens, S.pos, heard);
    if (next !== S.pos) { S.pos = next; show(next); }
  } catch (_) {
  } finally { S.busy = false; }
}

// Tocar una línea recoloca el seguimiento ahí.
function onBodyClick(e) {
  if (!L) return;
  const el = e.target.closest('.lyric-line, .chord-line');
  if (!el) return;
  readSheet();
  let i = L.rows.indexOf(el);
  if (i > 0 && !L.tokens.some((t) => t.line === i) && L.rows[i - 1].classList.contains('chord-line')) i -= 1;
  const tk = L.tokens.findIndex((t) => t.line >= i);
  if (tk >= 0) { L.pos = tk; show(tk); }
}

export async function startBandFollow() {
  if (L) return;
  if (!body()) { window.showToast?.('Abre primero la letra de la canción.', 'info'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } });
  } catch (_) { window.showToast?.('No se pudo abrir el micrófono.', 'error'); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  const resample = makeResampler(ctx.sampleRate);
  const ring = new Float32Array(CHORD_SR * KEEP_S);
  const tmp = [];
  L = { ctx, stream, src, proc, mute, ring, len: 0, busy: false, cand: null, hits: 0, tokens: [], rows: [], pos: -1, sig: null };
  proc.onaudioprocess = (e) => {
    const S = L;
    if (!S) return;
    tmp.length = 0;
    resample(e.inputBuffer.getChannelData(0), tmp);
    if (S.len + tmp.length > ring.length) {
      const drop = S.len + tmp.length - ring.length;
      ring.copyWithin(0, drop, S.len);
      S.len -= drop;
    }
    for (let i = 0; i < tmp.length; i++) ring[S.len++] = tmp[i];
  };
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  L.timer = setInterval(tick, 900);
  L.bodyEl = body();
  L.bodyEl?.addEventListener('click', onBodyClick);
  paint();
  window.showToast?.('La letra sigue a la banda por los acordes. Toca una línea para recolocarla.', 'info');
}

export function stopBandFollow() {
  const S = L;
  if (!S) return;
  L = null;
  clearInterval(S.timer);
  try { S.proc.onaudioprocess = null; S.src.disconnect(); S.proc.disconnect(); S.mute.disconnect(); } catch (_) {}
  S.stream.getTracks().forEach((t) => t.stop());
  try { S.ctx.close(); } catch (_) {}
  S.bodyEl?.removeEventListener('click', onBodyClick);
  document.querySelectorAll('.ll-band-now').forEach((x) => x.classList.remove('ll-band-now'));
  paint();
}

function paint() {
  const b = button();
  if (!b) return;
  b.classList.toggle('is-on', !!L);
  b.title = L ? 'Siguiendo a la banda por el micrófono (pulsa para parar)' : 'La letra sigue a la banda sin pista: escucha los acordes por el micrófono y avanza sola';
}

export function initBandFollow() {
  // El panel de letra se crea más tarde: se escucha el clic en todo el documento.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ll-band')) return;
    if (L) stopBandFollow(); else startBandFollow();
  });
}
