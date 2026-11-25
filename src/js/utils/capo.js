// ─────────────────────────────────────────────────────────────────────────
// Cejilla sugerida para guitarra: con el tono del día, en qué traste poner la
// cejilla para tocar con formas abiertas (G, C, D, A, E · Em, Am, Dm).
//   Bb → cejilla 1, formas de A · Eb → cejilla 1, formas de D · F#m → cejilla 2, formas de Em
// Preferencia: formas G/C/D (y Em/Am) mejor que A/E (y Dm); a igualdad, la
// cejilla más baja. Nunca más allá del traste 7.
// La misma regla vive en companion/client/instrument.js (los móviles); la prueba
// tests/capo.test.mjs comprueba que las dos dan lo mismo en los 24 tonos.
// ─────────────────────────────────────────────────────────────────────────

import { keyTonic } from './chordNumbers.js';
import { transposeBracketedChords } from '../ui/chordTransposer.js';

const SHAPES_MAJOR = { 7: ['G', 0], 0: ['C', 0], 2: ['D', 0], 9: ['A', 1], 4: ['E', 1] };
const SHAPES_MINOR = { 4: ['Em', 0], 9: ['Am', 0], 2: ['Dm', 1] };
const mod12 = (v) => ((v % 12) + 12) % 12;

/** Tono → { capo, shape } (capo 0 = no hace falta) o null si el tono no se entiende. */
export function bestCapo(key) {
  const k = keyTonic(key);
  if (!k) return null;
  const table = k.minor ? SHAPES_MINOR : SHAPES_MAJOR;
  let best = null;
  for (let capo = 0; capo <= 7; capo++) {
    const s = table[mod12(k.pc - capo)];
    if (!s) continue;
    const cost = s[1] + capo * 0.5;
    if (!best || cost < best.cost) best = { capo, shape: s[0], cost };
  }
  return best ? { capo: best.capo, shape: best.shape } : null;
}

/** «Cejilla 3 · formas de G» / «Sin cejilla». */
export function capoLabel(c) {
  if (!c) return '';
  return c.capo ? `Cejilla ${c.capo} · formas de ${c.shape}` : 'Sin cejilla';
}

/** Un acorde como se toca con la cejilla (C con cejilla 2 → Bb). */
export function capoShape(chord, capo, shapeKey = '') {
  if (!capo) return chord;
  const flats = /^(F|Bb|Eb|Dm|Gm|Cm)$/.test(shapeKey);
  const out = transposeBracketedChords(`[${chord}]`, -capo, flats);
  return out.replace(/^\[|\]$/g, '');
}

const CHORD_TOKEN = /^([A-G][#b]?)((?:maj|min|dim|aug|sus|add|m|M|\d|\+|-|°|º|ø|#|b|\(|\)|,)*)(?:\/([A-G][#b]?))?$/;

/** Cambia, en el HTML ya pintado de una letra, cada acorde por su forma con cejilla. */
export function applyCapoView(root, capo, shapeKey) {
  if (!root || !capo) return;
  const swap = (el) => {
    const t = (el.textContent || '').trim();
    if (!CHORD_TOKEN.test(t)) return;
    el.textContent = capoShape(t, capo, shapeKey);
  };
  for (const c of root.querySelectorAll('.inline-chord')) {
    const name = c.querySelector('.cn-name');
    swap(name || c);
  }
  for (const line of root.querySelectorAll('.chord-line')) {
    const names = line.querySelectorAll('.cn-name');
    if (names.length) { names.forEach(swap); continue; }
    // Línea de acordes sin grados: se cambian los acordes del texto, palabra a palabra.
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) n.textContent = n.textContent.replace(/\S+/g, (tok) => (CHORD_TOKEN.test(tok) ? capoShape(tok, capo, shapeKey) : tok));
  }
}
