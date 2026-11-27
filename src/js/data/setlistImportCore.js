// ─────────────────────────────────────────────────────────────────────────
// Importar un setlist desde texto (pegado, de un PDF o leído de una foto). Puro;
// tests/setlistImport.test.mjs.
//   parseSetlistText(text, { today }) → { name, date, items: [{ raw, title, artist, key }] }
//   matchEntries(lib, items)          → items + { song, score } (la de tu librería o null)
// Entiende listas como las de WhatsApp:
//   «1. Adiós al ayer (Ab)», «- Way Maker – Sinach – G», «Cuán grande es Él en Sib 🔥»,
//   «Tono: Re · Tu fidelidad», cabeceras («Domingo 6 de diciembre», «Alabanza»), horas, etc.
// ─────────────────────────────────────────────────────────────────────────

const strip = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (v) => strip(v).toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const LATIN = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
const KEY_RE = /^([A-G])\s*(#|b|♯|♭)?\s*(m|min|menor)?$/;
const LATIN_RE = /^(do|re|mi|fa|sol|la|si)\s*(#|b|♯|♭|sostenido|bemol)?\s*(m|menor)?$/i;

/** «Ab», «F#m», «Sol», «Re m», «Sib», «La#m» → cifrado americano, o '' si no es un tono. */
export function toKey(tok) {
  let t = String(tok || '').trim().replace(/[.,;:)\]]+$/, '').replace(/^[(\[]+/, '').trim();
  if (!t || t.length > 12) return '';
  let m = t.match(KEY_RE);
  if (m) return m[1] + (m[2] === '#' || m[2] === '♯' ? '#' : m[2] ? 'b' : '') + (m[3] ? 'm' : '');
  m = strip(t).match(LATIN_RE);
  if (m) {
    const acc = (m[2] || '').toLowerCase();
    return LATIN[m[1].toLowerCase()] + (acc === '#' || acc === '♯' || acc === 'sostenido' ? '#' : acc ? 'b' : '') + (m[3] ? 'm' : '');
  }
  return '';
}

const HEADER = /^(set ?list|alabanza|adoracion|adoración|servicio|culto|reunion|reunión|ensayo|canciones|repertorio|orden|programa|ofrenda|santa cena|predica|prédica|bienvenida|anuncios|oracion|oración|cierre|despedida|tonos?|lista)\b/i;
const MONTHS = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** Fecha en una línea («domingo 6 de diciembre», «6/12», «06-12-2026») → 'YYYY-MM-DD' o null. */
export function findDate(line, today = Date.now()) {
  const s = norm(line);
  const now = new Date(today);
  const year = (m, d) => { let y = now.getFullYear(); const t = Date.UTC(y, m - 1, d); if (t < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - 60 * 86400000) y++; return y; };
  let m = s.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?/);
  if (m && MONTHS[m[2]]) { const mo = MONTHS[m[2]], d = +m[1]; if (d >= 1 && d <= 31) return `${m[3] || year(mo, d)}-${pad(mo)}-${pad(d)}`; }
  m = s.match(/\b(\d{1,2})\s+([a-z]{3,})\b/);
  if (m && MONTHS[m[2]]) { const mo = MONTHS[m[2]], d = +m[1]; if (d >= 1 && d <= 31) return `${year(mo, d)}-${pad(mo)}-${pad(d)}`; }
  m = String(line).match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) { const d = +m[1], mo = +m[2]; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year(mo, d); return `${y}-${pad(mo)}-${pad(d)}`; } }
  return null;
}

