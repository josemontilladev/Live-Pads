// ─────────────────────────────────────────────────────────────────────────
// Guía hablada de las secuencias («Verso», «Coro», «1, 2, 3, 4»…).
// En las secuencias de alabanza el canal IZQUIERDO lleva click + guía y el
// DERECHO la música (sin correlación entre ellos). La guía dice cada sección
// en el compás anterior, así que marca dónde empieza con mucha precisión.
//
//  · guideStats(L, R, sr) → { guide, corr, quietL } (¿hay canal de guía?)
//  · guideWords(L, sr)    → [{ s, e }] palabras (ráfagas de voz; los golpes de click son más cortos)
//  · guideEvents(words, barSec) → avisos (palabras agrupadas: «Coro… 2, 3, 4» = un aviso)
//  · guideBoundaries(events, grid) → inicios de sección: el primer compás tras el aviso.
// Puro: se prueba en Node (tests/guideCues.test.mjs).
// ─────────────────────────────────────────────────────────────────────────

/** ¿Canal izquierdo = click/guía (casi siempre en silencio y sin parecido con el derecho)? */
export function guideStats(L, R, sr) {
  if (!L || !R || L === R) return { guide: false };
  let el = 0, er = 0, lr = 0;
  for (let i = 0; i < L.length; i += 4) { el += L[i] * L[i]; er += R[i] * R[i]; lr += L[i] * R[i]; }
  const corr = lr / Math.sqrt(el * er || 1);
  const bs = Math.round(sr * 0.05);
  let q = 0, n = 0;
  for (let i = 0; i + bs < L.length; i += bs) {
    let e = 0;
    for (let j = 0; j < bs; j += 4) e += L[i + j] * L[i + j];
    if (Math.sqrt(e / (bs / 4)) < 0.003) q++;
    n++;
  }
  const quietL = n ? q / n : 0;
  const rmsL = Math.sqrt(el / Math.max(1, L.length / 4));
  // Lo decisivo: los dos canales no se parecen nada (en una mezcla estéreo normal, sí).
  return { guide: Math.abs(corr) < 0.15 && rmsL > 0.005, corr: +corr.toFixed(3), quietL: +quietL.toFixed(2) };
}

/**
 * Palabras de la guía. La voz es SOSTENIDA (energía estable ≥ 150 ms); el click es
 * un golpe que cae enseguida. Con el mínimo de la energía en ventanas de 150 ms
 * el click desaparece y la voz queda.
 */
export function guideWords(L, sr, { minWord = 0.25, joinGap = 0.12, win = 15 } = {}) {
  const hop = Math.round(sr * 0.01), rms = [];
  for (let i = 0; i + hop <= L.length; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j += 2) e += L[i + j] * L[i + j];
    rms.push(Math.sqrt(e / (hop / 2)));
  }
  // Mínimo deslizante (cola monótona: lineal).
  const sus = new Float32Array(rms.length), dq = [];
  for (let i = rms.length - 1; i >= 0; i--) {
    while (dq.length && rms[dq[dq.length - 1]] >= rms[i]) dq.pop();
    dq.push(i);
    while (dq[0] >= i + win) dq.shift();
    sus[i] = rms[dq[0]];
  }
  const sorted = Array.from(sus).sort((a, b) => a - b);
  const thr = Math.max(0.004, sorted[sorted.length >> 1] * 3);
  const words = [];
  let st = -1;
  const close = (a, b) => {
    const s = a / 100, e = (b + win - 1) / 100, last = words[words.length - 1];
    if (last && s - last.e < joinGap) last.e = e; else words.push({ s, e });
  };
  for (let i = 0; i < sus.length; i++) {
    if (sus[i] > thr) { if (st < 0) st = i; }
    else if (st >= 0) { close(st, i); st = -1; }
  }
  if (st >= 0) close(st, sus.length - 1);
  return words.filter((w) => w.e - w.s >= minWord).map((w) => ({ s: +w.s.toFixed(2), e: +w.e.toFixed(2) }));
}

/** Agrupa palabras seguidas (aviso + cuenta, o una frase) en un aviso. */
export function guideEvents(words, barSec = 2) {
  const out = [];
  for (const w of words || []) {
    const last = out[out.length - 1];
    if (last && w.s - last.e < Math.max(0.9, barSec * 0.95)) { last.e = w.e; last.n++; }
    else out.push({ s: w.s, e: w.e, n: 1 });
  }
  return out;
}

