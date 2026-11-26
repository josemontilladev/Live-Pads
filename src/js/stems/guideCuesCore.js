// ─────────────────────────────────────────────────────────────────────────
// Lo que dice la pista guía → marcadores de sección (puro; probado en
// tests/guideCues.test.mjs). El reconocimiento de voz está en whisperGuide.js
// (proceso principal) y devuelve [{ t, key }] con t = cuándo empieza a hablar.
//
// Las guías anuncian cada sección UN COMPÁS ANTES («Chorus… 1, 2, 3, 4»): el
// marcador va al inicio del compás siguiente al aviso. Sin tempo conocido, se
// deja en el momento del aviso.
// ─────────────────────────────────────────────────────────────────────────

/** Claves que son secciones de verdad (las demás —«Todos», «Sube», «Última vez»— son avisos). */
const SECTIONS = new Set(['intro', 'verso', 'verso-1', 'verso-2', 'verso-3', 'verso-4', 'pre-coro', 'coro', 'coro-1', 'coro-2', 'coro-3',
  'post-coro', 'puente', 'puente-1', 'puente-2', 'solo', 'interludio', 'vamp', 'tag', 'breakdown', 'ending', 'outro']);
export const isSectionKey = (k) => SECTIONS.has(k);

/**
 * hits: [{ t, key }] (key null = no es sección: cuentas, «aleluya»…).
 * opts: { bpm, beatsPerBar = 4, gridOffset = 0, durationSec, onlySections = false }
 * → [{ atSec, key }] ordenado, sin repetidos pegados.
 */
export function placeCues(hits, { bpm = 0, beatsPerBar = 4, gridOffset = 0, durationSec = Infinity, onlySections = false } = {}) {
  const bar = bpm > 0 ? (beatsPerBar * 60) / bpm : 0;
  const beat = bpm > 0 ? 60 / bpm : 0;
  const out = [];
  for (const h of (hits || []).slice().sort((a, b) => a.t - b.t)) {
    if (!h || !h.key || (onlySections && !SECTIONS.has(h.key))) continue;
    let at = h.t;
    if (bar > 0) at = gridOffset + Math.ceil((h.t - gridOffset + 0.15 * beat) / bar) * bar;
    if (at >= durationSec) continue;
    const prev = out[out.length - 1];
    // El mismo aviso repetido en el mismo compás (o pegado) cuenta una vez.
    if (prev && prev.key === h.key && at - prev.atSec < Math.max(bar, 1.5)) continue;
    if (prev && Math.abs(at - prev.atSec) < 0.01) { prev.key = h.key; continue; }   // dos avisos al mismo compás: manda el último
    out.push({ atSec: Math.round(at * 1000) / 1000, key: h.key });
  }
  return out;
}

/**
 * Nombres de los marcadores: «Verso» y «Coro» sin número se numeran por orden
 * (Verso 1, Verso 2…); los que ya traen número se respetan. labelOf(key) → etiqueta base.
 */
export function labelCues(cues, labelOf) {
  const count = { verso: 0, coro: 0, puente: 0 };
  return cues.map((c) => {
    let label = labelOf(c.key) || c.key;
    const fam = c.key.replace(/-\d$/, '');
    if (fam in count) {
      const m = c.key.match(/-(\d)$/);
      count[fam] = m ? Number(m[1]) : count[fam] + 1;
      if (!m && fam !== 'puente') label = `${label} ${count[fam]}`;
    }
    return { ...c, label };
  });
}
