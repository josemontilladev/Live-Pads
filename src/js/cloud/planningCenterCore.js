// ─────────────────────────────────────────────────────────────────────────
// Planning Center Services → LivePads (puro; probado en tests/planningCenter.test.mjs).
//
// La API es JSON:API: los elementos del plan («items») traen en `relationships` la
// canción, el arreglo y el tono, y esos objetos llegan aparte en `included`.
//   · planFromItems(json)        → [{ title, artist, key, bpm, lyrics, ccli, … }] (solo canciones, en orden)
//   · plansList(json)            → [{ id, title, date, label }]
//   · chartToLyrics(text)        → letra con [SECCIÓN] y [acordes] al estilo de LivePads
//   · matchSongs(lib, pcoSongs)  → por cada una: la de la librería (si está) o una nueva
// ─────────────────────────────────────────────────────────────────────────

import { autoFormatLyrics } from '../ui/lyricsFormat.js';

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function index(json) {
  const m = new Map();
  for (const o of (json && json.included) || []) m.set(o.type + ':' + o.id, o);
  return (rel) => (rel && rel.data ? m.get(rel.data.type + ':' + rel.data.id) || null : null);
}

/** Tono legible: «G», «Bb», «F#m»… (Planning Center a veces lo da como «G - Bb» al modular). */
export function cleanKey(k) {
  const s = String(k || '').trim();
  const m = s.match(/^([A-G](?:#|b)?m?)/);
  return m ? m[1] : '';
}

/** Hoja de acordes de Planning Center (ChordPro sencillo) → letra de LivePads. */
export function chartToLyrics(text) {
  if (!text) return '';
  let t = String(text).replace(/\r/g, '');
  t = t.replace(/^\s*(COLUMN_BREAK|PAGE_BREAK)\s*$/gim, '');
  // Directivas ChordPro: {title:…}, {c: Coro} → la del comentario queda como texto; el resto fuera.
  t = t.replace(/^\s*\{\s*(?:c|comment|ci)\s*:\s*([^}]*)\}\s*$/gim, '$1');
  t = t.replace(/^\s*\{[^}]*\}\s*$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return autoFormatLyrics(t);
}

/** Elementos de un plan → canciones (solo los de tipo canción, en el orden del plan). */
export function planFromItems(json) {
  const inc = index(json);
  const items = [].concat((json && json.data) || []).filter((it) => it && it.attributes && it.attributes.item_type === 'song');
  items.sort((a, b) => (a.attributes.sequence || 0) - (b.attributes.sequence || 0));
  return items.map((it) => {
    const a = it.attributes || {}, rel = it.relationships || {};
    const song = inc(rel.song), arr = inc(rel.arrangement), key = inc(rel.key);
    const sa = (song && song.attributes) || {}, aa = (arr && arr.attributes) || {}, ka = (key && key.attributes) || {};
    const chart = aa.chord_chart || '';
    const bpm = Number(aa.bpm);
    return {
      pcoSongId: song ? String(song.id) : null,
      title: String(sa.title || a.title || 'Sin título').trim(),
      artist: String(sa.author || '').trim(),
      ccli: sa.ccli_number ? String(sa.ccli_number) : '',
      key: cleanKey(a.key_name || ka.starting_key || ka.name || aa.chord_chart_key),
      bpm: bpm > 0 ? Math.round(bpm) : null,
      lyrics: chart ? chartToLyrics(chart) : String(aa.lyrics || '').trim(),
      arrangement: String(aa.name || ''),
      sequence: Array.isArray(aa.sequence) ? aa.sequence.map(String) : [],
    };
  });
}

/** Planes (servicios) de un tipo de servicio, con su fecha. */
export function plansList(json) {
  return [].concat((json && json.data) || []).map((p) => {
    const a = p.attributes || {};
    const date = String(a.sort_date || '').slice(0, 10) || null;
    const title = String(a.title || a.series_title || '').trim();
    return { id: String(p.id), title, date, label: [a.dates || date || '', title].filter(Boolean).join(' · ') || 'Servicio' };
  });
}

/** Tipos de servicio («Domingo mañana», «Jóvenes»…). */
export function serviceTypes(json) {
  return [].concat((json && json.data) || []).map((s) => ({ id: String(s.id), name: String((s.attributes && s.attributes.name) || 'Servicio') }));
}

/**
 * Busca cada canción del plan en la librería: por el id de Planning Center (si ya se
 * importó), por CCLI, o por título (+ autor si lo hay). Las que no están se crean.
 *   → [{ pco, song, isNew }]
 */
export function matchSongs(lib, pcoSongs, now = Date.now()) {
  const pool = lib.slice();
  return pcoSongs.map((p, i) => {
    const t = norm(p.title), au = norm(p.artist);
    const have = (p.pcoSongId && pool.find((x) => x.pcoSongId && String(x.pcoSongId) === p.pcoSongId))
      || (p.ccli && pool.find((x) => x.ccli && String(x.ccli) === p.ccli))
      || pool.find((x) => norm(x.title) === t && (!au || !norm(x.artist) || norm(x.artist) === au))
      || null;
    if (have) return { pco: p, song: have, isNew: false };
    const song = {
      id: `song_pco_${now}_${i}`,
      title: p.title, artist: p.artist, key: p.key || '', bpm: p.bpm || '',
      lyrics: p.lyrics || '', genre: 'adoracion', tags: [], addedAt: now, timeSig: '4/4',
      audio: { sequence: null, original: null },
      ...(p.ccli ? { ccli: p.ccli } : {}),
      ...(p.pcoSongId ? { pcoSongId: p.pcoSongId } : {}),
    };
    pool.push(song);
    return { pco: p, song, isNew: true };
  });
}
