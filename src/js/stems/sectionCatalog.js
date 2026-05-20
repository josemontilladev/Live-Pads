// Static catalogue of the Spanish section cues shipped under
// src/assets/Spanish Guides/. The renderer can't enumerate the folder
// directly (no Node fs in the renderer), so we hand-list them. Order
// matches the order users would drop them when marking a song.
//
// Each entry maps a stable id → display label + path (livepads:// URL
// safe — uses encodeURIComponent on each segment).
//
// Add new files to the assets folder + register them here. The folder
// has more files than we surface (some have alternate variants); we keep
// the most useful set for typical worship songs.

function url(filename) {
  // Files live in src/assets/Spanish Guides/<sub>/<filename>.wav.
  // We load them via a relative path from src/index.html — the renderer
  // resolves them through Electron's file://.
  // The encoded URI handles the spaces and parentheses safely.
  return `assets/Spanish%20Guides/Song%20Sections/${encodeURIComponent(filename)}.wav`;
}
function urlCue(filename) {
  return `assets/Spanish%20Guides/Guide%20Cues/${encodeURIComponent(filename)}.wav`;
}

// Song-section labels — the ones a user will use most often.
export const SECTION_CUES = [
  { id: 'intro',       label: 'Intro',           url: url('Spanish - Intro') },
  { id: 'verso',       label: 'Verso',           url: url('Spanish - Verso (Verse)') },
  { id: 'verso-1',     label: 'Verso 1',         url: url('Spanish - Verso 1 (Verse 1)') },
  { id: 'verso-2',     label: 'Verso 2',         url: url('Spanish - Verso 2 (Verse 2)') },
  { id: 'verso-3',     label: 'Verso 3',         url: url('Spanish - Verso 3 (Verse 3)') },
  { id: 'verso-4',     label: 'Verso 4',         url: url('Spanish - Verso 4 (Verse 4)') },
  { id: 'pre-coro-1',  label: 'Pre Coro 1',      url: url('Spanish - Pre Coro 1 (Pre Chorus 1)') },
  { id: 'pre-coro-2',  label: 'Pre Coro 2',      url: url('Spanish - Pre Coro 2 (Pre Chorus 2)') },
  { id: 'pre-coro',    label: 'Pre Coro',        url: url('Spanish - Pre Coro (Pre Chorus)') },
  { id: 'coro',        label: 'Coro',            url: url('Spanish - Coro (Chorus)') },
  { id: 'coro-1',      label: 'Coro 1',          url: url('Spanish - Coro 1 (Chorus 1)') },
  { id: 'coro-2',      label: 'Coro 2',          url: url('Spanish - Coro 2 (Chorus 2)') },
  { id: 'coro-3',      label: 'Coro 3',          url: url('Spanish - Coro 3 (Chorus 3)') },
  { id: 'post-coro',   label: 'Post Coro',       url: url('Spanish - Post Coro (Post Chorus)') },
  { id: 'puente',      label: 'Puente',          url: url('Spanish - Puente (Bridge)') },
  { id: 'puente-1',    label: 'Puente 1',        url: url('Spanish - Puente 1 (Bridge 1)') },
  { id: 'puente-2',    label: 'Puente 2',        url: url('Spanish - Puente 2 (Bridge 2)') },
  { id: 'instrumental',label: 'Instrumental',    url: url('Spanish - Instrumental') },
  { id: 'solo',        label: 'Solo',            url: url('Spanish - Solo') },
  { id: 'interludio',  label: 'Interludio',      url: url('Spanish - Interludio (Interlude)') },
  { id: 'vamp',        label: 'Vamp',            url: url('Spanish - Vamp') },
  { id: 'tag',         label: 'Repetir / Tag',   url: url('Spanish - Repetir (Tag)') },
  { id: 'breakdown',   label: 'Baja Intensidad', url: url('Spanish - Baja Intensidad (Breakdown)') },
  { id: 'ending',      label: 'Final',           url: url('Spanish - Ending (Final)') },
  { id: 'outro',       label: 'Outro',           url: url('Spanish - Outro') }
];

// Optional instrument cues — exposed for future use (Phase 5).
export const GUIDE_CUES = [
  { id: 'drums-in',      label: 'Entra Batería',   url: urlCue('Spanish - Drums In (Entra Bateria)') },
  { id: 'drums',         label: 'Batería',          url: urlCue('Spanish - Drums (Bateria)') },
  { id: 'bass',          label: 'Bajo',             url: urlCue('Spanish - Bass (Bajo)') },
  { id: 'keys',          label: 'Teclado',          url: urlCue('Spanish - Keys (Teclado)') },
  { id: 'guitar',        label: 'Guitarra',         url: urlCue('Spanish - Guitar (Guitara)') },
  { id: 'all-in',        label: 'Toda la Banda',    url: urlCue('Spanish - All In (Toda La Banda)') },
  { id: 'break',         label: 'Pausa',            url: urlCue('Spanish - Break (Pausa)') },
  { id: 'build',         label: 'Sube Intensidad',  url: urlCue('Spanish - Build (Sube Intensidad)') },
  { id: 'hold',          label: 'Sostener',         url: urlCue('Spanish - Hold (Sostener)') },
  { id: 'a-capella',     label: 'A Capella',        url: urlCue('Spanish - A Capella') },
  { id: 'softly',        label: 'Suave',            url: urlCue('Spanish - Softly (Suave)') },
  { id: 'last-time',     label: 'Última Vez',       url: urlCue('Spanish - Last Time (Ultima Vez)') },
  { id: 'big-ending',    label: 'Final Grande',     url: urlCue('Spanish - Big Ending (Final Grande)') },
  { id: 'key-up',        label: 'Sube Tono',        url: urlCue('Spanish - Key Change Up (Sube Tono)') },
  { id: 'key-down',      label: 'Baja Tono',        url: urlCue('Spanish - Key Change Down (Baja Tono)') }
];

export function findCueById(id) {
  return SECTION_CUES.find(c => c.id === id)
      || GUIDE_CUES.find(c => c.id === id)
      || null;
}
