import { esc } from '../utils/dom.js';

// ─────────────────────────────────────────────────────────────────────────
// Letra + acordes: detección, limpieza y render.
//
// El formato que la gente pega de las webs de cifras es "acordes ARRIBA de la
// letra":
//
//        B                 E
//     Es un milagro cuando me despierto
//
// Ese formato SOLO funciona si letra y acordes comparten una fuente
// monoespaciada. Aquí la letra es proporcional (se lee mucho mejor en vivo),
// así que la columna del acorde no cae sobre su sílaba. La solución es unir el
// acorde a la letra como marca inline —[B]Es un milagro—: queda anclado al
// carácter exacto, ocupa UNA línea en vez de dos y sobrevive a cualquier
// fuente y a la transposición.
// ─────────────────────────────────────────────────────────────────────────

const CHORD_REGEX = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;
const SECTION_KEYWORDS = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO', 'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS', 'PRECHORUS'];
const HIGHLIGHT_SECTION_KEYWORDS = [...SECTION_KEYWORDS];

// Tokens que ACOMPAÑAN a los acordes sin ser acordes: separadores de progresión
// y marcas de repetición. Sin esta lista, "B E G#m - B - E" contaba los guiones
// como palabras, la línea dejaba de ser "de acordes" y acababa pintada como una
// píldora de SECCIÓN, en mayúsculas y todo ("G#M").
const CHORD_FILLER = /^(?:[-–—|/,.:;•·]+|x\s*\d+|\d+\s*x|%|\(|\)|\[|\])$/i;

function isChordToken(token) {
  const clean = token.replace(/[()[\]]/g, '');
  if (!clean) return false;
  return CHORD_REGEX.test(clean);
}

export function isChordLine(line) {
  const clean = line.replace(/\[|\]/g, '').trim();
  if (clean.length === 0) return false;

  const tokens = clean.split(/\s+/);
  let chordCount = 0;
  let wordCount = 0;

  for (const token of tokens) {
    if (CHORD_FILLER.test(token)) continue;
    if (isChordToken(token)) chordCount++;
    else wordCount++;
  }
  return chordCount > 0 && wordCount === 0;
}

// Sinónimos de sección (ES/EN/PT, sin tildes ni separadores) → etiqueta
// canónica. La clave es solo-letras en mayúscula, así "PRE-CORO" / "PRE CORO" /
// "PRECORO" caen todos en la misma entrada. El portugués está porque Cifra Club
// —de donde sale la mayoría de las cifras en español— rotula en portugués.
const SECTION_SYNONYMS = {
  INTRO: 'INTRO', INTRODUCCION: 'INTRO', INTRODUCAO: 'INTRO',
  VERSO: 'VERSO', VERSE: 'VERSO', ESTROFA: 'VERSO',
  PRIMEIRAPARTE: 'VERSO', SEGUNDAPARTE: 'VERSO', TERCEIRAPARTE: 'VERSO',
  PRECORO: 'PRE-CORO', PRECHORUS: 'PRE-CORO', PREREFRAO: 'PRE-CORO',
  CORO: 'CORO', CHORUS: 'CORO', ESTRIBILLO: 'CORO', REFRAO: 'CORO', REFRAIN: 'CORO',
  PUENTE: 'PUENTE', BRIDGE: 'PUENTE', PONTE: 'PUENTE',
  INSTRUMENTAL: 'INSTRUMENTAL', INTERLUDIO: 'INTERLUDIO', INTERLUDE: 'INTERLUDIO',
  SOLO: 'SOLO',
  FINAL: 'FINAL', OUTRO: 'FINAL', ENDING: 'FINAL', CODA: 'FINAL',
  TAG: 'TAG', PRE: 'PRE-CORO',
};

// ¿Esta línea es un encabezado de sección "suelto" (p. ej. "CORO:", "Verso 2",
// "[Pre-Coro]")? Devuelve { canon, num } o null. No toca líneas largas ni de
// acordes (para no confundir una letra que empiece con una palabra clave).
export function detectSectionHeader(line) {
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

// ── Acordes sobre la letra → acordes inline ────────────────────────────────

// Posición (columna) de cada acorde dentro de una línea de acordes. Los
// corchetes NO cuentan como columna: en "[B]   [E]" el acorde vive donde
// estaría la B sin adornos, que es contra lo que hay que medir la letra.
function chordPositions(line) {
  let plain = '';
  for (const ch of line) { if (ch !== '[' && ch !== ']') plain += ch; }
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(plain)) !== null) {
    if (CHORD_FILLER.test(m[0])) continue;
    if (!isChordToken(m[0])) continue;
    out.push({ token: m[0].replace(/[()]/g, ''), col: m.index });
  }
  return out;
}

// ¿La línea de acordes conserva la ALINEACIÓN original? Dos espacios seguidos
// (o sangría inicial) significan que las columnas todavía dicen algo. Cuando la
// fuente perdió el espaciado —"Db Db", "[D] [Bm]"— las columnas son mentira y
// ya no se puede saber sobre qué sílaba iba cada acorde.
function hasAlignment(line) {
  return /\S {2,}\S/.test(line) || /^\s{2,}\S/.test(line);
}

// Inserta los acordes dentro de la letra en su columna. Se recorre de derecha a
// izquierda para que cada inserción no desplace las posiciones pendientes.
function inlineChordsInto(chordLine, lyricLine) {
  const chords = chordPositions(chordLine);
  if (!chords.length) return null;
  let out = lyricLine;
  let limite = out.length; // ningún acorde puede pisar al que ya insertamos
  for (let k = chords.length - 1; k >= 0; k--) {
    const { token, col } = chords[k];
    const at = Math.max(0, Math.min(col, limite));
    out = out.slice(0, at) + '[' + token + ']' + out.slice(at);
    limite = at;
  }
  return out;
}

