// Secciones del espectro a partir de la LETRA SINCRONIZADA.
//
// La letra sincronizada dice cuándo empieza cada línea en ESTA pista (original o
// secuencia) y la letra dice a qué sección pertenece cada línea. Con eso cada sección
// cantada queda en su sitio con precisión de compás: la sección empieza en el compás
// donde entra su primera línea (si la frase entra de anacrusa, en el compás siguiente).
// Los tramos sin canto (intro, interludios, final) salen de los huecos entre secciones.
//
// Puro (sin DOM): lo usan seqWaveform.js y los tests.

import { detectSectionHeader } from './lyricsFormat.js';

const NICE = { 'INTRO': 'Intro', 'VERSO': 'Verso', 'PRE-CORO': 'Pre Coro', 'CORO': 'Coro', 'PUENTE': 'Puente',
  'INSTRUMENTAL': 'Instrumental', 'INTERLUDIO': 'Interludio', 'SOLO': 'Solo', 'FINAL': 'Final', 'TAG': 'Tag' };
const NON_VOCAL = new Set(['INTRO', 'INSTRUMENTAL', 'INTERLUDIO', 'SOLO', 'FINAL']);
const nameOf = (canon, num) => { const b = NICE[canon] || canon; return num ? `${b} ${num}` : b; };
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

/** Compases de la rejilla: lista de inicios de compás (de los downbeats o de off + k·barSec). */
export function barStarts(grid, dur) {
  if (!grid || !(grid.barSec > 0)) return [];
  if (grid.downbeats && grid.downbeats.length > 1) {
    const d = grid.downbeats.slice();
    // Completa hacia atrás hasta 0 y hacia delante hasta el final con el compás medio.
    while (d[0] - grid.barSec > -0.05) d.unshift(d[0] - grid.barSec);
    while (d[d.length - 1] + grid.barSec < dur) d.push(d[d.length - 1] + grid.barSec);
    return d;
  }
  const out = []; let t = (grid.off || 0) % grid.barSec; if (t > 0.05) t -= grid.barSec;
  for (; t < dur; t += grid.barSec) out.push(t);
  return out;
}

/**
 * Compás donde empieza una sección cuya primera línea entra en `a`.
 *  · entra en la parte 1 (o un poco tarde)          → ese compás
 *  · entra en el último tiempo y medio (anacrusa)   → el compás siguiente
 *  · entra en la 2 o la 3 (tras un silencio)         → ese compás
 * Si es dudoso y un cambio de textura del audio cae en uno de los dos compases, manda él.
 */
export function sectionBar(a, bars, { beatSec, novelty = [] } = {}) {
  if (!bars.length) return Math.max(0, a - 0.1);
  let k = 0; while (k + 1 < bars.length && bars[k + 1] <= a + 1e-6) k++;
  const d0 = bars[k], d1 = bars[k + 1] != null ? bars[k + 1] : d0 + (bars[1] - bars[0]);
  const bs = beatSec || (d1 - d0) / 4;
  if (a < d0) return d0;
  const after = a - d0, before = d1 - a;
  if (after <= 0.4 * bs) return d0;                    // en la 1
  if (before <= 0.35 * bs) return d1;                  // casi en la 1 del siguiente (se adelantó)
  const tol = 0.3 * bs;
  const nov0 = novelty.some((t) => Math.abs(t - d0) <= tol), nov1 = novelty.some((t) => Math.abs(t - d1) <= tol);
  if (before <= 1.6 * bs) return nov0 && !nov1 && after <= 1.6 * bs ? d0 : d1;  // anacrusa
  if (nov1 && !nov0 && before <= 2.1 * bs) return d1;
  return d0;
}

/**
 * @param {{text:string, sec:number, label:string}[]} lines  líneas de la letra (lyricLines)
 * @param {Array<[number, number, number?]>} ev  [t, i(, 0 = revisar)] de la letra sincronizada
 * @param {{grid?:object, dur:number, novelty?:number[]}} opts
 * @returns {{label:string, t:number}[]}
 */
