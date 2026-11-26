// ─────────────────────────────────────────────────────────────────────────
// Letra automática: lo transcrito (frases con su tiempo) → borrador de letra
// en el formato de LivePads («[Coro]» y debajo las líneas). Puro; probado en
// tests/lyricsDraft.test.mjs.
//   buildLyricsDraft(segments, markers) → texto
// · Una línea por frase cantada; estrofa nueva tras un silencio largo o al
//   empezar una sección marcada (con su nombre como título).
// · Se limpian repeticiones pegadas idénticas («aleluya aleluya aleluya» de
//   más que a veces mete el reconocimiento) y espacios raros.
// ─────────────────────────────────────────────────────────────────────────

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+/, '').trim();
// El reconocimiento a veces entra en bucle dentro de una frase («a la gloria, es soy,
// a la gloria, es soy, a la gloria…»): una tira de 5+ palabras repetida 2+ veces
// seguidas, o de 3-4 palabras repetida 3+ veces, se deja una sola vez. Las
// repeticiones de una palabra («Santo, santo, santo») se quedan.
export function collapseLoops(text) {
  let w = String(text || '').split(' ').filter(Boolean);
  const key = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  for (let n = 8; n >= 3; n--) {
    const need = n >= 5 ? 2 : 3;
    for (let i = 0; i + need * n <= w.length; i++) {
      const g = w.slice(i, i + n).map(key).join(' ');
      let reps = 1;
      while (i + (reps + 1) * n <= w.length && w.slice(i + reps * n, i + (reps + 1) * n).map(key).join(' ') === g) reps++;
      if (reps >= need) w = [...w.slice(0, i + n), ...w.slice(i + reps * n)];
    }
  }
  return w.join(' ').replace(/[,;\s]+$/, '');
}
const cap = (s) => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);

export function buildLyricsDraft(segments, markers = [], { gap = 2.5 } = {}) {
  const ms = (markers || []).filter((m) => m && Number.isFinite(m.t) && m.label).slice().sort((a, b) => a.t - b.t);
  const sectionAt = (t) => { let s = null; for (const m of ms) if (m.t <= t + 0.3) s = m; return s; };
  const lines = [];
  let prevEnd = -1e9, prevSection = null, prevText = '';
  for (const seg of segments || []) {
    const text = cap(collapseLoops(clean(seg.text)).replace(/[.]+$/, ''));
    if (!text) continue;
    if (text.toLowerCase() === prevText.toLowerCase() && seg.t0 - prevEnd < 1) { prevEnd = seg.t1; continue; }
    const sec = sectionAt(seg.t0);
    const newSection = sec && sec !== prevSection;
    if (lines.length && (newSection || seg.t0 - prevEnd >= gap)) lines.push('');
    if (newSection) lines.push(`[${sec.label}]`);
    lines.push(text);
    prevEnd = seg.t1; prevSection = sec || prevSection; prevText = text;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
