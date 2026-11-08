// ─────────────────────────────────────────────────────────────────────────
// Franja de acordes sobre el espectro de la pista (botón «Acordes» de la onda).
//  · Al encenderla se detectan los acordes de la pista cargada UNA vez, en el
//    Web Worker (o se toman de la caché si ya se analizó, también desde el panel
//    «Detectar acordes»). El motor solo se carga cuando la franja se usa.
//  · Cada acorde se marca en su segundo; el nombre se escribe donde hay espacio
//    y el que suena se resalta. Clic en un acorde = ir ahí.
//  · En la cabecera: el acorde que suena y el siguiente (se ven aunque la onda
//    esté oculta por falta de alto).
// Respeta las preferencias del detector (Básicos/Todos, C D E / Do Re Mi) y el
// cambio de tono de la pista.
// ─────────────────────────────────────────────────────────────────────────

import { getTrackPitch } from '../audio/trackPlayer.js';
import { nearestIn } from '../analysis/beatGrid.js';
import { hasFeature, requireFeature } from '../billing/license.js';
import { parseLyricStructure, keyOffset, songChordSegments, parseChord, replaceChordInLyrics } from './songStructure.js';
import { openContextMenu } from './cardMoreMenu.js';
import { showDialog } from './dialog.js';
import { getSongs } from '../state/store.js';
import { canEditActiveLibrary } from '../cloud/libraries.js';

const LS_PREFS = 'livepads.chords';
let root, lane, nowEl, nextEl, btn, seek = () => {};
let on = false;
let track = null;        // { audio, song, type }
let result = null, id = null;
let E = null, T = null;  // módulos del motor (carga diferida)
let lastIdx = -2, lastShift = 0, lastPitchCheck = 0;
// Acordes a mostrar: los de la LETRA colocados en cada sección marcada (si la
// canción los trae); donde la letra no dice nada, los detectados (suposición).
let shown = null, shownSig = '', songK = 0, fromSong = false;
let grid = null;          // { beatSec, barSec, off } — rejilla de pulsos de la pista
let neededZoom = 0;       // zoom con el que se leerían todos los nombres

// Los cambios de acorde caen sobre el pulso: el detector trabaja por ventanas y
// los marca unas décimas antes o después. Se pega cada cambio al pulso más
// cercano (si está a menos de ~medio pulso) y se funden los que quedan pegados.
function snapToBeats(segs, g) {
  if (!g || !(g.beatSec > 0)) return segs;
  const beat = g.beatSec, off = g.off || 0;
  const out = [];
  for (const sg of segs) {
    let s = sg.s;
    if (out.length) {
      // Pulsos reales (modelo) si los hay; si no, la rejilla de tempo fijo.
      const b = g.beats ? nearestIn(g.beats, s, beat * 0.45) : off + Math.round((s - off) / beat) * beat;
      if (b != null && Math.abs(b - s) <= beat * 0.45) s = b;
    }
    const prev = out[out.length - 1];
    if (prev) {
      prev.e = s;
      // Tramo que se quedó en casi nada: se lo come el anterior.
      if (prev.e - prev.s < beat * 0.3 && out.length > 1) { out.pop(); out[out.length - 1].e = s; }
    }
    const last = out[out.length - 1];
    if (last && last.r === sg.r && last.q === sg.q && last.b === sg.b) { last.e = sg.e; continue; }
    out.push({ ...sg, s });
  }
  return out;
}
export function laneSetGrid(g) { grid = g || null; shownSig = ''; if (result) render(); }
export const laneIsOn = () => on && !!result;
export const laneNeededZoom = () => neededZoom;

