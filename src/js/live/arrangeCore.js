// ─────────────────────────────────────────────────────────────────────────
// Lógica pura del arreglo en vivo (live/arrange.js). Se prueba en Node.
// Un salto = { at, to, label }: cuando la pista llega a `at` (fin de compás o de
// sección), salta a `to` (inicio de otra sección). Tiempos de la pista (s).
// ─────────────────────────────────────────────────────────────────────────

export const ACTIONS = [
  { id: 'repeat', label: 'Repetir esta sección', short: 'Repetir' },
  { id: 'next', label: 'Saltar a la siguiente sección', short: 'Siguiente' },
  { id: 'chorus', label: 'Ir al coro', short: 'Coro' },
  { id: 'bridge', label: 'Ir al puente', short: 'Puente' },
  { id: 'end', label: 'Ir al final', short: 'Final' },
];
const IS = {
  chorus: (l) => /^(coro|estribillo|chorus)/i.test(l),
  bridge: (l) => /^(puente|bridge)/i.test(l),
  end: (l) => /^(final|outro|ending|cierre)/i.test(l),
};

const sorted = (ms) => (ms || []).filter((m) => Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
/** Próximo primer tiempo estrictamente después de t (con margen), o t si no hay rejilla. */
export function nextBar(downs, t, margin = 0.12) {
  for (const d of downs || []) if (d > t + margin) return d;
  return null;
}

/**
 * @param action  'repeat' | 'next' | 'chorus' | 'bridge' | 'end'
 * @param markers secciones de la pista
 * @param t       tiempo actual de la pista
 * @param downs   primeros tiempos de compás (para saltar sin cortar el compás)
 * @param mode    cuándo entra el salto: 'bar' (al terminar el compás, por defecto),
 *                'section' (al terminar la sección en curso) o 'now' (ya mismo)
 * @returns { at, to, label } o null si no hay adónde ir.
 */
export const JUMP_MODES = { now: 'Ya', bar: 'Al compás', section: 'Fin de sección' };
export function planJump(action, markers, t, downs, mode = 'bar') {
  const ms = sorted(markers);
  if (!ms.length) return null;
  let i = -1;
  ms.forEach((m, k) => { if (m.t <= t + 0.05) i = k; });
  const cur = i >= 0 ? ms[i] : null, next = ms[i + 1] || null;
  if (action === 'repeat') {
    if (mode === 'now') return cur ? { at: t + 0.05, to: cur.t, label: cur.label } : null;   // volver ya al inicio de la sección
    if (!cur || !next) return null;                       // repetir = al terminar esta sección, volver a su inicio
    return { at: next.t, to: cur.t, label: cur.label };
  }
  let at;
  if (mode === 'now') at = t + 0.05;
  else if (mode === 'section') at = next ? next.t : null;
  else {
    const bar = nextBar(downs, t);
    at = bar != null && (!next || bar <= next.t + 0.05) ? bar : (next ? next.t : null);
  }
  if (at == null) return null;
  if (action === 'next') {
    if (!next) return null;
    const after = ms[i + 2];
    // Si el compás que viene ES el comienzo de la siguiente, saltar a la de después.
    if (Math.abs(at - next.t) < 0.1) return after ? { at, to: after.t, label: after.label } : null;
    return { at, to: next.t, label: next.label };
  }
  const test = IS[action];
  if (!test) return null;
  const after = ms.slice(i + 1).find((m) => test(m.label) && m.t > at - 0.05);
  const target = after || ms.find((m) => test(m.label));
  if (!target) return null;
  return { at, to: target.t, label: target.label };
}
