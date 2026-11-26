// ─────────────────────────────────────────────────────────────────────────
// Letra sincronizada: CUÁNDO suena cada línea de la letra, guardado en la canción.
//   song.lyricSync = { original?: S, sequence?: S }   (por pista: no empiezan igual)
//   S = { key, ev: [[t, i(, 0)], …], at, auto, edited }   (0 = «revisar»: la IA no estaba segura)
//     · ev: un evento por cada vez que se canta una línea (el coro repetido = varios
//       eventos con el mismo i), en orden de tiempo. t en segundos; i = nº de la línea
//       entre los `.lyric-line` de la letra mostrada (formatLyrics), empezando en 0.
//     · key: huella del TEXTO de las líneas (sin acordes): cambiar acordes o tono no la
//       invalida; cambiar la letra sí (hay que volver a sincronizar).
// Lo usan el panel de letra y la TV (ui/lyricTiming.js), la letra en vivo
// (ui/liveLyrics.js) y la proyección (live/projectionLink.js).
// ─────────────────────────────────────────────────────────────────────────

import { formatLyrics } from '../ui/lyricsFormat.js';

const plain = (el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('.inline-chord').forEach((n) => n.remove());
  return (c.textContent || '').replace(/[​  ]/g, ' ').replace(/\s+/g, ' ').trim();
};
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Texto de cada `.lyric-line` de un contenedor ya pintado. */
export function lineTextsOf(container) {
  return container ? Array.from(container.querySelectorAll('.lyric-line')).map(plain) : [];
}

/** Líneas de la letra tal como se muestran: [{ text, sec, secStart, label }] (una por `.lyric-line`). */
export function lyricLines(lyrics) {
  const div = document.createElement('div');
  div.innerHTML = formatLyrics(String(lyrics || ''));
  const out = [];
  let sec = -1, label = '', start = true;
  div.querySelectorAll('.section-header-line, .lyric-line').forEach((el) => {
    if (el.classList.contains('section-header-line')) { sec++; label = el.textContent.trim(); start = true; return; }
    out.push({ text: plain(el), sec: Math.max(0, sec), secStart: start, label });
    start = false;
  });
  return out;
}

export const syncKey = (texts) => hash(texts.map((t) => t.toLowerCase()).join('\n'));
const typeOf = (type) => (type === 'sequence' ? 'sequence' : 'original');

/** La sincronización guardada para esa pista, si sigue valiendo para la letra actual. */
export function getLyricSync(song, type, texts = null) {
  const s = song && song.lyricSync && song.lyricSync[typeOf(type)];
  if (!s || !Array.isArray(s.ev) || !s.ev.length) return null;
  const key = syncKey(texts || lyricLines(song.lyrics).map((l) => l.text));
  return s.key === key ? s : null;
}

/** ¿Hay alguna sincronización (aunque sea de otra versión de la letra)? → 'ok' | 'old' | null */
export function syncState(song, type) {
  const s = song && song.lyricSync && song.lyricSync[typeOf(type)];
  if (!s) return null;
  return getLyricSync(song, type) ? 'ok' : 'old';
}

export function setLyricSync(song, type, ev, { auto = false, edited = false } = {}) {
  const texts = lyricLines(song.lyrics).map((l) => l.text);
  // [t, i] o [t, i, 0]: el 0 marca «revisar» (la IA no estaba segura); se quita al tocarla a mano.
  const clean = ev.filter((e) => Number.isFinite(e[0]) && e[1] >= 0 && e[1] < texts.length)
    .map((e) => (e[2] === 0 ? [Math.round(Math.max(0, e[0]) * 100) / 100, e[1] | 0, 0] : [Math.round(Math.max(0, e[0]) * 100) / 100, e[1] | 0])).sort((a, b) => a[0] - b[0]);
  if (!song.lyricSync || typeof song.lyricSync !== 'object') song.lyricSync = {};
  song.lyricSync[typeOf(type)] = { key: syncKey(texts), ev: clean, at: Date.now(), auto, edited };
  return song.lyricSync[typeOf(type)];
}

export function clearLyricSync(song, type) {
  if (song && song.lyricSync) delete song.lyricSync[typeOf(type)];
}

/**
 * Tiempos por línea para un contenedor pintado: [{ el, start, i }] en orden, o null si no hay
 * sincronización válida. (Un coro repetido aparece varias veces con el mismo el.)
 */
export function syncedLines(container, song, type) {
  if (!container || !song) return null;
  const els = Array.from(container.querySelectorAll('.lyric-line'));
  const s = getLyricSync(song, type, els.map(plain));
  if (!s) return null;
  return s.ev.filter((e) => els[e[1]]).map((e) => ({ el: els[e[1]], start: e[0], i: e[1] }));
}
