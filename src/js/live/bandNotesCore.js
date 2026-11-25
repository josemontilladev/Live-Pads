// ─────────────────────────────────────────────────────────────────────────
// Notas para la banda por sección («Bajo: aquí para», «Todos: el último coro suave»).
// Viven en la canción de la librería (song.bandNotes) y viajan al equipo con la
// nube; se ven en la letra de LivePads, en la hoja impresa y en el Companion de
// cada músico (en el monitor de escenario, justo en esa sección).
//
//   nota = { id, sec, who, text, by, at }
//     sec  — sección a la que se refiere («Coro», «Verso 2»; '' = toda la canción).
//            «Coro» sin número vale para todos los coros; «Verso 2», solo para ese.
//     who  — para quién: all | vocals | guitar | bass | keys | drums | winds
//     by   — quién la escribió (nombre de la cuenta); at — cuándo (ms)
//
// Puro (sin DOM): probado en tests/bandNotes.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import { detectSectionHeader } from '../ui/lyricsFormat.js';

export const WHO = [
  { id: 'all', label: 'Todos' },
  { id: 'vocals', label: 'Voces' },
  { id: 'guitar', label: 'Guitarras' },
  { id: 'bass', label: 'Bajo' },
  { id: 'keys', label: 'Teclados' },
  { id: 'drums', label: 'Batería' },
  { id: 'winds', label: 'Vientos' },
];
const WHO_IDS = new Set(WHO.map((w) => w.id));
export const whoLabel = (id) => (WHO.find((w) => w.id === id) || WHO[0]).label;

export const MAX_NOTES = 60;
export const MAX_TEXT = 140;

/** Nota válida y recortada, o null. */
export function cleanNote(n) {
  if (!n || typeof n !== 'object') return null;
  const text = String(n.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!text) return null;
  return {
    id: String(n.id || '').slice(0, 40) || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sec: String(n.sec || '').replace(/\s+/g, ' ').trim().slice(0, 26),
    who: WHO_IDS.has(n.who) ? n.who : 'all',
    text,
    by: String(n.by || '').trim().slice(0, 30),
    at: Number(n.at) || 0,
  };
}

/** Lista limpia (sin duplicados por id, ordenada por fecha). */
export function cleanNotes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Map();
  for (const raw of list) {
    const n = cleanNote(raw);
    if (!n) continue;
    const prev = seen.get(n.id);
    if (!prev || n.at >= prev.at) seen.set(n.id, n);
  }
  return [...seen.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(-MAX_NOTES);
}

/** Forma canónica para comparar (sincronización). */
export function notesSig(list) {
  return JSON.stringify(cleanNotes(list).map((n) => [n.id, n.sec, n.who, n.text, n.by, n.at]));
}

/**
 * Fusión de tres vías: nunca es conflicto. Las notas nuevas de cualquiera de los dos
 * lados se suman; una nota que estaba en la base y uno de los dos borró, se borra
 * (salvo que el otro la editara después); si ambos editaron la misma, gana la más reciente.
 */
export function mergeNotes(base, mine, theirs) {
  const B = new Map(cleanNotes(base).map((n) => [n.id, n]));
  const M = new Map(cleanNotes(mine).map((n) => [n.id, n]));
  const T = new Map(cleanNotes(theirs).map((n) => [n.id, n]));
  const out = [];
  for (const id of new Set([...M.keys(), ...T.keys()])) {
    const m = M.get(id), t = T.get(id), b = B.get(id);
    if (m && t) { out.push(m.at >= t.at ? m : t); continue; }
    const only = m || t;
    if (!b) { out.push(only); continue; }                 // nueva en un lado
    if (only.at > b.at) out.push(only);                    // el otro la borró, pero esta se editó después
  }
  return cleanNotes(out);
}

/** Clave de sección para comparar: { canon, num } o el texto en minúsculas. */
function secKey(label) {
  const h = detectSectionHeader(String(label || ''));
  if (h) return { canon: h.canon, num: String(h.num || '') };
  const s = String(label || '').trim().toLowerCase();
  return s ? { canon: s, num: '' } : null;
}

/** ¿La nota de la sección `noteSec` vale para la sección `label`? */
export function secMatches(noteSec, label) {
  if (!noteSec) return false;
  const a = secKey(noteSec), b = secKey(label);
  if (!a || !b || a.canon !== b.canon) return false;
  return !a.num || a.num === b.num;   // «Coro» vale para todos los coros; «Coro 2», solo para ese
}

/** Notas de una sección (las de «toda la canción» no entran aquí). */
export function notesForSection(list, label) {
  return cleanNotes(list).filter((n) => secMatches(n.sec, label));
}

/** Notas generales (sin sección). */
export function generalNotes(list) {
  return cleanNotes(list).filter((n) => !n.sec);
}

/** Texto corto para pantallas pequeñas: «Bajo: aquí para». */
export function noteLine(n) {
  return n.who && n.who !== 'all' ? `${whoLabel(n.who)}: ${n.text}` : n.text;
}

/**
 * Secciones de la canción para elegir en el editor: las de la letra ([Coro], Verso 2…)
 * y las marcas de la onda, sin repetir, en orden de aparición.
 */
export function sectionsOf(lyrics, markers = []) {
  const out = [], seen = new Set();
  const add = (label) => {
    const k = secKey(label);
    if (!k) return;
    const id = k.canon + '|' + k.num;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(String(label).replace(/[\[\]]/g, '').replace(/[\s:]+$/, '').trim());
  };
  for (const line of String(lyrics || '').replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const bracket = /^\[[^\[\]]+\]$/.test(t);
    if (detectSectionHeader(t) || (bracket && detectSectionHeader(t.slice(1, -1)))) add(t.replace(/^\[|\]$/g, ''));
  }
  for (const m of Array.isArray(markers) ? markers : []) if (m && m.label) add(m.label);
  return out;
}
