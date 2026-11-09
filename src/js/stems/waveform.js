// Waveform peak computation + canvas rendering. Peaks are decimated once
// per track on import: we walk the float samples in `samplesPerPx` blocks
// and store the min/max of each block. Drawing is then O(width) per repaint.
//
// Stereo buffers are summed to mono for visualisation — the L/R distinction
// is irrelevant for "where is the energy" at this zoom level.

export function computePeaks(audioBuffer, targetWidth) {
  const channels = audioBuffer.numberOfChannels;
  const samples = audioBuffer.getChannelData(0);
  const second = channels > 1 ? audioBuffer.getChannelData(1) : null;
  const total = samples.length;
  const width = Math.max(1, Math.floor(targetWidth));
  const samplesPerPx = Math.max(1, Math.floor(total / width));
  const peaks = new Float32Array(width * 2);

  for (let i = 0; i < width; i++) {
    const start = i * samplesPerPx;
    const end = Math.min(total, start + samplesPerPx);
    let min = 0, max = 0;
    for (let j = start; j < end; j++) {
      const v = second ? (samples[j] + second[j]) * 0.5 : samples[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2]     = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}

// Igual que computePeaks, pero en trozos de ~`slice` ms que ceden el hilo entre sí:
// con canciones largas el cálculo de un tirón bloqueaba la interfaz (y retrasaba los
// golpes MIDI) cientos de milisegundos al cambiar de canción.
const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
export async function computePeaksAsync(audioBuffer, targetWidth, { slice = 6, isCancelled } = {}) {
  const channels = audioBuffer.numberOfChannels;
  const samples = audioBuffer.getChannelData(0);
  const second = channels > 1 ? audioBuffer.getChannelData(1) : null;
  const total = samples.length;
  const width = Math.max(1, Math.floor(targetWidth));
  const samplesPerPx = Math.max(1, Math.floor(total / width));
  const peaks = new Float32Array(width * 2);
  let t0 = performance.now();
  for (let i = 0; i < width; i++) {
    const start = i * samplesPerPx;
    const end = Math.min(total, start + samplesPerPx);
    let min = 0, max = 0;
    if (second) {
      for (let j = start; j < end; j++) { const v = (samples[j] + second[j]) * 0.5; if (v < min) min = v; else if (v > max) max = v; }
    } else {
      for (let j = start; j < end; j++) { const v = samples[j]; if (v < min) min = v; else if (v > max) max = v; }
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
    if ((i & 63) === 0 && performance.now() - t0 > slice) {
      await yieldNow();
      if (isCancelled && isCancelled()) return null;
      t0 = performance.now();
    }
  }
  return peaks;
}

export function drawWaveform(canvas, peaks, options = {}) {
  if (!canvas || !peaks) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width  = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const color = options.color || 'rgba(255,255,255,0.65)';
  const mid = cssH / 2;
  const len = peaks.length / 2;
  const ratio = len / cssW;

  ctx.fillStyle = color;
  for (let x = 0; x < cssW; x++) {
    const i = Math.floor(x * ratio);
    const min = peaks[i * 2];
    const max = peaks[i * 2 + 1];
    const y1 = mid - max * mid;
    const y2 = mid - min * mid;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}
