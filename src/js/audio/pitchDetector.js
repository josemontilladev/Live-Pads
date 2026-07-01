// ─────────────────────────────────────────────────────────────────────────
// Detección de tono (pitch) para el Afinador. Autocorrelación normalizada
// sobre el buffer de tiempo del micrófono (robusta para cuerdas graves y voz,
// mejor que un pico de FFT). Devuelve la frecuencia fundamental en Hz o -1 si
// no hay una nota clara. Incluye las utilidades nota↔frecuencia.
//
// El algoritmo (autoCorrelate) es la variante clásica con recorte de silencio
// e interpolación parabólica del pico, muy usada en afinadores web.
// ─────────────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Autocorrelación → frecuencia fundamental. `buf` es Float32 (dominio temporal).
// Devuelve Hz, o -1 si la señal es demasiado débil o no hay periodicidad clara.
export function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  // Puerta de ruido: si el nivel (RMS) es muy bajo, no hay nota que medir.
  let rms = 0;
  for (let i = 0; i < SIZE; i++) { const v = buf[i]; rms += v * v; }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  // Recorta los extremos por debajo de un umbral para centrar la señal útil.
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }

  const b = buf.subarray(r1, r2);
  const size = b.length;
  if (size < 8) return -1;

  // Autocorrelación c[i] = Σ b[j]·b[j+i].
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (let j = 0; j < size - i; j++) sum += b[j] * b[j + i];
    c[i] = sum;
  }

  // Salta el primer descenso (autocorrelación en 0) y busca el pico máximo.
  let d = 0;
  while (d < size - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < size; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  let T0 = maxpos;
  if (T0 <= 0) return -1;

  // Interpolación parabólica alrededor del pico para afinar el periodo.
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);

  const freq = sampleRate / T0;
  // Rango musical útil (mi grave de bajo ≈ 41 Hz → agudos ≈ 2 kHz).
  if (freq < 27 || freq > 4200) return -1;
  return freq;
}

// Frecuencia → nota más cercana + desviación en cents. `a4` permite calibrar
// (referencia del La central; 440 por defecto).
export function freqToNoteInfo(freq, a4 = 440) {
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const targetFreq = a4 * Math.pow(2, (midi - 69) / 12);
  return { midi, name, octave, cents, targetFreq };
}

export { NOTE_NAMES };
