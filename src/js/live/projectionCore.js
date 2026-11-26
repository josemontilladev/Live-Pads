// ─────────────────────────────────────────────────────────────────────────
// Letras en el programa de proyección (FreeShow, OpenLP, ProPresenter) —
// lógica pura (probada en tests/projection.test.mjs):
//   sectionKind('Coro 2') → { kind: 'chorus', num: 2 }
//   groupName('Verso 1')  → 'Verse 1'   (FreeShow y ProPresenter: grupos en inglés)
//   openlpTag('Puente')   → 'B1'        (OpenLP: etiquetas de estrofa V1, C1, B1…)
//   bestTitle('Way Maker', [...]) → el elemento cuyo nombre se parece más
// ─────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const KINDS = [
  ['pre_chorus', /^(pre ?coro|pre ?chorus|precoro|prechorus)/],
  ['post_chorus', /^(post ?coro|post ?chorus)/],
  ['verse', /^(verso|verse|estrofa)/],
  ['chorus', /^(coro|chorus|estribillo|refrain)/],
  ['bridge', /^(puente|bridge)/],
  ['intro', /^intro/],
  ['outro', /^(outro|final|ending|end|cierre)/],
  ['tag', /^(tag|repetir)/],
  ['instrumental', /^(instrumental|interludio|interlude|solo|turnaround)/],
  ['vamp', /^vamp/],
  ['break', /^(break|pausa|breakdown|baja)/],
];
const NUM_WORDS = { uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4 };

/** Etiqueta de LivePads → { kind, num } (num = 1 si no lleva número). kind null si no se reconoce. */
export function sectionKind(label) {
  const n = norm(label);
  const hit = KINDS.find(([, re]) => re.test(n));
  if (!hit) return { kind: null, num: 1 };
  const m = n.match(/(\d+)\s*$/) || n.match(/\b(uno|one|dos|two|tres|three|cuatro|four)\s*$/);
  const num = m ? (Number(m[1]) || NUM_WORDS[m[1]] || 1) : 1;
  return { kind: hit[0], num };
}

const EN = { verse: 'Verse', chorus: 'Chorus', pre_chorus: 'Pre-Chorus', post_chorus: 'Post-Chorus', bridge: 'Bridge', intro: 'Intro', outro: 'Ending', tag: 'Tag', instrumental: 'Instrumental', vamp: 'Vamp', break: 'Break' };
/** Nombre de grupo en inglés (como los crean FreeShow y ProPresenter): «Verse 2», «Chorus». */
export function groupName(label) {
  const { kind, num } = sectionKind(label);
  if (!kind) return String(label || '').trim();
  const numbered = kind === 'verse' || num > 1;
  return numbered ? `${EN[kind]} ${num}` : EN[kind];
}

// OpenLP: V = verso, C = coro, B = puente, P = pre-coro, I = intro, E = final, O = otro.
const OPENLP = { verse: 'V', chorus: 'C', bridge: 'B', pre_chorus: 'P', intro: 'I', outro: 'E', tag: 'O', instrumental: 'O', post_chorus: 'O', vamp: 'O', break: 'O' };
/** Etiqueta de estrofa de OpenLP para la sección («V2», «C1»), o null. */
export function openlpTag(label) {
  const { kind, num } = sectionKind(label);
  return kind ? `${OPENLP[kind]}${num}` : null;
}

/**
 * Índice de la diapositiva de OpenLP para la sección: la primera con esa etiqueta; si no hay
 * con ese número, la primera de ese tipo (V2 → V1). slides: [{ tag }] del elemento en vivo.
 */
export function openlpSlideIndex(slides, label) {
  const tag = openlpTag(label);
  if (!tag || !Array.isArray(slides)) return -1;
  const up = (s) => String((s && s.tag) || '').toUpperCase();
  let i = slides.findIndex((s) => up(s) === tag);
  if (i < 0) i = slides.findIndex((s) => up(s).startsWith(tag[0]));
  return i;
}

/**
 * El elemento cuyo nombre se parece más al título (exacto > empieza igual > contiene > palabras
 * en común). getName(item) → nombre. null si no se parece a nada.
 */
export function bestTitle(title, items, getName = (x) => x.name) {
  const t = norm(title);
  if (!t || !Array.isArray(items) || !items.length) return null;
  const words = new Set(t.split(' '));
  let best = null, bestScore = 0;
  for (const it of items) {
    const n = norm(getName(it));
    if (!n) continue;
    let s = 0;
    if (n === t) s = 100;
    else if (n.startsWith(t) || t.startsWith(n)) s = 80;
    else if (n.includes(t) || t.includes(n)) s = 60;
    else { const w = n.split(' '); const common = w.filter((x) => words.has(x)).length; s = (common / Math.max(words.size, w.length)) * 50; }
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return bestScore >= 30 ? best : null;
}
