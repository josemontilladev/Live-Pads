// Lógica pura del «Click por sección» (live/clickSections.js). Se prueba en Node.

export const CLICK_MODES = [
  { id: '', label: 'Como esté' },
  { id: 'x1', label: 'Negras' },
  { id: 'x2', label: 'Corcheas' },
  { id: 'x3', label: 'Tresillos' },
  { id: 'x4', label: 'Semicorcheas' },
  { id: 'mute', label: 'Sin click' },
];

/** «Verso 2» → «Verso» (una regla para «Verso» vale para todos los versos). */
export const baseLabel = (l) => String(l || '').replace(/\s*\d+\s*$/, '').trim();

/** Sección (marcador) en la que está t: el último cuyo inicio ya pasó. */
export function sectionAt(markers, t) {
  let cur = null;
  for (const m of (markers || []).slice().sort((a, b) => a.t - b.t)) { if (m.t <= t + 0.05) cur = m; else break; }
  return cur;
}

/** Regla para una sección: la exacta («Coro 2») o la general («Coro»). '' si no hay. */
export function ruleFor(rules, label) {
  if (!rules || !label) return '';
  return rules[label] || rules[baseLabel(label)] || '';
}

/** Regla → ajustes del metrónomo. null = dejarlo como esté. */
export function modeToClick(mode) {
  if (mode === 'mute') return { mute: true, mult: null };
  const m = /^x([1-4])$/.exec(mode || '');
  return m ? { mute: false, mult: Number(m[1]) } : null;
}
