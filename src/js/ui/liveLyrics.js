// ─────────────────────────────────────────────────────────────────────────
// «Letra en vivo»: la letra con acordes de la canción activa, siempre a la vista en
// una columna propia de Pads (sin abrir la pantalla completa, así los pads, el
// mezclador y la onda siguen a mano).
//
// · Sigue a la canción activa (tarjeta seleccionada) y respeta el tono del servicio.
// · Estilo karaoke: mientras suena la pista, ilumina la línea actual, atenúa lo ya
//   cantado y la mantiene centrada. Los tiempos se estiman con las SECCIONES marcadas
//   en la onda (Verso 1, Coro…) y se reparten entre sus líneas según su longitud.
//   Cuantas más secciones estén marcadas, más exacto queda.
// · Clic en una línea = ir a ese punto de la pista.
// ─────────────────────────────────────────────────────────────────────────

import { getSongs, getActiveSongId } from '../state/store.js';
import { getEffectiveKey } from '../data/service.js';
import { formatLyrics, detectSectionHeader } from './lyricsFormat.js';
import { transposeAll } from './chordTransposer.js';
import { keyDelta, prefersFlats } from '../utils/musicKeys.js';

const OPEN_KEY = 'livepads-livelyrics-open';
const SIZE_KEY = 'livepads-livelyrics-size';
const CHORDS_KEY = 'livepads-livelyrics-chords';
const FOLLOW_KEY = 'livepads-livelyrics-follow';
const AUTO_KEY = 'livepads-livelyrics-auto';

let panel, bodyEl, titleEl, subEl, hintEl, btn;
let audio = null;
let song = null;
let lines = [];          // [{ el, start }]  (start en segundos, estimado)
let active = -1;
let timer = null;
let userScrollUntil = 0;
let sized = 16, showChords = true, follow = true, auto = true;
let lastActiveId = null;
let timingKind = 'none'; // 'sections' | 'whole' | 'none'

const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function initLiveLyrics() {
  const stage = document.getElementById('stage');
  btn = document.getElementById('sw-lyrics');
  if (!stage || !btn || document.getElementById('panel-lyrics')) return;

  sized = Math.max(12, Math.min(30, parseInt(ls(SIZE_KEY, '16'), 10) || 16));
  showChords = ls(CHORDS_KEY, '1') !== '0';
  follow = ls(FOLLOW_KEY, '1') !== '0';
  auto = ls(AUTO_KEY, '1') !== '0';

  panel = document.createElement('aside');
  panel.id = 'panel-lyrics';
  panel.className = 'hidden';
  panel.setAttribute('aria-label', 'Letra en vivo');
  panel.innerHTML = `
    <header class="ll-head">
      <button type="button" class="ll-back" id="ll-close" title="Volver a la lista de canciones (al elegir otra canción, la letra vuelve a abrirse sola)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Canciones
      </button>
      <div class="ll-titles"><b class="ll-title">Letra</b><span class="ll-sub"></span></div>
    </header>
    <div class="ll-tools">
      <button type="button" class="ll-btn" id="ll-chords" title="Mostrar u ocultar los acordes">Acordes</button>
      <button type="button" class="ll-btn ll-btn--icon" id="ll-smaller" title="Letra más pequeña" aria-label="Letra más pequeña">A−</button>
      <button type="button" class="ll-btn ll-btn--icon" id="ll-bigger" title="Letra más grande" aria-label="Letra más grande">A+</button>
      <button type="button" class="ll-btn" id="ll-follow" title="Seguir la canción mientras suena (karaoke) y mantener la línea actual centrada">Seguir</button>
      <button type="button" class="ll-btn" id="ll-auto" title="Abrir la letra automáticamente al elegir una canción">Auto</button>
    </div>
    <div class="ll-body lyrics-text-content"></div>
    <footer class="ll-hint"></footer>`;
  stage.appendChild(panel);
  bodyEl = panel.querySelector('.ll-body');
  titleEl = panel.querySelector('.ll-title');
  subEl = panel.querySelector('.ll-sub');
  hintEl = panel.querySelector('.ll-hint');

  btn.onclick = () => setOpen(panel.classList.contains('hidden'));
  panel.querySelector('#ll-close').onclick = () => setOpen(false);
  panel.querySelector('#ll-chords').onclick = () => { showChords = !showChords; lsSet(CHORDS_KEY, showChords ? '1' : '0'); paintTools(); };
  panel.querySelector('#ll-smaller').onclick = () => setSize(sized - 1);
  panel.querySelector('#ll-bigger').onclick = () => setSize(sized + 1);
  panel.querySelector('#ll-auto').onclick = () => { auto = !auto; lsSet(AUTO_KEY, auto ? '1' : '0'); paintTools(); };
  panel.querySelector('#ll-follow').onclick = () => { follow = !follow; lsSet(FOLLOW_KEY, follow ? '1' : '0'); paintTools(); if (follow) active = -1; };
  // Si la persona desplaza la letra a mano, el seguimiento automático se pausa unos segundos.
  bodyEl.addEventListener('wheel', () => { userScrollUntil = Date.now() + 6000; }, { passive: true });
  bodyEl.addEventListener('pointerdown', () => { userScrollUntil = Date.now() + 6000; });
  bodyEl.addEventListener('click', onLineClick);

  // Al elegir OTRA canción, la letra reemplaza a las tarjetas (si «Auto» está activo).
  const cs = currentSong(); lastActiveId = cs ? cs.id : null;
  window.addEventListener('livepads:song-state', () => {
    const s = currentSong();
    if (s && s.id !== lastActiveId) {
      lastActiveId = s.id;
      if (auto && panel.classList.contains('hidden')) setOpen(true);
    }
    refresh();
  });
  window.addEventListener('livepads:songs-changed', refresh);
  window.addEventListener('livepads:library-synced', refresh);
  window.addEventListener('livepads:track-loaded', (e) => {
    audio = e.detail && e.detail.audio;
    rebuildTiming();
    if (audio && !audio.buffer) { const a = audio; a.addEventListener('loadedmetadata', () => { if (audio === a) rebuildTiming(); }, { once: true }); }
  });
  window.addEventListener('livepads:track-cleared', () => { audio = null; rebuildTiming(); });

  setOpen(ls(OPEN_KEY, '0') === '1');
  paintTools();
  setSize(sized);
  refresh();
}

