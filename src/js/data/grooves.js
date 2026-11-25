// ─────────────────────────────────────────────────────────────────────────
// Ritmos incluidos de la «Caja de ritmos» (live/grooveCore.js). Datos puros.
//
// Cada ritmo: beats (pulsos por compás, al BPM) × spb (pasos por pulso:
// 4 = semicorcheas, 3 = tresillos, 2 = corcheas). Cada sección es un mapa
// voz → pasos:  X = acento · x = golpe · o = suave (ghost) · - = nada.
// Secciones: intro · A (verso) · B (coro) · C (puente) · fill (redoble) · end (final).
//
// Escritos como los tocaría un baterista:
//  · hi-hat con el golpe en el tiempo y más suave a contratiempo;
//  · caja de fondo en los coros, más suave en los versos, con notas fantasma;
//  · el bombo marca el 1; las anticipaciones van más suaves;
//  · redobles en crescendo (de suave a fuerte, bajando por los toms) y el
//    groove sigue en la primera mitad del compás.
// Solo instrumentos reales del drum pad (bombo, caja, palmas, hi-hat, platos,
// toms, shaker, pandereta); los latinos, adaptados a batería.
// En 6/8 el pulso es la negra con puntillo (beats 2 × spb 3 corcheas).
// ─────────────────────────────────────────────────────────────────────────

