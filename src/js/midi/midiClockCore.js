// ─────────────────────────────────────────────────────────────────────────
// Reloj MIDI (MIDI Clock) — lógica pura (probada en tests/midiClock.test.mjs).
// 24 pulsos (0xF8) por negra; Start 0xFA, Continue 0xFB, Stop 0xFC.
// ─────────────────────────────────────────────────────────────────────────

export const CLOCK = 0xF8, START = 0xFA, CONTINUE = 0xFB, STOP = 0xFC;
export const PPQN = 24;

/** Milisegundos entre pulsos de reloj a `bpm`. */
export const tickMs = (bpm) => 60000 / (Math.max(20, Math.min(300, Number(bpm) || 120)) * PPQN);

/**
 * Pulsos a programar por adelantado: desde `next` (ms, reloj de performance.now) hasta
 * `until`, cada tickMs(bpm). → { times: [...], next } (next = el siguiente aún no programado).
 * Si se quedó atrás (la ventana estuvo congelada), salta al presente en vez de mandar una ráfaga.
 */
export function scheduleTicks(next, now, until, bpm) {
  const dt = tickMs(bpm);
  let t = next;
  if (t < now - dt * 2) t = now;
  const times = [];
  while (t < until) { times.push(t); t += dt; }
  return { times, next: t };
}

/**
 * BPM a partir de los instantes de llegada de los pulsos (ms). Media recortada de los intervalos
 * (la mitad central): el temblor del cable/USB y algún pulso tardío no mueven el tempo. null si hay pocos.
 */
export function bpmFromTicks(stamps) {
  if (!Array.isArray(stamps) || stamps.length < 13) return null;
  const iv = [];
  for (let i = 1; i < stamps.length; i++) { const d = stamps[i] - stamps[i - 1]; if (d > 0 && d < 200) iv.push(d); }
  if (iv.length < 12) return null;
  iv.sort((a, b) => a - b);
  const mid = iv.slice(Math.floor(iv.length * 0.25), Math.ceil(iv.length * 0.75));
  const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
  return Math.round((60000 / (mean * PPQN)) * 10) / 10;
}
