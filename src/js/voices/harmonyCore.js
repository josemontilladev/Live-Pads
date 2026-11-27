// ─────────────────────────────────────────────────────────────────────────
// Estudio de voces — núcleo puro (sin DOM ni audio del navegador; probado en
// tests/harmony.test.mjs):
//   trackPitch(mono, sr)     → curva de tono de la voz (YIN), 100 cuadros/s
//   segmentNotes(track)      → notas de la melodía [{ s, e, m }] (m = MIDI)
//   harmonize(notes, opts)   → 2.ª y 3.ª voz según el tono y los acordes
//   noteName(m)              → «F#4»
// ─────────────────────────────────────────────────────────────────────────

const HOP = 0.01;            // s entre cuadros de tono
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const mod12 = (v) => ((v % 12) + 12) % 12;

export function noteName(m, flats = false) {
  const r = Math.round(m);
  return (flats ? FLAT : SHARP)[mod12(r)] + (Math.floor(r / 12) - 1);
}
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// ── Tono de la voz (YIN) ─────────────────────────────────────────────────
/**
 * mono: Float32Array; sr: Hz. Se reduce a ~11 kHz (la voz no necesita más) y se
 * analiza cada 10 ms. → { hop, f0: Float32Array (Hz, 0 = sin voz), conf, rms }
 */
const YIN_FALLBACK = 0.4;
export function trackPitch(mono, sr, { fmin = 70, fmax = 1100, onProgress = null } = {}) {
  const dec = Math.max(1, Math.round(sr / 11025));
  const rate = sr / dec;
  const n = Math.floor(mono.length / dec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < dec; k++) s += mono[i * dec + k]; x[i] = s / dec; }
  const W = 512, tauMin = Math.max(2, Math.floor(rate / fmax)), tauMax = Math.min(W - 1, Math.ceil(rate / fmin));
  const hopN = Math.round(HOP * rate);
  const frames = Math.max(0, Math.floor((n - W - tauMax) / hopN));
  const f0 = new Float32Array(frames), conf = new Float32Array(frames), rms = new Float32Array(frames);
  const d = new Float32Array(tauMax + 1);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const o = f * hopN;
    let e = 0;
    for (let j = 0; j < W; j++) e += x[o + j] * x[o + j];
    rms[f] = Math.sqrt(e / W);
    if (rms[f] > peak) peak = rms[f];
  }
  const gate = peak * 0.06;
  for (let f = 0; f < frames; f++) {
    if (onProgress && (f & 1023) === 0) onProgress(f / frames);
    if (rms[f] < gate) continue;
    const o = f * hopN;
    d[0] = 1;
    let run = 0, best = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[o + j] - x[o + j + tau]; s += v * v; }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (d[tau] < 0.15) { while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++; best = tau; break; }
    }
    if (best < 0) {
      // Sin un valle claro (la voz separada lleva reverberación y restos de la mezcla, sobre todo
      // en las notas largas y sus finales): vale el mínimo absoluto si es razonable. Antes estos
      // cuadros se perdían y las notas largas salían cortadas.
      let mv = YIN_FALLBACK;
      for (let tau = tauMin; tau < tauMax; tau++) if (d[tau] < mv) { mv = d[tau]; best = tau; }
      if (best < 0) continue;
    }
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c;
    const t = den ? best + (a - c) / (2 * den) : best;
    f0[f] = rate / t;
    conf[f] = Math.max(0, 1 - b);
  }
  return { hop: HOP, f0, conf, rms };
}

// ── Notas de la melodía ──────────────────────────────────────────────────
function median(arr) { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1]; }