export function sectionsFromSync(lines, ev, { grid = null, dur = Infinity, novelty = [] } = {}) {
  if (!Array.isArray(lines) || !lines.length || !Array.isArray(ev) || ev.length < 2) return [];
  const evs = ev.filter((e) => Number.isFinite(e[0]) && lines[e[1]] && e[0] < dur).map((e) => ({ t: e[0], i: e[1], check: e[2] === 0 }))
    .sort((a, b) => a.t - b.t);
  if (evs.length < 2) return [];

  // Nombre de cada sección de la letra (por su cabecera).
  const secInfo = new Map();
  for (const l of lines) if (!secInfo.has(l.sec)) {
    const h = detectSectionHeader(String(l.label || '')) || null;
    secInfo.set(l.sec, h);
  }
  const firstLine = new Map();
  lines.forEach((l, i) => { if (!firstLine.has(l.sec)) firstLine.set(l.sec, i); });

  // Duración típica de una línea (para saber cuándo acaba de cantarse una sección).
  const gaps = [];
  for (let k = 1; k < evs.length; k++) { const g = evs[k].t - evs[k - 1].t; if (g > 0.8 && g < 10) gaps.push(g); }
  const lineDur = Math.max(1.5, Math.min(6, median(gaps) || 3));
  const bigGap = Math.max(10, 3 * lineDur);           // silencio dentro de una sección = tramo instrumental
  const secFirst = new Map(), secLast = new Map();
  for (const e of evs) { const sc = lines[e.i].sec; secFirst.set(sc, Math.min(secFirst.has(sc) ? secFirst.get(sc) : Infinity, e.i)); secLast.set(sc, Math.max(secLast.has(sc) ? secLast.get(sc) : -1, e.i)); }

  // 1) Ocurrencias: tramos seguidos de eventos de la misma sección. Se abre otra cuando
  //    cambia la sección o cuando la sección vuelve a empezar (coro repetido).
  let occ = [];
  for (const e of evs) {
    const sec = lines[e.i].sec;
    const cur = occ[occ.length - 1];
    const gapSplit = cur && cur.sec === sec && e.t - cur.last > bigGap;
    if (cur && cur.sec === sec && !gapSplit && !(e.i <= cur.minI && e.i < cur.lastI)) {
      cur.last = e.t; cur.lastI = e.i; cur.minI = Math.min(cur.minI, e.i); cur.n++; if (!e.check) cur.sure++;
    } else occ.push({ sec, first: e.t, last: e.t, firstI: e.i, lastI: e.i, minI: e.i, n: 1, sure: e.check ? 0 : 1, split: !!gapSplit });
  }
  // Una sola línea dudosa suelta no hace sección: se quita y se juntan sus vecinas si son la misma.
  occ = occ.filter((o, k) => !(o.n === 1 && o.sure === 0 && occ.length > 2 && (k > 0 || k < occ.length - 1)));
  const merged = [];
  for (const o of occ) {
    const p = merged[merged.length - 1];
    if (p && p.sec === o.sec && o.first - p.last > bigGap) o.split = true;
    if (p && p.sec === o.sec && !o.split && !(o.firstI <= p.minI && o.firstI < p.lastI)) { p.last = o.last; p.lastI = o.lastI; p.n += o.n; p.sure += o.sure; p.minI = Math.min(p.minI, o.minI); }
    else merged.push({ ...o });
  }
  occ = merged;
  // Un arranque a medias (la sección empieza, se corta y vuelve a empezar enseguida, o la IA
  // oyó un trozo suelto) no es otra sección: se junta con la que sigue.
  const fullDur = (sec) => {
    let d = Math.max(2, (secLast.get(sec) - secFirst.get(sec) + 1)) * lineDur;
    for (const o of occ) if (o.sec === sec && o.firstI === secFirst.get(sec) && o.lastI === secLast.get(sec)) d = Math.max(d, o.last - o.first + lineDur);
    return d;
  };
  for (const o of occ) o.runFirst = o.first;
  for (let k = 0; k + 1 < occ.length; k++) {
    const p = occ[k], o = occ[k + 1];
    // También si el último tramo oído fue corto (menos de media sección) y el canto vuelve a
    // empezar enseguida: «Adiós al ayer… / Adiós al ayer…» antes del verso entero. Un puente que
    // se repite tras cantar buena parte NO se junta (es una repetición de verdad).
    const shortRestart = p.last - p.runFirst < 0.5 * fullDur(p.sec) && o.first - p.last < 2 * lineDur;
    if (p.sec === o.sec && !o.split && p.lastI < secLast.get(p.sec) && (o.first - p.first < 0.6 * fullDur(p.sec) || shortRestart)) {
      p.last = o.last; p.lastI = o.lastI; p.n += o.n; p.sure += o.sure; p.runFirst = o.first; occ.splice(k + 1, 1); k--;
    }
  }
  if (occ.length < 2) return [];


  // 2b) Líneas que la IA no oyó al principio o al final de una sección: se estima cuándo
  //     empezó (o acabó) con lo que tarda esa misma sección cuando sí se oyó entera.
  for (const o of occ) o.evs = evs.filter((e) => e.t >= o.first - 1e-6 && e.t <= o.last + 1e-6 && lines[e.i].sec === o.sec);
  const relOf = (sec, from, to) => {         // cuánto va de la línea `from` a la `to` en esa sección (mediana)
    const ds = [];
    for (const o of occ) if (o.sec === sec) {
      const a = o.evs.find((e) => e.i === from), b = o.evs.find((e) => e.i === to);
      if (a && b && b.t > a.t) ds.push(b.t - a.t);
    }
    return ds.length ? median(ds) : Math.abs(to - from) * lineDur;
  };
  occ.forEach((o, k) => {
    o.start = o.first; o.end = o.last + lineDur;
    const f0 = secFirst.get(o.sec), l0 = secLast.get(o.sec);
    if (o.firstI > f0 && !o.split) {
      const prevEnd = k > 0 ? occ[k - 1].last + 0.5 : 0;
      o.start = Math.max(prevEnd, o.first - relOf(o.sec, f0, o.firstI));
    }
    if (o.lastI < l0 && !(occ[k + 1] && occ[k + 1].split && occ[k + 1].sec === o.sec)) {
      const nextStart = k + 1 < occ.length ? occ[k + 1].first : Infinity;
      o.end = Math.min(nextStart, o.last + relOf(o.sec, o.lastI, l0) + lineDur);
    }
  });

  const bars = barStarts(grid, Number.isFinite(dur) ? dur : evs[evs.length - 1].t + 60);
  const barSec = (grid && grid.barSec) || 0;
  const beatSec = (grid && (grid.beatSec || (grid.barSec / (grid.beatsPerBar || 4)))) || 0;
  const startOf = (a) => sectionBar(a, bars, { beatSec, novelty });
  const barAtOrAfter = (t) => { for (const b of bars) if (b >= t - 0.25 * (beatSec || 0.5)) return b; return t; };

  // 3) Nombres: cabecera de la letra; versos sin número → numerados por su sección.
  const verseNum = new Map(); let vn = 0;
  const vocalLabel = (sec) => {
    const h = secInfo.get(sec);
    if (!h) return 'Verso';
    if (h.canon === 'VERSO' && !h.num) { if (!verseNum.has(sec)) verseNum.set(sec, ++vn); return `Verso ${verseNum.get(sec)}`; }
    return nameOf(h.canon, h.num);
  };
  // Sección sin canto de la letra que va justo antes de `sec` (INTRO, INTERLUDIO…).
  const secsInOrder = [...secInfo.keys()].sort((a, b) => a - b);
  const instrumentalBefore = (sec) => {
    const k = secsInOrder.indexOf(sec);
    const h = k > 0 ? secInfo.get(secsInOrder[k - 1]) : null;
    return h && NON_VOCAL.has(h.canon) && h.canon !== 'INTRO' && h.canon !== 'FINAL' ? nameOf(h.canon, h.num) : null;
  };

  const out = [];
  const minGap = Math.max(8, 4 * (barSec || 2));       // hueco mínimo para un tramo instrumental
  occ.forEach((o, k) => {
    o.t = startOf(o.start);
    if (k > 0 && o.t <= occ[k - 1].t) o.t = Math.min(o.start, occ[k - 1].t + 0.5 * ((grid && grid.barSec) || 2));
  });
  // Intro
  const first = occ[0];
  if (first.t > Math.max(3, 1.5 * (barSec || 2))) out.push({ label: 'Intro', t: 0 });
  else first.t = 0;
  occ.forEach((o, k) => {
    if (k > 0) {
      const p = occ[k - 1];
      const end = p.end;
      if (o.t - end >= minGap) {
        // Tramo sin canto: empieza en el compás tras la última línea, o en un cambio de textura
        // del audio que caiga entre el final del canto y la siguiente sección.
        const nov = novelty.filter((t) => t >= end - (barSec || 2) && t <= o.t - 2 * (barSec || 2)).sort((a, b) => Math.abs(a - end) - Math.abs(b - end))[0];
        const t = nov != null ? barAtOrAfter(nov) : barAtOrAfter(end);
        if (t > p.t + 2 * (barSec || 2) && t < o.t - (barSec || 2)) out.push({ label: instrumentalBefore(o.sec) || 'Instrumental', t });
      }
    }
    out.push({ label: vocalLabel(o.sec), t: o.t, one: o.n === 1 });
  });
  // Final
  const last = occ[occ.length - 1];
  const endV = last.end;
  if (Number.isFinite(dur) && dur - endV >= minGap) {
    const t = barAtOrAfter(endV);
    if (t < dur - 4) out.push({ label: 'Final', t });
  }
  // Orden, sin dos secciones en el mismo compás (gana la cantada, que va después).
  out.sort((a, b) => a.t - b.t);
  // Una sola línea que deja una sección de menos de 3 compases no es sección.
  for (let k = out.length - 1; k > 0; k--) {
    const nx = k + 1 < out.length ? out[k + 1].t : dur;
    if (out[k].one && nx - out[k].t < 3 * (barSec || 2)) out.splice(k, 1);
  }
  for (let k = out.length - 1; k > 0; k--) if (out[k].label === out[k - 1].label && out[k].label === 'Final') out.splice(k, 1);
  const clean = [];
  for (const m of out) {
    m.t = Math.max(0, Math.round(m.t * 1000) / 1000);
    const p = clean[clean.length - 1];
    if (p && m.t - p.t < Math.max(1, 0.75 * (barSec || 2))) { clean[clean.length - 1] = { label: m.label, t: p.t === 0 ? 0 : m.t }; continue; }
    clean.push({ label: m.label, t: m.t });
  }
  return clean;
}

/** ¿Hay sincronización suficiente para sacar secciones? (≥ 2 secciones de la letra con eventos) */
export function syncCoversSections(lines, ev) {
  if (!Array.isArray(ev) || ev.length < 4) return false;
  const secs = new Set(ev.map((e) => lines[e[1]] && lines[e[1]].sec).filter((s) => s != null));
  return secs.size >= 2;
}
