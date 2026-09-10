// Rol de un stem deducido del nombre de archivo ("Song - vocals.wav",
// "bajo_Song.mp3", "Song (Drums).wav"…). Los separadores exportan con estos
// tokens; nombrar la pista por rol evita cuatro filas "Song" idénticas.
// Módulo puro (sin DOM) para poder testearlo con node.

const STEM_ROLE_PATTERNS = [
  ['vocals', /\b(vocals?|voces|voz|voice|lead\s*vox|vox)\b/i],
  ['drums',  /\b(drums?|bater[ií]a|percusi[oó]n|percussion)\b/i],
  ['bass',   /\b(bass|bajo)\b/i],
  ['other',  /\b(other|otros|instrumental|music|m[uú]sica|accompaniment)\b/i],
  ['click',  /\b(click|metr[oó]nomo|metronome)\b/i],
  ['guide',  /\b(guide|gu[ií]a|cues?)\b/i],
];

export const STEM_ROLE_COLORS = { vocals: '#ec4899', drums: '#f97316', bass: '#3b82f6', other: '#a855f7' };

// Badge shown on rows/strips. Used in row, strip and console alike.
export const STEM_KIND_BADGE = {
  click: 'CLICK', guide: 'GUÍA', midi: 'MIDI',
  vocals: 'VOCES', drums: 'BATERÍA', bass: 'BAJO', other: 'OTROS', instrumental: 'INSTRUMENTAL',
};

export function detectStemRole(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  for (const [kind, re] of STEM_ROLE_PATTERNS) {
    const m = base.match(re);
    if (!m) continue;
    // Drop the token plus the separator glued to it ("Song - vocals" → "Song").
    let clean = base.replace(new RegExp(`\\s*[-–—:|(\\[]*\\s*${m[0]}\\s*[)\\]]*\\s*`, 'i'), ' ').replace(/\s{2,}/g, ' ').trim();
    clean = clean.replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, '');
    return { kind, name: clean || base };
  }
  return { kind: 'stem', name: base };
}