/** Curva de tono → notas estables [{ s, e, m }]. Quita vibrato, deslices cortos y saltos de octava. */
export function segmentNotes({ hop, f0, conf }, { minDur = 0.09, minConf = 0.55, startConf = 0.7 } = {}) {
  const N = f0.length;
  const mid = new Float32Array(N);
  for (let i = 0; i < N; i++) mid[i] = f0[i] > 0 && conf[i] >= minConf ? hzToMidi(f0[i]) : NaN;
  // Mediana de 5 cuadros (vibrato y errores sueltos) y corrección de octava.
  const sm = new Float32Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(mid[i])) continue;
    const w = [];
    for (let k = -2; k <= 2; k++) { const v = mid[i + k]; if (v === v && v !== undefined) w.push(v); }
    let m = median(w);
    if (w.length >= 3) { const ctx = median(w); if (Math.abs(mid[i] - ctx) > 9) m = ctx; }
    sm[i] = m;
  }
  const notes = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const dur = (cur.end - cur.start + 1) * hop;
    if (dur >= minDur) notes.push({ s: cur.start * hop, e: (cur.end + 1) * hop, m: Math.round(median(cur.vals)) });
    cur = null;
  };
  let gap = 0;
  for (let i = 0; i < N; i++) {
    const v = sm[i];
    if (Number.isNaN(v)) { gap++; if (gap >= 4) close(); continue; }
    gap = 0;
    // Una nota empieza solo con un tono claro; una vez empezada sigue con uno algo menos claro (su final).
    if (!cur) { if (conf[i] < startConf) continue; cur = { start: i, end: i, vals: [v], ref: v, off: 0 }; continue; }
    const ref = median(cur.vals.slice(-15));
    if (Math.abs(v - ref) > 0.65) {
      cur.off++;
      if (cur.off >= 3) {   // cambio sostenido: nota nueva desde donde empezó a cambiar
        const startNew = i - cur.off + 1;
        cur.end = startNew - 1;
        cur.vals = cur.vals.slice(0, Math.max(1, cur.vals.length - (cur.off - 1)));
        close();
        cur = { start: startNew, end: i, vals: [], ref: v, off: 0 };
        for (let k = startNew; k <= i; k++) if (!Number.isNaN(sm[k])) cur.vals.push(sm[k]);
      } else { cur.end = i; cur.vals.push(v); }
    } else { cur.off = 0; cur.end = i; cur.vals.push(v); }
  }
  close();
  // Picos falsos del detector: una nota muy corta encajada entre dos iguales (A-B-A) o muy
  // lejos de sus dos vecinas pegadas a ella es un error (un armónico, un coro de fondo, una
  // consonante): se la come la nota de al lado.
  const SHORT = 0.2;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < notes.length - 1; i++) {
      const a = notes[i - 1], b = notes[i], c = notes[i + 1];
      if (!b || b.e - b.s >= SHORT) continue;
      const glued = b.s - a.e < 0.08 && c.s - b.e < 0.08;
      if (!glued) continue;
      if (a.m === c.m || (Math.abs(b.m - a.m) >= 4 && Math.abs(b.m - c.m) >= 4)) {
        a.e = b.e;   // la anterior se alarga; la de después sigue igual
        notes.splice(i, 1);
        i--;
      }
    }
  }
  // Saltos de octava del detector: una nota corta pegada a otra justo una octava al lado.
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1], b = notes[i];
    if (b.s - a.e >= 0.08) continue;
    const d = b.m - a.m;
    if (Math.abs(Math.abs(d) - 12) <= 1 && b.e - b.s < 0.6 && b.e - b.s < a.e - a.s) b.m -= 12 * Math.sign(d);
    else if (Math.abs(Math.abs(d) - 12) <= 1 && a.e - a.s < 0.6 && a.e - a.s < b.e - b.s) a.m += 12 * Math.sign(d);
  }
  // Une notas iguales separadas por un respiro corto.
  const out = [];
  for (const n of notes) {
    const p = out[out.length - 1];
    if (p && p.m === n.m && n.s - p.e < 0.08) p.e = n.e; else out.push({ ...n });
  }
  return out;
}

// ── Armonía ──────────────────────────────────────────────────────────────
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Estilos: cuántos grados de la escala se mueve cada voz respecto a la melodía. */
export const STYLES = {
  'arriba-abajo': { label: '2.ª voz arriba · 3.ª voz abajo', v2: 2, v3: -2 },
  arriba: { label: 'Las dos arriba (3.ª y 5.ª)', v2: 2, v3: 4 },
  abajo: { label: 'Las dos abajo (3.ª y 5.ª)', v2: -2, v3: -4 },
};

