// ─────────────────────────────────────────────────────────────────────────
// Click que sigue el tempo real de la canción (tempo variable: en vivo, rubato,
// canciones grabadas sin click). Sin DOM: lo usan workspace.js y las pruebas.
//
//  · isVariableTempo(beats) → ¿un click de BPM fijo se iría desfasando?
//    Se ajusta una recta a los pulsos detectados; si más del 10 % de los pulsos
//    quedan a más de 60 ms de ella, el tempo cambia de verdad (los pulsos de una
//    secuencia con click quedan a pocos ms).
//  · clickTimes(beats, downbeats, durationSec) → { times, accents }
//    Los pulsos detectados, suavizados (quita el temblor del detector sin perder
//    los cambios de tempo), extendidos hasta el principio y el final de la pista
//    con el tempo del borde. accents[i] = el pulso i es el 1 del compás.
// ─────────────────────────────────────────────────────────────────────────

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * Ajuste a una rejilla de tempo fijo t ≈ a + p·k, donde k es la CASILLA de cada
 * pulso (no su número de orden): así los pulsos que el detector no ve (silencios,
 * breaks, partes a medio tiempo) no descuadran la cuenta. Devuelve los residuos.
 */
/**
 * Un solo nivel de pulso. El detector a veces pasa a contar corcheas (o a medio
 * pulso) en una parte de la canción: se descartan los pulsos que caen antes de
 * tiempo o a contratiempo (a medio pulso del anterior que se quedó).
 * → { kept, k, p1 }: pulsos que quedan, su casilla en la rejilla y el periodo.
 */
function onePulseLevel(b) {
  const ibi = []; for (let i = 1; i < b.length; i++) ibi.push(b[i] - b[i - 1]);
  const q = median(ibi);
  if (!(q > 0.15)) return null;
  const kept = [b[0]];
  for (let i = 1; i < b.length; i++) {
    const m = (b[i] - kept[kept.length - 1]) / q;
    if (m >= 0.75 && Math.abs(m - Math.round(m)) <= 0.25) kept.push(b[i]);
  }
  const ki = []; for (let i = 1; i < kept.length; i++) ki.push(kept[i] - kept[i - 1]);
  // El periodo para los saltos largos: la media de los saltos de un pulso (la
  // mediana sola cae en uno de los dos lados del temblor y en un break largo se nota).
  const ones = ki.filter((x) => Math.round(x / q) === 1);
  const p1 = ones.length ? ones.reduce((s, x) => s + x, 0) / ones.length : q;
  // Casilla de cada pulso: cada salto se redondea a cuántos pulsos ocupa (1, o 2
  // si el detector se saltó uno…). Redondear salto a salto no acumula error.
  const k = [0];
  for (let i = 1; i < kept.length; i++) k.push(k[i - 1] + Math.max(1, Math.round(ki[i - 1] / p1)));
  return { kept, k, p1 };
}
function lineFit(t, k) {
  const n = t.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += k[i]; sy += t[i]; sxx += k[i] * k[i]; sxy += k[i] * t[i]; }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const p = (n * sxy - sx * sy) / den, a = (sy - p * sx) / n;
  return { p, res: t.map((x, i) => x - (a + p * k[i])) };
}

