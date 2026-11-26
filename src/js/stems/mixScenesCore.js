// ─────────────────────────────────────────────────────────────────────────
// Escenas de mezcla y plantillas de mezcla de Stems — núcleo puro (sin DOM;
// probado en tests/mixScenes.test.mjs).
//
// ESCENA: una foto de la mezcla (volumen, paneo y silencio de cada pista)
// guardada en un marcador de sección (marker.mix). Al pasar por ese marcador
// tocando, la mezcla cambia sola («Coro 2 sin batería», «Puente solo pad y voz»)
// y se queda así hasta el siguiente marcador con escena.
//
// PLANTILLA: la mezcla guardada por TIPO de pista (batería, bajo, click, guía…)
// o por nombre si la pista no tiene tipo, para aplicarla a otro proyecto o a un
// multitrack recién importado y que quede ruteado igual que el anterior.
// ─────────────────────────────────────────────────────────────────────────

const r2 = (v) => Math.round(v * 100) / 100;

/** Pistas → escena { [id]: { v, p, m } }. */
export function captureScene(tracks) {
  const out = {};
  for (const t of tracks || []) {
    if (!t || t.id == null) continue;
    out[t.id] = { v: r2(Number(t.volume) || 0), p: r2(Number(t.pan) || 0), m: !!t.muted };
  }
  return out;
}

/** El marcador con escena que manda en `sec` (el último con escena que ya empezó), o null. */
export function sceneMarkerAt(markers, sec) {
  let best = null;
  for (const m of markers || []) {
    if (!m || !m.mix || !(m.atSec <= sec + 0.02)) continue;
    if (!best || m.atSec >= best.atSec) best = m;
  }
  return best;
}

/** Cambios que hay que hacer para pasar de las pistas actuales a la escena: [{ id, v?, p?, m? }]. */
export function sceneChanges(tracks, scene) {
  const out = [];
  if (!scene) return out;
  for (const t of tracks || []) {
    const s = scene[t.id];
    if (!s) continue;   // pista añadida después de guardar la escena: no se toca
    const c = { id: t.id };
    if (Math.abs((Number(t.volume) || 0) - s.v) > 0.005) c.v = s.v;
    if (Math.abs((Number(t.pan) || 0) - s.p) > 0.005) c.p = s.p;
    if (!!t.muted !== !!s.m) c.m = !!s.m;
    if (Object.keys(c).length > 1) out.push(c);
  }
  return out;
}

/** Resumen legible: «Sin batería, bajo · Voz al 60 %». `nameOf(id)` → nombre de la pista. */
export function sceneSummary(scene, nameOf) {
  if (!scene) return '';
  const muted = [], low = [];
  for (const [id, s] of Object.entries(scene)) {
    const n = nameOf(id);
    if (!n) continue;
    if (s.m) muted.push(n);
    else if (s.v < 0.5) low.push(`${n} al ${Math.round(s.v * 100)} %`);
  }
  const parts = [];
  if (muted.length) parts.push('Sin ' + muted.join(', '));
  if (low.length) parts.push(low.join(', '));
  return parts.join(' · ') || 'Todas las pistas sonando';
}

// ── Plantillas ───────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Clave con la que una pista se reconoce en otro proyecto: su tipo, o su nombre si no tiene. */
export function templateKey(t) {
  const k = t && t.kind;
  if (k && k !== 'stem' && k !== 'other' && k !== 'midi') return 'k:' + k;
  return 'n:' + norm(t && t.name);
}

/** Pistas → plantilla { name, at, slots: [{ key, label, v, p, m, color }] } (en el orden de las pistas). */
export function buildTemplate(name, tracks) {
  const seen = new Set();
  const slots = [];
  for (const t of tracks || []) {
    const key = templateKey(t);
    if (seen.has(key)) continue;   // varias pistas del mismo tipo: manda la primera
    seen.add(key);
    slots.push({ key, label: t.name || '', v: r2(Number(t.volume) || 0), p: r2(Number(t.pan) || 0), m: !!t.muted, color: t.color || null });
  }
  return { name: String(name || 'Plantilla').slice(0, 60), at: Date.now(), slots };
}

/**
 * Plantilla → qué hacer con cada pista: { changes: [{ id, v, p, m, color }], order: [ids], matched, total }.
 * El orden: primero las pistas que la plantilla conoce (en su orden), luego las demás como estaban.
 */
export function applyTemplate(tpl, tracks) {
  const list = tracks || [];
  const byKey = new Map((tpl && tpl.slots || []).map((s, i) => [s.key, { ...s, i }]));
  const changes = [], known = [], rest = [];
  for (const t of list) {
    const s = byKey.get(templateKey(t));
    if (!s) { rest.push(t.id); continue; }
    changes.push({ id: t.id, v: s.v, p: s.p, m: s.m, color: s.color });
    known.push([s.i, t.id]);
  }
  known.sort((a, b) => a[0] - b[0]);
  return { changes, order: known.map((k) => k[1]).concat(rest), matched: changes.length, total: list.length };
}