export const GROOVES = [
  {
    id: 'pop', name: 'Pop / worship', genre: 'Worship', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { hhc: 'x-o-x-o-x-o-x-o-', kick: 'X-------x-------' },
      A: { kick: 'X-------X-o-----', snare: '----x-------x---', hhc: 'x-o-x-o-x-o-x-o-' },
      B: { kick: 'X-----o-X-x-----', snare: '----X-------X---', ride: 'x-o-x-o-x-o-x-o-' },
      C: { kick: 'X-------------o-', snare: '--------X-------', ride: 'x---o---x---o---' },
      fill: { kick: 'X-----------X---', snare: '----x-----------', hhc: 'x-o-x-o---------', tomH: '--------oxxX----', tomL: '------------xxXX' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'ballad', name: 'Balada', genre: 'Worship', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { hhc: 'x---o---x---o---' },
      A: { kick: 'X-------x-----o-', snare: '----x-------x---', hhc: 'x-o-x-o-x-o-x-o-' },
      B: { kick: 'X-----o-X-x-----', snare: '----X-------X---', ride: 'x-o-x-o-x-o-x-o-' },
      C: { kick: 'X-------X-------', tomL: '----o-------x---', ride: 'x---o---x---o---' },
      fill: { kick: 'X---------------', snare: '----x-----------', hhc: 'x-o-x-o---------', tomH: '--------o-x-----', tomL: '------------x-X-' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'ballad68', name: 'Balada 6/8', genre: 'Worship', beats: 2, spb: 3, swing: 0, kit: 'acoustic',
    parts: {
      intro: { hhc: 'Xooxoo' },
      A: { kick: 'X-----', snare: '---x--', hhc: 'xooxoo' },
      B: { kick: 'X----o', snare: '---X--', ride: 'xooxoo' },
      C: { kick: 'X-----', tomL: '---x--', ride: 'x--o--' },
      fill: { kick: 'X-----', snare: 'oox---', tomH: '---xx-', tomL: '-----X' },
      end: { kick: 'X-----', crash: 'X-----' },
    },
  },
  {
    id: 'upbeat', name: 'Alabanza 4×4', genre: 'Worship', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { kick: 'X---x---x---x---', hhc: 'x-o-x-o-x-o-x-o-' },
      A: { kick: 'X---x---X---x---', clap: '----x-------x---', hho: '--o---o---o---o-', shaker: 'xoxoxoxoxoxoxoxo' },
      B: { kick: 'X---x---X---x---', snare: '----X-------X---', clap: '----o-------o---', hho: '--x---x---x---x-', shaker: 'xoxoxoxoxoxoxoxo' },
      C: { kick: 'X-------x-------', snare: '--------x-------', shaker: 'xoxoxoxoxoxoxoxo' },
      fill: { kick: 'X---x---x---x---', snare: '--------oxoxxxXX' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'waltz', name: 'Vals 3/4', genre: 'Worship', beats: 3, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { hhc: 'x---o---o---' },
      A: { kick: 'X-----------', snare: '----o---o---', hhc: 'x---o---o---' },
      B: { kick: 'X-----------', snare: '----x---x---', ride: 'x-o-x-o-x-o-' },
      fill: { kick: 'X-----------', snare: '----oxox----', tomL: '--------xxXX' },
      end: { kick: 'X-----------', crash: 'X-----------' },
    },
  },
  {
    id: 'rock', name: 'Rock', genre: 'Rock', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { kick: 'X-------x-------', hhc: 'x---o---x---o---' },
      A: { kick: 'X-------X-x-----', snare: '----X-------X---', hhc: 'x-o-x-o-x-o-x-o-' },
      B: { kick: 'X-o-----X-x-----', snare: '----X-------X---', ride: 'X-o-x-o-X-o-x-o-' },
      C: { kick: 'X-------X-------', tomL: 'x-o-x-o-x-o-x-o-', snare: '----X-------X---' },
      fill: { kick: 'X---------------', snare: 'x-o-x-o-oxxX----', tomH: '------------xx--', tomL: '--------------xX' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'shuffle', name: 'Gospel shuffle', genre: 'Gospel', beats: 4, spb: 3, swing: 0, kit: 'gospel',
    parts: {
      intro: { kick: 'X-----x-----', hhc: 'x-ox-ox-ox-o' },
      A: { kick: 'X----oX-----', snare: '--oX----oX--', hhc: 'x-ox-ox-ox-o' },
      B: { kick: 'X----oX----o', snare: '---X--o--X--', clap: '---x-----x--', ride: 'x-ox-ox-ox-o' },
      C: { kick: 'X-----x-----', clap: '---x-----x--', tamb: '---x-----x--' },
      fill: { kick: 'X-----------', snare: 'oox-xx------', tomH: '------xxX---', tomL: '---------xxX' },
      end: { kick: 'X-----------', crash: 'X-----------' },
    },
  },
  {
    id: 'march', name: 'Marcha (alabanza rápida)', genre: 'Latino', beats: 2, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { hhc: '--o---o-' },
      A: { kick: 'X---x---', snare: '--x---x-', hhc: '--o---o-' },
      B: { kick: 'X---X---', snare: '--X---X-', ride: 'x-o-x-o-', tamb: '--x---x-' },
      fill: { kick: 'X-------', snare: 'oxoxxxXX' },
      end: { kick: 'X-------', crash: 'X-------' },
    },
  },
  {
    id: 'cumbia', name: 'Cumbia', genre: 'Latino', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { shaker: 'x-oox-oox-oox-oo' },
      A: { kick: 'X-------X-------', snare: '----o-------o---', tomH: '------x-------x-', tomL: '----o-------o---', shaker: 'x-oox-oox-oox-oo' },
      B: { kick: 'X---x---X---x---', snare: '----x-------x---', tomH: '------x-------x-', tomL: '----o-------o---', shaker: 'x-oox-oox-oox-oo', ride: 'x---o---x---o---' },
      fill: { kick: 'X---------------', snare: '--------oxoxxxXX', tomH: 'x-x-x-o---------' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'merengue', name: 'Merengue', genre: 'Latino', beats: 4, spb: 4, swing: 0, kit: 'acoustic',
    parts: {
      intro: { shaker: 'x-oxx-oxx-oxx-ox' },
      A: { kick: 'X---x---X---x---', tomL: 'x---o--xx---o--x', tomH: '--x---x---x---x-', shaker: 'x-oxx-oxx-oxx-ox' },
      B: { kick: 'X---x---X---x---', snare: '----x-------x---', tomL: 'x---o--xx---o--x', tomH: '--x---x---x---x-', shaker: 'x-oxx-oxx-oxx-ox', ride: 'x-o-x-o-x-o-x-o-' },
      fill: { kick: 'X---x---X---x---', tomL: 'ooxxxxXX--------', snare: '--------oxoxxxXX' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'reggae', name: 'Reggae (one drop)', genre: 'Latino', beats: 4, spb: 4, swing: 0.35, kit: 'acoustic',
    parts: {
      intro: { hhc: 'x-o-x-o-x-o-x-o-' },
      A: { kick: '--------X-------', snare: '--------x-------', hhc: 'x-o-x-o-x-o-x-o-' },
      B: { kick: 'X---x---X---x---', snare: '--------X-------', hhc: 'x---x---x---x---', hho: '--o---o---o---o-' },
      fill: { kick: '--------X-------', snare: '--------o-o-xxXX' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
  {
    id: 'salsa', name: 'Salsa (batería)', genre: 'Latino', beats: 8, spb: 2, swing: 0, kit: 'acoustic',
    parts: {
      intro: { snare: 'o--o--o---o-o---' },
      A: { snare: 'o--o--o---o-o---', ride: 'x-o-x-o-x-o-x-o-', tomL: '------xo------xo', kick: '---o--x----o--x-' },
      B: { snare: 'o--o--o---o-o---', ride: 'X-o-x-o-X-o-x-o-', tomL: '------xo------xo', tomH: '--o-------o-----', kick: '---o--x----o--x-' },
      fill: { tomH: 'o-x-x-X-xxxx----', tomL: '------------xxXX', kick: 'X---------------' },
      end: { kick: 'X---------------', crash: 'X---------------' },
    },
  },
];
