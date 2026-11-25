// ─────────────────────────────────────────────────────────────────────────
// Diagramas de acordes: al tocar un acorde de la letra (panel de letra, tarjeta,
// pantalla completa) aparece un globo con cómo se toca en GUITARRA (posición
// principal, de @tombatossals/chords-db, licencia MIT — la misma base que usa
// GI App) y en PIANO (las notas del acorde marcadas en dos octavas, con el bajo
// de los acordes con barra). Para los músicos nuevos o menos avanzados.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const DB_KEY = { C: 'C', 'C#': 'Csharp', Db: 'Csharp', D: 'D', 'D#': 'Eb', Eb: 'Eb', E: 'E', F: 'F', 'F#': 'Fsharp', Gb: 'Fsharp', G: 'G', 'G#': 'Ab', Ab: 'Ab', A: 'A', 'A#': 'Bb', Bb: 'Bb', B: 'B' };
const DB_SUFFIX = { '': 'major', M: 'major', maj: 'major', m: 'minor', min: 'minor', '-': 'minor', M7: 'maj7', '7M': 'maj7', sus: 'sus4', '2': 'sus2', '4': 'sus4', 'º': 'dim', '°': 'dim', 'ø': 'm7b5', '+': 'aug' };
// Intervalos (semitonos desde la raíz) para el piano.
const INTERVALS = {
  '': [0, 4, 7], m: [0, 3, 7], '5': [0, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11], '7M': [0, 4, 7, 11],
  m7: [0, 3, 7, 10], sus2: [0, 2, 7], '2': [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], '4': [0, 5, 7], '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14], dim: [0, 3, 6], 'º': [0, 3, 6], '°': [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], '+': [0, 4, 8],
  m7b5: [0, 3, 6, 10], 'ø': [0, 3, 6, 10], mmaj7: [0, 3, 7, 11], '11': [0, 4, 7, 10, 17], '13': [0, 4, 7, 10, 21],
};
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

let db = null, dbLoading = null;
function loadDb() {
  if (db) return Promise.resolve(db);
  if (!dbLoading) {
    dbLoading = fetch(new URL('../data/chordShapes.json', import.meta.url))
      .then((r) => r.json()).then((j) => (db = j)).catch(() => (db = {}));
  }
  return dbLoading;
}

