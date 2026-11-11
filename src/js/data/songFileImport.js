// Importar canciones desde archivos de otras apps: ChordPro (.cho, .chopro, .crd,
// .pro), OpenSong (XML) y texto plano con los acordes encima de la letra.
//
// Todo se convierte al formato de LivePads: acordes en línea —[G]Santo— y cada
// sección con su rótulo en una línea propia (VERSO 1, CORO, PUENTE…).
//
//   parseSongFile(nombre, texto) → { title, artist, key, bpm, lyrics, format }
//
// Módulo puro (sin DOM): las líneas «acordes encima» que queden se unen a su
// letra después, con repairLyrics() de lyricsFormat.js, igual que al pegar.

const SECTION_BY_LETTER = { V: 'VERSO', C: 'CORO', B: 'PUENTE', P: 'PRE-CORO', T: 'TAG', I: 'INTRO', O: 'OUTRO', E: 'FINAL' };
const SECTION_WORDS = [
  [/^(verse|verso|estrofa)\b/i, 'VERSO'], [/^(pre[- ]?chorus|pre[- ]?coro)\b/i, 'PRE-CORO'],
  [/^(chorus|coro|estribillo|refrain)\b/i, 'CORO'], [/^(bridge|puente)\b/i, 'PUENTE'],
  [/^(intro(duction|ducci[oó]n)?)\b/i, 'INTRO'], [/^(outro|ending|final)\b/i, 'OUTRO'],
  [/^(interlude|interludio|instrumental)\b/i, 'INSTRUMENTAL'], [/^(tag)\b/i, 'TAG'], [/^(solo)\b/i, 'SOLO'],
];

/** «Verse 2» → «VERSO 2»; «Chorus» → «CORO». Devuelve null si no es una sección. */
function sectionLabel(text) {
  const t = String(text || '').trim().replace(/[:.]+$/, '');
  if (!t) return null;
  for (const [re, name] of SECTION_WORDS) {
    const m = t.match(re);
    if (m) {
      const rest = t.slice(m[0].length).trim();
      return rest && /^[\dIVX]+$/i.test(rest) ? `${name} ${rest}` : name;
    }
  }
  return null;
}

/** Normaliza un tono a como lo guarda la app: «g» → «G», «a min» → «Am», «Bb». */
export function normalizeKey(raw) {
  const m = String(raw || '').trim().match(/^([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|menor|-)?/);
  if (!m) return '';
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  return m[1].toUpperCase() + acc + (m[3] ? 'm' : '');
}

const baseTitle = (name) => String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
const tidy = (lines) => lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ── ChordPro ─────────────────────────────────────────────────────────────
export function isChordPro(name, text) {
  if (/\.(cho|crd|chopro|chordpro|pro)$/i.test(String(name || ''))) return true;
  return /^\s*\{\s*(title|t|subtitle|st|artist|key|start_of_\w+|so[cvb]|comment|c)\b[^}]*\}/im.test(text);
}

export function parseChordPro(text, name = '') {
  const out = { title: '', artist: '', key: '', bpm: '', lyrics: '', format: 'ChordPro' };
  const lines = [];
  let inTab = false;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*#/.test(line)) continue;                       // comentario del archivo
    const d = line.match(/^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i);
    if (!d) { if (!inTab) lines.push(line); continue; }
    const key = d[1].toLowerCase(), val = (d[2] || '').trim();
    switch (key) {
      case 'title': case 't': if (!out.title) out.title = val; break;
      case 'artist': case 'subtitle': case 'st': case 'composer': if (!out.artist) out.artist = val; break;
      case 'key': if (!out.key) out.key = normalizeKey(val); break;
      case 'tempo': case 'bpm': if (!out.bpm) out.bpm = (val.match(/\d+/) || [''])[0]; break;
      case 'start_of_chorus': case 'soc': lines.push('', sectionLabel(val) || 'CORO'); break;
      case 'start_of_verse': case 'sov': lines.push('', sectionLabel(val) || 'VERSO'); break;
      case 'start_of_bridge': case 'sob': lines.push('', sectionLabel(val) || 'PUENTE'); break;
      case 'end_of_chorus': case 'eoc': case 'end_of_verse': case 'eov': case 'end_of_bridge': case 'eob': lines.push(''); break;
      case 'start_of_tab': case 'sot': case 'start_of_grid': case 'sog': inTab = true; break;   // tablaturas: fuera
      case 'end_of_tab': case 'eot': case 'end_of_grid': case 'eog': inTab = false; break;
      case 'comment': case 'c': case 'comment_italic': case 'ci': case 'comment_box': case 'cb': {
        const sec = sectionLabel(val);
        if (sec) lines.push('', sec); else if (val) lines.push(`(${val})`);
        break;
      }
      default: break;                                       // capo, time, etc.: no se muestran
    }
  }
  out.lyrics = tidy(lines);
  if (!out.title) out.title = baseTitle(name);
  return out;
}

// ── OpenSong (XML) ───────────────────────────────────────────────────────
export function isOpenSong(text) {
  return /<song[\s>]/i.test(text) && /<lyrics[\s>]/i.test(text);
}
const xmlText = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const xmlTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')); return m ? xmlText(m[1]).trim() : ''; };

export function parseOpenSong(text, name = '') {
  const xml = String(text || '');
  const out = { title: xmlTag(xml, 'title') || baseTitle(name), artist: xmlTag(xml, 'author'), key: normalizeKey(xmlTag(xml, 'key')),
    bpm: (xmlTag(xml, 'tempo').match(/\d+/) || [''])[0], lyrics: '', format: 'OpenSong' };
  const lines = [];
  for (const raw of xmlTag(xml, 'lyrics').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) { lines.push(''); continue; }
    const c = raw[0];
    if (c === '[') {                                         // [V1] [C] [B]…
      const tag = raw.replace(/[[\]]/g, '').trim();
      const m = tag.match(/^([A-Za-z])(\d*)$/);
      const base = m && SECTION_BY_LETTER[m[1].toUpperCase()];
      lines.push('', base ? (m[2] ? `${base} ${m[2]}` : base) : (sectionLabel(tag) || tag.toUpperCase()));
    } else if (c === '.') lines.push(' ' + raw.slice(1));    // línea de acordes (misma columna que la letra)
    else if (c === ';') { const t = raw.slice(1).trim(); if (t) lines.push(`(${t})`); }
    else if (c === '-' && /^-+$/.test(raw.trim())) lines.push('');   // salto de página
    else lines.push((/^[ \d]/.test(c) ? ' ' + raw.slice(1) : raw).replace(/[_|]/g, ''));   // letra (el 1.er carácter es el n.º de estrofa)
  }
  out.lyrics = tidy(lines);
  return out;
}

// ── Texto plano (acordes encima de la letra) ─────────────────────────────
export function parsePlainText(text, name = '') {
  return { title: baseTitle(name), artist: '', key: '', bpm: '', lyrics: String(text || '').replace(/\r\n?/g, '\n').trim(), format: 'texto' };
}

/** Detecta el formato y devuelve la canción lista para rellenar el formulario. */
export function parseSongFile(name, text) {
  const t = String(text || '').replace(/^﻿/, '');
  if (isOpenSong(t)) return parseOpenSong(t, name);
  if (isChordPro(name, t)) return parseChordPro(t, name);
  return parsePlainText(t, name);
}
