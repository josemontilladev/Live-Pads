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
let timingKind = 'none'; // 'manual' | 'sections' | 'whole' | 'none'
let syncing = null;      // { els, times, idx } mientras se sincroniza a mano
const LEAD = 0.3;        // la línea se ilumina un poco antes, para leerla a tiempo

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
      <button type="button" class="ll-btn ll-btn--sync" id="ll-sync" title="Enseña a la app cuándo empieza a cantarse cada línea: el karaoke queda exacto">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        Sincronizar
      </button>
    </header>
    <div class="ll-tools">
      <button type="button" class="ll-btn" id="ll-chords" title="Mostrar u ocultar los acordes">Acordes</button>
      <button type="button" class="ll-btn ll-btn--icon" id="ll-smaller" title="Letra más pequeña" aria-label="Letra más pequeña">A−</button>
      <button type="button" class="ll-btn ll-btn--icon" id="ll-bigger" title="Letra más grande" aria-label="Letra más grande">A+</button>
      <button type="button" class="ll-btn" id="ll-follow" title="Seguir la canción mientras suena (karaoke) y mantener la línea actual centrada">Seguir</button>
      <button type="button" class="ll-btn" id="ll-auto" title="Abrir la letra automáticamente al elegir una canción">Auto</button>
    </div>
    <div class="ll-syncbar hidden">
      <div class="ll-synctop"><b>Sincronizar letra</b><span class="ll-syncstep"></span></div>
      <div class="ll-syncwhy">Escucha la canción y pulsa el botón grande justo cuando empiece a cantarse esta línea:</div>
      <div class="ll-syncline"></div>
      <div class="ll-syncbtns">
        <button type="button" class="ll-btn ll-btn--mark" id="ll-mark">Ya empezó ▸</button>
      </div>
      <div class="ll-syncsec">
        <button type="button" class="ll-btn" id="ll-undo">← Línea anterior</button>
        <button type="button" class="ll-btn" id="ll-sync-cancel">Cancelar</button>
      </div>
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
  panel.querySelector('#ll-sync').onclick = () => (syncing ? stopSync(false) : startSync());
  panel.querySelector('#ll-mark').onclick = markLine;
  panel.querySelector('#ll-undo').onclick = undoMark;
  panel.querySelector('#ll-sync-cancel').onclick = () => stopSync(false);

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

// Tiempos exactos tomados a mano («Sincronizar»): se guardan por canción y solo valen
// mientras la letra no cambie.
const TT_PREFIX = 'livepads-linetimes-';
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h); }
function loadManual(count) {
  if (!song) return null;
  try {
    const o = JSON.parse(localStorage.getItem(TT_PREFIX + song.id) || 'null');
    if (o && o.h === hashStr(String(song.lyrics || '')) && Array.isArray(o.t) && o.t.length === count) return o.t;
  } catch (_) {}
  return null;
}
function saveManual(times) {
  try { localStorage.setItem(TT_PREFIX + song.id, JSON.stringify({ h: hashStr(String(song.lyrics || '')), t: times })); } catch (_) {}
}
function clearManual() { try { localStorage.removeItem(TT_PREFIX + song.id); } catch (_) {} }