function segsNow() {
  if (!result) return [];
  const s = track && track.song;
  const sig = JSON.stringify([s ? s.lyrics || '' : '', s ? s.markers || [] : [], result.d, grid]);
  if (sig === shownSig && shown) return shown;
  const det = snapToBeats(result.seg, grid);
  shownSig = sig; shown = det; fromSong = false;
  try {
    const lyr = s ? parseLyricStructure(s.lyrics) : [];
    if (lyr.some((x) => x.chords.length) && Array.isArray(s.markers) && s.markers.length) {
      songK = keyOffset(lyr, det, getTrackPitch() || (s.audio && s.audio.pitch) || 0).k;
      const segs = songChordSegments(s.markers, lyr, det, songK, result.d || 0);
      if (segs.some((x) => !x.guess)) { shown = segs; fromSong = true; }
    }
  } catch (e) { console.warn('[LivePads] acordes de la letra:', e); }
  return shown;
}

function prefs() {
  try { return Object.assign({ basic: true, latin: false, lane: false }, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (_) { return { basic: true, latin: false, lane: false }; }
}
async function mods() {
  if (!E) [E, T] = await Promise.all([import('../chords/chordEngine.js'), import('../chords/trackChords.js')]);
}
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initChordLane(rootEl, seekFn) {
  root = rootEl; seek = seekFn;
  lane = root.querySelector('.sw-chords');
  btn = root.querySelector('#sw-chords');
  const now = root.querySelector('.sw-chordnow');
  nowEl = now && now.querySelector('b'); nextEl = now && now.querySelector('span');
  if (!lane || !btn) return;
  on = !!prefs().lane;
  paintOn();
  btn.onclick = () => {
    if (!on && !requireFeature('chords')) return;
    on = !on;
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ ...prefs(), lane: on })); } catch (_) {}
    paintOn();
    if (on) request();
  };
  lane.addEventListener('click', (e) => {
    const el = e.target.closest('.sw-ch');
    if (el) seek(parseFloat(el.dataset.t) || 0);
  });
  // Clic derecho en un acorde: corregirlo (se guarda en la LETRA de la canción).
  lane.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.sw-ch'); if (!el) return;
    e.preventDefault();
    openChordMenu(e.clientX, e.clientY, segsNow()[+el.dataset.i], parseFloat(el.dataset.t) || 0);
  });
  window.addEventListener('livepads:chord-prefs', () => { if (result) render(); });
  // Secciones movidas / letra editada: los acordes de la letra se recolocan solos.
  const again = () => { if (result) { shownSig = ''; render(); } };
  window.addEventListener('livepads:songs-changed', again);
  window.addEventListener('livepads:library-synced', again);
  window.addEventListener('livepads:chords-ready', (e) => {
    if (on && e.detail && e.detail.id === id) { result = e.detail.result; render(); }
  });
}

