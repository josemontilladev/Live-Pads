// ─────────────────────────────────────────────────────────────────────────
// Buscador de la Biblioteca de stems (packs).
//
// Igual que el de canciones (songQuery.js): texto libre sin tildes ni
// mayúsculas, todas las palabras en cualquier orden, y filtros:
//   artista:elevation · genero:worship · tono:E · bpm:130 · bpm:120-140
//   modo:mayor | modo:menor · es:gratis | es:pro
// El texto busca en nombre, artista, género, sensación, descripción y firma
// del pack, y también en el nombre de sus tracks («bajo», «pad»…).
// Puro (sin DOM); probado en tests/packQuery.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import { norm, parseQuery, toggleToken } from './songQuery.js';

export { toggleToken };

/** Texto del buscador → consulta (la de canciones + marca y género). */
export function parsePackQuery(input) {
  let tier = null;
  const genres = [];
  const rest = [];
  for (const tok of String(input || '').match(/(?:[^\s"]+:"[^"]*"|"[^"]*"|\S+)/g) || []) {
    const m = tok.match(/^([a-záéíóúñ]+):(.*)$/i);
    const k = m ? norm(m[1]) : '';
    const v = m ? norm(m[2].replace(/^"|"$/g, '').trim()) : '';
    if (k === 'es' || k === 'marca' || k === 'plan') {
      tier = v.startsWith('gra') || v === 'free' ? 'free' : v.startsWith('pro') ? 'pro' : null;
    } else if (k === 'genero' || k === 'genre') {
      if (v) genres.push(v);
    } else rest.push(tok);
  }
  return { ...parseQuery(rest.join(' ')), tier, genres };
}

const isMinor = (key) => /m(?!aj)/i.test(String(key || '').replace(/^[A-G][#b]?/, ''));

/**
 * ¿El pack cumple la consulta? null si no; si sí, { score } (mayor = más arriba).
 * [loops]: los tracks del pack (bpm, musical_key, tier, title).
 */
export function matchPack(p, loops, q) {
  const ls = loops || [];
  if (q.tier) {
    const tiers = ls.length ? ls.map((l) => (l.tier === 'free' ? 'free' : 'pro')) : [p.tier === 'free' ? 'free' : 'pro'];
    if (!tiers.includes(q.tier)) return null;
  }
  if (q.genres.length) { const g = norm(p.genre); if (!q.genres.every((x) => g.includes(x))) return null; }
  if (q.artists.length) { const a = norm(p.artist); if (!q.artists.every((x) => a.includes(x))) return null; }
  if (q.key !== null) {
    const keys = ls.map((l) => norm(l.musical_key)).filter(Boolean);
    if (!keys.length || (q.key && !keys.some((k) => k.startsWith(norm(q.key))))) return null;
  }
  if (q.mode) {
    const keys = ls.map((l) => l.musical_key).filter(Boolean);
    if (!keys.some((k) => isMinor(k) === (q.mode === 'minor'))) return null;
  }
  if (q.bpm) {
    if (!ls.some((l) => { const b = Number(l.bpm); return b >= q.bpm.min && b <= q.bpm.max; })) return null;
  }
  if (!q.words.length) return { score: 0 };

  const title = norm(p.title), artist = norm(p.artist);
  const meta = norm([p.genre, p.mood, p.description, p.author_name].filter(Boolean).join(' '));
  const tracks = norm(ls.map((l) => l.title).filter(Boolean).join(' '));
  for (const w of q.words) {
    if (!(title.includes(w) || artist.includes(w) || meta.includes(w) || tracks.includes(w))) return null;
  }
  const term = q.words.join(' ');
  let score;
  if (title === term) score = 100;
  else if (title.startsWith(term)) score = 90;
  else if (q.words.every((w) => title.includes(w))) score = 75;
  else if (artist && artist.includes(term)) score = 60;
  else if (q.words.every((w) => title.includes(w) || artist.includes(w))) score = 55;
  else if (q.words.every((w) => title.includes(w) || artist.includes(w) || meta.includes(w))) score = 35;
  else score = 15;   // por el nombre de sus tracks
  return { score };
}

/** ¿Hay algo que buscar (texto o filtros)? */
export const packQueryActive = (q) => !!(q.words.length || q.tier || q.genres.length || q.artists.length || q.key !== null || q.mode || q.bpm);
