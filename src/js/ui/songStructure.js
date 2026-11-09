// ─────────────────────────────────────────────────────────────────────────
// La letra manda: secciones y acordes de la canción sobre el espectro.
//
// Si la letra trae sus secciones («VERSO 1», «Estribillo», «Primera Parte»…) y
// sus acordes («[A]», «F#m A/C# D»), eso es lo que se muestra en la onda. Lo
// que falte se completa con lo que detecta la app (suposiciones).
//
//  · parseLyricStructure(lyrics) → secciones de la letra con sus acordes.
//  · keyOffset(lyricSecs, detSegs) → semitonos entre la letra y el audio.
//  · labelSegments(audioSegs, lyricSecs, detSegs, k) → a cada tramo detectado
//    (cortes de sectionDetector) le pone la sección de la letra que mejor
//    encaja por sus ACORDES, respetando el orden de la letra (con repeticiones).
//  · songChordSegments(markers, lyricSecs, detSegs, k, duration) → los acordes
//    de la letra colocados en el tiempo, siguiendo los cambios de acorde que se
//    oyen dentro de cada sección.
//
// Todo puro (sin DOM): se prueba en tests/songStructure.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import { detectSectionHeader, isChordToken } from './lyricsFormat.js';

const mod = (a, n) => ((a % n) + n) % n;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NICE = { 'INTRO': 'Intro', 'VERSO': 'Verso', 'PRE-CORO': 'Pre Coro', 'CORO': 'Coro', 'PUENTE': 'Puente',
  'INSTRUMENTAL': 'Instrumental', 'INTERLUDIO': 'Interludio', 'SOLO': 'Solo', 'FINAL': 'Final', 'TAG': 'Tag' };
export const NON_VOCAL = new Set(['INTRO', 'INSTRUMENTAL', 'INTERLUDIO', 'SOLO', 'FINAL']);
const REPEATABLE = new Set(['CORO', 'PRE-CORO', 'PUENTE', 'TAG', 'INTERLUDIO', 'INSTRUMENTAL']);

export function sectionName(canon, num) {
  const base = NICE[canon] || canon;
  return num ? `${base} ${num}` : base;
}

