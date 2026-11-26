// ─────────────────────────────────────────────────────────────────────────
// En qué segundo de la pista empieza cada línea de la letra (para que avance sola).
//  · Letra sincronizada (live/lyricSyncStore.js: IA + ajuste a mano), si la hay: exacta,
//    con cada repetición del coro en su sitio.
//  · Tiempos tomados a mano con el antiguo «Sincronizar», si los hay.
//  · Si no: cada sección de la letra se coloca en su sección del espectro (por nombre:
//    «Coro», «Verso 2»…, y las repeticiones del coro con marcador propio también), y
//    sus líneas se reparten por longitud dentro de la sección.
//  · Sin secciones: se reparten por toda la canción (aproximado).
// lineTimes(container, { song, markers, dur, type }) → { kind, lines: [{ el, start }] }
// (Extraído del antiguo panel de letra en vivo; lo usan el panel «Letra» y la TV.)
// ─────────────────────────────────────────────────────────────────────────

import { detectSectionHeader } from './lyricsFormat.js';
import { syncedLines } from '../live/lyricSyncStore.js';

const SEC_PER_CHAR = 0.22;   // tope: una línea no «dura» más que cantarla despacio
const TT_PREFIX = 'livepads-linetimes-';

function canonOf(label) {
  const h = detectSectionHeader(label);
  return h ? `${h.canon}|${h.num || ''}` : String(label || '').trim().toUpperCase();
}
function lineWeight(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.inline-chord').forEach((n) => n.remove());
  return Math.max(8, (c.textContent || '').trim().length);
}
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h); }
function loadManual(song, count) {
  if (!song) return null;
  try {
    const o = JSON.parse(localStorage.getItem(TT_PREFIX + song.id) || 'null');
    if (o && o.h === hashStr(String(song.lyrics || '')) && Array.isArray(o.t) && o.t.length === count) return o.t;
  } catch (_) {}
  return null;
}

export function lineTimes(container, { song, markers, dur, type }) {
  const lines = [];
  const synced = syncedLines(container, song, type);
  if (synced && synced.length) return { kind: 'synced', lines: synced };
  const distribute = (els, t0, t1) => {
    const w = els.map(lineWeight);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const span = Math.min(t1 - t0, sum * SEC_PER_CHAR);
    let acc = 0;
    els.forEach((el, i) => { lines.push({ el, start: t0 + (span * acc) / sum }); acc += w[i]; });
  };
  if (!container) return { kind: 'none', lines };
  const secs = [];
  let cur = { label: null, canon: null, els: [] };
  secs.push(cur);
  container.querySelectorAll('.section-header-line, .lyric-line').forEach((el) => {
    if (el.classList.contains('section-header-line')) { cur = { label: el.textContent.trim(), canon: canonOf(el.textContent), els: [] }; secs.push(cur); }
    else cur.els.push(el);
  });
  const lyricSecs = secs.filter((s) => s.els.length);
  const allEls = lyricSecs.flatMap((s) => s.els);
  if (!allEls.length) return { kind: 'none', lines };

  const manual = loadManual(song, allEls.length);
  if (manual) {
    allEls.forEach((el, i) => lines.push({ el, start: manual[i] }));
    return { kind: 'manual', lines: lines.sort((a, b) => a.start - b.start) };
  }

  const ms = (markers || []).slice().sort((a, b) => a.t - b.t);
  const used = new Set();
  const cMs = ms.map((m) => ({ ...m, canon: canonOf(m.label) }));
  const startOf = new Map();
  const sameCount = ms.length && (secs.filter((s) => s.label).length === ms.length);
  secs.forEach((s) => {
    if (!s.label) return;
    let j = cMs.findIndex((m, k) => !used.has(k) && m.canon === s.canon);
    if (j < 0) j = cMs.findIndex((m, k) => !used.has(k) && m.canon.split('|')[0] === s.canon.split('|')[0]);
    if (j < 0 && sameCount) { const idx = secs.filter((x) => x.label).indexOf(s); if (!used.has(idx)) j = idx; }
    if (j >= 0) { used.add(j); startOf.set(s, cMs[j].t); }
  });

  if (startOf.size && dur) {
    const anchors = lyricSecs.map((s) => (startOf.has(s) ? startOf.get(s) : null));
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i] != null) continue;
      let p = i - 1; while (p >= 0 && anchors[p] == null) p--;
      let n = i + 1; while (n < anchors.length && anchors[n] == null) n++;
      const t0 = p >= 0 ? anchors[p] : 0, t1 = n < anchors.length ? anchors[n] : dur;
      const span = (n < anchors.length ? n : anchors.length) - (p >= 0 ? p : -1);
      anchors[i] = t0 + ((t1 - t0) * (i - (p >= 0 ? p : -1))) / Math.max(1, span);
    }
    const occ = lyricSecs.map((s, i) => ({ sec: s, t0: anchors[i] }));
    cMs.forEach((m, k) => {
      if (used.has(k)) return;
      const host = lyricSecs.find((s) => s.canon === m.canon) || lyricSecs.find((s) => s.canon && s.canon.split('|')[0] === m.canon.split('|')[0] && !/INSTR|INTRO|OUTRO|FINAL/.test(m.canon));
      if (host) occ.push({ sec: host, t0: m.t });
    });
    occ.sort((x, y) => x.t0 - y.t0);
    const times = ms.map((m) => m.t);
    occ.forEach((o, i) => {
      const nextMark = times.find((t) => t > o.t0 + 0.5);
      const nextOcc = i + 1 < occ.length ? occ[i + 1].t0 : null;
      const cands = [nextMark, nextOcc].filter((v) => v != null && v > o.t0);
      distribute(o.sec.els, o.t0, Math.max(o.t0 + 1, cands.length ? Math.min(...cands) : dur));
    });
    return { kind: 'sections', lines: lines.sort((a, b) => a.start - b.start) };
  }
  if (dur) { distribute(allEls, dur * 0.06, dur * 0.94); return { kind: 'whole', lines: lines.sort((a, b) => a.start - b.start) }; }
  return { kind: 'none', lines };
}

/** Índice de la línea que suena en t (con un pequeño adelanto para leerla a tiempo). */
export function lineAt(lines, t, lead = 0.35) {
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].start <= t + lead) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  return idx;
}
