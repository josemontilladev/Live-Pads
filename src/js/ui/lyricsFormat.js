import { esc } from '../utils/dom.js';

const CHORD_REGEX = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;
const SECTION_KEYWORDS = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO', 'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS', 'PRECHORUS'];
const HIGHLIGHT_SECTION_KEYWORDS = [...SECTION_KEYWORDS];

function isChordLine(line) {
  const clean = line.replace(/\[|\]/g, '').trim();
  if (clean.length === 0) return false;

  const tokens = clean.split(/\s+/);
  let chordCount = 0;
  let wordCount = 0;

  for (const token of tokens) {
    if (/^x\d+$/i.test(token)) continue;
    const cleanToken = token.replace(/[()]/g, '');
    if (CHORD_REGEX.test(cleanToken)) chordCount++;
    else wordCount++;
  }
  return chordCount > 0 && wordCount === 0;
}

// Sinónimos de sección (ES/EN, sin tildes ni separadores) → etiqueta canónica.
// La clave es solo-letras en mayúscula, así "PRE-CORO" / "PRE CORO" / "PRECORO"
// caen todos en la misma entrada.
const SECTION_SYNONYMS = {
  INTRO: 'INTRO', INTRODUCCION: 'INTRO',
  VERSO: 'VERSO', VERSE: 'VERSO', ESTROFA: 'VERSO',
  PRECORO: 'PRE-CORO', PRECHORUS: 'PRE-CORO',
  CORO: 'CORO', CHORUS: 'CORO', ESTRIBILLO: 'CORO',
  PUENTE: 'PUENTE', BRIDGE: 'PUENTE',
  INSTRUMENTAL: 'INSTRUMENTAL', INTERLUDIO: 'INTERLUDIO', INTERLUDE: 'INTERLUDIO',
  SOLO: 'SOLO',
  FINAL: 'FINAL', OUTRO: 'FINAL', ENDING: 'FINAL', CODA: 'FINAL',
  TAG: 'TAG', PRE: 'PRE-CORO',
};

// ¿Esta línea es un encabezado de sección "suelto" (p. ej. "CORO:", "Verso 2",
// "[Pre-Coro]")? Devuelve { canon, num } o null. No toca líneas largas ni de
// acordes (para no confundir una letra que empiece con una palabra clave).
function detectSectionHeader(line) {
  let s = (line || '').trim();
  if (!s || s.length > 26) return null;
  if (isChordLine(s)) return null;
  // Quita corchetes/paréntesis externos y puntuación de borde (":", "-", "—"…).
  s = s.replace(/^[\[\(\{]+/, '').replace(/[\]\)\}]+$/, '').trim();
  s = s.replace(/[\s:：.\-–—_]+$/, '').replace(/^[\s:：.\-–—_]+/, '').trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  const numMatch = upper.match(/(\d+)\s*$/);
  const num = numMatch ? numMatch[1] : '';
  const wordPart = upper.replace(/\d+\s*$/, '');
  const lettersKey = wordPart.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  const canon = SECTION_SYNONYMS[lettersKey];
  return canon ? { canon, num } : null;
}

// Envuelve cada acorde de una línea de solo-acordes en corchetes ([F] [Am]…),
// conservando los espacios (la alineación sobre la letra se mantiene; en la
// vista previa los corchetes se quitan). No re-bracketea lo que ya lo tiene ni
// las marcas de repetición tipo "x2".
function bracketChordLine(line) {
  return line.replace(/\S+/g, (tok) => {
    if (tok.startsWith('[')) return tok;
    if (/^x\d+$/i.test(tok)) return tok;
    const core = tok.replace(/[()]/g, '');
    return CHORD_REGEX.test(core) ? `[${tok}]` : tok;
  });
}