// ── Acordes ────────────────────────────────────────────────────────────────
function pcOf(s) {
  const m = /^([A-G])([#b]?)/.exec(s || '');
  if (!m) return -1;
  return mod(PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), 12);
}
/** «F#m7/C#» → { r, q, b, n } con q en el índice de calidades del motor
 *  (0 mayor · 1 m · 2 7 · 3 maj7 · 4 m7 · 5 sus4 · 6 sus2). null si no es acorde. */
export function parseChord(token) {
  const t = String(token || '').replace(/[()[\]]/g, '').trim();
  if (!t || !isChordToken(t)) return null;
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(t);
  if (!m) return null;
  const r = pcOf(m[1]);
  const rest = m[2].toLowerCase();
  let q = 0;
  const minor = /^(m(?!aj)|min)/.test(rest) || /^dim/.test(rest);
  if (/^maj7|^maj9/.test(rest)) q = 3;
  else if (minor) q = /7|9|11/.test(rest) ? 4 : 1;
  else if (/sus2/.test(rest)) q = 6;
  else if (/sus/.test(rest)) q = 5;
  else if (/^(7|9|11|13)/.test(rest)) q = 2;
  const b = m[3] ? pcOf(m[3]) : -1;
  return { r, q, b, n: t };
}
const isMinorQ = (q) => q === 1 || q === 4;
const bin24 = (c) => c.r + (isMinorQ(c.q) ? 12 : 0);

// ── Letra → secciones con acordes ─────────────────────────────────────────
// Marcas pegadas a un acorde: «////Gm», «C//», «|F», «(Am)». Una sola «/» final no se
// toca porque «F/» no es habitual y «F/C» es un acorde con bajo.
const stripMarks = (t) => t.replace(/^[/|(\[]+/, '').replace(/(?:\/{2,}|[|)\]]+)$/, '');
const isFiller = (t) => /^[-–—|/,.:;•·x\d%()]+$/i.test(t);
/** ¿La línea es solo acordes (y separadores / marcas de repetición)? */
function isChordsOnly(line) {
  const toks = String(line).replace(/[\[\]]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.some((t) => parseChord(stripMarks(t))) && toks.every((t) => isFiller(t) || parseChord(stripMarks(t)));
}
/** Tokens de acorde de una línea (con o sin corchetes), con su columna exacta. */
function chordTokens(raw) {
  const out = [];
  const re = /[^\s\[\]]+/g;
  let m;
  while ((m = re.exec(raw))) {
    const tok = m[0];
    const lead = (/^[/|(]+/.exec(tok) || [''])[0].length;
    const text = stripMarks(tok);
    if (!text || !parseChord(text)) continue;
    const start = m.index + lead;
    out.push({ text, start, end: start + text.length });
  }
  return out;
}
/**
 * @returns {{canon:string, num:string, label:string, chords:{r,q,b,n}[]}[]}
 *   en el orden de la letra (las repeticiones escritas cuentan como apariciones).
 */
export function parseLyricStructure(lyrics) {
  const secs = [];
  let cur = null;
  const open = (h) => { cur = { canon: h.canon, num: h.num || '', label: sectionName(h.canon, h.num), chords: [], lines: [] }; secs.push(cur); };
  // Cada acorde recuerda DÓNDE está en la letra (línea y columnas del nombre) para
  // poder corregirlo desde la franja de acordes.
  const addChords = (toks, li) => {
    toks.forEach((tk) => {
      const c = parseChord(tk.text);
      if (!c) return;
      if (!cur) open({ canon: 'INTRO', num: '' });
      c.pos = { line: li, start: tk.start, end: tk.end };
      cur.chords.push(c);
    });
  };
  const scan = (raw, re, group = 0) => {
    const out = []; let m; re.lastIndex = 0;
    while ((m = re.exec(raw))) {
      const text = group ? m[group] : m[0];
      const start = m.index + (group ? m[0].indexOf(text) : 0);
      out.push({ text, start, end: start + text.length });
    }
    return out;
  };
  String(lyrics || '').split(/\r?\n/).forEach((raw, li) => {
    const line = raw.trim();
    if (!line) return;
    const h = detectSectionHeader(line);
    if (h) {
      // «Primera/Segunda Parte» = Verso 1/2.
      if (!h.num) { const o = /\b(primer|segund|tercer|cuart)/i.exec(line); if (o) h.num = String(['primer', 'segund', 'tercer', 'cuart'].indexOf(o[1].toLowerCase()) + 1); }
      open(h); return;
    }
    // «[INTRO] [Dm] [C]…»: el nombre de la sección y sus acordes en la misma línea.
    const lead = /^\s*\[([^\]]+)\]/.exec(raw);
    if (lead) {
      const h2 = detectSectionHeader(lead[1]);
      if (h2 && !parseChord(lead[1])) {
        open(h2);
        addChords(scan(raw, /\[([^\]]+)\]/g, 1).slice(1), li);
        return;
      }
    }
    // Acordes entre corchetes en cualquier parte de la línea (y el resto es letra)…
    if (/\[[^\]]+\]/.test(raw)) {
      const text = raw.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      // …salvo que lo que queda fuera de los corchetes sean también acordes
      // («[Dm7] C Bb»): entonces cuentan todos, en orden.
      if (text && isChordsOnly(text)) { addChords(chordTokens(raw), li); return; }
      addChords(scan(raw, /\[([^\]]+)\]/g, 1), li);
      if (text && cur) cur.lines.push(text);
      return;
    }
    // …o una línea solo de acordes («F#m A/C# D», «//Bb - F - Dm7 - C//»).
    if (isChordsOnly(line)) { addChords(chordTokens(raw), li); return; }
    if (cur) cur.lines.push(line);
  });
  return secs;
}

/** Cambia el acorde que está en `pos` (de parseLyricStructure) por `name`. */
export function replaceChordInLyrics(lyrics, pos, name) {
  const lines = String(lyrics || '').split(/\r?\n/);
  const nl = /\r\n/.test(String(lyrics || '')) ? '\r\n' : '\n';
  const l = lines[pos.line];
  if (l == null) return lyrics;
  lines[pos.line] = l.slice(0, pos.start) + name + l.slice(pos.end);
  return lines.join(nl);
}

