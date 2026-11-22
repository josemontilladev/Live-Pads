// ─────────────────────────────────────────────────────────────────────────
// Cambiar la letra de una canción CONSERVANDO sus acordes.
//
// Caso real: el equipo de voces cambia la letra (otra traducción, versos
// nuevos) y hay que reescribirla sin perder los acordes que ya estaban puestos.
// Se pega la letra nueva SIN acordes y aquí:
//   1. Se empareja cada sección nueva con una de la letra vieja: mismo nombre y
//      número (Verso 2 ← Verso 2); si no, mismo tipo (Verso 3 ← Verso 1/2 en
//      rotación); si no hay ninguna con nombre, por orden.
//   2. Dentro de la sección, los acordes conservan su posición RELATIVA: línea
//      con línea si hay las mismas; si la letra nueva parte cada línea en dos
//      (o junta dos en una), por grupos; si no, a lo largo de la sección.
//   3. Cada acorde cae al principio de una palabra (nunca a media sílaba
//      inventada) y en el mismo orden que tenía.
// Las líneas solo de acordes (intro, «(Dm C F Gm)») se conservan al principio o
// al final de su sección; una sección nueva sin letra (p. ej. «Intro») toma las
// de la vieja. Funciones puras; probadas en tests/lyricsReplace.test.mjs.
// ─────────────────────────────────────────────────────────────────────────
import { isChordLine, detectSectionHeader, mergeChordLines } from '../ui/lyricsFormat.js';

const CHORD_TAG = /\[([^\]]+)\]/g;

/** «[C]Mil gene[F]raciones» → { text: 'Mil generaciones', chords: [{chord:'C', idx:0}, {chord:'F', idx:8}] } */
function splitInline(line) {
  const chords = [];
  let text = '', last = 0, m;
  CHORD_TAG.lastIndex = 0;
  while ((m = CHORD_TAG.exec(line))) {
    text += line.slice(last, m.index);
    chords.push({ chord: m[1], idx: text.length });
    last = CHORD_TAG.lastIndex;
  }
  text += line.slice(last);
  return { text, chords };
}

function isHeaderLine(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  // «[Verso 1]» o «Verso 1» / «CORO:»: encabezado si el detector lo reconoce.
  const h = detectSectionHeader(t);
  if (h) return h;
  return null;
}

/** Secciones de la letra vieja (con acordes). */
export function parseOld(text) {
  const lines = mergeChordLines(String(text || '').replace(/\r/g, '')).split('\n');
  const sections = [];
  let cur = { header: null, canon: '', num: '', lyric: [], before: [], after: [] };
  const push = () => { if (cur.header || cur.lyric.length || cur.before.length || cur.after.length) sections.push(cur); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const h = isHeaderLine(line);
    if (h) { push(); cur = { header: line.trim(), canon: h.canon, num: h.num, lyric: [], before: [], after: [] }; continue; }
    if (isChordLine(line)) {
      // Línea solo de acordes: antes de la letra o después.
      (cur.lyric.length ? cur.after : cur.before).push(line);
      continue;
    }
    const s = splitInline(line);
    if (cur.after.length) { cur.lyric.push(...cur.after.map((l) => ({ text: '', chords: [], raw: l }))); cur.after = []; }
    cur.lyric.push(s);
  }
  push();
  return sections;
}

/** Secciones de la letra nueva (sin acordes). */
export function parseNew(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const sections = [];
  let cur = { header: null, canon: '', num: '', lines: [] };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const h = isHeaderLine(line);
    if (h) { if (cur.header || cur.lines.length) sections.push(cur); cur = { header: line.trim().replace(/^\[|\]$/g, ''), canon: h.canon, num: h.num, lines: [] }; continue; }
    // Si pegaron con acordes, se quitan: la letra nueva manda en el texto.
    cur.lines.push(splitInline(line).text.trim());
  }
  if (cur.header || cur.lines.length) sections.push(cur);
  return sections;
}

// Empareja cada sección nueva con una vieja.
function matchSections(oldS, newS) {
  const byCanon = new Map();
  oldS.forEach((s, i) => { if (s.canon) { if (!byCanon.has(s.canon)) byCanon.set(s.canon, []); byCanon.get(s.canon).push(i); } });
  const anyNamed = oldS.some((s) => s.canon);
  let seq = 0;
  return newS.map((ns) => {
    if (ns.canon && byCanon.has(ns.canon)) {
      const cands = byCanon.get(ns.canon);
      const exact = cands.find((i) => (oldS[i].num || '1') === (ns.num || '1'));
      if (exact != null) return exact;
      const n = Math.max(1, parseInt(ns.num || '1', 10));
      return cands[(n - 1) % cands.length];
    }
    if (!anyNamed && oldS.length) return Math.min(seq++, oldS.length - 1);
    return -1;
  });
}

