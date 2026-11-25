// Cálculo puro de la modulación en vivo (live/modulation.js); probado en tests/modulation.test.mjs.

/** Desplazamiento (semitonos) que toca en el segundo t: 0 antes del punto marcado, `semis` desde él. */
export function offsetAt(mod, t) {
  if (!mod || !Number.isFinite(mod.at) || !mod.semis) return 0;
  return t >= mod.at - 0.02 ? mod.semis : 0;
}