const SEC_PER_CHAR = 0.22; // tope: una línea no «dura» más que cantarla despacio

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

  // 0) Tiempos tomados a mano: exactos.
  const allEls = lyricSecs.flatMap((s) => s.els);
  const manual = loadManual(allEls.length);
  if (manual) {
    timingKind = 'manual';
    allEls.forEach((el, i) => lines.push({ el, start: manual[i] }));
    lines.sort((x, y) => x.start - y.start);
    paintHint();
    tickNow(true);
    return;
  }

  // 2) Marcadores (secciones de la onda) → tiempo de inicio de cada sección de la letra.
  const ms = (Array.isArray(song.markers) ? song.markers : []).slice().sort((a, b) => a.t - b.t);
  const used = new Set();
  const cMs = ms.map((m) => ({ ...m, canon: canonOf(m.label) }));
  const startOf = new Map(); // sec → t
  const sameCount = ms.length && (secs.filter((s) => s.label).length === ms.length);
  secs.forEach((s) => {
    if (!s.label) return;
    let j = cMs.findIndex((m, k) => !used.has(k) && m.canon === s.canon);
    if (j < 0) j = cMs.findIndex((m, k) => !used.has(k) && m.canon.split('|')[0] === s.canon.split('|')[0]);
    if (j < 0 && sameCount) { const idx = secs.filter((x) => x.label).indexOf(s); if (!used.has(idx)) j = idx; }
    if (j >= 0) { used.add(j); startOf.set(s, cMs[j].t); }
  });

  if (startOf.size && dur) {
    timingKind = 'sections';
    // Secciones con letra y sin tiempo propio: se reparten entre sus vecinas con tiempo.
    const anchors = lyricSecs.map((s) => (startOf.has(s) ? startOf.get(s) : null));
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i] != null) continue;
      let p = i - 1; while (p >= 0 && anchors[p] == null) p--;
      let n = i + 1; while (n < anchors.length && anchors[n] == null) n++;
      const t0 = p >= 0 ? anchors[p] : 0;
      const t1 = n < anchors.length ? anchors[n] : dur;
      const span = (n < anchors.length ? n : anchors.length) - (p >= 0 ? p : -1);
      anchors[i] = t0 + ((t1 - t0) * (i - (p >= 0 ? p : -1))) / Math.max(1, span);
    }
    // Apariciones: cada sección de la letra una vez, más las REPETICIONES (el coro que la
    // pista canta de nuevo y en la letra aparece una sola vez) que tengan marcador propio.
    const occ = lyricSecs.map((s, i) => ({ sec: s, t0: anchors[i] }));
    cMs.forEach((m, k) => {
      if (used.has(k)) return;
      const host = lyricSecs.find((s) => s.canon === m.canon) || lyricSecs.find((s) => s.canon && s.canon.split('|')[0] === m.canon.split('|')[0] && !/INSTR|INTRO|OUTRO|FINAL/.test(m.canon));
      if (host) occ.push({ sec: host, t0: m.t });
    });
    occ.sort((x, y) => x.t0 - y.t0);
    const times = ms.map((m) => m.t);
    occ.forEach((o, i) => {
      // Termina en el siguiente marcador (sea del tipo que sea: un «Instrumental» corta la
      // sección) o en la siguiente aparición, lo que llegue primero.
      const nextMark = times.find((t) => t > o.t0 + 0.5);
      const nextOcc = i + 1 < occ.length ? occ[i + 1].t0 : null;
      const cands = [nextMark, nextOcc].filter((v) => v != null && v > o.t0);
      const end = cands.length ? Math.min(...cands) : dur;
      distribute(o.sec.els, o.t0, Math.max(o.t0 + 1, end));
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
  // La sección puede traer un tramo instrumental al final: no se estira la letra sobre él.
  const span = Math.min(t1 - t0, sum * SEC_PER_CHAR);
  let acc = 0;
  els.forEach((el, i) => {
    lines.push({ el, start: t0 + (span * acc) / sum });
    acc += w[i];
  });
}

function paintHint() {
  const msg = {
    manual: 'Letra sincronizada a mano · exacta. Toca una línea para saltar a ella.',
    sections: 'Karaoke por secciones · el tiempo de cada línea es una estimación. Usa «Sincronizar» para dejarla exacta.',
    whole: 'Karaoke aproximado: marca las secciones en la onda (Intro, Verso, Coro…) para afinarlo.',
    none: audio ? '' : 'Reproduce una pista (Sec u Orig) para seguir la letra mientras suena.',
  }[timingKind];
  hintEl.textContent = msg || '';
}

// ── Seguimiento mientras suena ─────────────────────────────────────────────
function startTimer() { if (!timer) timer = setInterval(() => tickNow(false), 90); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function tickNow(force) {
  if (!panel || panel.classList.contains('hidden') || !lines.length || !audio || syncing) return;
  const playing = !audio.paused;
  if (!playing && !force) return;
  const t = audio.currentTime || 0;
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].start <= t + LEAD) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === active && !force) return;
  active = idx;
  const nowEl = idx >= 0 ? lines[idx].el : null;
  const pastEls = new Set();
  for (let i = 0; i < idx; i++) if (lines[i].el !== nowEl) pastEls.add(lines[i].el);
  lines.forEach((l) => {
    l.el.classList.toggle('ll-now', l.el === nowEl);
    l.el.classList.toggle('ll-past', pastEls.has(l.el));
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
  if (!el || !audio || syncing) return;
  const l = lines.find((x) => x.el === el);
  if (l) { try { audio.currentTime = l.start; } catch (_) {} active = -1; tickNow(true); }
}

// ── Sincronizar a mano ─────────────────────────────────────────────────────
// Con la pista sonando, se pulsa «Marcar línea» justo cuando empieza a cantarse cada una.
// Al terminar, el karaoke usa esos tiempos exactos (quedan guardados en este equipo).
function plainLine(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.inline-chord').forEach((n) => n.remove());
  return (c.textContent || '').replace(/\s+/g, ' ').trim();
}

function syncUi() {
  const bar = panel.querySelector('.ll-syncbar');
  bar.classList.toggle('hidden', !syncing);
  panel.classList.toggle('is-syncing', !!syncing);
  panel.querySelector('#ll-sync').classList.toggle('is-on', !!syncing);
  if (!syncing) return;
  const { els, idx } = syncing;
  const el = els[Math.min(idx, els.length - 1)];
  panel.querySelector('.ll-syncstep').textContent = `${Math.min(idx + 1, els.length)} de ${els.length}`;
  panel.querySelector('.ll-syncline').textContent = el ? plainLine(el) : '';
  els.forEach((e, i) => { e.classList.toggle('ll-next', i === idx); e.classList.toggle('ll-marked', i < idx); e.classList.remove('ll-now', 'll-past'); });
  if (el) bodyEl.scrollTo({ top: Math.max(0, el.offsetTop - bodyEl.clientHeight * 0.34), behavior: 'smooth' });
}

function startSync() {
  if (!audio || audio.paused === undefined) { hintEl.textContent = 'Primero carga la pista de la canción (botón Sec u Orig) y luego pulsa Sincronizar.'; return; }
  const els = Array.from(bodyEl.querySelectorAll('.lyric-line'));
  if (!els.length) { hintEl.textContent = 'Esta canción no tiene letra para sincronizar.'; return; }
  syncing = { els, times: [], idx: 0 };
  try { audio.currentTime = 0; } catch (_) {}
  if (audio.paused) { try { const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  syncUi();
}

function markLine() {
  if (!syncing || !audio) return;
  syncing.times[syncing.idx] = Math.max(0, (audio.currentTime || 0) - 0.1); // compensa el tiempo de reacción
  syncing.idx++;
  if (syncing.idx >= syncing.els.length) { stopSync(true); return; }
  syncUi();
}

function undoMark() {
  if (!syncing || syncing.idx === 0) return;
  syncing.idx--;
  syncing.times.length = syncing.idx;
  syncUi();
}

function stopSync(save) {
  if (!syncing) return;
  const { els, times } = syncing;
  els.forEach((el) => el.classList.remove('ll-next', 'll-marked'));
  syncing = null;
  syncUi();
  if (save && song) {
    // Los tiempos deben ir en orden creciente.
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1];
    saveManual(times);
    hintEl.textContent = 'Letra sincronizada ✓';
  }
  rebuildTiming();
}