function paintOn() {
  root.classList.toggle('has-chords', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** La pista ya está decodificada (lo llama la onda). */
export function laneTrackLoaded(t) {
  track = t; result = null; id = null; lastIdx = -2; grid = null; neededZoom = 0; shownSig = '';
  if (lane) lane.innerHTML = '';
  if (nowEl) { nowEl.textContent = ''; nextEl.textContent = ''; }
  if (on) request();
}
export function laneCleared() {
  track = null; result = null; id = null; grid = null; neededZoom = 0;
  if (lane) lane.innerHTML = '';
  if (nowEl) { nowEl.textContent = ''; nextEl.textContent = ''; }
}

async function request() {
  const t = track;
  if (!on || !t || !t.audio || !t.audio.buffer || !hasFeature('chords')) return;
  await mods();
  if (track !== t) return;
  id = T.trackChordId(t.song, t.type, t.audio.buffer);
  const cached = T.cacheGet(id);
  if (cached) { result = cached; render(); return; }
  const myId = id;
  lane.innerHTML = '<span class="sw-ch-msg">Detectando acordes de la pista…</span>';
  try {
    const r = await T.analyzeBufferCached(myId, t.audio.buffer, (p) => {
      if (id === myId && !result) lane.innerHTML = `<span class="sw-ch-msg">Detectando acordes… ${Math.round(p * 100)} %</span>`;
    });
    if (id === myId) { result = r; render(); }
  } catch (_) {
    if (id === myId) lane.innerHTML = '<span class="sw-ch-msg">No se pudieron detectar los acordes de esta pista.</span>';
  }
}

function nameOf(c) {
  const p = prefs();
  // Acorde escrito en la letra y la pista en el tono de la letra: tal cual se escribió.
  if (c.n && !p.latin && ((lastShift - songK) % 12 + 12) % 12 === 0) return c.n;
  return E.chordName(c, { latin: p.latin, basic: p.basic && !c.n, shift: lastShift });
}

// ── Corregir acordes ──────────────────────────────────────────────────────
function saveLyrics(s, text) {
  s.lyrics = text;
  try {
    const lib = getSongs().find((x) => x !== s && ((s.cloudId && x.cloudId === s.cloudId) || (x.id != null && x.id === s.id)));
    if (lib) lib.lyrics = text;
  } catch (_) {}
  try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: s.id } }));
}
function openChordMenu(x, y, seg, t) {
  const s = track && track.song;
  if (!seg || !s) return;
  const editable = canEditActiveLibrary();
  const items = [{ label: 'Ir aquí', onSelect: () => seek(t) }];
  if (editable && seg.pos) {
    items.push({ label: `Cambiar «${nameOf(seg)}»…`, onSelect: () => changeChord(s, seg) });
  }
  if (editable) {
    items.push({ label: seg.guess ? 'Escribir los acordes en la letra…' : 'Corregir en la letra…', onSelect: () => editLyrics(s) });
  }
  if (seg.guess) items.push({ label: 'Este acorde es una suposición (detectado)', onSelect: () => {} });
  openContextMenu(x, y, items);
}
function changeChord(s, seg) {
  const shown = nameOf(seg);
  showDialog(`Cambiar acorde (ahora: ${shown})`, shown, (v) => {
    v = String(v || '').trim();
    if (!v || v === shown) return;
    const c = parseChord(v);
    if (!c) { window.showToast?.(`«${v}» no parece un acorde (ej.: G, Em, D/F#, Cmaj7).`, 'error'); return; }
    // Si la pista suena en otro tono que la letra, lo escrito se pasa al tono de la letra.
    const d = (((songK - lastShift) % 12) + 12) % 12;
    const name = d && E ? E.chordName(c, { shift: d }) : v;
    const prev = s.lyrics;
    saveLyrics(s, replaceChordInLyrics(prev, seg.pos, name));
    window.showToast?.(`Acorde cambiado a ${v} en la letra.`, 'success', { action: { label: 'Deshacer', onClick: () => saveLyrics(s, prev) } });
  });
}
async function editLyrics(s) {
  try {
    const { openLyricsEditorModal } = await import('./lyricsEditor.js');
    openLyricsEditorModal(s, (text) => saveLyrics(s, text));
  } catch (e) { console.warn('[LivePads] editor de letra:', e); }
}