// ── Colocación por palabras ────────────────────────────────────────────
// Se alinean las palabras de la sección vieja con las de la nueva (la parte
// común más larga, sin tildes ni mayúsculas). Un acorde sobre una palabra que
// sigue estando va a esa misma palabra (y a la misma sílaba si cabe); los que
// caen en palabras nuevas se reparten en proporción entre las anclas vecinas.
const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

function oldWords(lines) {
  const out = [];
  lines.forEach((l) => {
    const re = /\S+/g; let m; const ws = [];
    while ((m = re.exec(l.text))) ws.push({ w: m[0], start: m.index, end: m.index + m[0].length, chords: [] });
    l.chords.forEach((c) => {
      // El acorde pertenece a la palabra que lo contiene; si cae en un espacio, a la siguiente.
      let w = ws.find((x) => c.idx >= x.start && c.idx < x.end) || ws.find((x) => x.start >= c.idx) || ws[ws.length - 1];
      if (w) w.chords.push({ chord: c.chord, off: Math.max(0, c.idx - w.start) });
    });
    ws.forEach((x) => out.push({ n: norm(x.w), chords: x.chords }));
  });
  return out;
}
function newWords(lines) {
  const out = [];
  lines.forEach((l, li) => { const re = /\S+/g; let m; while ((m = re.exec(l))) out.push({ n: norm(m[0]), li, idx: m.index, len: m[0].length }); });
  return out;
}
// Parte común más larga (pares [i, j]).
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i].n && a[i].n === b[j].n ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].n && a[i].n === b[j].n) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

function placeSection(oldLines, newLines) {
  const ow = oldWords(oldLines), nw = newWords(newLines);
  const out = newLines.map(() => []);
  const leftovers = [];
  if (!nw.length) { ow.forEach((w) => w.chords.forEach((c) => leftovers.push(c.chord))); return { out, leftovers }; }
  const pairs = lcs(ow, nw);
  const anchor = new Map(pairs);
  const anchors = [[-1, -1], ...pairs, [ow.length, nw.length]];
  let last = -1;
  ow.forEach((w, i) => {
    if (!w.chords.length) return;
    let j;
    if (anchor.has(i)) j = anchor.get(i);
    else {
      let a = anchors[0], b = anchors[anchors.length - 1];
      for (const p of anchors) { if (p[0] < i) a = p; else { b = p; break; } }
      const t = (i - a[0]) / Math.max(1, b[0] - a[0]);
      j = Math.round(a[1] + t * (b[1] - a[1]));
      j = Math.min(Math.max(j, 0), nw.length - 1);
    }
    // Siempre al INICIO de la palabra (las cifras pegadas suelen tener los
    // acordes alineados a ojo, a media palabra). Sin palabras libres: sobra.
    w.chords.forEach((c) => {
      const jj = Math.max(j, last + 1);
      if (jj >= nw.length) { leftovers.push(c.chord); return; }
      const t = nw[jj];
      out[t.li].push({ chord: c.chord, idx: t.idx });
      last = jj;
    });
  });
  return { out, leftovers };
}

function render(line, chords) {
  let s = line;
  [...chords].sort((a, b) => b.idx - a.idx).forEach((c) => {
    const pad = c.tail && s.length ? ' ' : '';
    s = s.slice(0, c.idx) + pad + '[' + c.chord + ']' + s.slice(c.idx);
  });
  return s;
}

/**
 * Devuelve { text, report } — text con la letra nueva y los acordes puestos;
 * report = [{ section, from }] (de qué sección vieja tomó los acordes, o null).
 */
export function replaceLyricsKeepChords(oldText, newText) {
  const oldS = parseOld(oldText);
  const newS = parseNew(newText);
  const match = matchSections(oldS, newS);
  const out = [];
  const report = [];
  newS.forEach((ns, k) => {
    const os = match[k] >= 0 ? oldS[match[k]] : null;
    if (out.length) out.push('');
    if (ns.header) out.push(ns.header);
    report.push({ section: ns.header || '(sin nombre)', from: os ? (os.header || '(inicio)') : null });
    if (!os) { ns.lines.forEach((l) => out.push(l)); return; }
    const oldLyric = os.lyric.filter((l) => l.text.trim());
    if (!ns.lines.length) { out.push(...os.before, ...os.lyric.map((l) => l.raw || render(l.text, l.chords)), ...os.after); return; }
    out.push(...os.before);
    const { out: placed, leftovers } = placeSection(oldLyric, ns.lines);
    ns.lines.forEach((l, i) => out.push(render(l, placed[i] || [])));
    // Acordes que no cupieron (la sección nueva tiene menos palabras): en una
    // línea de acordes aparte, para colocarlos a mano en la vista previa.
    if (leftovers.length) out.push(leftovers.join('  '));
    out.push(...os.after);
  });
  return { text: out.join('\n'), report };
}
