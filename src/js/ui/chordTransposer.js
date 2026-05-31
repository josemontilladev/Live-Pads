// Chord transposition for the lyrics editor.
//
// Handles [C], [F#m7], [Bb/D], [Am/G] — root note, suffix, optional slash bass.
// Preserves the suffix verbatim ("m7", "sus4", "maj7add9", etc.) — only roots
// and bass notes shift. Accidental style (sharp vs flat) follows the target
// key when given, otherwise the original accidental on each chord is honored.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const NOTE_TO_SEMITONE = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11
};

// Keys that traditionally use flats (when writing the diatonic scale).
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm']);

export function keyPrefersFlats(key) {
  if (!key) return null; // null = preserve original per-chord
  const normalized = key.trim();
  return FLAT_KEYS.has(normalized);
}

function transposeNote(note, semitones, preferFlats) {
  const idx = NOTE_TO_SEMITONE[note];
  if (idx === undefined) return note;
  const target = ((idx + semitones) % 12 + 12) % 12;
  // If preferFlats wasn't decided (null) by the caller, fall back to the
  // accidental that was on the original note. Sharp-or-natural inputs map to
  // SHARP_NAMES; flat inputs map to FLAT_NAMES.
  const useFlats = preferFlats !== null && preferFlats !== undefined
    ? preferFlats
    : note.length === 2 && note[1] === 'b';
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[target];
}

// Parse "C#m7", "F/A", "Bb/D" -> { root, suffix, bass }. Returns null if the
// token doesn't look like a chord (so transposer can leave it alone).
function parseChord(token) {
  const match = token.match(/^([A-G][b#]?)([^\/\s]*)(?:\/([A-G][b#]?))?$/);
  if (!match) return null;
  if (!(match[1] in NOTE_TO_SEMITONE)) return null;
  return { root: match[1], suffix: match[2] || '', bass: match[3] || '' };
}

function transposeChordToken(token, semitones, preferFlats) {
  const parsed = parseChord(token);
  if (!parsed) return token;
  const newRoot = transposeNote(parsed.root, semitones, preferFlats);
  const newBass = parsed.bass ? '/' + transposeNote(parsed.bass, semitones, preferFlats) : '';
  return newRoot + parsed.suffix + newBass;
}

// Transpose every [chord] bracket in `text` by N semitones.
// `preferFlats`: true = use flats for accidentals, false = use sharps,
// null/undefined = preserve each chord's original accidental style.
export function transposeBracketedChords(text, semitones, preferFlats = null) {
  if (!text || semitones === 0) return text;
  return text.replace(/\[([^\]]+)\]/g, (match, inner) => {
    // A bracket may contain multiple chord tokens separated by whitespace:
    // "[C  G  Am  F]" -> transpose each.
    const transposed = inner.split(/(\s+)/).map(piece => {
      if (/^\s+$/.test(piece)) return piece;
      return transposeChordToken(piece, semitones, preferFlats);
    }).join('');
    return '[' + transposed + ']';
  });
}

// Some users write chord-only lines without brackets ("C  G  Am  F"). Detect
// such lines and transpose them token by token. Lines that look like lyrics
// are left untouched. A line is a "chord line" if every non-empty token
// parses as a chord (mirrors lyricsFormat.js's isChordLine).
const CHORD_TOKEN_RE = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;

function isAllChordsLine(line) {
  const stripped = line.replace(/\[|\]/g, '').trim();
  if (!stripped) return false;
  const tokens = stripped.split(/\s+/);
  for (const t of tokens) {
    if (/^x\d+$/i.test(t)) continue;
    const clean = t.replace(/[()]/g, '');
    if (!CHORD_TOKEN_RE.test(clean)) return false;
  }
  return true;
}

export function transposeChordOnlyLines(text, semitones, preferFlats = null) {
  if (!text || semitones === 0) return text;
  return text.split('\n').map(line => {
    // Si la línea ya tiene corchetes, transposeBracketedChords se encargó.
    // Volver a transponerla aquí causaría el doble salto (D → E en vez de D#).
    if (line.indexOf('[') !== -1) return line;
    if (!isAllChordsLine(line)) return line;
    return line.replace(/[A-G][b#]?(?:[a-zA-Z0-9]+)?(?:\/[A-G][b#]?)?/g, (token) => {
      return transposeChordToken(token, semitones, preferFlats);
    });
  }).join('\n');
}

// Convenience: transpose everything (bracketed + chord-only lines).
export function transposeAll(text, semitones, preferFlats = null) {
  const step1 = transposeBracketedChords(text, semitones, preferFlats);
  return transposeChordOnlyLines(step1, semitones, preferFlats);
}
