// Tonos por cantante: «esta canción está en A, pero María la canta en G».
//
// Se guardan en la canción como UN texto, «G · María; E · Pedro», que es además
// lo que viaja a la nube en la columna `vocalist_key` (la misma que GI App
// muestra como «Tono vocalista»). Texto plano a propósito: se sincroniza como
// cualquier otro campo, se puede escribir a mano y GI App lo enseña tal cual.
//
// Sin dependencias del DOM: se prueba en Node.

import { parseKey, keyDelta } from './musicKeys.js';

const SEP = ' · ';

/** «G · María; E · Pedro» → [{ key: 'G', note: 'María' }, { key: 'E', note: 'Pedro' }] */
export function parseSingerKeys(text) {
  const out = [];
  const seen = new Set();
  for (const part of String(text || '').split(/[;\n]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    // El tono es el primer trozo; lo demás, la nota. Acepta «G · María», «G - María»,
    // «G: María», «G (María)» y «G María».
    const m = raw.match(/^([A-Ga-g][#b♯♭]?m?)\s*(?:[·\-–—:,(]\s*)?(.*?)\)?$/);
    if (!m) continue;
    const key = m[1].charAt(0).toUpperCase() + m[1].slice(1).replace('♯', '#').replace('♭', 'b');
    if (!parseKey(key)) continue;
    const note = (m[2] || '').trim().slice(0, 40);
    const id = key + '|' + note.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key, note });
  }
  return out;
}

export function formatSingerKeys(list) {
  return (list || [])
    .filter((x) => x && x.key)
    .map((x) => (x.note ? `${x.key}${SEP}${x.note}` : x.key))
    .join('; ');
}

/** Normaliza lo que alguien escribió a mano (o '' si no hay nada válido). */
export function cleanSingerKeys(text) { return formatSingerKeys(parseSingerKeys(text)); }

/**
 * Añade (o actualiza) el tono de un cantante. Si ya había una entrada con la
 * misma nota (misma persona), se le cambia el tono en vez de duplicarla.
 */
export function upsertSingerKey(text, key, note) {
  const list = parseSingerKeys(text);
  const n = String(note || '').trim().slice(0, 40);
  const same = (a) => (n ? a.note.toLowerCase() === n.toLowerCase() : (!a.note && a.key === key));
  const i = list.findIndex(same);
  if (i >= 0) list[i] = { key, note: n };
  else list.push({ key, note: n });
  return formatSingerKeys(list);
}

/** «sube ½ tono», «baja 1 tono», «baja 1½ tonos»… ('' si es el mismo tono o no se reconoce). */
export function shiftLabel(fromKey, toKey) {
  const d = keyDelta(fromKey, toKey);
  if (!d) return '';
  const half = Math.abs(d);
  const whole = Math.floor(half / 2), rest = half % 2;
  const amount = whole === 0 ? '½' : (rest ? `${whole}½` : String(whole));
  const unit = (whole > 1 || (whole === 1 && rest)) ? 'tonos' : 'tono';
  return `${d > 0 ? 'sube' : 'baja'} ${amount} ${unit}`;
}

/** Flecha corta para un chip: «↑½», «↓1», «↓1½». */
export function shiftShort(fromKey, toKey) {
  const d = keyDelta(fromKey, toKey);
  if (!d) return '';
  const half = Math.abs(d);
  const whole = Math.floor(half / 2), rest = half % 2;
  return (d > 0 ? '↑' : '↓') + (whole === 0 ? '½' : (rest ? `${whole}½` : String(whole)));
}

/** La nota guardada para ese tono (p. ej. «María»), o ''. */
export function noteForKey(text, key) {
  const hit = parseSingerKeys(text).find((x) => x.key === key && x.note);
  return hit ? hit.note : '';
}

// ── Quién dirige (servicio) ─────────────────────────────────────────────
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Tono guardado para ese cantante en esta canción («G · María» → G para «maria»). null si no tiene. */
export function keyForSinger(text, name) {
  const n = fold(name);
  if (!n) return null;
  const hit = parseSingerKeys(text).find((x) => fold(x.note) === n);
  return hit ? hit.key : null;
}
/** Cantantes con algún tono guardado en estas canciones (sin repetir, por orden alfabético). */
export function singersIn(texts) {
  const seen = new Map();
  for (const t of texts || []) for (const x of parseSingerKeys(t)) {
    const k = fold(x.note);
    if (k && !seen.has(k)) seen.set(k, x.note);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
