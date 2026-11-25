// Lógica pura: qué archivo de voz (assets/Spanish Guides) corresponde a una sección o a un número.
// Se prueba en Node (tests/voiceCues.test.mjs).

const DIR = 'assets/Spanish Guides/Song Sections/';
const NUM_MAX = 7;
// Nombre base de la sección → archivo (sin número) y números disponibles.
const SECTIONS = [
  [/^verso/i, 'Verso', 'Verse', 6], [/^pre.?coro/i, 'Pre Coro', 'Pre Chorus', 4], [/^post.?coro/i, 'Post Coro', 'Post Chorus', 0],
  [/^coro|^estribillo/i, 'Coro', 'Chorus', 4], [/^puente/i, 'Puente', 'Bridge', 4],
  [/^intro/i, 'Intro', null, 0], [/^(final|ending|cierre)/i, 'Ending', 'Final', -1], [/^outro/i, 'Outro', null, 0],
  [/^instrumental/i, 'Instrumental', null, 0], [/^interludio/i, 'Interludio', 'Interlude', 0],
  [/^(tag|repetir)/i, 'Repetir', 'Tag', 0], [/^solo/i, 'Solo', null, 0], [/^vamp/i, 'Vamp', null, 0], [/^rap/i, 'Rap', null, 0],
];

/** «1»…«7» → archivo; null si no hay. */
export function numberFile(n) {
  return n >= 1 && n <= NUM_MAX ? `${DIR}Spanish - ${n}.wav` : null;
}

/** «Verso 2», «Coro», «Final», «Tag»… → archivo de voz; null si no hay voz para esa sección. */
export function sectionFile(label) {
  const t = String(label || '').trim();
  const num = (/(\d+)\s*$/.exec(t) || [])[1];
  for (const [re, es, en, max] of SECTIONS) {
    if (!re.test(t)) continue;
    if (max === -1) return `${DIR}Spanish - ${es} (${en}).wav`;            // «Ending (Final)»
    const n = num ? Number(num) : 0;
    const suffix = en ? (n && n <= max ? ` ${n} (${en} ${n})` : ` (${en})`) : (n && n <= max ? ` ${n}` : '');
    return `${DIR}Spanish - ${es}${en ? suffix : suffix}.wav`.replace(' .wav', '.wav');
  }
  return null;
}

/**
 * Próximo aviso: la sección que empieza dentro de [now, now + horizon] con su
 * momento de aviso (un compás antes). markers ordenados o no.
 */
export function nextCue(markers, now, barSec, horizon = 0.6) {
  for (const m of (markers || []).slice().sort((a, b) => a.t - b.t)) {
    if (m.t < barSec) continue;                 // la primera (en el 0) no se avisa
    const at = m.t - barSec;
    if (at < now - 0.05) continue;
    if (at > now + horizon) return null;
    return { marker: m, at };
  }
  return null;
}