/** «F#m7/E» → { root: 'F#', suffix: 'm7', bass: 'E' } o null. */
export function parseChordName(name) {
  // Sufijo: solo lo que puede llevar un acorde (así «Coro» no se lee como C + «oro»).
  const m = String(name || '').trim().match(/^([A-G])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|\d|\+|-|°|º|ø|#|b|\(|\)|,)*)(?:\/([A-G][#b]?))?$/);
  if (!m || PC[m[1] + m[2]] == null) return null;
  return { root: m[1] + m[2], suffix: m[3] || '', bass: m[4] || null };
}

/** Posición de guitarra { f:[6ª→1ª], g:[dedos], b: traste base, r:[cejillas] } o null. */
export function guitarShape(name, data = db) {
  const c = parseChordName(name);
  if (!c || !data) return null;
  const key = DB_KEY[c.root];
  if (!key) return null;
  const find = (s) => data[`${key}|${DB_SUFFIX[s] ?? s}`];
  let e = (c.bass && (data[`${key}|${c.suffix}/${c.bass}`] || data[`${key}|/${c.bass}`])) || find(c.suffix);
  if (!e && c.suffix.startsWith('m') && !c.suffix.startsWith('maj')) e = find('m');
  if (!e) e = find('');
  return e || null;
}

/** Notas del acorde (clases de altura) y el bajo, para el piano. */
export function chordNotes(name) {
  const c = parseChordName(name);
  if (!c) return null;
  let ints = INTERVALS[c.suffix];
  if (!ints) ints = c.suffix.startsWith('m') && !c.suffix.startsWith('maj') ? INTERVALS.m : INTERVALS[''];
  const r = PC[c.root];
  return { notes: ints.map((i) => (r + i) % 12), root: r, bass: c.bass ? PC[c.bass] : r };
}

// ── Dibujo ──
function guitarSvg(s) {
  const W = 120, H = 140, x0 = 22, y0 = 30, sx = 16, fy = 20, frets = 5;
  let g = '';
  for (let i = 0; i <= frets; i++) g += `<line x1="${x0}" y1="${y0 + i * fy}" x2="${x0 + 5 * sx}" y2="${y0 + i * fy}" stroke="currentColor" stroke-opacity=".45" stroke-width="${i === 0 && s.b <= 1 ? 4 : 1}"/>`;
  for (let i = 0; i < 6; i++) g += `<line x1="${x0 + i * sx}" y1="${y0}" x2="${x0 + i * sx}" y2="${y0 + frets * fy}" stroke="currentColor" stroke-opacity=".55" stroke-width="1"/>`;
  if (s.b > 1) g += `<text x="${x0 - 8}" y="${y0 + fy * 0.65}" font-size="11" text-anchor="end" fill="currentColor" opacity=".8">${s.b}</text>`;
  (s.r || []).forEach((fr) => {
    const strs = s.f.map((f, i) => (f >= fr ? i : -1)).filter((i) => i >= 0);
    if (strs.length < 2) return;
    const a = Math.min(...strs), z = Math.max(...strs), y = y0 + (fr - 0.5) * fy;
    g += `<rect x="${x0 + a * sx - 6}" y="${y - 6}" width="${(z - a) * sx + 12}" height="12" rx="6" fill="var(--cd-dot, #fff)"/>`;
  });
  s.f.forEach((f, i) => {
    const x = x0 + i * sx;
    if (f < 0) g += `<text x="${x}" y="${y0 - 8}" font-size="11" text-anchor="middle" fill="currentColor" opacity=".7">×</text>`;
    else if (f === 0) g += `<circle cx="${x}" cy="${y0 - 12}" r="4" fill="none" stroke="currentColor" stroke-opacity=".8"/>`;
    else if (!(s.r || []).includes(f)) g += `<circle cx="${x}" cy="${y0 + (f - 0.5) * fy}" r="6.5" fill="var(--cd-dot, #fff)"/>`;
  });
  return `<svg class="cd-guitar" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${g}</svg>`;
}
function pianoSvg(n) {
  // Dos octavas desde Do; las notas del acorde se marcan en la primera aparición desde la raíz.
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10];
  const ww = 14, wh = 64, bw = 9, bh = 40, W = ww * 14;
  const lit = new Set();
  // Voz cerrada desde la raíz (dentro de las dos octavas) + el bajo abajo si es distinto.
  let base = n.root;
  for (const p of n.notes) { let k = p; while (k < base) k += 12; if (k < 24) lit.add(k); }
  const bassKey = n.bass !== n.root ? n.bass : null;
  // Color fijo (no el acento del tema: en «Consola» el acento es blanco y las teclas blancas no se veían
  // marcadas) y además un punto en cada tecla del acorde.
  const LIT = '#f5a524', DOT = '#1a1206';
  let g = '', dots = '';
  for (let o = 0; o < 2; o++) whites.forEach((pc, i) => {
    const k = o * 12 + pc, x = (o * 7 + i) * ww;
    g += `<rect x="${x}" y="0" width="${ww - 1}" height="${wh}" rx="2" fill="${lit.has(k) ? LIT : '#f3f3f3'}"/>`;
    if (lit.has(k)) dots += `<circle cx="${x + (ww - 1) / 2}" cy="${wh - 9}" r="3.2" fill="${DOT}"/>`;
  });
  for (let o = 0; o < 2; o++) blacks.forEach((pc) => {
    const k = o * 12 + pc, wi = whites.filter((w) => w < pc).length, x = (o * 7 + wi) * ww - bw / 2 - 0.5;
    g += `<rect x="${x}" y="0" width="${bw}" height="${bh}" rx="1.5" fill="${lit.has(k) ? LIT : '#1b1b1b'}"/>`;
    if (lit.has(k)) dots += `<circle cx="${x + bw / 2}" cy="${bh - 8}" r="2.6" fill="${DOT}"/>`;
  });
  g += dots;
  return `<svg class="cd-piano" viewBox="0 0 ${W} ${wh}" width="${W}" height="${wh}" aria-hidden="true">${g}</svg>`
    + (bassKey != null ? `<div class="cd-bass">Bajo: ${NAMES[bassKey]}</div>` : '');
}

// ── Globo ──
let pop = null;
function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true); } }
function onOutside(e) { if (pop && !pop.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

export async function showChordDiagram(anchor, name) {
  close();
  await loadDb();
  const shape = guitarShape(name);
  const notes = chordNotes(name);
  if (!shape && !notes) return;
  pop = document.createElement('div');
  pop.className = 'cd-pop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `
    <div class="cd-head"><b>${esc(name)}</b>${notes ? `<span>${notes.notes.map((p) => NAMES[p]).join(' · ')}</span>` : ''}</div>
    <div class="cd-body">
      ${shape ? `<div class="cd-col"><div class="cd-k">Guitarra</div>${guitarSvg(shape)}</div>` : ''}
      ${notes ? `<div class="cd-col"><div class="cd-k">Piano</div>${pianoSvg(notes)}</div>` : ''}
    </div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let left = Math.min(window.innerWidth - pr.width - 8, Math.max(8, r.left + r.width / 2 - pr.width / 2));
  let top = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 8);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', onOutside, true); document.addEventListener('keydown', onKey, true); }, 0);
}

/** Tocar un acorde de cualquier letra abre su diagrama (no sigue a la línea: no salta la pista). */
export function initChordDiagrams() {
  loadDb();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.inline-chord, .chord-line .cn-name, .chord-line .cn-num');
    if (!el) return;
    const holder = el.classList.contains('inline-chord') ? el : el.closest('.chord-line');
    const nameEl = el.classList.contains('inline-chord') ? (el.querySelector('.cn-name') || el) : (el.classList.contains('cn-num') ? el.previousElementSibling : el);
    const name = (nameEl && nameEl.textContent || '').trim();
    if (!parseChordName(name) || !holder) return;
    e.stopPropagation(); e.preventDefault();
    showChordDiagram(el, name);
  }, true);
}
