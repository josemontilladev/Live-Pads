// ─────────────────────────────────────────────────────────────────────────
// Armar el servicio con ayuda (puro; tests/setlistSuggest.test.mjs).
//   · orderForFlow(songs, keyOf)  → orden de celebración a adoración, evitando saltos
//                                   de tono bruscos, con una nota por transición.
//   · lastPlayedMap(setlists, today) → cuándo se tocó cada canción por última vez.
//   · suggestSongs(lib, opts)     → canciones para un servicio: tema, no repetidas en las
//                                   últimas semanas, listas para sonar, con tempos variados.
// ─────────────────────────────────────────────────────────────────────────

import { parseKey } from '../utils/musicKeys.js';

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const DAY = 86400000;

/** Tónica en «mayor relativo» (Am → C): así Am y C cuentan como el mismo color. */
function tonic(key) {
  const p = parseKey(key);
  if (!p) return null;
  return p.minor ? (p.semitone + 3) % 12 : p.semitone;
}
/** Distancia en el círculo de quintas (0 = mismo tono, 1 = vecino… 6 = opuesto). */
export function fifthsDistance(a, b) {
  const ta = tonic(a), tb = tonic(b);
  if (ta == null || tb == null) return null;
  const pos = (s) => (s * 7) % 12;     // semitono → lugar en el círculo de quintas
  const d = Math.abs(pos(ta) - pos(tb));
  return Math.min(d, 12 - d);
}

/** Cómo suena el paso de un tono a otro, en palabras. */
export function transitionNote(fromKey, toKey) {
  if (!fromKey || !toKey) return '';
  const pa = parseKey(fromKey), pb = parseKey(toKey);
  if (!pa || !pb) return '';
  const up = ((pb.semitone - pa.semitone) % 12 + 12) % 12;
  const d = fifthsDistance(fromKey, toKey);
  if (up === 0 && pa.minor === pb.minor) return 'Mismo tono: se encadena sin parar.';
  if (d === 0) return 'Tono relativo: el pad sirve para las dos.';
  if (up === 1 || up === 2) return `Sube ${up === 1 ? 'medio tono' : 'un tono'}: transición natural hacia arriba.`;
  if (d === 1) return 'Tonos vecinos: transición fácil.';
  if (d <= 3) return 'Transición media: un acorde de paso o el pad ayudan.';
  return `Tonos lejanos (${fromKey} → ${toKey}): mejor una pausa, oración o la transición de tonos.`;
}

const bpmOf = (s) => { const b = Number(s && s.bpm); return b > 0 ? b : null; };

/**
 * Orden para que el servicio fluya: empieza por la más movida y va bajando hacia
 * la adoración; entre dos parecidas, la de tono más cercano a la anterior.
 * keyOf(song) = tono del día. → { order: [songs], notes: [texto por transición] }
 */
export function orderForFlow(songs, keyOf = (s) => s.key) {
  const order = songs.slice();
  if (order.length < 3) return { order, notes: [] };
  // 1) De la más movida a la más lenta (sin BPM: al medio, a 100).
  const b = (s) => bpmOf(s) || 100;
  order.sort((x, y) => b(y) - b(x));
  // 2) Entre dos vecinas de tempo parecido (±12 %), se cambian si así los tonos quedan
  //    más cerca de lo que hay alrededor.
  const kd = (x, y) => { if (!x || !y) return 0; const d = fifthsDistance(keyOf(x), keyOf(y)); return d == null ? 1.5 : d; };
  const close = (x, y) => Math.abs(b(x) - b(y)) <= 0.12 * Math.max(b(x), b(y));
  for (let pass = 0; pass < order.length; pass++) {
    let changed = false;
    for (let i = 0; i + 1 < order.length; i++) {
      const p = order[i - 1], x = order[i], y = order[i + 1], n = order[i + 2];
      if (!close(x, y)) continue;
      const now = kd(p, x) + kd(x, y) + kd(y, n), swapped = kd(p, y) + kd(y, x) + kd(x, n);
      if (swapped < now) { order[i] = y; order[i + 1] = x; changed = true; }
    }
    if (!changed) break;
  }
  const notes = order.slice(1).map((s, i) => transitionNote(keyOf(order[i]), keyOf(s)));
  return { order, notes };
}