// ── Tono: letra vs audio ──────────────────────────────────────────────────
function histLyric(secs) {
  const h = new Float64Array(24);
  secs.forEach((s) => s.chords.forEach((c) => { h[bin24(c)] += 1; }));
  return h;
}
function histDet(segs, t0 = -Infinity, t1 = Infinity) {
  const h = new Float64Array(24);
  segs.forEach((s) => {
    if (s.r < 0) return;
    const a = Math.max(s.s, t0), b = Math.min(s.e, t1);
    if (b > a) h[bin24(s)] += b - a;
  });
  return h;
}
function cosShift(lh, dh, k) {
  // lh en tono de la letra; dh en tono del audio: letra = audio + k.
  let dot = 0, nl = 0, nd = 0;
  for (let i = 0; i < 24; i++) {
    const j = (i < 12 ? mod(i - k, 12) : 12 + mod(i - 12 - k, 12));
    dot += lh[i] * dh[j]; nl += lh[i] * lh[i]; nd += dh[j] * dh[j];
  }
  return nl && nd ? dot / Math.sqrt(nl * nd) : 0;
}
// Solo raíces (12 notas): el detector confunde a menudo mayor/menor (oye «D»
// donde la letra dice «Dm»), pero la raíz casi siempre la acierta.
function cosShiftRoots(lh, dh, k) {
  let dot = 0, nl = 0, nd = 0;
  for (let i = 0; i < 12; i++) {
    const l = lh[i] + lh[12 + i], j = mod(i - k, 12), d = dh[j] + dh[12 + j];
    dot += l * d; nl += l * l; nd += d * d;
  }
  return nl && nd ? dot / Math.sqrt(nl * nd) : 0;
}
const keyScore = (lh, dh, k) => 0.5 * cosShift(lh, dh, k) + 0.5 * cosShiftRoots(lh, dh, k);
/** Semitonos k tales que acorde_letra = acorde_audio + k. { k, score 0..1 }.
 *  preferred = el cambio de tono que la persona puso a la pista: si encaja casi
 *  igual de bien, se usa ese (lo normal es subir/bajar la pista al tono de la letra). */
export function keyOffset(lyricSecs, detSegs, preferred = null) {
  const lh = histLyric(lyricSecs), dh = histDet(detSegs || []);
  let best = { k: 0, score: 0 };
  for (let k = 0; k < 12; k++) { const s = keyScore(lh, dh, k); if (s > best.score) best = { k, score: s }; }
  if (preferred != null) {
    const k = mod(Math.round(preferred), 12), s = keyScore(lh, dh, k);
    if (s >= best.score - 0.12) return { k, score: s };
  }
  return best;
}

// ── Tramos detectados → secciones de la letra (Viterbi) ───────────────────
const CUE_NONVOCAL = new Set(['intro', 'instrumental', 'outro']);
/**
 * @param {{s:number,e:number,cueId:string}[]} audioSegs  tramos en orden
 * @param lyricSecs  parseLyricStructure()
 * @param detSegs    acordes detectados [{s,e,r,q,b}]
 * @param k          keyOffset().k
 * @returns {{t:number, label:string, lyricIdx:number}[]}  (tramos iguales seguidos, fundidos)
 */
