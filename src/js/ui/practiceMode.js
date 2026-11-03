// ─────────────────────────────────────────────────────────────────────────
// Modo práctica (Pads): reproduce la Secuencia o el Original MÁS LENTO sin cambiar
// el tono, y repite un tramo A–B en bucle sin cortes. Vive en la franja de la onda
// (#seq-wave): botón «Práctica» en la cabecera + panel plegable + tramo dibujado
// sobre la onda con dos asas arrastrables.
//
// Atajos (si no estás escribiendo): [ marca A · ] marca B · \ activa/desactiva el bucle.
// El motor está en audio/pitchAudio.js (playbackRate + setLoopRegion).
// ─────────────────────────────────────────────────────────────────────────

import { showToast } from './toast.js';
import { parseLyricStructure, mapMarkersToLyrics } from './songStructure.js';

const OPEN_KEY = 'livepads-practice-open';
const MIN_RATE = 0.25, MAX_RATE = 1.25, MIN_SPAN = 0.5;

let root, panel, btn, stage, wave, overlay, hA, hB;
let audio = null, song = null, secsEl = null;
let rate = 1, A = null, B = null, loopOn = false;
// Práctica guiada: 80 % + cuenta de entrada + sube 5 % por vuelta hasta 100 %.
let picked = null;            // { a, b, label } sección elegida en el panel
let loopLabel = null;         // nombre de la sección que se repite (para la letra)
let guided = false, guideTimer = 0, lastT = 0, countingIn = false, clickCtx = null;
let lyricsEl = null, lyricLines = [], lyricsFor = '';
const RAMP_KEY = 'livepads-practice-ramp', LYR_KEY = 'livepads-practice-lyrics';
const pref = (k) => { try { return localStorage.getItem(k) !== '0'; } catch (_) { return true; } };

const $ = (sel, el = document) => el.querySelector(sel);
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const dur = () => (audio && Number.isFinite(audio.duration) ? audio.duration : 0);