/** Última fecha (ms) en que se tocó cada canción, según los servicios guardados con fecha. */
export function lastPlayedMap(setlists, today = Date.now()) {
  const m = new Map();
  for (const sl of setlists || []) {
    const t = sl && sl.date ? Date.parse(sl.date + 'T12:00:00') : NaN;
    if (!Number.isFinite(t) || t > today + DAY) continue;
    for (const s of sl.songs || []) {
      for (const k of [s.cloudId && 'c:' + s.cloudId, s.id != null && 'i:' + s.id, 't:' + norm(s.title)]) {
        if (k && (!m.has(k) || m.get(k) < t)) m.set(k, t);
      }
    }
  }
  return m;
}
const lastOf = (map, s) => Math.max(...[s.cloudId && map.get('c:' + s.cloudId), s.id != null && map.get('i:' + s.id), map.get('t:' + norm(s.title))].filter((x) => Number.isFinite(x)), -Infinity);

/**
 * Sugerir canciones para un servicio.
 * opts = { count = 5, theme = '', lastPlayed: Map, today, avoidWeeks = 3, exclude: [ids] }
 * → [{ song, score, reasons: [texto] }] ordenadas para el servicio (de movida a lenta).
 */
export function suggestSongs(lib, { count = 5, theme = '', lastPlayed = new Map(), today = Date.now(), avoidWeeks = 3, exclude = [] } = {}) {
  const words = norm(theme).split(' ').filter((w) => w.length > 2);
  const ex = new Set(exclude.map(String));
  const scored = [];
  for (const s of lib || []) {
    if (!s || ex.has(String(s.id))) continue;
    const reasons = [];
    let score = 0;
    // Tema: en el título vale más que en la letra o las etiquetas.
    if (words.length) {
      const title = norm(s.title), body = norm(`${s.lyrics || ''} ${(s.tags || []).join(' ')} ${s.theme || ''}`);
      const hitT = words.filter((w) => title.includes(w)), hitB = words.filter((w) => !hitT.includes(w) && body.includes(w));
      if (!hitT.length && !hitB.length) continue;
      score += hitT.length * 4 + hitB.length * 2;
      reasons.push(`Habla de «${[...hitT, ...hitB].slice(0, 2).join('», «')}»`);
    }
    // Recién tocada: fuera. Hace mucho (o nunca): suma.
    const last = lastOf(lastPlayed, s);
    if (Number.isFinite(last)) {
      const weeks = Math.floor((today - last) / (7 * DAY));
      if (weeks < avoidWeeks) continue;
      score += Math.min(4, weeks / 2);
      reasons.push(weeks >= 8 ? `No se toca desde hace ${weeks} semanas` : `Última vez hace ${weeks} semanas`);
    } else { score += 2; reasons.push('No está en ningún servicio guardado'); }
    // Lista para el domingo.
    const a = s.audio || {};
    if (a.sequence) { score += 2; reasons.push('Tiene secuencia'); } else if (a.original) { score += 1; reasons.push('Tiene original'); }
    if (s.key) score += 0.5; else reasons.push('Sin tono: añádelo');
    if (String(s.lyrics || '').trim()) score += 0.5;
    if (s.favorite) score += 1;
    scored.push({ song: s, score, reasons });
  }
  scored.sort((x, y) => y.score - x.score || String(x.song.title).localeCompare(String(y.song.title)));
  // Tempos variados: no todas rápidas ni todas lentas (reparto por tercios de BPM).
  const pool = scored.slice(0, Math.max(count * 4, 12));
  const bpms = pool.map((x) => bpmOf(x.song)).filter(Boolean).sort((a, b) => a - b);
  const lo = bpms[Math.floor(bpms.length / 3)] || 0, hi = bpms[Math.floor((2 * bpms.length) / 3)] || 0;
  const band = (s) => { const b = bpmOf(s); return !b ? 1 : b >= hi ? 2 : b <= lo ? 0 : 1; };
  const want = [Math.round(count * 0.4), count - Math.round(count * 0.4) - Math.floor(count * 0.3), Math.floor(count * 0.3)];   // lentas, medias, rápidas
  const pick = [], used = new Set();
  for (const b of [2, 1, 0]) for (const x of pool) { if (pick.length >= count) break; if (used.has(x) || band(x.song) !== b) continue; if (pick.filter((p) => band(p.song) === b).length >= want[b]) continue; pick.push(x); used.add(x); }
  for (const x of pool) { if (pick.length >= count) break; if (!used.has(x)) { pick.push(x); used.add(x); } }
  // En orden de servicio.
  const { order } = orderForFlow(pick.map((x) => x.song));
  return order.map((s) => pick.find((x) => x.song === s));
}

export { NAMES as PAD_NAMES };