export function labelSegments(audioSegs, lyricSecs, detSegs, k) {
  const n = audioSegs.length, m = lyricSecs.length;
  if (!n) return [];
  const lHist = lyricSecs.map((s) => histLyric([s]));
  const aHist = audioSegs.map((a) => histDet(detSegs || [], a.s, a.e));
  // Estados: (j, x). j = aparición de la letra (0..m-1) o -1 «antes de empezar»;
  // x = 1 «tramo instrumental después de j» (se queda con la etiqueta del detector).
  const S = [];
  for (let j = -1; j < m; j++) { if (j >= 0) S.push({ j, x: 0 }); S.push({ j, x: 1 }); }
  const emit = (i, st) => {
    const nonvocalCue = CUE_NONVOCAL.has(audioSegs[i].cueId);
    if (st.x === 1) return nonvocalCue ? 0.9 : -0.1;
    const L = lyricSecs[st.j];
    const hasCh = L.chords.length > 0;
    let e = hasCh ? 2 * cosShift(lHist[st.j], aHist[i], k) : 0.7;
    if (NON_VOCAL.has(L.canon)) e += nonvocalCue ? 0.6 : -0.4;
    else if (nonvocalCue) e -= 0.5;
    return e;
  };
  const trans = (a, b) => {
    // b.x === 1: instrumental tras la misma aparición, sin moverse en la letra.
    if (b.x === 1) return b.j === a.j ? -0.05 : -3;
    if (b.j === a.j) return a.x === 0 ? -0.15 : -0.6;     // seguir en la misma (se funde)
    if (b.j === a.j + 1) return 0.5;                       // lo siguiente de la letra
    if (b.j < a.j) return REPEATABLE.has(lyricSecs[b.j].canon) ? -0.35 : -1.1;   // repetir un coro…
    return -0.45 * (b.j - a.j - 1) - 0.2;                  // saltarse secciones
  };
  let score = S.map((st) => (st.j <= 0 ? 0 : -0.6 * st.j) + emit(0, st));
  const back = [];
  for (let i = 1; i < n; i++) {
    const nx = new Array(S.length), bp = new Array(S.length);
    for (let b = 0; b < S.length; b++) {
      let best = -Infinity, arg = 0;
      for (let a = 0; a < S.length; a++) { const v = score[a] + trans(S[a], S[b]); if (v > best) { best = v; arg = a; } }
      nx[b] = best + emit(i, S[b]); bp[b] = arg;
    }
    score = nx; back.push(bp);
  }
  let cur = score.indexOf(Math.max(...score));
  const path = [cur];
  for (let i = n - 2; i >= 0; i--) { cur = back[i][cur]; path.unshift(cur); }
  const out = [];
  path.forEach((si, i) => {
    const st = S[si], a = audioSegs[i];
    let label, lyricIdx = -1;
    if (st.x === 0) {
      label = lyricSecs[st.j].label; lyricIdx = st.j;
      // La letra repite el «Intro» a mitad de canción: ahí es un interludio.
      if (lyricSecs[st.j].canon === 'INTRO' && out.length) label = 'Interludio';
    }
    else if (st.j < 0 || i === 0) label = 'Intro';
    else label = (a.cueId === 'outro' || i === n - 1) ? 'Final' : 'Instrumental';
    const prev = out[out.length - 1];
    if (prev && prev.label === label) return;
    out.push({ t: a.s, label, lyricIdx });
  });
  return out;
}

/**
 * Afina el inicio de cada sección: si la sección de la letra empieza con un
 * acorde concreto, su inicio se mueve al momento en que ENTRA ese acorde en el
 * audio (a menos de un compás del corte detectado), y se pega al compás si hay
 * rejilla. Si no hay un cambio claro, se queda donde estaba.
 * @param marks  labelSegments() → [{t,label,lyricIdx}]
 * @param grid   { barSec, beatSec, off } | null
 */
export function refineSectionStarts(marks, lyricSecs, detSegs, k, grid, duration = Infinity) {
  const det = (detSegs || []).filter((d) => d.r >= 0);
  const win = grid && grid.barSec > 0 ? grid.barSec * 1.05 : 2.5;
  const out = marks.map((m) => ({ ...m }));
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const L = m.lyricIdx >= 0 ? lyricSecs[m.lyricIdx] : null;
    let t = m.t;
    if (L && L.chords.length && i > 0) {
      const c0 = L.chords[0];
      let best = null;
      det.forEach((d, j) => {
        if (Math.abs(d.s - m.t) > win) return;
        if (match(d, c0, k) < 1) return;
        // Que sea una ENTRADA del acorde (el anterior era otro).
        if (j > 0 && match(det[j - 1], c0, k) >= 1 && det[j - 1].e >= d.s - 0.05) return;
        if (best == null || Math.abs(d.s - m.t) < Math.abs(best - m.t)) best = d.s;
      });
      if (best != null) t = best;
    }
    // Al compás (o medio compás, por las anacrusas), si está cerca. Con los
    // compases reales del modelo, al compás que de verdad suena.
    if (grid && grid.downbeats && grid.downbeats.length && i > 0) {
      const near = (arr, tol) => { let b = null; for (const v of arr) if (Math.abs(v - t) <= tol && (b == null || Math.abs(v - t) < Math.abs(b - t))) b = v; return b; };
      const bar = near(grid.downbeats, grid.barSec * 0.3);
      if (bar != null) t = bar;
      else if (grid.beats) { const bt = near(grid.beats, grid.barSec * 0.15); if (bt != null) t = bt; }
    } else if (grid && grid.barSec > 0 && i > 0) {
      const off = grid.off || 0;
      const bar = off + Math.round((t - off) / grid.barSec) * grid.barSec;
      const half = off + Math.round((t - off) / (grid.barSec / 2)) * (grid.barSec / 2);
      if (Math.abs(bar - t) <= grid.barSec * 0.3) t = bar;
      else if (Math.abs(half - t) <= grid.barSec * 0.15) t = half;
    }
    const lo = i > 0 ? out[i - 1].t + 1 : 0, hi = i + 1 < out.length ? out[i + 1].t - 1 : duration;
    if (t > lo && t < hi) m.t = t;
  }
  return out;
}