export function initPracticeMode() {
  root = $('#seq-wave');
  panel = $('.sw-practice');
  btn = $('#sw-practice');
  if (!root || !panel || !btn || root.dataset.practice) return;
  root.dataset.practice = '1';
  stage = $('.sw-stage', root);
  wave = $('.sw-wave', root);

  // Tramo A–B dibujado sobre la onda.
  overlay = document.createElement('div');
  overlay.className = 'sw-ab hidden';
  overlay.innerHTML = '<div class="sw-ab-fill"></div><div class="sw-ab-h sw-ab-h--a" title="Inicio del tramo (A) — arrastra"><b>A</b></div><div class="sw-ab-h sw-ab-h--b" title="Fin del tramo (B) — arrastra"><b>B</b></div>';
  wave.appendChild(overlay);
  hA = $('.sw-ab-h--a', overlay); hB = $('.sw-ab-h--b', overlay);
  bindHandle(hA, 'A'); bindHandle(hB, 'B');

  // Siempre arranca cerrado: la pantalla de Pads se ve limpia y la práctica se abre a demanda.
  try { localStorage.removeItem(OPEN_KEY); } catch (_) {}
  setOpen(false);
  btn.onclick = () => { setOpen(!root.classList.contains('is-practice')); };

  // Velocidad
  panel.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => setRate(parseFloat(b.dataset.rate)); });
  $('#sp-slower').onclick = () => setRate(rate - 0.05);
  $('#sp-faster').onclick = () => setRate(rate + 0.05);
  $('#sp-rate').ondblclick = () => setRate(1);

  // Tramo A–B
  $('#sp-a').onclick = markA;
  $('#sp-b').onclick = markB;
  $('#sp-loop').onclick = toggleLoop;
  $('#sp-clear').onclick = clearRegion;

  // Secciones de la canción como botones: un clic = repetir esa sección.
  secsEl = document.createElement('div');
  secsEl.className = 'sp-group sp-secs';
  secsEl.innerHTML = `<span class="sp-label">Repetir sección</span><div class="sp-secs-list"></div>
    <button type="button" class="sp-practice" title="Practica la sección elegida (o la que suena): al 80 %, con cuenta de entrada, y sube la velocidad sola">▶ Practicar</button>
    <label class="sp-opt" title="En cada vuelta del bucle sube un 5 % hasta llegar al 100 %"><input type="checkbox" data-opt="ramp"> Subir 5 % por vuelta</label>
    <label class="sp-opt" title="Muestra grande sobre la onda la letra de la sección que se repite"><input type="checkbox" data-opt="lyrics"> Letra</label>`;
  panel.appendChild(secsEl);
  secsEl.querySelector('[data-opt="ramp"]').checked = pref(RAMP_KEY);
  secsEl.querySelector('[data-opt="lyrics"]').checked = pref(LYR_KEY);
  secsEl.addEventListener('change', (e) => {
    const o = e.target.dataset && e.target.dataset.opt; if (!o) return;
    try { localStorage.setItem(o === 'ramp' ? RAMP_KEY : LYR_KEY, e.target.checked ? '1' : '0'); } catch (_) {}
    paintLyrics(true);
  });
  secsEl.addEventListener('click', (e) => {
    if (e.target.closest('.sp-practice')) { guided ? stopGuided(true) : startGuided(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    picked = { a: parseFloat(b.dataset.a), b: parseFloat(b.dataset.b), label: b.dataset.label };
    loopSection(picked.a, picked.b, picked.label);
  });
  // Letra de la sección en bucle, grande sobre la onda.
  lyricsEl = document.createElement('div');
  lyricsEl.className = 'sw-loop-lyrics'; lyricsEl.hidden = true;
  wave.appendChild(lyricsEl);
  window.addEventListener('livepads:track-loaded', (e) => { audio = e.detail && e.detail.audio; song = (e.detail && e.detail.song) || null; reset(); });
  window.addEventListener('livepads:track-cleared', () => { audio = null; song = null; reset(); });
  window.addEventListener('livepads:songs-changed', () => renderSections());
  window.addEventListener('livepads:library-synced', () => renderSections());
  if (audio && !Number.isFinite(audio.duration)) audio.addEventListener?.('loadedmetadata', renderSections, { once: true });
  document.addEventListener('keydown', onKey);
  new ResizeObserver(paintOverlay).observe(stage);
  paint();
}

function setOpen(v) {
  root.classList.toggle('is-practice', v);
  panel.hidden = !v;
  btn.setAttribute('aria-pressed', v ? 'true' : 'false');
}

function reset() {
  stopGuided(false);
  rate = 1; A = B = null; loopOn = false; picked = null; loopLabel = null; lyricsFor = '';
  announceRate();
  paint();
  renderSections();
  if (audio && !(dur() > 0)) { try { audio.addEventListener('loadedmetadata', renderSections, { once: true }); } catch (_) {} setTimeout(renderSections, 1500); }
}

const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderSections() {
  if (!secsEl) return;
  const list = secsEl.querySelector('.sp-secs-list');
  const d = dur();
  const ms = song && Array.isArray(song.markers) ? song.markers.slice().sort((a, b) => a.t - b.t) : [];
  secsEl.hidden = !(ms.length && d);
  if (secsEl.hidden) { list.innerHTML = ''; return; }
  list.innerHTML = ms.map((m, i) => {
    const b = i + 1 < ms.length ? ms[i + 1].t : d;
    const on = loopOn && A != null && Math.abs(A - m.t) < 0.06 && Math.abs(B - b) < 0.06;
    const pk = picked && Math.abs(picked.a - m.t) < 0.06;
    return `<button type="button" class="sp-chip sp-sec${on ? ' is-on' : ''}${pk ? ' is-pick' : ''}" data-a="${m.t}" data-b="${b}" data-label="${escH(m.label)}" title="Repetir «${escH(m.label)}» (${fmt(m.t)} → ${fmt(b)})">${escH(m.label)}</button>`;
  }).join('');
  const pb = secsEl.querySelector('.sp-practice');
  if (pb) {
    pb.classList.toggle('is-on', guided);
    pb.textContent = guided ? '■ Parar práctica' : (picked ? `▶ Practicar «${picked.label}»` : '▶ Practicar');
  }
}

// ── Práctica guiada ────────────────────────────────────────────────────────
function sectionAtPlayhead() {
  const ms = song && Array.isArray(song.markers) ? song.markers.slice().sort((x, y) => x.t - y.t) : [];
  const t = audio ? audio.currentTime || 0 : 0;
  let i = -1;
  ms.forEach((m, k) => { if (m.t <= t + 0.05) i = k; });
  if (i < 0) return null;
  return { a: ms[i].t, b: i + 1 < ms.length ? ms[i + 1].t : dur(), label: ms[i].label };
}
function songBpm() {
  const b = parseFloat(song && song.bpm);
  if (b > 0) return b;
  const d = parseInt((document.getElementById('bpm-display') || {}).textContent, 10);
  return d > 0 ? d : 0;
}
async function countIn(beats, bpm) {
  if (!(bpm > 0)) return;
  try {
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (clickCtx.state === 'suspended') await clickCtx.resume();
  } catch (_) { return; }
  const ctx = clickCtx, spb = 60 / bpm, t0 = ctx.currentTime + 0.08;
  for (let i = 0; i < beats; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = i === 0 ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, t0 + i * spb);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + i * spb + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * spb + 0.09);
    o.connect(g).connect(ctx.destination); o.start(t0 + i * spb); o.stop(t0 + i * spb + 0.12);
  }
  // Número grande sobre la onda mientras cuenta.
  const big = document.createElement('div'); big.className = 'sp-countin'; wave.appendChild(big);
  for (let i = 0; i < beats; i++) {
    big.textContent = String(i + 1);
    const wait = (t0 + i * spb - ctx.currentTime) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    if (!countingIn) break;
  }
  await new Promise((r) => setTimeout(r, Math.max(0, (t0 + beats * spb - ctx.currentTime) * 1000)));
  big.remove();
}
async function startGuided() {
  if (!need()) return;
  const sec = picked || sectionAtPlayhead();
  if (!sec) { showToast('Esta canción no tiene secciones: marca A y B, o detecta las secciones en la onda.', 'info'); return; }
  picked = sec;
  guided = true; countingIn = true;
  try { audio.pause(); } catch (_) {}
  setRate(0.8);
  A = Math.round(sec.a * 10) / 10; B = Math.round(sec.b * 10) / 10; loopOn = true; loopLabel = sec.label;
  try { audio.currentTime = A; } catch (_) {}
  apply();
  const beats = parseInt(String((song && song.timeSig) || '4/4').split('/')[0], 10) || 4;
  await countIn(beats, songBpm() * rate);
  countingIn = false;
  if (!guided) return;
  try { audio.currentTime = A; await audio.play(); } catch (_) {}
  lastT = audio.currentTime || A;
  clearInterval(guideTimer);
  guideTimer = setInterval(onGuideTick, 120);
  showToast(`Practicando «${sec.label}» al ${Math.round(rate * 100)} %${pref(RAMP_KEY) ? ': sube un 5 % en cada vuelta' : ''}.`, 'info');
  renderSections();
}
function stopGuided(pause) {
  if (!guided && !countingIn) return;
  guided = false; countingIn = false;
  clearInterval(guideTimer); guideTimer = 0;
  if (pause && audio) { try { audio.pause(); } catch (_) {} }
  renderSections();
}
function onGuideTick() {
  if (!guided || !audio || !loopOn) { stopGuided(false); return; }
  const t = audio.currentTime || 0;
  if (t < lastT - 0.4 && pref(RAMP_KEY) && rate < 1) {           // dio la vuelta al bucle
    setRate(Math.min(1, rate + 0.05));
    if (rate >= 1) showToast('¡Ya a velocidad real (100 %)! Sigue repitiendo o pulsa Parar.', 'success');
  }
  lastT = t;
}

