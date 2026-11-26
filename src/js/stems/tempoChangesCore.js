// ─────────────────────────────────────────────────────────────────────────
// Cambios de tempo y de compás dentro de la canción (Stems) — puro; probado en
// tests/tempoChanges.test.mjs. Un marcador puede llevar { bpm, meter: '6/8' }:
// desde ahí la canción va a ese tempo y/o compás (el compás empieza en el marcador).
//   tempoSegments(markers, baseBpm, baseBeats) → [{ at, bpm, beats }]
//   beatGrid(segments, durationSec)            → { times, accents, bars: [{ t, n, beats, bpm }] }
//   nearestBeat(grid, t)                       → el pulso más cercano (para ajustar a la rejilla)
// ─────────────────────────────────────────────────────────────────────────

const meterBeats = (m) => { const x = String(m || '').match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/); return x ? Math.max(1, Math.min(16, Number(x[1]))) : null; };

/** Tramos de tempo: el del proyecto desde 0 y uno por cada marcador con cambio. */
export function tempoSegments(markers, baseBpm, baseBeats = 4) {
  const segs = [{ at: 0, bpm: Number(baseBpm) || 120, beats: baseBeats || 4 }];
  const ms = (markers || []).filter((m) => m && Number.isFinite(m.atSec) && (Number(m.bpm) > 0 || meterBeats(m.meter))).slice().sort((a, b) => a.atSec - b.atSec);
  for (const m of ms) {
    const prev = segs[segs.length - 1];
    const seg = { at: m.atSec, bpm: Number(m.bpm) > 0 ? Number(m.bpm) : prev.bpm, beats: meterBeats(m.meter) || prev.beats };
    if (m.atSec <= 0.001) segs[0] = { ...seg, at: 0 };
    else segs.push(seg);
  }
  return segs;
}
export const hasTempoChanges = (segs) => Array.isArray(segs) && segs.length > 1;

/**
 * Pulsos y compases de toda la canción. Cada tramo empieza un compás nuevo en su marcador
 * (si el anterior quedó a medias, ese compás es más corto). Numeración de compases continua.
 */
export function beatGrid(segs, durationSec) {
  const times = [], accents = [], bars = [];
  let n = 1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], end = i + 1 < segs.length ? segs[i + 1].at : durationSec;
    const beat = 60 / s.bpm;
    let k = 0;
    for (let t = s.at; t < end - 1e-6; t = s.at + (++k) * beat) {
      const down = k % s.beats === 0;
      times.push(Math.round(t * 1e6) / 1e6);
      accents.push(down);
      if (down) bars.push({ t: Math.round(t * 1e6) / 1e6, n: n++, beats: s.beats, bpm: s.bpm });
      if (times.length > 20000) break;
    }
  }
  return { times, accents, bars };
}

/** El pulso de la rejilla más cercano a t. */
export function nearestBeat(grid, t) {
  const a = grid && grid.times;
  if (!a || !a.length) return t;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < t) lo = mid + 1; else hi = mid; }
  const c = a[lo], p = lo > 0 ? a[lo - 1] : c;
  return Math.abs(p - t) <= Math.abs(c - t) ? p : c;
}