// ── Acordes de la letra colocados en el tiempo ────────────────────────────
function match(det, c, k) {
  if (!det || det.r < 0) return 0;
  const r = mod(det.r + k, 12);
  if (r === c.r) return isMinorQ(det.q) === isMinorQ(c.q) ? 1 : 0.55;
  if (c.b >= 0 && r === c.b) return 0.5;           // A/C#: suena el bajo C#
  return 0;
}
/** Sigue el orden de los acordes de una sección (con vuelta al principio, porque
 *  la progresión se repite) sobre los acordes que se oyen en [t0, t1). */
function placeSection(chords, det, t0, t1, k) {
  const inR = det.filter((d) => d.e > t0 + 0.05 && d.s < t1 - 0.05);
  const p = chords.length;
  if (!inR.length) {
    const step = (t1 - t0) / p;
    return chords.map((c, i) => ({ s: t0 + i * step, e: t0 + (i + 1) * step, c }));
  }
  const n = inR.length;
  const dur = (d) => Math.max(0.05, Math.min(d.e, t1) - Math.max(d.s, t0));
  let score = chords.map((c, q) => (q === 0 ? 0 : -0.6 - 0.1 * q) + match(inR[0], c, k) * dur(inR[0]));
  const back = [];
  for (let i = 1; i < n; i++) {
    const nx = new Array(p), bp = new Array(p);
    const w = dur(inR[i]);
    for (let b = 0; b < p; b++) {
      let best = -Infinity, arg = 0;
      for (let a = 0; a < p; a++) {
        let tr;
        if (a === b) tr = 0;
        else if (b === a + 1) tr = -0.12;
        else if (b === 0 && a === p - 1) tr = -0.2;             // vuelve a empezar la progresión
        else if (b === a + 2) tr = -0.5;                        // un acorde muy corto que no se oyó
        else tr = -2;
        const v = score[a] + tr;
        if (v > best) { best = v; arg = a; }
      }
      nx[b] = best + match(inR[i], chords[b], k) * w; bp[b] = arg;
    }
    score = nx; back.push(bp);
  }
  let cur = score.indexOf(Math.max(...score));
  const path = [cur];
  for (let i = n - 2; i >= 0; i--) { cur = back[i][cur]; path.unshift(cur); }
  const out = [];
  path.forEach((q, i) => {
    const s = Math.max(t0, inR[i].s), e = Math.min(t1, inR[i].e);
    const prev = out[out.length - 1];
    if (prev && prev.q === q) { prev.e = e; return; }
    out.push({ s: out.length ? s : t0, e, q, c: chords[q] });
  });
  return out;
}

/** Busca la sección de la letra de cada marcador: mismo nombre y número; si no,
 *  el mismo tipo (el 2.º «Verso» marcado → el 2.º verso distinto de la letra). */
