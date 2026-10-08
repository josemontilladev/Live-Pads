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

const LS_PREFS = 'livepads.chords';
let root, lane, nowEl, nextEl, btn, seek = () => {};
let on = false;
let track = null;        // { audio, song, type }
let result = null, id = null;
let E = null, T = null;  // módulos del motor (carga diferida)
let lastIdx = -2, lastShift = 0, lastPitchCheck = 0;

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
    on = !on;
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ ...prefs(), lane: on })); } catch (_) {}
    paintOn();
    if (on) request();
  };
  lane.addEventListener('click', (e) => {
    const el = e.target.closest('.sw-ch');
    if (el) seek(parseFloat(el.dataset.t) || 0);
  });
  window.addEventListener('livepads:chord-prefs', () => { if (result) render(); });
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
  track = t; result = null; id = null; lastIdx = -2;
  if (lane) lane.innerHTML = '';
  if (nowEl) { nowEl.textContent = ''; nextEl.textContent = ''; }
  if (on) request();
}
export function laneCleared() {
  track = null; result = null; id = null;
  if (lane) lane.innerHTML = '';
  if (nowEl) { nowEl.textContent = ''; nextEl.textContent = ''; }
}

async function request() {
  const t = track;
  if (!on || !t || !t.audio || !t.audio.buffer) return;
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
  return E.chordName(c, { latin: p.latin, basic: p.basic, shift: lastShift });
}

/** Dibuja la franja (al cargar, al cambiar preferencias, tono o ancho). */
export function render() {
  if (!on || !result || !lane || !E) return;
  lastShift = getTrackPitch() || 0;
  const d = result.d || 1, w = lane.clientWidth || 1;
  let lastX = -1e9, lastW = 0, html = '';
  result.seg.forEach((s, i) => {
    if (s.r < 0) return;
    const n = nameOf(s);
    const x = (s.s / d) * w;
    const tw = n.length * 7 + 12;               // ancho aproximado del nombre
    const fits = x - lastX >= lastW;
    if (fits) { lastX = x; lastW = tw; }
    html += `<span class="sw-ch${fits ? '' : ' no-label'}" data-i="${i}" data-t="${s.s}" style="left:${(s.s / d) * 100}%" title="${esc(n)}">${esc(n)}</span>`;
  });
  lane.innerHTML = html || '<span class="sw-ch-msg">No se encontraron acordes claros.</span>';
  lastIdx = -2;
  if (track && track.audio) laneTick(track.audio.currentTime || 0);
}

/** Acorde actual resaltado + cabecera (lo llama la onda en cada cuadro). */
export function laneTick(t) {
  if (!on || !result || !E) return;
  const now = performance.now();
  if (now - lastPitchCheck > 1000) {
    lastPitchCheck = now;
    if ((getTrackPitch() || 0) !== lastShift) { render(); return; }
  }
  const segs = result.seg;
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
