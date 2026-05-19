// Parses chord/lyric pages from external sites and converts them to the
// app's bracketed lyrics format. Currently supports lacuerda.net.
//
// Output format example:
//   [VERSO 1]
//   Am   F    C
//   Cantaré tu amor por siempre
//   G    Am
//   Te alabaré con todo
//
// The renderer's `formatLyrics()` already understands plain chord-only
// lines, so we keep the chord-on-top layout verbatim from the source —
// no need to align chords inline with [bracket] notation.

// Section markers we'll bracketize in the imported lyrics. LaCuerda uses
// Spanish labels like "Coro:", "Verso 1:", "Puente:", etc.
const SECTION_LABELS = [
  'INTRO', 'VERSO', 'PRE-CORO', 'PRECORO', 'CORO',
  'PUENTE', 'INSTRUMENTAL', 'SOLO', 'TAG', 'FINAL', 'OUTRO',
  'ESTRIBILLO', 'ESTROFA'
];

// Detect "Coro:", "Verso 1:", "PRE-CORO:" etc. at the start of a line.
const SECTION_RE = new RegExp(
  '^\\s*(' + SECTION_LABELS.join('|') + ')\\s*(\\d+)?\\s*:?\\s*$',
  'i'
);

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g,  'Á').replace(/&Eacute;/g,  'É')
    .replace(/&Iacute;/g,  'Í').replace(/&Oacute;/g,  'Ó')
    .replace(/&Uacute;/g,  'Ú').replace(/&Ntilde;/g,  'Ñ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Convert chord-site HTML into plain text. lacuerda specifically uses
// `<div></div>` as vertical spacers between chord blocks, `<br>` for soft
// line breaks, and wraps chords in `<a>` (for their transpose feature) and
// `<span>` (for styling). Strategy:
//   1. `<br>` → newline (it IS a line break)
//   2. Block-level tags (`<div>`, `</div>`, `<p>`, `</p>`) → newline so
//      their content sits on its own line
//   3. All other tags stripped, text preserved
// Then collapse any runs of >2 blank lines into 2.
function stripInnerHtmlPreservingText(html) {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return text;
}

// Normalize a body string into our bracketed format. Section headers like
// "Coro:" → "[CORO]". Empty lines preserved.
function normalizeBody(text) {
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      // Skip standalone chord-transpose UI artifacts that some sites leave.
      if (/^(transponer|original|original key|tonalidad)\s*:?$/i.test(trimmed)) return '';
      const m = trimmed.match(SECTION_RE);
      if (m) {
        const label = m[1].toUpperCase().replace('ESTRIBILLO', 'CORO').replace('ESTROFA', 'VERSO');
        const num = m[2] ? ' ' + m[2] : '';
        return '[' + label + num + ']';
      }
      return line.replace(/\s+$/, ''); // trim trailing whitespace only
    })
    // Collapse runs of >2 blank lines into 2
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Parse a lacuerda.net page and return the extracted song.
// Returns: { title, artist, key, lyrics } — any missing field is empty/null.
export function parseLaCuerda(html) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML vacío');
  }

  // Use the renderer's DOMParser for robust HTML parsing.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // --- Title ---
  // lacuerda usually has the song in <h1>. Falls back to <title>.
  let title = '';
  const h1 = doc.querySelector('h1');
  if (h1) title = h1.textContent.trim();
  if (!title) {
    const t = doc.querySelector('title');
    if (t) title = t.textContent.replace(/\s*-\s*acordes.*$/i, '').trim();
  }

  // --- Artist ---
  // lacuerda often shows it under the title as a link to the artist page.
  // The page <title> tag is usually "Song - Artist - acordes".
  let artist = '';
  const tTag = doc.querySelector('title');
  if (tTag) {
    const m = tTag.textContent.split(/\s+-\s+/);
    if (m.length >= 2) artist = m[1].trim();
  }
  // Try an explicit anchor too
  const artistLink = doc.querySelector('a[href*="/"][title*="acordes"]');
  if (artistLink && artistLink.textContent.trim() && !artist) {
    artist = artistLink.textContent.trim();
  }

  // --- Key/tone ---
  // Often inside a label "Tono: X" somewhere on the page.
  let key = '';
  const bodyText = doc.body ? doc.body.textContent : '';
  const tonoMatch = bodyText.match(/Tono\s*:\s*([A-G][#b]?m?)/);
  if (tonoMatch) key = tonoMatch[1];

  // --- Lyrics body ---
  // lacuerda has the chord+lyric content in <pre> elements. There may be
  // multiple <pre> blocks; concatenate them with section breaks.
  let body = '';
  const preBlocks = doc.querySelectorAll('pre');
  if (preBlocks.length > 0) {
    body = Array.from(preBlocks)
      .map(p => stripInnerHtmlPreservingText(p.innerHTML))
      .join('\n\n');
    body = decodeEntities(body);
  }

  // Some lacuerda pages put the song inside a <font> tag in a <table>.
  // Try alternates if <pre> empty.
  if (!body.trim()) {
    const font = doc.querySelector('font[size]');
    if (font) {
      body = decodeEntities(stripInnerHtmlPreservingText(font.innerHTML));
    }
  }

  const lyrics = normalizeBody(body);

  return { title, artist, key, lyrics };
}

// Dispatcher — picks the right parser based on URL hostname.
export function parseChordPage(url, html) {
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (host.includes('lacuerda.net')) return parseLaCuerda(html);
  // Default: try the lacuerda parser anyway, it's pretty generic
  return parseLaCuerda(html);
}
