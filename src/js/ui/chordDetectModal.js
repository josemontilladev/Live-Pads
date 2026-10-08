// ─────────────────────────────────────────────────────────────────────────
// Detector de acordes (estilo Chord AI) — herramienta independiente, como el
// afinador y el metrónomo. Tres fuentes:
//   · Pista cargada: reutiliza el audio YA decodificado de la Secuencia/Pista
//     (no vuelve a leer el archivo) y sigue la reproducción acorde por acorde.
//   · Abrir archivo: cualquier mp3/m4a/wav/ogg/flac del PC.
//   · En vivo: escucha el micrófono y muestra el acorde que suena.
//
// Para no cargar el PC:
//   · Este módulo, su CSS y el motor solo se cargan al abrir el panel (import()
//     dinámico desde app.js); al cerrarlo se destruye el worker y se libera el
//     micrófono y su AudioContext.
//   · El análisis corre en un Web Worker (chords/chordWorker.js), nunca en el
//     hilo de la interfaz ni en el de audio.
//   · El audio se reduce a mono 11 025 Hz antes de analizar (≈ 8 veces menos
//     datos que el original) y el resultado se guarda: abrir otra vez la misma
//     canción es instantáneo.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from './modalStack.js';
import { CHORD_SR, chordName, keyName, pitchClasses, makeResampler } from '../chords/chordEngine.js';
import { analyzeInWorker, stopChordWorker } from '../chords/chordWorker.js';
import { getTrackAudio, getCurrentSong, getCurrentType, getTrackPitch } from '../audio/trackPlayer.js';

const LS_PREFS = 'livepads.chords';
const LS_CACHE = 'livepads.chords.v1.';
const MAX_CACHE = 40;

let prefs = { basic: true, latin: false, tab: 'track' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (_) {}
function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (_) {} }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Caché de resultados (localStorage, con límite) ──
function cacheGet(id) {
  try { const s = localStorage.getItem(LS_CACHE + id); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
function cachePut(id, result) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_CACHE)) keys.push(k);
    }
    // Si hay demasiados, se borran los más viejos (guardamos la fecha dentro).
    if (keys.length >= MAX_CACHE) {
      keys.map(k => { let at = 0; try { at = JSON.parse(localStorage.getItem(k)).at || 0; } catch (_) {} return [k, at]; })
        .sort((a, b) => a[1] - b[1]).slice(0, keys.length - MAX_CACHE + 1)
        .forEach(([k]) => { try { localStorage.removeItem(k); } catch (_) {} });
    }
    localStorage.setItem(LS_CACHE + id, JSON.stringify({ ...result, at: Date.now() }));
  } catch (_) { /* sin espacio: simplemente no se guarda */ }
}

// ── Audio → mono 11 025 Hz ──
// AudioBuffer (cualquier frecuencia y canales) → mono 11 025 Hz con el
// remuestreo nativo del navegador (filtrado correcto, rapidísimo).
async function bufferToMono(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * CHORD_SR));
  const off = new OfflineAudioContext(1, len, CHORD_SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}