// ¿Se puede unir esta línea de acordes con la letra de abajo SIN inventarse
// dónde va cada acorde?
//   · un solo acorde        → sí (va al principio, no hay ambigüedad)
//   · varios CON alineación → sí (cada uno a su columna)
//   · varios SIN alineación → NO. Se quedan como fila de acordes encima: es
//     menos bonito, pero es la verdad; amontonarlos sobre la primera sílaba
//     sería inventarse una digitación que nadie escribió.
function canMerge(chordLine) {
  const n = chordPositions(chordLine).length;
  if (n === 0) return false;
  return n === 1 || hasAlignment(chordLine);
}

// Une los pares acorde/letra de todo un texto. Es lo que convierte dos líneas
// en una y ancla cada acorde a su sílaba.
export function mergeChordLines(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (
      isChordLine(cur) && canMerge(cur) &&
      next != null && next.trim() &&
      !isChordLine(next) && !detectSectionHeader(next)
    ) {
      const merged = inlineChordsInto(cur, next);
      if (merged != null) { out.push(merged); i++; continue; }
    }
    out.push(cur);
  }
  return out.join('\n');
}

// ── Limpieza de lo pegado ──────────────────────────────────────────────────

// Homoglifos cirílicos/griegos que las webs de letras inyectan para detectar
// copias. Se ven idénticos a la letra latina pero rompen la búsqueda, el
// detector de acordes y la ordenación. (Encontrados de verdad en la librería:
// "porquе", "Tendida еn", con e cirílica.)
const HOMOGLYPHS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'у': 'y', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H',
  'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'ο': 'o', 'ν': 'v',
};
const HOMOGLYPH_RE = /[\u0400-\u04FF\u0370-\u03FF]/g;

// Invisibles: zero-width, word-joiner, BOM.
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
// Separadores de línea Unicode que no son \n.
const UNICODE_BREAK_RE = /[\u2028\u2029]/g;
// Espacios "exóticos" (NBSP, finos, de figura, ideográfico…). Se cambian 1:1
// por un espacio normal para NO mover las columnas de los acordes.
const ODD_SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

// Basura que traen los pegados: cabeceras de la web, avisos, créditos.
const JUNK_LINE = /^(?:tom\s*:|cifra\s|afina[çc]|capotraste|capo\s*:|ver\s+m[aá]is?|ver\s+m[aá]s|composi[çc]|colabora[çc]|enviada?\s+por|©|todos\s+los\s+derechos)/i;

/**
 * Deja utilizable una letra recién pegada, sin cambiar una sola palabra:
 *   · homoglifos → letra latina
 *   · espacios raros (NBSP, finos) → espacio normal, conservando las columnas
 *   · tabuladores → 4 espacios (un tab de ancho variable descuadra los acordes)
 *   · quita caracteres invisibles, líneas de basura y espacios al final
 *   · máximo una línea en blanco seguida
 */
export function cleanPastedLyrics(text) {
  if (!text) return text;
  let t = String(text).replace(/\r\n?/g, '\n');

  t = t.replace(INVISIBLE_RE, '');
  t = t.replace(UNICODE_BREAK_RE, '\n');
  t = t.replace(ODD_SPACE_RE, ' ');
  t = t.replace(/\t/g, '    ');
  t = t.replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c] || c);

  // Comillas tipográficas → rectas (buscar «no sé» debe dar lo mismo escriba
  // quien lo escriba).
  t = t.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');

  const lines = t.split('\n')
    .map(l => l.replace(/\s+$/, ''))     // espacios finales: ruido puro
    .filter(l => !JUNK_LINE.test(l.trim()));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd();
}

// Envuelve cada acorde de una línea de solo-acordes en corchetes ([F] [Am]…),
// conservando los espacios (la alineación sobre la letra se mantiene; en la
// vista previa los corchetes se quitan). No re-bracketea lo que ya lo tiene ni
// las marcas de repetición tipo "x2".
function bracketChordLine(line) {
  return line.replace(/\S+/g, (tok) => {
    if (tok.startsWith('[')) return tok;
    if (CHORD_FILLER.test(tok)) return tok;
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

/**
 * Reparación completa de una letra: limpiar → marcar secciones → unir cada
 * acorde con su sílaba. Es lo que hace el botón "Reparar letra" del editor y lo
 * que se aplica solo a lo que se pega.
 */
export function repairLyrics(text) {
  if (!text) return text;
  return mergeChordLines(autoFormatLyrics(cleanPastedLyrics(text)));
}

/** Resumen de lo que cambió `repairLyrics`, para poder contárselo al usuario. */
export function describeRepair(before, after) {
  const nl = (s) => String(s || '').replace(/\r/g, '').split('\n');
  const inline = (s) => (String(s || '').match(/\S\[[^\]]+\]|\[[^\]]+\]\S/g) || []).length;
  const sucio = (s) => (String(s || "").match(/[\u0400-\u04FF\u0370-\u03FF\u200B-\u200D\u2060\uFEFF\u00A0\t]/g) || []).length;
  return {
    lineasMenos: Math.max(0, nl(before).length - nl(after).length),
    acordesUnidos: Math.max(0, inline(after) - inline(before)),
    limpiados: sucio(before),
    cambio: before !== after,
  };
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
      html += '<div class="lyrics-spacer"></div>';
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