// ── Letra de la sección en bucle ───────────────────────────────────────────
function loopLyricLines() {
  const label = loopLabel || (sectionAtPlayhead() || {}).label || '';
  const key = label + '|' + ((song && song.lyrics) || '').length;
  if (key === lyricsFor) return lyricLines;
  lyricsFor = key; lyricLines = [];
  if (!label || !song || !song.lyrics) return lyricLines;
  try {
    const lyr = parseLyricStructure(song.lyrics);
    const j = mapMarkersToLyrics([{ label }], lyr)[0];
    if (j >= 0) lyricLines = lyr[j].lines.slice();
  } catch (_) {}
  return lyricLines;
}
function paintLyrics(force) {
  if (!lyricsEl) return;
  const show = loopOn && A != null && B != null && pref(LYR_KEY) && !!audio;
  const lines = show ? loopLyricLines() : [];
  if (!lines.length) { lyricsEl.hidden = true; return; }
  // La línea que toca según por dónde va el bucle (aprox.), y la siguiente.
  const t = audio.currentTime || 0;
  const p = Math.min(0.999, Math.max(0, (t - A) / Math.max(0.5, B - A)));
  const i = Math.floor(p * lines.length);
  const html = `<small>${escH(loopLabel || '')}</small>${escH(lines[i])}${lines[i + 1] ? `<div style="opacity:.55;font-size:.8em">${escH(lines[i + 1])}</div>` : ''}`;
  if (force || lyricsEl.dataset.i !== String(i) || lyricsEl.hidden) { lyricsEl.innerHTML = html; lyricsEl.dataset.i = String(i); }
  lyricsEl.hidden = false;
}
let lyrTimer = 0;
function lyricsLoop() {
  paintLyrics(true);
  if (lyrTimer) return;
  lyrTimer = setInterval(() => {
    if (!loopOn) { clearInterval(lyrTimer); lyrTimer = 0; paintLyrics(true); return; }
    paintLyrics(false);
  }, 150);
}

