import { esc } from '../utils/dom.js';

const CHORD_REGEX = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;
const SECTION_KEYWORDS = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO'];
const HIGHLIGHT_SECTION_KEYWORDS = [...SECTION_KEYWORDS, 'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS'];

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
    const isKeywordHeader = SECTION_KEYWORDS.some(k => trimmed.toUpperCase().startsWith(k)) && trimmed.split(/\s+/).length <= 3;

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
    if (isHeader) {
      return `<span style="color:#60a5fa; font-weight:800; font-family:'Inter', system-ui, sans-serif;">${match}</span>`;
    }
    return `<span style="color:#fbae00; font-weight:800; font-family:'Consolas', 'Monaco', monospace; font-size: 13px;">${match}</span>`;
  });

  return html + (html.endsWith('\n') ? ' ' : '');
}
