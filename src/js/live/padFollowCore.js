// Cálculo puro del pad que sigue los acordes (live/padFollow.js); probado en tests/padFollow.test.mjs.

/** Acorde vigente en el segundo t (mirando `lookahead` s por delante para que el pad no llegue tarde). */
export function chordAtTime(list, t, lookahead = 0.12) {
  const x = t + lookahead;
  let cur = null;
  for (const s of list) { if (s.s <= x) cur = s; else break; }
  return cur && cur.e > x ? cur : null;
}
