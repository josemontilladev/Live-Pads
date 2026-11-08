// ─────────────────────────────────────────────────────────────────────────
// Rejilla REAL de pulsos y compases de una pista (modelo Beat This!, en local).
//
//  · analyzeBeats(buffer, key) → { beats[], downbeats[], bpm, beatsPerBar } o null
//    (sin el modelo instalado). Se calcula una vez por pista y se guarda.
//  · gridFrom(r) → la rejilla que usa la app: los arrays de pulsos/compases
//    reales y, por compatibilidad, beatSec / barSec / off.
//  · snapToGrid(t, arr, tol) → el instante de `arr` más cercano a t (si está a
//    menos de `tol`), o t.
//
// A diferencia de la rejilla anterior (un tempo fijo + un desfase), estos son
// los pulsos que se oyen: si la canción acelera o tiene un compás suelto, la
// rejilla lo sigue.
// ─────────────────────────────────────────────────────────────────────────

const LS = 'livepads.beats.v2.';
const inflight = new Map();

function load(key) {
  try { const v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : null; } catch (_) { return null; }
}
function save(key, r) {
  const slim = {
    beats: r.beats.map((t) => Math.round(t * 1000) / 1000),
    downbeats: r.downbeats.map((t) => Math.round(t * 1000) / 1000),
    bpm: Math.round(r.bpm * 10000) / 10000, beatsPerBar: r.beatsPerBar,
    phase: r.phase != null ? Math.round(r.phase * 10000) / 10000 : null,
  };
  try { localStorage.setItem(LS + key, JSON.stringify(slim)); } catch (_) {
    // Lleno: se borran los análisis guardados más viejos y se reintenta.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(LS)).slice(0, 40).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(LS + key, JSON.stringify(slim));
    } catch (_) {}
  }
  return slim;
}

/** Clave estable de una pista de canción (misma canción + tipo + duración). */
export function trackKey(song, type, buffer) {
  const id = (song && (song.cloudId || song.id)) || 'x';
  return `${id}.${type || 'audio'}.${Math.round((buffer ? buffer.duration : 0) * 10)}`;
}

async function toMono22050(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * 22050));
  const off = new OfflineAudioContext(1, len, 22050);   // mezcla a mono (L+R)/2 al conectar
  const src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

export function isAvailable() { return !!(window.electronAPI && window.electronAPI.analyzeBeats); }

export async function analyzeBeats(buffer, key) {
  if (!buffer || !isAvailable()) return null;
  const cached = key && load(key);
  if (cached) return cached;
  if (key && inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try {
      const mono = await toMono22050(buffer);
      const r = await window.electronAPI.analyzeBeats({ mono });
      if (!r || r.unavailable || !Array.isArray(r.beats) || r.beats.length < 8) return null;
      return key ? save(key, r) : r;
    } catch (e) {
      console.warn('[LivePads] análisis de pulsos:', e);
      return null;
    } finally { if (key) inflight.delete(key); }
  })();
  if (key) inflight.set(key, job);
  return job;
}

/** Rejilla para la app (con los campos de la rejilla anterior por compatibilidad). */
export function gridFrom(r) {
  if (!r || !r.beats || r.beats.length < 2) return null;
  const beatSec = r.bpm > 0 ? 60 / r.bpm : (r.beats[r.beats.length - 1] - r.beats[0]) / (r.beats.length - 1);
  const bpb = r.beatsPerBar || 4;
  return {
    beats: r.beats, downbeats: r.downbeats && r.downbeats.length ? r.downbeats : null,
    beatSec, barSec: beatSec * bpb, beatsPerBar: bpb, bpm: r.bpm,
    off: (r.downbeats && r.downbeats[0] != null) ? r.downbeats[0] : r.beats[0],
  };
}

/** Elemento de `arr` (ordenado) más cercano a t si está a ≤ tol; si no, null. */
export function nearestIn(arr, t, tol = Infinity) {
  if (!arr || !arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m; else hi = m; }
  const best = Math.abs(arr[lo] - t) <= Math.abs(arr[hi] - t) ? arr[lo] : arr[hi];
  return Math.abs(best - t) <= tol ? best : null;
}
/** Siguiente / anterior elemento de `arr` estrictamente después / antes de t. */
export function stepIn(arr, t, dir) {
  if (!arr || !arr.length) return null;
  if (dir > 0) { for (const v of arr) if (v > t + 1e-3) return v; return null; }
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] < t - 1e-3) return arr[i];
  return null;
}