// Auto-formatea letra pegada en crudo: (1) convierte los encabezados de sección
// al formato canónico [SECCIÓN] (con auto-numeración de versos) separándolos con
// una línea en blanco, y (2) envuelve los acordes de las líneas de solo-acordes
// en corchetes para que se resalten. Las líneas de letra no se tocan.
export function autoFormatLyrics(text) {
  if (!text) return text;
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  let versoAuto = 0;
  for (const raw of lines) {
    const sec = detectSectionHeader(raw);
    if (sec) {
      let label = sec.canon;
      if (sec.canon === 'VERSO') {
        if (sec.num) { versoAuto = Math.max(versoAuto, parseInt(sec.num, 10)); label = `VERSO ${sec.num}`; }
        else { versoAuto += 1; label = `VERSO ${versoAuto}`; }
      } else if (sec.num) {
        label = `${sec.canon} ${sec.num}`;
      }
      if (out.length && out[out.length - 1].trim() !== '') out.push(''); // aire antes
      out.push(`[${label}]`);
    } else if (isChordLine(raw)) {
      out.push(bracketChordLine(raw));
    } else {
      out.push(raw);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function formatLyrics(lyrics) {
  if (!lyrics) return '<div style="color:var(--text-muted);font-style:italic;font-size:11px;">No hay letra disponible.</div>';

  const cleanLyrics = lyrics.replace(/\r/g, '');
  const lines = cleanLyrics.split('\n');
  let html = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      html += '<div class="lyrics-spacer" style="height:10px;"></div>';
      continue;
    }

    const isBracketedHeader = trimmed.startsWith('[') && trimmed.endsWith(']') && !isChordLine(trimmed);
    // Encabezado "suelto" (sin corchetes): "CORO", "CORO:", "Verso 2", "Pre-Coro"…
    // detectSectionHeader ya descarta líneas largas, de acordes, o letras que
    // solo empiezan con una palabra clave ("Verso favorito mío" sigue siendo letra).
    const isKeywordHeader = !!detectSectionHeader(trimmed);

    if (isBracketedHeader || isKeywordHeader) {
      const headerText = trimmed.replace(/\[|\]/g, '');
      html += `<div class="section-header-line">${esc(headerText)}</div>`;
      continue;
    }

    if (isChordLine(rawLine)) {
      const formattedChords = rawLine.replace(/\[|\]/g, '');
      html += `<div class="chord-line">${esc(formattedChords)}</div>`;
    } else {
      const hasChords = /\[([^\]<>]+)\]/.test(rawLine);
      // Escape the raw line first, then re-inject [chord] markers as spans.
      const escapedLine = esc(rawLine);
      const formattedLyrics = escapedLine.replace(/\[([^\]]+)\]/g, (match, chord) => `<span class="inline-chord">${chord}</span>`);
      html += `<div class="lyric-line ${hasChords ? 'has-inline-chords' : ''}">${formattedLyrics}</div>`;
    }
  }

  return html;
}

// Syntax-highlights the lyrics textarea (used by the editor preview overlay).
export function highlightSyntax(text) {
  if (!text) return '';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/(\[[^\]\n]+\])/g, (match) => {
    const clean = match.replace(/\[|\]/g, '').toUpperCase().trim();
    const isHeader = HIGHLIGHT_SECTION_KEYWORDS.some(kw => clean.startsWith(kw));
    // IMPORTANTE: en el resaltado (capa detrás del textarea transparente) los
    // spans SOLO pueden cambiar color/fondo, NUNCA font-weight/family/size: si
    // cambian las métricas, el ancho del texto resaltado deja de coincidir con el
    // del textarea y el CURSOR se desfasa. Color + fondo sin padding mantienen el
    // ancho idéntico de cada glifo.
    if (isHeader) {
      return `<span style="color:#60a5fa; background:rgba(96,165,250,0.12); border-radius:3px;">${match}</span>`;
    }
    return `<span style="color:#fbae00; background:rgba(251,174,0,0.12); border-radius:3px;">${match}</span>`;
  });

  return html + (html.endsWith('\n') ? ' ' : '');
}