function scaleOf(key) {
  const k = key && Number.isFinite(key.k) ? mod12(key.k) : 0;
  return (key && key.m ? MINOR : MAJOR).map((i) => mod12(k + i));
}

/** Nota MIDI movida `steps` grados de la escala (desde el grado más cercano a la nota). */
function diatonic(m, steps, scale) {
  // Grado de la escala de la nota (o el más cercano por debajo si es cromática).
  let base = m, idx = scale.indexOf(mod12(base));
  while (idx < 0) { base -= 1; idx = scale.indexOf(mod12(base)); }
  let out = base, pos = idx;
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    const next = (((pos + dir) % 7) + 7) % 7;
    const pcFrom = scale[pos], pcTo = scale[next];
    let delta = mod12(pcTo - pcFrom);
    if (dir < 0) delta = delta - 12;
    if (dir > 0 && delta === 0) delta = 12;
    out += delta;
    pos = next;
  }
  return out + (m - base);
}

function chordAt(chords, t) {
  if (!Array.isArray(chords)) return null;
  for (const c of chords) if (c.s <= t && t < c.e) return c;
  return null;
}

/**
 * notes: melodía [{ s, e, m }]. opts: { key: { k, m }, chords: [{ s, e, pcs: [..] }], style }
 * → { v2: [...], v3: [...] } con los mismos tiempos que la melodía.
 * Con acordes: si la nota de la melodía es del acorde, la armonía busca la nota del
 * acorde más cercana a la de la escala (sin cruzarse con la melodía); si es de paso,
 * va en paralelo por la escala. Después se suavizan los saltos grandes.
 */
export function harmonize(notes, { key = null, chords = null, style = 'arriba-abajo' } = {}) {
  const st = STYLES[style] || STYLES['arriba-abajo'];
  const scale = scaleOf(key);
  const voice = (steps) => {
    const out = [];
    for (const n of notes) {
      let h = diatonic(n.m, steps, scale);
      const ch = chordAt(chords, (n.s + n.e) / 2);
      const pcs = ch && Array.isArray(ch.pcs) ? ch.pcs : null;
      if (pcs && pcs.length && pcs.includes(mod12(n.m)) && !pcs.includes(mod12(h))) {
        let best = null;
        for (let d = 1; d <= 2 && best == null; d++) {
          for (const cand of [h - d, h + d]) {
            const side = steps > 0 ? cand > n.m : cand < n.m;
            if (side && pcs.includes(mod12(cand)) && mod12(cand) !== mod12(n.m)) { best = cand; break; }
          }
        }
        if (best != null) h = best;
      }
      out.push({ s: n.s, e: n.e, m: h });
    }
    // Saltos grandes con la melodía casi quieta: se prueba la misma nota del acorde una octava al lado.
    for (let i = 1; i < out.length; i++) {
      if (notes[i].s - notes[i - 1].e > 0.4) continue;
      const jump = out[i].m - out[i - 1].m, lead = notes[i].m - notes[i - 1].m;
      if (Math.abs(jump) >= 7 && Math.abs(lead) <= 2) {
        const alt = out[i].m - 12 * Math.sign(jump);
        const ok = steps > 0 ? alt > notes[i].m : alt < notes[i].m;
        if (ok) out[i].m = alt;
      }
    }
    return out;
  };
  return { v2: voice(st.v2), v3: voice(st.v3) };
}

/** Acordes del análisis ({ s, e, r, q } + calidades) → [{ s, e, pcs }]. */
export function chordsWithPcs(seg, qualities) {
  if (!Array.isArray(seg)) return [];
  return seg.filter((c) => c && c.r >= 0).map((c) => ({ s: c.s, e: c.e, pcs: (qualities[c.q] ? qualities[c.q][1] : [0, 4, 7]).map((i) => mod12(c.r + i)) }));
}