/** Inicio de cada sección: el primer compás que empieza después del aviso (la guía habla en el compás anterior). */
export function guideBoundaries(events, grid, duration = Infinity) {
  if (!events || !events.length) return [];
  const barSec = (grid && grid.barSec) || 2;
  const downs = grid && grid.downbeats && grid.downbeats.length ? grid.downbeats : null;
  const out = [];
  for (const ev of events) {
    const from = ev.s + barSec * 0.35;
    let t = null;
    if (downs) { for (const d of downs) if (d >= from) { t = d; break; } }
    else { const off = (grid && grid.off) || 0; t = off + Math.ceil((from - off) / barSec) * barSec; }
    if (t == null || t >= duration - 1) continue;
    if (out.length && t - out[out.length - 1] < barSec * 1.5) continue;
    out.push(+t.toFixed(3));
  }
  return out;
}

// ── Versiones que no bloquean la interfaz (para la app) ──────────────────
const yieldNow = () => (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function')
  ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0));

/** guideStats leyendo 1 de cada 16 muestras (la correlación y el silencio no necesitan más). */
export function guideStatsFast(L, R, sr) {
  if (!L || !R || L === R) return { guide: false };
  let el = 0, er = 0, lr = 0;
  for (let i = 0; i < L.length; i += 16) { el += L[i] * L[i]; er += R[i] * R[i]; lr += L[i] * R[i]; }
  const corr = lr / Math.sqrt(el * er || 1);
  const rmsL = Math.sqrt(el / Math.max(1, L.length / 16));
  return { guide: Math.abs(corr) < 0.15 && rmsL > 0.005, corr: +corr.toFixed(3) };
}

/** guideWords en trozos de ~5 ms que ceden el hilo entre sí. */
export async function guideWordsAsync(L, sr, opts = {}) {
  const hop = Math.round(sr * 0.01), n = Math.floor(L.length / hop);
  const rms = new Float32Array(n);
  let t0 = performance.now();
  for (let k = 0; k < n; k++) {
    const i = k * hop;
    let e = 0;
    for (let j = 0; j < hop; j += 2) e += L[i + j] * L[i + j];
    rms[k] = Math.sqrt(e / (hop / 2));
    if ((k & 255) === 0 && performance.now() - t0 > 5) { await yieldNow(); t0 = performance.now(); }
  }
  // El resto (mínimo deslizante y umbral) es barato: trabaja sobre ~30 000 valores.
  return guideWordsFromRms(rms, opts);
}
function guideWordsFromRms(rms, { minWord = 0.25, joinGap = 0.12, win = 15 } = {}) {
  const sus = new Float32Array(rms.length), dq = [];
  for (let i = rms.length - 1; i >= 0; i--) {
    while (dq.length && rms[dq[dq.length - 1]] >= rms[i]) dq.pop();
    dq.push(i);
    while (dq[0] >= i + win) dq.shift();
    sus[i] = rms[dq[0]];
  }
  const sorted = Array.from(sus).sort((a, b) => a - b);
  const thr = Math.max(0.004, sorted[sorted.length >> 1] * 3);
  const words = [];
  let st = -1;
  const close = (a, b) => { const s = a / 100, e = (b + win - 1) / 100, last = words[words.length - 1]; if (last && s - last.e < joinGap) last.e = e; else words.push({ s, e }); };
  for (let i = 0; i < sus.length; i++) { if (sus[i] > thr) { if (st < 0) st = i; } else if (st >= 0) { close(st, i); st = -1; } }
  if (st >= 0) close(st, sus.length - 1);
  return words.filter((w) => w.e - w.s >= minWord).map((w) => ({ s: +w.s.toFixed(2), e: +w.e.toFixed(2) }));
}

/** Solo el canal derecho (la música), mono a 22 050 Hz, calculado por el motor de audio fuera de este hilo. */
export async function rightChannelBuffer(buffer) {
  const SR = 22050, len = Math.max(1, Math.ceil(buffer.duration * SR));
  const off = new OfflineAudioContext(1, len, SR);
  const src = off.createBufferSource(); src.buffer = buffer;
  const split = off.createChannelSplitter(2), g = off.createGain();
  src.connect(split); split.connect(g, 1); g.connect(off.destination); src.start();
  return off.startRendering();
}
