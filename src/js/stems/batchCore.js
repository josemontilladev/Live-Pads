// ─────────────────────────────────────────────────────────────────────────
// Subida por lotes a la Biblioteca de stems — lógica pura (probada en
// tests/batch.test.mjs): qué se deduce de cada multitrack, qué pistas se
// escuchan para comprobarlo y qué hay que revisar antes de subir.
// ─────────────────────────────────────────────────────────────────────────

import { parsePackName } from './multitrackCore.js';

/** Tonos que acepta la Biblioteca (los del subidor de packs). */
export const LIB_KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const MAJOR_NAME = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAME = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** «A#» → «Bb», «D#m» → «Ebm», «c#» → «C#m»? (no: respeta la «m»). '' si no es un tono. */
export function normKey(k) {
  const m = String(k || '').trim().replace('♯', '#').replace('♭', 'b').match(/^([A-Ga-g])([#b]?)(m|min|minor)?$/);
  if (!m) return '';
  const pc = PC[m[1].toUpperCase() + m[2]];
  if (pc == null) return '';
  return m[3] ? MINOR_NAME[pc] : MAJOR_NAME[pc];
}
const keyPc = (k) => { const n = normKey(k); return n ? { pc: PC[n.replace(/m$/, '')], minor: /m$/.test(n) } : null; };

/** ¿Dos tonos son el mismo, o relativos (C y Am: mismas notas)? */
export function keysAgree(a, b) {
  const x = keyPc(a), y = keyPc(b);
  if (!x || !y) return true;
  if (x.pc === y.pc && x.minor === y.minor) return true;
  const rel = (maj, min) => (maj.pc + 9) % 12 === min.pc;
  return (!x.minor && y.minor && rel(x, y)) || (x.minor && !y.minor && rel(y, x));
}

/** ¿El BPM del nombre y el detectado cuadran? (también si uno es el doble o la mitad del otro). */
export function bpmsAgree(a, b) {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return true;
  return [1, 2, 0.5].some((f) => Math.abs(x - y * f) / x <= 0.03);
}

// Palabras que a veces quedan en el lugar del artista y no lo son.
const NOT_ARTIST = /^(secuencia|sequence|multitracks?|stems?|pistas?|tracks?|live|en vivo|original|demo|zip|wav|mp3|master|instrumental|split|click|guide|gu[ií]a)$/i;

/** Lo que dice el nombre del ZIP o la carpeta (y sus archivos): título, artista, BPM, tono. */
export function packMeta(name, fileNames = []) {
  const g = parsePackName(name, fileNames);
  const title = (g.title || String(name || '')).trim();
  let artist = (g.artist || '').trim();
  const doubtful = !!artist && (NOT_ARTIST.test(artist) || artist.toLowerCase() === title.toLowerCase());
  if (doubtful) artist = '';
  const bpm = Number(g.bpm) > 0 ? Number(g.bpm) : null;
  return { title, artist, artistDoubt: doubtful ? g.artist : '', bpm, key: normKey(g.key) };
}

/**
 * Qué pistas escuchar para comprobar: el BPM con el click (o la batería, o lo que haya),
 * el tono con una armónica (teclas, pad, guitarra, bajo). roles: rol de cada archivo.
 */
export function pickProbeTracks(roles) {
  const find = (...want) => { for (const w of want) { const i = roles.indexOf(w); if (i >= 0) return i; } return -1; };
  const bpm = find('click', 'drums', 'bass', 'keys', 'guitar', 'other');
  const key = find('keys', 'guitar', 'bass', 'other', 'vocals');
  return { bpm: bpm >= 0 ? bpm : (roles.length ? 0 : -1), key };
}

/** Valores finales: lo que corrigió la persona > lo del nombre > lo detectado. */
export function resolveItem(it) {
  const bpm = Number(it.edit?.bpm) > 0 ? Number(it.edit.bpm) : (it.meta.bpm || (it.detected?.bpm ? Math.round(it.detected.bpm) : null));
  const key = it.edit?.key != null ? normKey(it.edit.key) : (it.meta.key || normKey(it.detected?.key) || '');
  return {
    title: (it.edit?.title ?? it.meta.title).trim(),
    artist: (it.edit?.artist ?? it.meta.artist).trim(),
    bpm, key,
    tier: it.edit?.tier || it.tier || 'pro',
  };
}

/** Avisos de la fila: [{ level: 'bad' | 'warn', text }]. 'bad' impide subirla. */
export function reviewIssues(it, existingTitles = new Set()) {
  const v = resolveItem(it);
  const out = [];
  if (!v.title) out.push({ level: 'bad', text: 'Falta el nombre' });
  if (!v.bpm) out.push({ level: 'bad', text: 'Falta el BPM (no viene en el nombre y no se pudo detectar)' });
  else if (!(it.edit?.bpm) && it.meta.bpm && it.detected?.bpm && !bpmsAgree(it.meta.bpm, it.detected.bpm)) {
    out.push({ level: 'warn', text: `BPM: el nombre dice ${it.meta.bpm} y el audio suena a ${Math.round(it.detected.bpm)}` });
  } else if (!it.meta.bpm && !(it.edit?.bpm)) out.push({ level: 'warn', text: `BPM detectado del audio (${v.bpm}): compruébalo` });
  if (!v.key) out.push({ level: 'warn', text: 'Sin tono (no viene en el nombre y no se pudo detectar)' });
  else if (it.edit?.key == null && it.meta.key && it.detected?.key && !keysAgree(it.meta.key, it.detected.key)) {
    out.push({ level: 'warn', text: `Tono: el nombre dice ${it.meta.key} y el audio suena a ${normKey(it.detected.key)}` });
  } else if (!it.meta.key && it.edit?.key == null) out.push({ level: 'warn', text: `Tono detectado del audio (${v.key}): compruébalo` });
  if (!v.artist) out.push({ level: 'warn', text: it.meta.artistDoubt ? `Artista dudoso («${it.meta.artistDoubt}»): escríbelo` : 'Sin artista' });
  if (existingTitles.has(v.title.toLowerCase())) out.push({ level: 'warn', text: 'Ya hay un pack con este nombre: se creará otro' });
  return out;
}

/** Peso aproximado en la nube: WAV → MP3 192 kbps (≈ 0,14 del WAV de 16 bits); MP3 queda igual. */
export function estimateCloudBytes(files) {
  return files.reduce((t, f) => t + (/\.mp3$/i.test(f.name) ? f.size : /\.flac$/i.test(f.name) ? f.size * 0.25 : f.size * 0.14), 0);
}