/** Una línea de canción → { title, artist, key } o null si no parece una canción. */
export function parseLine(raw) {
  let s = String(raw || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')   // emojis
    .replace(/[*_~`]+/g, ' ')                                                   // formato de WhatsApp
    .replace(/\s+/g, ' ').trim();
  s = s.replace(/^(\d{1,2}\s*[.)\-:]|#\d{1,2}|[-•·▪●○◦>]+)\s*/, '').trim();    // numeración y viñetas
  if (!s || s.length < 2 || s.length > 90) return null;
  if (!/[a-záéíóúñ]{2,}/i.test(s)) return null;                                // sin palabras
  if (/^\d{1,2}[:.]\d{2}\b/.test(s)) return null;                             // una hora
  let key = '';
  // «Tono: G» / «(Ab)» / «[F#m]» / «en Sol» / «- G» al final o al principio.
  const tono = s.match(/\b(?:tono|key|tonalidad)\s*[:=]?\s*([A-Za-z#♯♭]{1,6}(?:\s?m(?:enor)?)?)/i);
  if (tono && toKey(tono[1])) { key = toKey(tono[1]); s = s.replace(tono[0], ' '); }
  if (!key) { const p = s.match(/[([]\s*([^)\]]{1,8})\s*[)\]]/); if (p && toKey(p[1])) { key = toKey(p[1]); s = s.replace(p[0], ' '); } }
  if (!key) { const e = s.match(/\s(?:en|in)\s+([A-Za-z#♯♭]{1,6}(?:\s?m(?:enor)?)?)\s*$/i); if (e && toKey(e[1])) { key = toKey(e[1]); s = s.slice(0, e.index); } }
  s = s.replace(/\s+/g, ' ').trim().replace(/^[\s\-–—|:·]+|[\s\-–—|:·]+$/g, '');
  let parts = s.split(/\s+[-–—|:]\s+|\s*[–—|]\s*/).map((x) => x.trim()).filter(Boolean);
  if (!key && parts.length > 1 && toKey(parts[parts.length - 1])) key = toKey(parts.pop());
  if (!key && parts.length > 1 && toKey(parts[0])) key = toKey(parts.shift());
  if (!key) { const w = s.split(' '); if (w.length > 1 && toKey(w[w.length - 1]) && /^[A-G]/.test(w[w.length - 1])) { key = toKey(w.pop()); parts = [w.join(' ')]; } }
  const title = (parts[0] || '').replace(/[.,;:]+$/, '').trim();
  if (!title || !/[a-záéíóúñ]{2,}/i.test(title)) return null;
  if (HEADER.test(norm(title)) && !key && parts.length === 1 && title.split(' ').length <= 4) return null;   // cabecera
  if (/^(dirige|director|lider|líder|voces?|banda|bateria|batería|bajo|guitarra|teclado|piano|sonido|proyeccion|proyección)\s*:/i.test(s)) return null;   // roles
  return { title, artist: (parts[1] || '').trim(), key };
}

/** Texto completo → nombre del servicio, fecha y canciones. */
export function parseSetlistText(text, { today = Date.now() } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  let date = null, name = '';
  const items = [];
  for (const line of lines) {
    const d = findDate(line, today);
    const p = parseLine(line);
    if (d && !date) { date = d; if (!name) name = line.replace(/[*_~]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60); continue; }
    if (!p) { if (!name && !items.length && HEADER.test(norm(line))) name = line.replace(/[*_~]+/g, '').trim().slice(0, 60); continue; }
    items.push({ raw: line, ...p });
  }
  return { name, date, items };
}

// ── Casar con la librería ──────────────────────────────────────────────────
function bigrams(s) { const t = ` ${s} `, out = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; }
/** Parecido entre dos títulos (0…1), tolerante a erratas del OCR y a tildes. */
export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length > 5 && (y.includes(x) || x.includes(y))) return 0.9;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, n = 0;
  for (const [g, c] of A) { inter += Math.min(c, B.get(g) || 0); n += c; }
  for (const c of B.values()) n += c;
  return n ? (2 * inter) / n : 0;
}

export const MATCH_MIN = 0.72;
export function matchEntries(lib, items) {
  return items.map((it) => {
    let best = null, score = 0;
    for (const s of lib || []) {
      let sc = similarity(it.title, s.title);
      if (sc >= 0.6 && it.artist && s.artist) sc += similarity(it.artist, s.artist) >= 0.7 ? 0.05 : -0.03;
      if (sc > score) { score = sc; best = s; }
    }
    return { ...it, song: score >= MATCH_MIN ? best : null, score: Math.round(score * 100) / 100 };
  });
}
