// ─────────────────────────────────────────────────────────────────────────
// Sesión de REAPER (.rpp, texto) → lo que Stems necesita: tempo, compás,
// marcadores/regiones y pistas con sus clips (posición, recorte, fades,
// volumen, paneo, silencio). Puro: probado en tests/rpp.test.mjs.
//
//   parseRpp(text) → { bpm, beatsPerBar, beatValue, markers: [{ label, atSec }],
//                      tracks: [{ name, volume, pan, muted, clips: [{ file, position, length, offset, fadeIn, fadeOut }] }] }
//   rppFiles(text) → rutas de audio que la sesión usa (en orden, sin repetir)
// ─────────────────────────────────────────────────────────────────────────

/** Una línea del RPP en palabras (respeta "comillas", 'simples' y `invertidas`). */
export function rppTokens(line) {
  const out = [];
  const s = line.trim();
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i >= s.length) break;
    const q = s[i];
    if (q === '"' || q === "'" || q === '`') {
      const j = s.indexOf(q, i + 1);
      out.push(s.slice(i + 1, j < 0 ? s.length : j));
      i = j < 0 ? s.length : j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ' ' && s[j] !== '\t') j++;
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/** Árbol de bloques: { tag, args, lines: [tokens], kids: [bloque] }. */
function tree(text) {
  const root = { tag: 'ROOT', args: [], lines: [], kids: [] };
  const stack = [root];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t[0] === '<') {
      const tk = rppTokens(t.slice(1));
      const b = { tag: (tk[0] || '').toUpperCase(), args: tk.slice(1), lines: [], kids: [] };
      stack[stack.length - 1].kids.push(b);
      stack.push(b);
    } else if (t === '>') {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].lines.push(rppTokens(t));
    }
  }
  return root;
}

const line = (b, key) => b.lines.find((l) => l[0] === key);

/** Primer FILE dentro de una fuente (las fuentes pueden ir anidadas: SECTION → WAVE). */
function sourceFile(b) {
  for (const k of b.kids) {
    if (k.tag !== 'SOURCE') continue;
    const f = line(k, 'FILE');
    if (f && f[1]) return f[1];
    const inner = sourceFile(k);
    if (inner) return inner;
  }
  return null;
}

export function parseRpp(text) {
  const root = tree(text);
  const proj = root.kids.find((k) => k.tag === 'REAPER_PROJECT');
  if (!proj) throw new Error('No es una sesión de REAPER (.rpp).');
  const tempo = line(proj, 'TEMPO');
  const bpm = tempo ? num(tempo[1], 120) : 120;
  const beatsPerBar = tempo ? Math.round(num(tempo[2], 4)) || 4 : 4;
  const beatValue = tempo ? Math.round(num(tempo[3], 4)) || 4 : 4;
  // Marcadores y regiones: «MARKER id posición "nombre" flags». Una región son dos
  // líneas con el mismo id (inicio y fin): se usa el inicio.
  const seen = new Set();
  const markers = [];
  for (const l of proj.lines) {
    if (l[0] !== 'MARKER') continue;
    const id = l[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const atSec = num(l[2], NaN);
    if (!Number.isFinite(atSec)) continue;
    markers.push({ label: (l[3] || '').trim() || `Marcador ${id}`, atSec: Math.max(0, atSec) });
  }
  markers.sort((a, b) => a.atSec - b.atSec);
  const tracks = [];
  for (const tb of proj.kids.filter((k) => k.tag === 'TRACK')) {
    const name = (line(tb, 'NAME') || [])[1] || `Pista ${tracks.length + 1}`;
    const vp = line(tb, 'VOLPAN');
    const ms = line(tb, 'MUTESOLO');
    const clips = [];
    for (const it of tb.kids.filter((k) => k.tag === 'ITEM')) {
      const file = sourceFile(it);
      if (!file) continue;
      const iv = line(it, 'VOLPAN');
      const fi = line(it, 'FADEIN'), fo = line(it, 'FADEOUT');
      clips.push({
        file,
        position: Math.max(0, num((line(it, 'POSITION') || [])[1])),
        length: Math.max(0, num((line(it, 'LENGTH') || [])[1])),
        offset: Math.max(0, num((line(it, 'SOFFS') || [])[1])),
        fadeIn: fi ? Math.max(0, num(fi[2])) : 0,
        fadeOut: fo ? Math.max(0, num(fo[2])) : 0,
        gain: iv ? num(iv[1], 1) : 1,
        muted: !!(line(it, 'MUTE') && line(it, 'MUTE')[1] === '1'),
      });
    }
    // Volumen de REAPER: ganancia lineal (1 = 0 dB, puede pasar de 1) → 0..1 del fader de Stems.
    const vol = vp ? num(vp[1], 1) : 1;
    tracks.push({
      name,
      volume: Math.max(0, Math.min(1, vol * 0.85)),
      pan: vp ? Math.max(-1, Math.min(1, num(vp[2]))) : 0,
      muted: !!(ms && ms[1] === '1'),
      clips: clips.filter((c) => !c.muted && c.length > 0.01),
    });
  }
  return { bpm, beatsPerBar, beatValue, markers, tracks: tracks.filter((t) => t.clips.length) };
}

/** Rutas de audio que usa la sesión (sin repetir, en orden). */
export function rppFiles(text) {
  const out = [];
  for (const t of parseRpp(text).tracks) for (const c of t.clips) if (!out.includes(c.file)) out.push(c.file);
  return out;
}

/**
 * Pistas para Stems: una pista por (pista de REAPER × archivo). Los clips del mismo
 * archivo comparten audio; en el timeline: empieza en `position`, suena desde `offset`
 * del archivo durante `length`.
 */
export function rppStemTracks(parsed) {
  const out = [];
  for (const t of parsed.tracks) {
    const files = [...new Set(t.clips.map((c) => c.file))];
    for (const f of files) {
      const base = f.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      out.push({
        name: files.length > 1 ? `${t.name} · ${base}` : t.name,
        file: f, volume: t.volume, pan: t.pan, muted: t.muted,
        clips: t.clips.filter((c) => c.file === f).map((c) => ({
          shift: c.position - c.offset, trimStartSec: c.offset, trimEndSec: c.offset + c.length,
          fadeInSec: Math.min(c.fadeIn, c.length), fadeOutSec: Math.min(c.fadeOut, c.length),
        })),
      });
    }
  }
  return out;
}
