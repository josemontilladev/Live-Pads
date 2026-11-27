// ─────────────────────────────────────────────────────────────────────────
// Mapa de la canción (arreglos guardados) — lógica pura, probada en
// tests/songMap.test.mjs.
//
// Un arreglo es una lista ordenada de secciones: «Intro, Verso 1, Coro, Coro,
// Puente, Coro, Final». Cada sección se guarda por su NOMBRE y su VEZ en la pista
// ({ label: 'Coro', n: 2 } = el 2.º coro), así sirve igual en la secuencia y en el
// original aunque sus marcas estén en tiempos distintos.
//   song.arrangements = { active: id | null, list: [{ id, name, order: [{ label, n }] }] }
// Al tocar, cuando termina una sección del arreglo y la siguiente no es la que
// viene en la pista, se salta a su inicio justo en el límite (fin de sección).
// ─────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s || '').trim().toLowerCase();

/** Marcas → secciones [{ label, n, s, e }] en orden (n = vez de ese nombre en la pista). */
export function sectionsOf(markers, dur) {
  // Las marcas que caen pasado el final de ESTA pista no existen en ella (p. ej. marcas
  // antiguas de la secuencia, más larga, aplicadas al original): saltar ahí acabaría la pista.
  const end = Number.isFinite(dur) && dur > 0 ? dur - 0.5 : Infinity;
  const ms = (markers || []).filter((m) => m && Number.isFinite(m.t) && m.label && m.t < end).slice().sort((a, b) => a.t - b.t);
  const count = new Map();
  return ms.map((m, i) => {
    const k = norm(m.label);
    const n = (count.get(k) || 0) + 1;
    count.set(k, n);
    const e = ms[i + 1] ? ms[i + 1].t : (Number.isFinite(dur) && dur > m.t ? dur : m.t + 1);
    return { label: m.label, n, s: m.t, e, i };
  });
}

/** La sección de la pista para una entrada del arreglo (o null si esa pista no la tiene). */
export function resolve(sections, ref) {
  if (!ref) return null;
  const same = sections.filter((x) => norm(x.label) === norm(ref.label));
  // Si la pista tiene menos veces de esa sección (el «4.º coro» en una con 3), la última:
  // volver a la PRIMERA haría que el mapa repitiera la canción desde el principio.
  return sections.find((x) => norm(x.label) === norm(ref.label) && x.n === ref.n)
    || same[Math.max(0, (ref.n || 1) - 1)]
    || same[same.length - 1]
    || null;
}

/** El arreglo «tal cual» (todas las secciones en su orden). */
export function naturalOrder(sections) {
  return sections.map((x) => ({ label: x.label, n: x.n }));
}

/** Duración total de un arreglo en esta pista (lo que se omite no cuenta). */
export function mapDuration(sections, order, dur) {
  let total = 0;
  const first = sections[0];
  if (first && first.s > 0.2 && order.length && resolve(sections, order[0]) === first) total += first.s;   // cuenta antes de la 1.ª sección
  for (const ref of order) { const x = resolve(sections, ref); if (x) total += x.e - x.s; }
  return total || dur || 0;
}

/** Índice del arreglo que corresponde al tiempo t (preferencia: `hint` si sigue valiendo). */
export function locate(sections, order, t, hint = -1) {
  const inside = (ref, after = 0) => { const x = resolve(sections, ref); return x && x.s - 0.05 <= t && t < x.e - 0.02 + after; };
  // La entrada actual sigue valiendo un instante después de su final: es justo ahí cuando hay que saltar.
  if (hint >= 0 && hint < order.length && inside(order[hint], 0.35)) return hint;
  if (hint + 1 < order.length && hint >= -1 && inside(order[hint + 1])) return hint + 1;
  for (let i = 0; i < order.length; i++) if (inside(order[i])) return i;
  return -1;
}

/**
 * Qué hacer al terminar la entrada `ai` del arreglo:
 *   { at, to, label, ai: siguiente }  saltar en `at` a `to`
 *   { at, end: true }                 el arreglo termina aquí (antes del final de la pista)
 *   null                              sigue la pista sola (la siguiente sección es la que viene)
 */
export function nextStep(sections, order, ai) {
  const cur = resolve(sections, order[ai]);
  if (!cur) return null;
  const nextRef = order[ai + 1];
  if (!nextRef) {
    const last = sections[sections.length - 1];
    return cur === last ? null : { at: cur.e, end: true };
  }
  const nx = resolve(sections, nextRef);
  if (!nx) return null;
  if (Math.abs(nx.s - cur.e) < 0.05) return null;   // es la que viene: no hace falta saltar
  return { at: cur.e, to: nx.s, label: nx.label, ai: ai + 1 };
}

/** Limpia lo guardado (lo que venga de la nube o de una versión anterior). */
export function cleanArrangements(a) {
  const list = a && Array.isArray(a.list) ? a.list : [];
  const out = list.filter((x) => x && Array.isArray(x.order)).slice(0, 12).map((x, i) => ({
    id: String(x.id || `a${i}`).slice(0, 40),
    name: String(x.name || `Arreglo ${i + 1}`).trim().slice(0, 40) || `Arreglo ${i + 1}`,
    order: x.order.filter((r) => r && r.label).slice(0, 80).map((r) => ({ label: String(r.label).slice(0, 30), n: Math.max(1, Math.min(20, Number(r.n) || 1)) })),
  }));
  const active = a && out.some((x) => x.id === a.active) ? a.active : null;
  return { active, list: out };
}