function setOpen(v) {
  panel.classList.toggle('hidden', !v);
  document.getElementById('stage').classList.toggle('has-lyrics', v);
  btn.setAttribute('aria-pressed', v ? 'true' : 'false');
  btn.classList.toggle('is-active', v);
  lsSet(OPEN_KEY, v ? '1' : '0');
  if (v) { refresh(); startTimer(); } else stopTimer();
}

function setSize(n) {
  sized = Math.max(12, Math.min(30, n));
  lsSet(SIZE_KEY, String(sized));
  panel.style.setProperty('--ll-size', sized + 'px');
}

function paintTools() {
  panel.querySelector('#ll-chords').classList.toggle('is-on', showChords);
  panel.querySelector('#ll-follow').classList.toggle('is-on', follow);
  panel.querySelector('#ll-auto').classList.toggle('is-on', auto);
  bodyEl.classList.toggle('hide-chords', !showChords);
}

// ── Contenido ──────────────────────────────────────────────────────────────
function currentSong() {
  try { const id = getActiveSongId(); return id == null ? null : (getSongs().find((s) => s.id === id) || null); } catch (_) { return null; }
}

let lastSig = '';
function refresh() {
  if (!panel || panel.classList.contains('hidden')) return;
  const s = currentSong();
  const liveKey = s ? getEffectiveKey(s) : '';
  const sig = s ? JSON.stringify([s.id, s.lyrics, s.key, liveKey, s.markers]) : 'none';
  if (sig === lastSig) return;
  lastSig = sig;
  song = s;
  if (!s) {
    titleEl.textContent = 'Letra en vivo';
    subEl.textContent = '';
    bodyEl.innerHTML = '<div class="ll-empty">Elige una canción de la lista: aquí verás su letra y acordes mientras tocas.</div>';
    lines = []; active = -1; hintEl.textContent = '';
    return;
  }
  titleEl.textContent = s.title || 'Sin título';
  const baseKey = s.key || '';
  subEl.textContent = [liveKey || baseKey, s.artist].filter(Boolean).join(' · ');
  if (!s.lyrics || !String(s.lyrics).trim()) {
    bodyEl.innerHTML = '<div class="ll-empty">Esta canción aún no tiene letra. Ábrela en la tarjeta (lápiz) para agregarla.</div>';
    lines = []; active = -1; hintEl.textContent = '';
    return;
  }
  const semis = baseKey && liveKey && baseKey !== liveKey ? keyDelta(baseKey, liveKey) : 0;
  const text = semis ? transposeAll(s.lyrics, semis, prefersFlats(liveKey)) : s.lyrics;
  bodyEl.innerHTML = formatLyrics(text);
  rebuildTiming();
}

// ── Tiempos estimados por línea ────────────────────────────────────────────
function canonOf(label) {
  const h = detectSectionHeader(label);
  return h ? `${h.canon}|${h.num || ''}` : String(label || '').trim().toUpperCase();
}
function lineWeight(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.inline-chord').forEach((n) => n.remove());
  return Math.max(8, (c.textContent || '').trim().length);
}