/**
 * Repite el tramo [a, b] en bucle (una sección, o lo que se dibujó con Mayús +
 * arrastrar). preview = solo dibujarlo mientras se arrastra.
 */
export function loopSection(a, b, label, { preview = false } = {}) {
  if (!need() || !(b - a >= MIN_SPAN)) { if (preview && audio) { A = a; B = null; paint(); } return; }
  A = Math.round(a * 10) / 10; B = Math.round(b * 10) / 10;
  if (preview) { loopOn = false; paint(); return; }
  loopOn = true; loopLabel = label || null; lyricsFor = '';
  if (!root.classList.contains('is-practice')) setOpen(true);
  try { audio.currentTime = A; } catch (_) {}
  apply();
  showToast(label ? `Repitiendo «${label}» (${fmt(A)} → ${fmt(B)}). Cambia la velocidad abajo o pulsa \\ para soltar el bucle.` : `Repitiendo ${fmt(A)} → ${fmt(B)}. Arrastra A o B para ajustar.`, 'info');
}

function announceRate() {
  try { window.dispatchEvent(new CustomEvent('livepads:practice-rate', { detail: { rate } })); } catch (_) {}
}

function need() {
  if (audio) return true;
  showToast('Carga una canción (Sec u Orig) para usar el modo práctica.', 'info');
  return false;
}

// ── Velocidad ──────────────────────────────────────────────────────────────
function setRate(r) {
  if (!need()) return;
  rate = Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(r * 20) / 20));
  try { audio.playbackRate = rate; } catch (_) {}
  announceRate();
  paint();
}

// ── Tramo A–B ──────────────────────────────────────────────────────────────
function markA() {
  if (!need()) return;
  A = Math.round((audio.currentTime || 0) * 10) / 10;
  if (B != null && B - A < MIN_SPAN) B = null;
  afterMark();
}
function markB() {
  if (!need()) return;
  if (A == null) A = 0;
  const t = Math.round((audio.currentTime || 0) * 10) / 10;
  if (t - A < MIN_SPAN) { showToast('B debe estar después de A: avanza la canción y vuelve a marcar.', 'info'); return; }
  B = t;
  afterMark();
}
function afterMark() {
  loopOn = A != null && B != null;
  apply();
}
function toggleLoop() {
  if (!need()) return;
  if (A == null || B == null) { showToast('Marca el punto A y el punto B para repetir ese tramo.', 'info'); return; }
  loopOn = !loopOn;
  if (loopOn && (audio.currentTime < A || audio.currentTime > B)) audio.currentTime = A;
  apply();
}
function clearRegion() {
  stopGuided(false);
  A = B = null; loopOn = false; loopLabel = null;
  apply();
}
function apply() {
  if (audio) {
    try {
      if (loopOn && A != null && B != null) audio.setLoopRegion(A, B); else audio.clearLoopRegion();
    } catch (_) {}
  }
  paint();
}

