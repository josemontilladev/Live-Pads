// ─────────────────────────────────────────────────────────────────────────
// Bus principal de Pads: pads, batería y pista pasan por aquí antes de la
// salida (el click NO: va aparte, a 1-2 o a los in-ears por 3-4).
//   entrada → graves (estante 180 Hz) → agudos (estante 4 kHz) → limitador de
//   seguridad (techo −1 / −3 / −6 dB) → salida
// El limitador protege la SUMA de todo (antes cada parte tenía el suyo y juntas
// podían pasarse). El ecualizador ajusta la mezcla a la sala o a los auriculares.
// Ajustes → Audio → «Sonido general».
// ─────────────────────────────────────────────────────────────────────────

const PREF = 'livepads.mainEq';
const buses = new WeakMap();

export function mainEqPrefs() {
  const p = { bass: 0, treble: 0, ceiling: -1 };
  try { Object.assign(p, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (_) {}
  p.bass = Math.max(-9, Math.min(9, Number(p.bass) || 0));
  p.treble = Math.max(-9, Math.min(9, Number(p.treble) || 0));
  p.ceiling = [-1, -3, -6].includes(Number(p.ceiling)) ? Number(p.ceiling) : -1;
  return p;
}

function apply(b, p) {
  const t = b.ctx.currentTime;
  try {
    b.low.gain.setTargetAtTime(p.bass, t, 0.05);
    b.high.gain.setTargetAtTime(p.treble, t, 0.05);
    b.lim.threshold.setValueAtTime(p.ceiling, t);
  } catch (_) {
    b.low.gain.value = p.bass; b.high.gain.value = p.treble; b.lim.threshold.value = p.ceiling;
  }
}

/** Nodo de entrada del bus principal de este AudioContext (se crea la primera vez). */
export function mainBusInput(ctx) {
  let b = buses.get(ctx);
  if (!b) {
    const input = ctx.createGain();
    const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180;
    const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
    const lim = ctx.createDynamicsCompressor();
    lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    input.connect(low); low.connect(high); high.connect(lim); lim.connect(ctx.destination);
    // Medidor (vúmetro): lee la salida tras el limitador. No va a ningún sitio (solo se mide).
    const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0;
    lim.connect(an);
    b = { ctx, input, low, high, lim, an, buf: new Float32Array(an.fftSize) };
    buses.set(ctx, b);
    apply(b, mainEqPrefs());
    allBuses.add(b);
  }
  return b.input;
}
const allBuses = new Set();

export function setMainEq(patch) {
  const p = { ...mainEqPrefs(), ...patch };
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) {}
  const q = mainEqPrefs();
  for (const b of allBuses) apply(b, q);
  return q;
}

/**
 * Nivel de la salida del bus principal ahora mismo (para el vúmetro):
 *   { peak, rms } en dBFS (−∞…0) y `reduction`: cuántos dB está recortando el limitador
 *   (0 = nada; −6 o menos sostenido = la mezcla entra demasiado fuerte: satura).
 */
export function mainMeter() {
  let peak = 0, sum = 0, n = 0, reduction = 0;
  for (const b of allBuses) {
    try { b.an.getFloatTimeDomainData(b.buf); } catch (_) { continue; }
    for (let i = 0; i < b.buf.length; i++) { const v = Math.abs(b.buf[i]); if (v > peak) peak = v; sum += b.buf[i] * b.buf[i]; }
    n += b.buf.length;
    const r = Number(b.lim.reduction);
    if (Number.isFinite(r) && r < reduction) reduction = r;
  }
  const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
  return { peak: db(peak), rms: db(n ? Math.sqrt(sum / n) : 0), reduction };
}

// ── Terminar suave ────────────────────────────────────────────────────────
// Baja a cero, en `sec` segundos, todo lo que suena por el bus principal (secuencia,
// original, pads, batería, caja de ritmos). El click y las indicaciones van por su
// propio bus (in-ears) y no se tocan.
export function fadeMainBuses(sec) {
  for (const b of allBuses) {
    const g = b.input.gain, t = b.ctx.currentTime;
    try { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + Math.max(0.05, sec)); } catch (_) { g.value = 0; }
  }
}
/** Deja el bus principal otra vez a su volumen (tras terminar suave o si se cancela). */
export function restoreMainBuses() {
  for (const b of allBuses) {
    const g = b.input.gain, t = b.ctx.currentTime;
    try { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1, t + 0.05); } catch (_) { g.value = 1; }
  }
}
