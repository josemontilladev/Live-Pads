// Vúmetro: balística y detección de saturación (puro; tests/vuMeter.test.mjs).

const FLOOR = -60;
export const SAT_REDUCTION_DB = -6;     // el limitador recorta más de 6 dB…
export const SAT_HOLD_MS = 500;         // …durante medio segundo seguido
const FALL_DB_PER_S = 24;               // caída de la barra
const PEAK_HOLD_MS = 1500;

/** dBFS → % de la barra (−60 dB = 0 %, 0 dB = 100 %). */
export const meterPct = (db) => Math.max(0, Math.min(100, ((Math.max(FLOOR, db) - FLOOR) / -FLOOR) * 100));

/**
 * Un paso del medidor. prev = estado anterior (o null), m = { peak, rms, reduction }, now en ms.
 * → { level, hold, holdAt, overSince, sat, satUntil, reduction, at }
 */
export function meterStep(prev, m, now) {
  const p = prev || { level: FLOOR, hold: FLOOR, holdAt: 0, overSince: null, sat: false, satUntil: 0, reduction: 0, at: now };
  const dt = Math.max(0, (now - (p.at != null ? p.at : now)) / 1000);
  // Sube al instante, cae despacio (como un medidor de verdad).
  const target = Math.max(FLOOR, m.peak);
  const level = target >= p.level ? target : Math.max(target, p.level - FALL_DB_PER_S * dt);
  let hold = p.hold, holdAt = p.holdAt;
  if (target >= hold || now - holdAt > PEAK_HOLD_MS) { hold = target; holdAt = now; }
  // Saturación: recorte fuerte sostenido, o pico a 0 dB.
  const over = (m.reduction <= SAT_REDUCTION_DB) || m.peak >= -0.1;
  const overSince = over ? (p.overSince != null ? p.overSince : now) : null;
  let sat = p.sat, satUntil = p.satUntil;
  if (over && (now - overSince >= SAT_HOLD_MS || m.peak >= -0.1)) { sat = true; satUntil = now + 2000; }
  else if (sat && now > satUntil) sat = false;
  return { level, hold, holdAt, overSince, sat, satUntil, reduction: m.reduction, at: now };
}