function rebuildTiming() {
  lines = []; active = -1;
  if (!bodyEl || !song) return;
  const dur = audio && Number.isFinite(audio.duration) ? audio.duration : 0;

  // 1) Secciones de la letra y sus líneas (en orden).
  const secs = [];
  let cur = { label: null, canon: null, els: [] };
  secs.push(cur);
  bodyEl.querySelectorAll('.section-header-line, .lyric-line').forEach((el) => {
    if (el.classList.contains('section-header-line')) {
      cur = { label: el.textContent.trim(), canon: canonOf(el.textContent), els: [] };
      secs.push(cur);
    } else cur.els.push(el);
  });
  const lyricSecs = secs.filter((s) => s.els.length);
  const total = lyricSecs.reduce((n, s) => n + s.els.length, 0);
  if (!total) { timingKind = 'none'; paintHint(); return; }

  // 2) Marcadores (secciones de la onda) → tiempo de inicio de cada sección de la letra.
  const ms = (Array.isArray(song.markers) ? song.markers : []).slice().sort((a, b) => a.t - b.t);
  const used = new Set();
  const cMs = ms.map((m) => ({ ...m, canon: canonOf(m.label) }));
  const startOf = new Map(); // sec → t
  const sameCount = ms.length && (secs.filter((s) => s.label).length === ms.length);
  secs.forEach((s, i) => {
    if (!s.label) return;
    let j = cMs.findIndex((m, k) => !used.has(k) && m.canon === s.canon);
    if (j < 0) j = cMs.findIndex((m, k) => !used.has(k) && m.canon.split('|')[0] === s.canon.split('|')[0]);
    if (j < 0 && sameCount) { const idx = secs.filter((x) => x.label).indexOf(s); if (!used.has(idx)) j = idx; }
    if (j >= 0) { used.add(j); startOf.set(s, cMs[j].t); }
  });

  if (startOf.size && dur) {
    timingKind = 'sections';
    // Secciones con letra y sin tiempo propio: se reparten entre sus vecinas con tiempo.
    const withLyrics = lyricSecs;
    const anchors = withLyrics.map((s) => (startOf.has(s) ? startOf.get(s) : null));
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i] != null) continue;
      let p = i - 1; while (p >= 0 && anchors[p] == null) p--;
      let n = i + 1; while (n < anchors.length && anchors[n] == null) n++;
      const t0 = p >= 0 ? anchors[p] : 0;
      const t1 = n < anchors.length ? anchors[n] : dur;
      const span = (n < anchors.length ? n : anchors.length) - (p >= 0 ? p : -1);
      anchors[i] = t0 + ((t1 - t0) * (i - (p >= 0 ? p : -1))) / Math.max(1, span);
    }
    withLyrics.forEach((s, i) => {
      const t0 = anchors[i];
      const t1 = i + 1 < anchors.length ? anchors[i + 1] : dur;
      distribute(s.els, t0, Math.max(t0 + 1, t1));
    });
  } else if (dur) {
    timingKind = 'whole';
    const all = lyricSecs.flatMap((s) => s.els);
    distribute(all, dur * 0.06, dur * 0.94);
  } else {
    timingKind = 'none';
  }
  lines.sort((a, b) => a.start - b.start);
  paintHint();
  tickNow(true);
}

function distribute(els, t0, t1) {
  const w = els.map(lineWeight);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  els.forEach((el, i) => {
    lines.push({ el, start: t0 + ((t1 - t0) * acc) / sum });
    acc += w[i];
  });
}

function paintHint() {
  const msg = {
    sections: 'Karaoke por secciones · el tiempo de cada línea es una estimación. Toca una línea para saltar a ella.',
    whole: 'Karaoke aproximado: marca las secciones en la onda (Intro, Verso, Coro…) para afinarlo.',
    none: audio ? '' : 'Reproduce una pista (Sec u Orig) para seguir la letra mientras suena.',
  }[timingKind];
  hintEl.textContent = msg || '';
}

// ── Seguimiento mientras suena ─────────────────────────────────────────────
function startTimer() { if (!timer) timer = setInterval(() => tickNow(false), 160); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function tickNow(force) {
  if (!panel || panel.classList.contains('hidden') || !lines.length || !audio) return;
  const playing = !audio.paused;
  if (!playing && !force) return;
  const t = audio.currentTime || 0;
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].start <= t + 0.05) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === active && !force) return;
  active = idx;
  lines.forEach((l, i) => {
    l.el.classList.toggle('ll-now', i === idx);
    l.el.classList.toggle('ll-past', i < idx);
  });
  if (idx >= 0 && follow && Date.now() > userScrollUntil) {
    const el = lines[idx].el;
    // El acorde flotante vive sobre la línea: se deja aire arriba.
    const target = el.offsetTop - bodyEl.clientHeight * 0.34;
    bodyEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
}

function onLineClick(e) {
  const el = e.target.closest('.lyric-line');
  if (!el || !audio) return;
  const l = lines.find((x) => x.el === el);
  if (l) { try { audio.currentTime = l.start; } catch (_) {} active = -1; tickNow(true); }
}
