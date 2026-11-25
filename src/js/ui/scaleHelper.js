// ─────────────────────────────────────────────────────────────────────────
// «Notas para improvisar»: para un relleno o un solo sin salirse del tono.
// Según el tono de la canción (el del servicio si lo tiene):
//   · Escala del tono (mayor o menor natural): todas las notas que encajan.
//   · Pentatónica: 5 de esas notas, las más seguras (ninguna choca con los acordes).
//   · Notas que siempre funcionan: las del acorde del tono (1 · 3 · 5).
// Se ven en un teclado: escala en tono suave, pentatónica marcada, tónica con punto.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { keyTonic } from '../utils/chordNumbers.js';

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);
const SOLFEO = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

/** Escalas de un tono: { name, scale[], penta[], safe[], names(pc) } (clases de altura). */
export function scalesFor(key) {
  const t = keyTonic(key);
  if (!t) return null;
  const r = t.pc;
  const at = (ints) => ints.map((i) => (r + i) % 12);
  const names = FLAT_KEYS.has(String(key).trim()) ? FLAT : SHARP;
  const root = names[r];
  const solfeo = (SOLFEO[root[0]] || root) + (root[1] === '#' ? '#' : root[1] === 'b' ? 'b' : '');
  return t.minor
    ? { name: `${solfeo} menor`, scale: at([0, 2, 3, 5, 7, 8, 10]), penta: at([0, 3, 5, 7, 10]), safe: at([0, 3, 7]), root: r, names }
    : { name: `${solfeo} mayor`, scale: at([0, 2, 4, 5, 7, 9, 11]), penta: at([0, 2, 4, 7, 9]), safe: at([0, 4, 7]), root: r, names };
}

function keyboard(sc) {
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10];
  const ww = 16, wh = 70, bw = 10, bh = 44;
  const scale = new Set(sc.scale), penta = new Set(sc.penta);
  const fill = (pc, black) => penta.has(pc) ? '#f5a524' : scale.has(pc) ? '#f6d9a0' : black ? '#1b1b1b' : '#f3f3f3';
  let g = '', dots = '';
  for (let o = 0; o < 2; o++) whites.forEach((pc, i) => {
    const x = (o * 7 + i) * ww;
    g += `<rect x="${x}" y="0" width="${ww - 1}" height="${wh}" rx="2" fill="${fill(pc, false)}"/>`;
    if (pc === sc.root) dots += `<circle cx="${x + (ww - 1) / 2}" cy="${wh - 9}" r="3.4" fill="#1a1206"/>`;
  });
  for (let o = 0; o < 2; o++) blacks.forEach((pc) => {
    const wi = whites.filter((w) => w < pc).length, x = (o * 7 + wi) * ww - bw / 2 - 0.5;
    g += `<rect x="${x}" y="0" width="${bw}" height="${bh}" rx="1.5" fill="${fill(pc, true)}"/>`;
    if (pc === sc.root) dots += `<circle cx="${x + bw / 2}" cy="${bh - 8}" r="2.8" fill="#1a1206"/>`;
  });
  return `<svg viewBox="0 0 ${ww * 14} ${wh}" width="${ww * 14}" height="${wh}" aria-hidden="true" style="border-radius:4px">${g}${dots}</svg>`;
}

let pop = null;
function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', onOut, true); document.removeEventListener('keydown', onKey, true); } }
function onOut(e) { if (pop && !pop.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

export function showScaleHelper(anchor, key, title = '') {
  close();
  const sc = scalesFor(key);
  if (!sc) { window.showToast?.('Esta canción no tiene tono: ponle uno para ver sus notas.', 'info'); return; }
  const list = (pcs) => pcs.map((p) => sc.names[p]).join(' · ');
  pop = document.createElement('div');
  pop.className = 'cd-pop sh-pop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `
    <div class="cd-head"><b>Notas para improvisar</b><span>${esc(title ? `${title} · ` : '')}tono ${esc(key)}</span></div>
    ${keyboard(sc)}
    <div class="sh-rows">
      <div class="sh-row"><i class="sh-sw sh-sw--penta"></i><div><b>Pentatónica</b> — la más segura para rellenos y solos<br><span>${esc(list(sc.penta))}</span></div></div>
      <div class="sh-row"><i class="sh-sw sh-sw--scale"></i><div><b>Escala de ${esc(sc.name)}</b> — todas las notas que encajan<br><span>${esc(list(sc.scale))}</span></div></div>
      <div class="sh-row"><i class="sh-sw sh-sw--safe"></i><div><b>Siempre funcionan</b> — las del acorde del tono, para terminar una frase (el punto del teclado marca la tónica)<br><span>${esc(list(sc.safe))}</span></div></div>
    </div>
    <div class="sh-tip">Consejo: en cada acorde, apoyar la melodía en una nota de ese acorde suena «dentro»; las demás de la escala, de paso.</div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - pr.width - 8, Math.max(8, r.left + r.width / 2 - pr.width / 2)) + 'px';
  let top = r.bottom + 8;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 8);
  pop.style.top = top + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', onOut, true); document.addEventListener('keydown', onKey, true); }, 0);
}
