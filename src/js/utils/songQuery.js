// ─────────────────────────────────────────────────────────────────────────
// Buscador de canciones (Librería).
//
// Texto libre (título, artista, etiquetas, letra; sin importar tildes ni
// mayúsculas; todas las palabras, en cualquier orden; tolera una falta de
// ortografía en palabras largas) + filtros:
//   tono:G · tono:Am · bpm:120 · bpm:110-130 · bpm:>120 · bpm:<90
//   artista:hillsong · tag:navidad
//   tiene:secuencia|original|letra|acordes   sin:secuencia|original|letra|acordes
//   modo:mayor | modo:menor
// Puro (sin DOM); probado en tests/songQuery.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

export const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const HAS = {
  secuencia: 'seq', seq: 'seq', sec: 'seq',
  original: 'orig', orig: 'orig',
  letra: 'lyrics', lyrics: 'lyrics',
  acordes: 'chords', chords: 'chords',
};

/** Texto del buscador → consulta estructurada. */
export function parseQuery(input) {
  const q = { words: [], key: null, tags: [], artists: [], bpm: null, has: [], not: [], mode: null, raw: String(input || '') };
  const tokens = String(input || '').match(/(?:[^\s"]+:"[^"]*"|"[^"]*"|\S+)/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^([a-záéíóúñ]+):(.*)$/i);
    if (!m) { const w = norm(tok.replace(/"/g, '')); if (w) q.words.push(w); continue; }
    const k = norm(m[1]);
    const v = m[2].replace(/^"|"$/g, '').trim();
    if (k === 'tono' || k === 'key') q.key = v || '';
    else if (k === 'tag' || k === 'etiqueta') { if (v) q.tags.push(norm(v)); }
    else if (k === 'artista' || k === 'artist' || k === 'de') { if (v) q.artists.push(norm(v)); }
    else if (k === 'bpm') q.bpm = parseBpm(v);
    else if (k === 'tiene' || k === 'con') { const h = HAS[norm(v)]; if (h) q.has.push(h); }
    else if (k === 'sin') { const h = HAS[norm(v)]; if (h) q.not.push(h); }
    else if (k === 'modo') { const n = norm(v); q.mode = n.startsWith('men') ? 'minor' : n.startsWith('may') ? 'major' : null; }
    else { const w = norm(tok); if (w) q.words.push(w); }   // «palabra:con:dos puntos» → texto
  }
  return q;
}

function parseBpm(v) {
  const s = String(v || '').replace(/\s/g, '');
  let m;
  if ((m = s.match(/^(\d+)-(\d+)$/))) return { min: +m[1], max: +m[2] };
  if ((m = s.match(/^>=?(\d+)$/))) return { min: +m[1] + (s.includes('=') ? 0 : 1), max: Infinity };
  if ((m = s.match(/^<=?(\d+)$/))) return { min: -Infinity, max: +m[1] - (s.includes('=') ? 0 : 1) };
  if ((m = s.match(/^(\d+)$/))) return { min: +m[1] - 2, max: +m[1] + 2 };   // ±2 BPM
  return null;
}

/** ¿Hay algún filtro (más allá del texto)? */
export const hasFilters = (q) => !!(q.key !== null || q.tags.length || q.artists.length || q.bpm || q.has.length || q.not.length || q.mode);

const plainLyrics = (s) => String(s.lyrics || '').replace(/\[[^\]\n]{1,12}\]/g, '').replace(/<[^>]*>/g, ' ');
const hasChords = (s) => /\[[A-G][^\]\n]{0,10}\]/.test(String(s.lyrics || ''));
const feature = (s, f) => {
  const a = s.audio || {};
  if (f === 'seq') return !!a.sequence;
  if (f === 'orig') return !!a.original;
  if (f === 'lyrics') return !!String(s.lyrics || '').trim();
  if (f === 'chords') return hasChords(s);
  return false;
};

// Distancia de edición ≤ 1 (una letra de más, de menos o cambiada).
function oneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return d + (la - i) + (lb - j) <= 1;
}

/**
 * ¿La canción cumple la consulta? Devuelve null si no, o { score, where, snippet }:
 * score mayor = más arriba; where = 'título' | 'artista' | 'etiquetas' | 'letra';
 * snippet = la frase de la letra que coincide (si solo coincide en la letra).
 */
export function matchSong(s, q) {
  // Filtros
  if (q.key !== null) {
    const k = norm(s.key);
    if (!k) return null;
    if (q.key && !k.startsWith(norm(q.key))) return null;
    // «tono:G» no debe traer «G#» ni «Gm» si se escribió exacto con modo: tono:G → G, Gm, G#… (prefijo, como antes)
  }
  if (q.mode) { const minor = /m(?!aj)/i.test(String(s.key || '').replace(/^[A-G][#b]?/, '')); if ((q.mode === 'minor') !== minor || !s.key) return null; }
  if (q.bpm) { const b = parseFloat(s.bpm); if (!(b >= q.bpm.min && b <= q.bpm.max)) return null; }
  if (q.tags.length) { const t = norm((s.tags || []).join(' ')); if (!q.tags.every((x) => t.includes(x))) return null; }
  if (q.artists.length) { const a = norm(s.artist); if (!q.artists.every((x) => a.includes(x))) return null; }
  for (const f of q.has) if (!feature(s, f)) return null;
  for (const f of q.not) if (feature(s, f)) return null;
  if (!q.words.length) return { score: 0, where: null, snippet: null };

  // Texto libre: todas las palabras, en cualquier campo.
  const title = norm(s.title), artist = norm(s.artist), tags = norm((s.tags || []).join(' '));
  const lyr = plainLyrics(s), lyrN = norm(lyr);
  const fields = [title, artist, tags, lyrN];
  const titleWords = title.split(/[^a-z0-9ñ]+/).filter(Boolean).concat(artist.split(/[^a-z0-9ñ]+/).filter(Boolean));
  let fuzzy = false;
  for (const w of q.words) {
    if (fields.some((f) => f.includes(w))) continue;
    // Una falta de ortografía en palabras de 5+ letras (solo título y artista).
    if (w.length >= 5 && titleWords.some((tw) => tw.length >= 4 && oneEdit(w, tw))) { fuzzy = true; continue; }
    return null;
  }
  const term = q.words.join(' ');
  let score, where;
  if (title === term) { score = 100; where = 'título'; }
  else if (title.startsWith(term)) { score = 90; where = 'título'; }
  else if (q.words.every((w) => title.includes(w))) { score = 75; where = 'título'; }
  else if (q.words.every((w) => title.includes(w) || artist.includes(w))) { score = 55; where = 'artista'; }
  else if (q.words.every((w) => title.includes(w) || artist.includes(w) || tags.includes(w))) { score = 35; where = 'etiquetas'; }
  else { score = 15; where = 'letra'; }
  if (fuzzy) { score -= 8; if (where === 'letra') where = 'título'; }
  let snippet = null;
  if (where === 'letra') {
    const lines = lyr.split('\n').map((l) => l.trim()).filter(Boolean);
    const hit = lines.find((l) => q.words.every((w) => norm(l).includes(w))) || lines.find((l) => norm(l).includes(q.words[0]));
    if (hit) snippet = hit.length > 70 ? hit.slice(0, 67) + '…' : hit;
  }
  return { score, where, snippet };
}

/** Añade o quita un filtro del texto del buscador (para las píldoras). */
export function toggleToken(input, token) {
  const parts = String(input || '').split(/\s+/).filter(Boolean);
  const i = parts.findIndex((p) => norm(p) === norm(token));
  if (i >= 0) parts.splice(i, 1);
  else {
    // Mayor y menor se excluyen entre sí; «tiene:x» y «sin:x» también.
    const [k, v] = token.split(':');
    const clash = (p) => { const [pk, pv] = p.split(':'); return (k === 'modo' && norm(pk) === 'modo') || ((k === 'tiene' || k === 'sin') && (norm(pk) === 'tiene' || norm(pk) === 'sin') && norm(pv) === norm(v)); };
    for (let j = parts.length - 1; j >= 0; j--) if (clash(parts[j])) parts.splice(j, 1);
    parts.push(token);
  }
  return parts.join(' ') + (parts.length ? ' ' : '');
}