export function gridResiduals(beats) {
  const b = (beats || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (b.length < 4) return [];
  const lv = onePulseLevel(b);
  if (!lv || lv.kept.length < 4) return [];
  let k = lv.k, f = lineFit(lv.kept, k);
  if (!f) return [];
  // Un salto de residuo de ~1 periodo entre pulsos vecinos es un pulso mal contado.
  for (let it = 0; it < 3; it++) {
    let shift = 0; const k2 = [k[0]];
    for (let i = 1; i < k.length; i++) { shift += Math.round((f.res[i] - f.res[i - 1]) / f.p); k2.push(k[i] + shift); }
    const f2 = lineFit(lv.kept, k2);
    if (!f2) break;
    k = k2; f = f2;
  }
  return f.res;
}

export function isVariableTempo(beats, { tolSec = 0.06, share = 0.1 } = {}) {
  const b = (beats || []).filter(Number.isFinite);
  if (b.length < 16) return false;
  const r = gridResiduals(b);
  if (!r.length) return false;
  const off = r.filter((x) => Math.abs(x) > tolSec).length;
  return off / r.length > share;
}

/** Intervalos entre pulsos suavizados con una mediana móvil (ventana impar). */
function smoothBeats(b, win = 5) {
  if (b.length < win + 2) return b.slice();
  const ibi = [];
  for (let i = 1; i < b.length; i++) ibi.push(b[i] - b[i - 1]);
  const h = (win - 1) >> 1;
  const sm = ibi.map((_, i) => median(ibi.slice(Math.max(0, i - h), Math.min(ibi.length, i + h + 1))));
  // Se reconstruye desde el centro de masa para no acumular deriva: cada pulso se
  // acerca a su tiempo detectado (mitad suavizado, mitad detectado).
  const out = [b[0]];
  for (let i = 1; i < b.length; i++) out.push((out[i - 1] + sm[i - 1]) * 0.5 + b[i] * 0.5);
  return out;
}

/** Rellena los pulsos que el detector no vio (breaks, silencios) con el tempo de alrededor. */
function fillGaps(b) {
  const ibi = []; for (let i = 1; i < b.length; i++) ibi.push(b[i] - b[i - 1]);
  const Q = median(ibi);   // pulso principal de la canción
  const out = [b[0]];
  for (let i = 1; i < b.length; i++) {
    const near = ibi.slice(Math.max(0, i - 9), Math.min(ibi.length, i + 8)).filter((_, j, arr) => arr[j] !== ibi[i - 1]);
    let q = median(near.length ? near : ibi);
    // Un tramo contado a otro nivel (blancas, o a 3 por pulso): el click sigue en el
    // pulso principal, no cambia de velocidad a mitad de canción.
    const r = q / Q;
    if (r > 1.75 && r < 2.3) q /= 2; else if (r > 2.6 && r < 3.4) q /= 3; else if (r > 1.35 && r < 1.65) q /= 1.5;
    const n = q > 0 ? Math.round(ibi[i - 1] / q) : 1;
    for (let k = 1; k < n; k++) out.push(b[i - 1] + (ibi[i - 1] * k) / n);
    out.push(b[i]);
  }
  return out;
}

export function clickTimes(beats, downbeats, durationSec) {
  const raw = (beats || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (raw.length < 2) return { times: [], accents: [] };
  // Un solo nivel de pulso (sin corcheas sueltas ni contratiempos) y sin huecos.
  const lv = raw.length >= 4 ? onePulseLevel(raw) : null;
  const b = fillGaps(lv && lv.kept.length >= 2 ? lv.kept : raw);
  const s = smoothBeats(b);
  const first = s[1] - s[0], last = s[s.length - 1] - s[s.length - 2];
  const times = [];
  // Antes del primer pulso detectado (intro sin batería): con el tempo del principio.
  for (let t = s[0] - first; t >= -1e-6; t -= first) times.unshift(Math.max(0, t));
  times.push(...s);
  for (let t = s[s.length - 1] + last; t < durationSec; t += last) times.push(t);
  // Acentos: el pulso más cercano a cada 1 del compás detectado; fuera de lo
  // detectado, se sigue la cuenta del compás.
  const accents = new Array(times.length).fill(false);
  const db = (downbeats || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (db.length) {
    let j = 0;
    for (const d of db) {
      while (j + 1 < times.length && Math.abs(times[j + 1] - d) <= Math.abs(times[j] - d)) j++;
      if (Math.abs(times[j] - d) < 0.15) accents[j] = true;
    }
    // Compás típico (pulsos entre unos) para continuar la cuenta antes y después.
    const idx = accents.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const gaps = []; for (let k = 1; k < idx.length; k++) gaps.push(idx[k] - idx[k - 1]);
    const bar = Math.max(2, Math.round(median(gaps)) || 4);
    if (idx.length) {
      for (let i = idx[0] - bar; i >= 0; i -= bar) accents[i] = true;
      for (let i = idx[idx.length - 1] + bar; i < times.length; i += bar) accents[i] = true;
    }
  } else {
    for (let i = 0; i < times.length; i += 4) accents[i] = true;
  }
  return { times, accents };
}