export function mapMarkersToLyrics(markers, lyricSecs) {
  const used = {};
  return markers.map((mk) => {
    const h = detectSectionHeader(mk.label);
    if (!h) return -1;
    let j = lyricSecs.findIndex((s) => s.canon === h.canon && h.num && s.num === h.num);
    if (j >= 0) return j;
    const same = [];
    lyricSecs.forEach((s, i) => { if (s.canon === h.canon && !same.some((x) => lyricSecs[x].label === s.label && sameChords(lyricSecs[x], s))) same.push(i); });
    if (!same.length) return -1;
    const n = used[h.canon] || 0;
    if (!h.num) used[h.canon] = n + 1;
    const pick = h.num ? Math.max(0, parseInt(h.num, 10) - 1) : n;
    return same[pick % same.length];
  });
}
function sameChords(a, b) { return a.chords.map((c) => c.n).join(' ') === b.chords.map((c) => c.n).join(' '); }

/**
 * Acordes a mostrar en la franja: los de la letra dentro de cada sección marcada
 * (en tono del AUDIO, con su nombre escrito en `n`), y los detectados — marcados
 * `guess` — donde la letra no dice nada.
 * @returns {{s,e,r,q,b,n?,guess?}[]}
 */
export function songChordSegments(markers, lyricSecs, detSegs, k, duration) {
  const ms = (markers || []).slice().sort((a, b) => a.t - b.t);
  const det = (detSegs || []).filter((d) => d.r >= 0);
  const map = mapMarkersToLyrics(ms, lyricSecs);
  const out = [];
  const pushGuess = (t0, t1) => det.forEach((d) => {
    if (d.e <= t0 || d.s >= t1) return;
    out.push({ s: Math.max(d.s, t0), e: Math.min(d.e, t1), r: d.r, q: d.q, b: d.b, guess: true });
  });
  if (ms.length && ms[0].t > 0.5) pushGuess(0, ms[0].t);
  ms.forEach((mk, i) => {
    const t0 = mk.t, t1 = i + 1 < ms.length ? ms[i + 1].t : duration;
    if (!(t1 > t0)) return;
    const L = map[i] >= 0 ? lyricSecs[map[i]] : null;
    if (!L || !L.chords.length) { pushGuess(t0, t1); return; }
    placeSection(L.chords, det, t0, t1, k).forEach((x) => {
      const c = x.c;
      out.push({ s: x.s, e: x.e, r: mod(c.r - k, 12), q: c.q, b: c.b >= 0 ? mod(c.b - k, 12) : -1, n: c.n, pos: c.pos, sec: L.label });
    });
  });
  return out;
}

// ── Acordes de la letra sin secciones marcadas ────────────────────────────
// Toda la secuencia de acordes de la letra (en su orden) se alinea con los
// acordes que se oyen (programación dinámica): cada tramo detectado se asigna a
// un acorde de la letra que puede durar varios tramos, avanzar al siguiente,
// saltarse alguno (con coste), volver al principio de una sección (los coros se
// repiten aunque la letra los escriba una vez) o quedarse sin pareja (pasajes
// que la letra no recoge: se muestran como detectados).
const INTS = [[0, 4, 7], [0, 3, 7], [0, 4, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10], [0, 5, 7], [0, 2, 7]];
function chordSim(dr, dq, lr, lq) {
  // Parecido entre un acorde oído y uno de la letra (ya en el tono del audio), −0,5 … +0,5.
  const a = new Set(INTS[dq] ? INTS[dq].slice(0, 3).map((i) => (dr + i) % 12) : []);
  const b = INTS[lq] ? INTS[lq].slice(0, 3).map((i) => (lr + i) % 12) : [];
  let common = 0;
  b.forEach((x) => { if (a.has(x)) common++; });
  return (dr === lr ? 0.55 : 0) + 0.45 * common / 3 - 0.5;
}

/**
 * @returns {{s,e,r,q,b,n?,pos?,sec?,guess?}[]} en el tono del AUDIO (como songChordSegments).
 */
