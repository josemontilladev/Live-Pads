// ─────────────────────────────────────────────────────────────────────────
// Masterizado automático (puro; tests/autoMaster.test.mjs).
// Mide el balance tonal de una canción por octavas (media de ~24 trozos de 4096
// muestras repartidos por toda la pista) y lo compara con una curva de referencia
// de mezcla moderna (graves algo por encima, agudos cayendo ~2,5 dB por octava desde
// 1 kHz). Devuelve tres correcciones SUAVES (la mitad de la diferencia, con tope):
//   low  → estante de graves 120 Hz   (±4 dB)
//   mud  → campana 350 Hz, solo resta (0…−3 dB): el «barro» de las mezclas caseras
//   high → estante de agudos 6 kHz     (±4 dB)
// El volumen lo iguala aparte loudness.js.
// ─────────────────────────────────────────────────────────────────────────

const N = 4096;
// Octavas (Hz) y nivel de referencia relativo a 500–1000 Hz (dB).
export const OCTAVES = [[60, 120], [120, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
export const TARGET = [2, 1.5, 0.5, 0, -2.5, -5, -7.5, -10.5];
const AMOUNT = 0.5;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Nivel (dB) de cada octava, relativo a 500–1000 Hz. null si la pista es silencio. */
export function octaveProfile(samples, sr, frames = 24) {
  const len = samples.length;
  if (len < N * 2) return null;
  const power = new Float64Array(N / 2);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  let used = 0;
  // Se saltan el principio y el final (intros y colas en silencio).
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(len * 0.08 + ((len * 0.84 - N) * f) / Math.max(1, frames - 1));
    let e = 0;
    for (let i = 0; i < N; i++) { const v = samples[start + i] || 0; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    if (e / N < 1e-7) continue;          // trozo en silencio
    fft(re, im);
    for (let k = 1; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  if (!used) return null;
  const hz = sr / N;
  const levels = OCTAVES.map(([lo, hi]) => {
    let s = 0, c = 0;
    for (let k = Math.max(1, Math.floor(lo / hz)); k <= Math.min(N / 2 - 1, Math.ceil(hi / hz)); k++) { s += power[k]; c++; }
    // Potencia TOTAL de la octava (no la media por bin): el ruido rosa da lo mismo en todas.
    return c ? 10 * Math.log10(s / used + 1e-20) : -200;
  });
  const ref = levels[3];
  return levels.map((l) => l - ref);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Correcciones (dB) a partir del perfil por octavas. */
export function masterGains(profile) {
  if (!profile) return { low: 0, mud: 0, high: 0 };
  const diff = profile.map((l, i) => TARGET[i] - l);   // >0 = le falta, <0 = le sobra
  const low = clamp(avg(diff.slice(0, 2)) * AMOUNT, -4, 4);
  const mud = clamp(Math.min(0, diff[2] - avg(diff.slice(0, 2)) * 0.5) * AMOUNT, -3, 0);
  const high = clamp(avg(diff.slice(5, 8)) * AMOUNT, -4, 4);
  const r = (v) => Math.round(v * 10) / 10;
  return { low: r(low), mud: r(mud), high: r(high) };
}