/** Dibuja la franja (al cargar, al cambiar preferencias, tono o ancho). */
let measureCtx = null;
function textW(n) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    const ff = getComputedStyle(lane).fontFamily || 'sans-serif';
    measureCtx.font = `700 11px ${ff}`;
  }
  return Math.ceil(measureCtx.measureText(n).width) + 12;   // + padding y la raya
}
export function render() {
  if (!on || !result || !lane || !E) return;
  lastShift = getTrackPitch() || 0;
  const d = result.d || 1, w = lane.clientWidth || 1;
  const list = segsNow();
  lane.title = fromSong ? 'Acordes de la letra de la canción, colocados en cada sección (los tenues son detectados)' : 'Acordes detectados en la pista (suposición)';
  root.classList.toggle('chords-from-song', fromSong);
  // Dos filas: un nombre que no cabe tras el anterior baja a la segunda; si
  // tampoco cabe ahí, queda solo su raya (con zoom se leen todos).
  const ends = [-1e9, -1e9];
  const items = [];
  let usedRow2 = false;
  list.forEach((s, i) => {
    if (s.r < 0) return;
    const n = nameOf(s), x = (s.s / d) * w, tw = textW(n);
    let row = -1;
    if (x >= ends[0]) row = 0; else if (x >= ends[1]) row = 1;
    // 6 px de aire: el acorde que suena se resalta con fondo y no debe tocar al siguiente.
    if (row >= 0) { ends[row] = x + tw + 6; if (row === 1) usedRow2 = true; }
    items.push({ s, i, n, x, tw, row });
  });
  let html = '';
  for (const it of items) {
    const { s, i, n, row } = it;
    html += `<span class="sw-ch${row < 0 ? ' no-label' : ''}${row === 1 ? ' row2' : ''}${s.guess ? ' is-guess' : ''}" data-i="${i}" data-t="${s.s}" style="left:${(s.s / d) * 100}%" title="${esc(n)} · ${Math.floor(s.s / 60)}:${String(Math.floor(s.s % 60)).padStart(2, '0')}${s.guess ? ' (detectado)' : s.n ? ' (de la letra)' : ''}">${esc(n)}</span>`;
  }
  lane.classList.toggle('two-rows', usedRow2);
  lane.innerHTML = html || '<span class="sw-ch-msg">No se encontraron acordes claros.</span>';
  // Zoom con el que cabrían (casi) todos los nombres en dos filas: cada nombre
  // necesita hueco hasta el que va dos más allá (el de su misma fila). Se ignora
  // el 5 % más apretado (acordes de paso muy cortos) para no exagerar.
  const sc = root.querySelector('.sw-scroll');
  const base = (sc && sc.clientWidth) || w;
  const need = [];
  for (let k = 0; k + 2 < items.length; k++) {
    const dt = items[k + 2].s.s - items[k].s.s;
    if (dt > 0) need.push((items[k].tw + 6) / dt);          // px por segundo
  }
  need.sort((a, b) => a - b);
  const pps = need.length ? need[Math.min(need.length - 1, Math.floor(need.length * 0.95))] : 0;
  neededZoom = pps ? Math.max(1, (pps * d) / base) : 0;
  lastIdx = -2;
  if (track && track.audio) laneTick(track.audio.currentTime || 0);
  window.dispatchEvent(new Event('livepads:chord-lane-rendered'));
}

/** Acorde actual resaltado + cabecera (lo llama la onda en cada cuadro). */
export function laneTick(t) {
  if (!on || !result || !E) return;
  const now = performance.now();
  if (now - lastPitchCheck > 1000) {
    lastPitchCheck = now;
    if ((getTrackPitch() || 0) !== lastShift) { render(); return; }
  }
  const segs = segsNow();
  // búsqueda binaria del segmento que contiene t
  let lo = 0, hi = segs.length - 1, idx = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (segs[m].s <= t) { idx = m; lo = m + 1; } else hi = m - 1;
  }
  if (idx === lastIdx) return;
  lastIdx = idx;
  lane.querySelectorAll('.sw-ch.is-current').forEach(el => el.classList.remove('is-current'));
  let cur = idx >= 0 ? segs[idx] : null;
  if (cur && cur.r < 0) cur = null;
  if (cur) { const el = lane.querySelector(`.sw-ch[data-i="${idx}"]`); if (el) el.classList.add('is-current'); }
  let next = null;
  const curName = cur ? nameOf(cur) : '';
  for (let k = idx + 1; k < segs.length; k++) { if (segs[k].r >= 0 && nameOf(segs[k]) !== curName) { next = segs[k]; break; } }
  if (nowEl) nowEl.textContent = cur ? curName : '—';
  if (nextEl) nextEl.textContent = next ? `→ ${nameOf(next)}` : '';
}