// Archivo → decodificado directamente a 11 025 Hz y promediado a mono.
async function fileToMono(arrayBuffer) {
  const off = new OfflineAudioContext(1, 1, CHORD_SR);
  const buf = await off.decodeAudioData(arrayBuffer);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  const g = 1 / buf.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// ── Estado del panel ──
let overlay = null, popModal = null;
let analysis = null;      // resultado del motor
let source = null;        // { kind: 'track'|'file', title, songId, type }
let shift = 0;            // transponer (semitonos)
let busy = false;
let syncTimer = null, lastSegIdx = -2, lastBarIdx = -2;

const $ = (sel) => overlay && overlay.querySelector(sel);
const nameOf = (c) => (c && c.r >= 0) ? chordName(c, { latin: prefs.latin, basic: prefs.basic, shift }) : '—';

function setStatus(text, kind) {
  const el = $('.chd-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `chd-status${kind ? ' ' + kind : ''}${text ? '' : ' hidden'}`;
}
function setProgress(p, label) {
  const box = $('.chd-progress');
  if (!box) return;
  box.classList.toggle('hidden', p == null);
  if (p == null) return;
  box.querySelector('.chd-bar-fill').style.width = `${Math.round(p * 100)}%`;
  box.querySelector('.chd-progress-lbl').textContent = label || '';
}

// Teclado de una octava con las notas del acorde (bajo resaltado aparte).
function pianoSvg(c) {
  const pcs = new Set(pitchClasses(c).map(p => (p + shift + 120) % 12));
  const bass = c && c.r >= 0 ? (((c.b >= 0 ? c.b : c.r) + shift) % 12 + 12) % 12 : -1;
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
  const W = 26, H = 86;
  let s = `<svg class="chd-piano" viewBox="0 0 ${W * 14} ${H}" aria-hidden="true">`;
  for (let o = 0; o < 2; o++) {
    whites.forEach((pc, i) => {
      const on = pcs.has(pc), isBass = o === 0 && pc === bass;
      s += `<rect x="${(o * 7 + i) * W + 0.5}" y="0.5" width="${W - 1}" height="${H - 1}" rx="3" class="wk${on ? ' on' : ''}${isBass ? ' bass' : ''}"/>`;
    });
  }
  for (let o = 0; o < 2; o++) {
    blacks.forEach(([pc, after]) => {
      const on = pcs.has(pc), isBass = o === 0 && pc === bass;
      s += `<rect x="${(o * 7 + after) * W - 8}" y="0" width="16" height="${H * 0.6}" rx="2" class="bk${on ? ' on' : ''}${isBass ? ' bass' : ''}"/>`;
    });
  }
  return s + '</svg>';
}

// ── Pestañas ──
function renderTab() {
  overlay.querySelectorAll('.chd-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === prefs.tab));
  overlay.querySelectorAll('.chd-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== prefs.tab));
  if (prefs.tab !== 'live') stopLive();
  // El resultado de la pista/archivo no se mezcla con el modo en vivo.
  $('.chd-result').classList.toggle('hidden', prefs.tab === 'live' || !analysis);
  if (prefs.tab === 'track') renderTrackPane();
  if (prefs.tab === 'live') renderLive();
}

function trackInfo() {
  const audio = getTrackAudio();
  const song = getCurrentSong();
  if (!audio || !song) return null;
  const type = getCurrentType();
  const buf = audio.buffer;
  return { audio, song, type, buf, id: `${song.id || song.title}.${type}.${buf ? Math.round(buf.duration) : 0}` };
}

function renderTrackPane() {
  const pane = $('[data-pane="track"]');
  const info = trackInfo();
  const kind = info ? (info.type === 'sequence' ? 'Secuencia' : info.type === 'original' ? 'Pista original' : 'Audio') : '';
  pane.querySelector('.chd-src').innerHTML = info
    ? `<div class="chd-src-title">${esc(info.song.title || 'Canción')}</div><div class="chd-src-sub">${esc(kind)}${info.buf ? ' · ' + fmtTime(info.buf.duration) : ' · cargando…'}</div>`
    : `<div class="chd-src-title">No hay ninguna pista cargada</div><div class="chd-src-sub">Toca la Secuencia o la Pista de una canción y vuelve aquí, o usa «Abrir archivo».</div>`;
  const btn = pane.querySelector('.chd-run-track');
  btn.disabled = !info || !info.buf || busy;
  // La pista todavía se está decodificando: se vuelve a mirar en un momento.
  clearTimeout(renderTrackPane._t);
  if (info && !info.buf) renderTrackPane._t = setTimeout(() => { if (overlay && prefs.tab === 'track') renderTrackPane(); }, 600);
  // Si ya está analizada (caché), se muestra al instante.
  if (info && info.buf && (!source || source.id !== info.id)) {
    const cached = cacheGet(info.id);
    if (cached) showResult(cached, { kind: 'track', id: info.id, title: info.song.title, songId: info.song.id, type: info.type });
  }
}

async function runTrack(force) {
  const info = trackInfo();
  if (!info || !info.buf || busy) return;
  if (!force) {
    const cached = cacheGet(info.id);
    if (cached) { showResult(cached, { kind: 'track', id: info.id, title: info.song.title, songId: info.song.id, type: info.type }); return; }
  }
  busy = true; setStatus(''); renderTrackPane();
  try {
    setProgress(0.02, 'Preparando el audio…');
    const x = await bufferToMono(info.buf);
    const r = await analyzeInWorker(x, (p, l) => setProgress(p, l));
    cachePut(info.id, r);
    showResult(r, { kind: 'track', id: info.id, title: info.song.title, songId: info.song.id, type: info.type });
  } catch (e) {
    if (overlay && String(e && e.message) !== 'cancelado') setStatus('No se pudo analizar el audio. ' + ((e && e.message) || ''), 'error');
  } finally {
    busy = false; setProgress(null);
    if (overlay) renderTrackPane();
  }
}

async function runFile(file) {
  if (!file || busy) return;
  const id = `file.${file.name}.${file.size}`;
  const title = file.name.replace(/\.[^.]+$/, '');
  const cached = cacheGet(id);
  if (cached) { showResult(cached, { kind: 'file', id, title }); return; }
  busy = true; setStatus('');
  try {
    setProgress(0.02, 'Leyendo el archivo…');
    const x = await fileToMono(await file.arrayBuffer());
    const r = await analyzeInWorker(x, (p, l) => setProgress(p, l));
    cachePut(id, r);
    showResult(r, { kind: 'file', id, title });
  } catch (e) {
    if (overlay && String(e && e.message) !== 'cancelado') setStatus('No se pudo leer ese archivo. Prueba con un MP3, M4A o WAV.', 'error');
  } finally {
    busy = false; setProgress(null);
  }
}

// ── Resultado: tono, BPM, acorde actual, hoja de acordes por compases ──
function fmtTime(s) { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

function bars() {
  const a = analysis;
  if (!a || a.beats.length < 8) return null;
  const starts = [];
  for (let i = a.db; i < a.beats.length; i += 4) starts.push(a.beats[i]);
  if (!starts.length || starts[0] > 0.3) starts.unshift(0);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const t0 = starts[i], t1 = i + 1 < starts.length ? starts[i + 1] : a.d;
    const chords = [];
    for (const s of a.seg) {
      if (s.e <= t0 + 0.05 || s.s >= t1 - 0.05) continue;
      const n = nameOf(s);
      if (chords[chords.length - 1] !== n) chords.push(n);
    }
    out.push({ t0, t1, chords });
  }
  return out;
}

let barList = null;
function showResult(r, src) {
  analysis = r; source = src;
  shift = src.kind === 'track' ? (getTrackPitch() || 0) : 0;
  lastSegIdx = -2; lastBarIdx = -2;
  renderResult();
  startSync();
}

function renderResult() {
  const box = $('.chd-result');
  if (!box) return;
  if (!analysis) { box.classList.add('hidden'); return; }
  box.classList.toggle('hidden', prefs.tab === 'live');
  const a = analysis;
  $('.chd-key').textContent = keyName(a, { latin: prefs.latin, shift });
  $('.chd-bpm').textContent = Math.round(a.bpm);
  $('.chd-shift-val').textContent = shift > 0 ? `+${shift}` : String(shift);
  $('.chd-res-title').textContent = source ? source.title : '';
  // Acordes de la canción (sin repetir)
  const uniq = [];
  for (const s of a.seg) { if (s.r < 0) continue; const n = nameOf(s); if (!uniq.includes(n)) uniq.push(n); }
  $('.chd-uniq').innerHTML = uniq.map(n => `<span class="chd-chip">${esc(n)}</span>`).join('');
  // Hoja por compases (o segmentos si no hubo pulso fiable)
  barList = bars();
  const sheet = $('.chd-sheet');
  if (barList) {
    let prev = null;
    sheet.innerHTML = barList.map((b, i) => {
      const txt = b.chords.length ? b.chords.join(' ') : '—';
      const rep = txt === prev; prev = txt;
      return `<button type="button" class="chd-barcell${rep ? ' rep' : ''}" data-i="${i}" data-t="${b.t0}">${esc(txt)}</button>`;
    }).join('');
  } else {
    sheet.innerHTML = a.seg.filter(s => s.r >= 0).map((s, i) => `<button type="button" class="chd-barcell" data-i="${i}" data-t="${s.s}">${esc(nameOf(s))}</button>`).join('');
  }
  lastSegIdx = -2; lastBarIdx = -2;
  paintNow(true);
}

function isSyncedToTrack() {
  if (!source || source.kind !== 'track') return false;
  const info = trackInfo();
  return !!(info && info.id === source.id);
}
function segIndexAt(t) {
  const s = analysis.seg;
  for (let i = 0; i < s.length; i++) if (t >= s[i].s && t < s[i].e) return i;
  return s.length - 1;
}
function paintNow(force) {
  if (!analysis || !overlay) return;
  const synced = isSyncedToTrack();
  const audio = synced ? getTrackAudio() : null;
  const t = audio ? audio.currentTime : 0;
  const si = synced ? segIndexAt(t) : -1;
  if (si !== lastSegIdx || force) {
    lastSegIdx = si;
    const segs = analysis.seg;
    let cur = si >= 0 ? segs[si] : null;
    if (cur && cur.r < 0) cur = null;
    let next = null;
    for (let k = Math.max(0, si + 1); k < segs.length; k++) { if (segs[k].r >= 0 && nameOf(segs[k]) !== nameOf(cur)) { next = segs[k]; break; } }
    $('.chd-now').textContent = synced ? nameOf(cur) : '—';
    $('.chd-next').textContent = synced && next ? nameOf(next) : '—';
    $('.chd-now-lbl').textContent = synced ? 'AHORA' : 'Reproduce la pista para seguir los acordes';
    $('.chd-diagram').innerHTML = pianoSvg(synced ? cur : null);
  }
  // Compás actual resaltado + autoscroll suave
  let bi = -1;
  if (synced) {
    if (barList) { for (let i = 0; i < barList.length; i++) if (t >= barList[i].t0 && t < barList[i].t1) { bi = i; break; } }
    else bi = analysis.seg.filter(s => s.r >= 0).findIndex(s => t >= s.s && t < s.e);
  }
  if (bi !== lastBarIdx || force) {
    lastBarIdx = bi;
    const sheet = $('.chd-sheet');
    sheet.querySelectorAll('.chd-barcell.cur').forEach(el => el.classList.remove('cur'));
    const el = bi >= 0 ? sheet.querySelector(`.chd-barcell[data-i="${bi}"]`) : null;
    if (el) {
      el.classList.add('cur');
      const top = el.offsetTop - sheet.offsetTop, h = sheet.clientHeight;
      if (top < sheet.scrollTop || top > sheet.scrollTop + h - el.offsetHeight * 2) sheet.scrollTo({ top: Math.max(0, top - el.offsetHeight), behavior: 'smooth' });
    }
  }
}
function startSync() {
  stopSync();
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') paintNow(false); }, 120);
}
function stopSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }

// ── En vivo (micrófono) ──
const KEEP_S = 12, WINDOW_S = 8;
let live = null; // { ctx, stream, src, proc, mute, ring, len, timer, busy, candidate, hits, current, history, keyVotes, bpms, level }

async function startLive() {
  if (live) return;
  setLiveStatus('Pidiendo micrófono…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } });
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setLiveStatus(denied ? 'Micrófono bloqueado. Permítelo en la privacidad de Windows y vuelve a intentarlo.' : 'No se pudo abrir el micrófono. Revisa que haya uno conectado.', 'error');
    return;
  }
  if (!overlay) { stream.getTracks().forEach(t => t.stop()); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor: solo copia muestras (trabajo mínimo); el análisis va al worker.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0; // sin monitoreo (evita acople)
  const resample = makeResampler(ctx.sampleRate);
  const ring = new Float32Array(CHORD_SR * KEEP_S);
  const tmp = [];
  live = { ctx, stream, src, proc, mute, ring, len: 0, busy: false, candidate: null, hits: 0, current: null, history: [], keyVotes: new Map(), bpms: [], level: 0 };
  proc.onaudioprocess = (e) => {
    if (!live) return;
    const input = e.inputBuffer.getChannelData(0);
    let sq = 0;
    for (let i = 0; i < input.length; i += 4) sq += input[i] * input[i];
    live.level = Math.sqrt(sq / (input.length / 4));
    tmp.length = 0;
    resample(input, tmp);
    const L = live;
    if (L.len + tmp.length > ring.length) {
      const drop = L.len + tmp.length - ring.length;
      ring.copyWithin(0, drop, L.len);
      L.len -= drop;
    }
    for (let i = 0; i < tmp.length; i++) ring[L.len++] = tmp[i];
  };
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  live.timer = setInterval(liveTick, 1000);
  live.meter = setInterval(() => {
    const el = $('.chd-level-fill');
    if (el && live) el.style.width = `${Math.min(100, Math.round(Math.sqrt(live.level) * 220))}%`;
  }, 80);
  setLiveStatus('Escuchando… pon la canción cerca del micrófono.');
  renderLive();
}

async function liveTick() {
  const L = live;
  if (!L || L.busy || L.len < CHORD_SR * 3) return;
  const n = Math.min(L.len, CHORD_SR * WINDOW_S);
  const x = L.ring.slice(L.len - n, L.len);
  let rms = 0;
  for (let i = 0; i < x.length; i += 8) rms += x[i] * x[i];
  rms = Math.sqrt(rms / (x.length / 8));
  if (rms < 0.004) { setLiveStatus('No se oye nada… sube el volumen o acerca el micrófono.'); return; }
  L.busy = true;
  try {
    const a = await analyzeInWorker(x);
    if (live !== L) return;
    // Acorde que suena ahora: el del último segundo y medio; se confirma con dos aciertos seguidos.
    let now = null;
    for (let k = a.seg.length - 1; k >= 0; k--) {
      const s = a.seg[k];
      if (s.r < 0) continue;
      if (s.e >= a.d - 1.6) now = s;
      break;
    }
    if (now) {
      const key = `${now.r}.${now.q}.${now.b}`;
      if (L.candidate === key) L.hits++; else { L.candidate = key; L.hits = 1; }
      const basicName = (c) => chordName(c, { basic: prefs.basic });
      if (L.hits >= 2 && (!L.current || basicName(L.current) !== basicName(now))) {
        if (L.current) { L.history.unshift(L.current); if (L.history.length > 8) L.history.pop(); }
        L.current = { r: now.r, q: now.q, b: now.b };
      }
    }
    const kk = a.k * 2 + (a.m ? 1 : 0);
    L.keyVotes.set(kk, (L.keyVotes.get(kk) || 0) + 1);
    if (a.beats.length >= 8) { L.bpms.push(a.bpm); if (L.bpms.length > 12) L.bpms.shift(); }
    setLiveStatus('Escuchando…');
  } catch (_) {
  } finally {
    L.busy = false;
    if (live === L) renderLive();
  }
}

function stopLive() {
  const L = live;
  if (!L) return;
  live = null;
  clearInterval(L.timer); clearInterval(L.meter);
  try { L.proc.onaudioprocess = null; L.src.disconnect(); L.proc.disconnect(); L.mute.disconnect(); } catch (_) {}
  try { L.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
  try { L.ctx.close(); } catch (_) {}
  if (overlay) { setLiveStatus(''); renderLive(); const el = $('.chd-level-fill'); if (el) el.style.width = '0%'; }
}

function setLiveStatus(text, kind) {
  const el = $('.chd-live-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `chd-live-status${kind ? ' ' + kind : ''}`;
}

let liveShown = { current: null, history: [], keyVotes: new Map(), bpms: [] };
function renderLive() {
  if (!overlay) return;
  const L = live || liveShown;
  if (live) liveShown = { current: live.current, history: live.history.slice(), keyVotes: new Map(live.keyVotes), bpms: live.bpms.slice() };
  const lname = (c) => (c ? chordName(c, { latin: prefs.latin, basic: prefs.basic, shift: 0 }) : '—');
  $('.chd-live-now').textContent = lname(L.current);
  $('.chd-live-diagram').innerHTML = pianoSvgLive(L.current);
  $('.chd-live-hist').innerHTML = L.history.map(c => `<span class="chd-chip">${esc(lname(c))}</span>`).join('');
  let key = '—';
  if (L.keyVotes.size) {
    const [kk] = [...L.keyVotes.entries()].reduce((p, c) => (c[1] > p[1] ? c : p));
    key = keyName({ k: kk >> 1, m: (kk & 1) === 1 }, { latin: prefs.latin });
  }
  $('.chd-live-key').textContent = key;
  let bpm = '—';
  if (L.bpms.length >= 3) { const s = L.bpms.slice().sort((a, b) => a - b); bpm = String(Math.round(s[Math.floor(s.length / 2)])); }
  $('.chd-live-bpm').textContent = bpm;
  const btn = $('.chd-live-btn');
  btn.textContent = live ? 'Detener' : 'Empezar a escuchar';
  btn.classList.toggle('stop', !!live);
}
function pianoSvgLive(c) { const s = shift; shift = 0; const svg = pianoSvg(c); shift = s; return svg; }

// ── Abrir / cerrar ──
function ensureCss() {
  if (document.getElementById('chd-css')) return;
  const l = document.createElement('link');
  l.id = 'chd-css'; l.rel = 'stylesheet'; l.href = 'css/modules/_chords.css';
  document.head.appendChild(l);
}

export function openChordDetect() {
  if (overlay) return;
  ensureCss();
  overlay = document.createElement('div');
  overlay.id = 'chords-overlay';
  overlay.innerHTML = `
    <div class="chd-panel" role="dialog" aria-label="Detectar acordes">
      <div class="chd-head">
        <h3>Detectar acordes</h3>
        <div class="chd-toggles">
          <div class="chd-seg" data-pref="basic"><button type="button" data-v="1">Básicos</button><button type="button" data-v="0">Todos</button></div>
          <div class="chd-seg" data-pref="latin"><button type="button" data-v="0">C D E</button><button type="button" data-v="1">Do Re Mi</button></div>
        </div>
        <button class="chd-close" type="button" aria-label="Cerrar">✕</button>
      </div>
      <div class="chd-tabs">
        <button type="button" class="chd-tab" data-tab="track">Pista cargada</button>
        <button type="button" class="chd-tab" data-tab="file">Abrir archivo</button>
        <button type="button" class="chd-tab" data-tab="live">En vivo</button>
      </div>

      <div class="chd-pane" data-pane="track">
        <div class="chd-srcrow"><div class="chd-src"></div><button type="button" class="acc-btn chd-run-track">Analizar</button></div>
      </div>
      <div class="chd-pane hidden" data-pane="file">
        <label class="chd-drop">
          <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" hidden>
          <strong>Elegir un archivo de audio</strong>
          <span>MP3, M4A, WAV, OGG o FLAC · también puedes arrastrarlo aquí</span>
        </label>
      </div>
      <div class="chd-pane hidden" data-pane="live">
        <div class="chd-live">
          <div class="chd-stats"><div><span>Tono</span><b class="chd-live-key">—</b></div><div><span>BPM</span><b class="chd-live-bpm">—</b></div></div>
          <div class="chd-live-now">—</div>
          <div class="chd-live-diagram"></div>
          <div class="chd-live-hist"></div>
          <div class="chd-level"><div class="chd-level-fill"></div></div>
          <button type="button" class="acc-btn chd-live-btn">Empezar a escuchar</button>
          <div class="chd-live-status"></div>
          <div class="chd-note">Pon la canción en otro equipo o deja que el micrófono escuche a la banda. Detección automática: úsala como guía.</div>
        </div>
      </div>

      <div class="chd-progress hidden"><div class="chd-bar"><div class="chd-bar-fill"></div></div><div class="chd-progress-lbl"></div></div>
      <div class="chd-status hidden"></div>

      <div class="chd-result hidden">
        <div class="chd-res-head">
          <div class="chd-res-title"></div>
          <button type="button" class="chd-reanalyze" title="Analizar de nuevo">↻</button>
        </div>
        <div class="chd-stats">
          <div><span>Tono</span><b class="chd-key">—</b></div>
          <div><span>BPM</span><b class="chd-bpm">—</b></div>
          <div class="chd-shift"><span>Transponer</span><span class="chd-shift-ctl"><button type="button" data-sh="-1">−</button><b class="chd-shift-val">0</b><button type="button" data-sh="1">+</button></span></div>
        </div>
        <div class="chd-nowrow">
          <div class="chd-nowbox"><div class="chd-now-lbl">AHORA</div><div class="chd-now">—</div></div>
          <div class="chd-nextbox"><div class="chd-now-lbl">SIGUE</div><div class="chd-next">—</div></div>
          <div class="chd-diagram"></div>
        </div>
        <div class="chd-uniq"></div>
        <div class="chd-sheet"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  popModal = pushModal(() => closeChordDetect());

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeChordDetect(); });
  $('.chd-close').onclick = closeChordDetect;
  overlay.querySelectorAll('.chd-tab').forEach(b => b.onclick = () => { prefs.tab = b.dataset.tab; savePrefs(); renderTab(); });
  overlay.querySelectorAll('.chd-seg').forEach(seg => {
    const key = seg.dataset.pref;
    const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b.dataset.v === '1') === !!prefs[key]));
    paint();
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { prefs[key] = b.dataset.v === '1'; savePrefs(); paint(); renderResult(); renderLive(); });
  });
  $('.chd-run-track').onclick = () => runTrack(false);
  $('.chd-reanalyze').onclick = () => { if (source && source.kind === 'track') runTrack(true); else if (source) { try { localStorage.removeItem(LS_CACHE + source.id); } catch (_) {} setStatus('Vuelve a elegir el archivo para analizarlo de nuevo.'); } };
  overlay.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { shift = Math.max(-11, Math.min(11, shift + parseInt(b.dataset.sh, 10))); renderResult(); });
  const input = $('.chd-drop input');
  input.onchange = () => { const f = input.files && input.files[0]; input.value = ''; runFile(f); };
  const drop = $('.chd-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) runFile(f); });
  $('.chd-live-btn').onclick = () => (live ? stopLive() : startLive());
  // Clic en un compás: la pista salta ahí (si es la pista analizada).
  $('.chd-sheet').addEventListener('click', (e) => {
    const b = e.target.closest('.chd-barcell');
    if (!b || !isSyncedToTrack()) return;
    const audio = getTrackAudio();
    if (audio) { audio.currentTime = parseFloat(b.dataset.t) || 0; paintNow(true); }
  });
  // Si cambian de canción con el panel abierto, se refresca la pestaña.
  window.addEventListener('livepads:track-loaded', onTrackLoaded);

  renderTab();
  requestAnimationFrame(() => overlay && overlay.classList.add('open'));
}
function onTrackLoaded() { if (overlay && prefs.tab === 'track') setTimeout(() => overlay && renderTrackPane(), 400); }

export function closeChordDetect() {
  if (!overlay) return;
  stopLive();
  stopSync();
  stopChordWorker();
  busy = false;
  window.removeEventListener('livepads:track-loaded', onTrackLoaded);
  if (popModal) { popModal(); popModal = null; }
  overlay.classList.remove('open');
  const node = overlay; overlay = null;
  analysis = null; source = null; barList = null;
  setTimeout(() => node.remove(), 180);
}

export function isChordDetectOpen() { return overlay !== null; }