// ── Pintado ────────────────────────────────────────────────────────────────
function paint() {
  const rr = Math.round(rate * 100);
  $('#sp-rate').textContent = rr + '%';
  panel.querySelectorAll('[data-rate]').forEach((b) => b.classList.toggle('is-on', Math.abs(parseFloat(b.dataset.rate) - rate) < 0.001));
  $('#sp-a').classList.toggle('is-set', A != null);
  $('#sp-b').classList.toggle('is-set', B != null);
  $('#sp-read').textContent = A == null && B == null ? 'Sin tramo' : `${A != null ? fmt(A) : '—'} → ${B != null ? fmt(B) : '—'}${A != null && B != null ? ` · ${Math.round(B - A)} s` : ''}`;
  const lp = $('#sp-loop');
  lp.classList.toggle('is-on', loopOn);
  lp.setAttribute('aria-pressed', loopOn ? 'true' : 'false');
  $('#sp-clear').disabled = A == null && B == null;
  panel.classList.toggle('has-slow', rate !== 1);
  const bpm = parseInt((document.getElementById('bpm-display') || {}).textContent, 10);
  const clk = $('#sp-click');
  if (clk) clk.textContent = Number.isFinite(bpm) ? `Click a ${Math.round(bpm * rate)} BPM (${bpm} × ${Math.round(rate * 100)} %)` : 'El click sigue la velocidad';
  // El botón de la cabecera avisa si hay algo activo aunque el panel esté cerrado.
  btn.classList.toggle('is-active', rate !== 1 || loopOn);
  btn.querySelector('.sw-practice-state').textContent = rate !== 1 ? rr + '%' : (loopOn ? 'A–B' : '');
  paintOverlay();
  renderSections();
  if (loopOn) lyricsLoop(); else paintLyrics(true);
}

function paintOverlay() {
  if (!overlay) return;
  const d = dur();
  const show = d > 0 && (A != null || B != null);
  overlay.classList.toggle('hidden', !show);
  overlay.classList.toggle('is-looping', loopOn);
  if (!show) return;
  const a = A != null ? (A / d) * 100 : 0;
  const b = B != null ? (B / d) * 100 : (A != null ? a : 100);
  const fill = $('.sw-ab-fill', overlay);
  fill.style.left = a + '%';
  fill.style.width = Math.max(0, b - a) + '%';
  hA.style.display = A != null ? '' : 'none';
  hB.style.display = B != null ? '' : 'none';
  hA.style.left = a + '%';
  hB.style.left = b + '%';
}

// ── Asas arrastrables ──────────────────────────────────────────────────────
function timeAtX(x) {
  const r = stage.getBoundingClientRect();
  return Math.min(dur(), Math.max(0, ((x - r.left) / r.width) * dur()));
}
function bindHandle(h, which) {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !dur()) return;
    e.preventDefault(); e.stopPropagation();           // no mover la reproducción
    h.setPointerCapture(e.pointerId);
    const move = (ev) => {
      let t = Math.round(timeAtX(ev.clientX) * 10) / 10;
      if (which === 'A') A = B != null ? Math.min(t, B - MIN_SPAN) : t;
      else B = A != null ? Math.max(t, A + MIN_SPAN) : t;
      if (A != null && A < 0) A = 0;
      if (loopOn && A != null && B != null && audio) { try { audio.setLoopRegion(A, B); } catch (_) {} }
      paint();
    };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); apply(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  h.addEventListener('click', (e) => e.stopPropagation());
}

// ── Atajos ─────────────────────────────────────────────────────────────────
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (!audio) return;
  if (e.key === '[') { e.preventDefault(); markA(); }
  else if (e.key === ']') { e.preventDefault(); markB(); }
  else if (e.key === '\\') { e.preventDefault(); toggleLoop(); }
}