export function alignLyricChords(lyricSecs, detSegs, k, duration = Infinity) {
  // Acordes oídos, fundiendo tramos seguidos con el mismo acorde (raíz + mayor/menor).
  const det = [];
  (detSegs || []).forEach((d) => {
    if (!(d.r >= 0) || !(d.e > d.s)) return;
    const last = det[det.length - 1];
    if (last && last.r === d.r && isMinorQ(last.q) === isMinorQ(d.q) && d.s - last.e < 0.5) { last.e = d.e; return; }
    det.push({ ...d });
  });
  const L = [], secStart = [];
  (lyricSecs || []).forEach((sec) => {
    if (!sec.chords.length) return;
    secStart.push(L.length);
    sec.chords.forEach((c) => L.push({ c, sec: sec.label, ar: mod(c.r - k, 12) }));
  });
  const n = det.length, m = L.length;
  if (!n || !m) return [];
  const GAP = m;                       // estado «sin pareja en la letra»
  const STAY = 0, SKIP = 1.2, JUMP = 3.0, TO_GAP = 1.5, GAP_STAY = 0.15;
  const starts = new Set(secStart);
  const NEG = -1e18;
  let dp = new Float64Array(m + 1).fill(NEG);
  const back = [];
  const emit = (i, j) => {
    const d = det[i], w = Math.min(8, d.e - d.s);
    return j === GAP ? -0.15 * w : chordSim(d.r, d.q, L[j].ar, L[j].c.q) * w;
  };
  // Inicio: lo natural es empezar por el principio de la letra; cualquier sección cuesta un salto.
  for (let j = 0; j < m; j++) if (j === 0 || starts.has(j)) dp[j] = (j === 0 ? 0 : -JUMP) + emit(0, j);
  dp[GAP] = -TO_GAP + emit(0, GAP);
  back.push(null);
  for (let i = 1; i < n; i++) {
    const nd = new Float64Array(m + 1).fill(NEG), bp = new Int32Array(m + 1).fill(-1);
    // mejor estado previo (para saltos a inicios de sección y a «sin pareja»)
    let best = 0;
    for (let p = 1; p <= m; p++) if (dp[p] > dp[best]) best = p;
    for (let j = 0; j < m; j++) {
      let v = NEG, from = -1;
      const cand = (p, cost) => { if (p >= 0 && p <= m && dp[p] > NEG / 2 && dp[p] - cost > v) { v = dp[p] - cost; from = p; } };
      cand(j, STAY);                                   // el mismo acorde sigue sonando
      if (j >= 1) cand(j - 1, 0);                      // siguiente acorde
      if (j >= 2) cand(j - 2, SKIP);                   // se salta uno
      if (j >= 3) cand(j - 3, 2 * SKIP);               // se salta dos
      if (starts.has(j)) { cand(best, JUMP); cand(GAP, JUMP * 0.5); }   // empieza (o se repite) una sección
      if (from >= 0) { nd[j] = v + emit(i, j); bp[j] = from; }
    }
    // sin pareja
    let v = dp[GAP] - GAP_STAY, from = GAP;
    if (dp[best] - TO_GAP > v) { v = dp[best] - TO_GAP; from = best; }
    nd[GAP] = v + emit(i, GAP); bp[GAP] = from;
    back.push(bp);
    dp = nd;
  }
  let j = 0;
  for (let p = 1; p <= m; p++) if (dp[p] > dp[j]) j = p;
  const path = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = j; if (i > 0) j = back[i][j]; }
  // Tramos: los tramos oídos seguidos que caen en el mismo acorde de la letra se unen.
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = det[i], st = path[i];
    const prev = out[out.length - 1];
    if (st === GAP) {
      out.push({ s: d.s, e: Math.min(d.e, duration), r: d.r, q: d.q, b: d.b, guess: true, _j: -1 });
      continue;
    }
    if (prev && prev._j === st) { prev.e = Math.min(d.e, duration); continue; }
    const { c, sec, ar } = L[st];
    out.push({ s: d.s, e: Math.min(d.e, duration), r: ar, q: c.q, b: c.b >= 0 ? mod(c.b - k, 12) : -1, n: c.n, pos: c.pos, sec, _j: st });
  }
  const res = out.map(({ _j, ...x }) => x);
  // Confianza: fracción del tiempo con acorde de la letra cuya raíz y modo coinciden con lo oído.
  let agree = 0, tot = 0;
  for (let i = 0; i < n; i++) {
    if (path[i] === GAP) continue;
    const d = det[i], w = d.e - d.s, l = L[path[i]];
    tot += w;
    if (d.r === l.ar && isMinorQ(d.q) === isMinorQ(l.c.q)) agree += w;
  }
  res.agree = tot ? agree / tot : 0;
  res.covered = tot / Math.max(1e-9, det.reduce((a, d) => a + d.e - d.s, 0));
  return res;
}
