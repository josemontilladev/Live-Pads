// Render offline de un loop de la biblioteca ajustado al proyecto: tempo,
// tono y N repeticiones, cuadrado al sample con la rejilla del editor.
//
//   await renderLoop(buffer, fit, { beatsPerBar, projectBpm, repeats, onProgress })
//     → AudioBuffer listo para engine.addTrack
//
// Cadena (la misma idea que la velocidad de estudio del engine):
//   source (playbackRate = ratio) → SoundTouchNode (pitch = stPitch) → destino
// Acelerar con playbackRate es sample-exacto; SoundTouch devuelve la afinación
// a su sitio y suma la transposición. Así no hay deriva entre repeticiones.
//
// SoundTouch añade una latencia de procesado (el audio sale unos ms tarde). En
// un loop eso se nota como un golpe fuera de tiempo, así que se MIDE una vez
// por combinación de parámetros con un impulso y se recorta del resultado.

import { SoundTouchNode } from '../../vendor/soundtouch-worklet/SoundTouchNode.js';
import { getWorkletUrl, capSampleRate } from './harmonyShifter.js';
import { barsToSamples, needsProcessing } from './loopFit.js';

const MAX_RENDER_RATE = 48000;
const SEAM_FADE = 64;            // ~1.3 ms de fade al final de cada vuelta (anti-clic)
const latencyCache = new Map();  // `${ratio}|${pitch}|${sr}` → muestras

// useSoundTouch = false → varispeed puro (solo playbackRate): sin latencia.
async function renderChain(buffer, ratio, stPitch, outLen, useSoundTouch = true) {
  const sr = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);
  const offline = new OfflineAudioContext(channels, outLen, sr);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = ratio;
  let st = null;
  if (useSoundTouch) {
    await SoundTouchNode.register(offline, await getWorkletUrl());
    st = new SoundTouchNode({ context: offline });
    st.pitchSemitones.value = stPitch;
    src.connect(st);
    st.connect(offline.destination);
  } else {
    src.connect(offline.destination);
  }
  src.start(0);
  const out = await offline.startRendering();
  try { st?.disconnect(); } catch (_) {}
  return out;
}

// Latencia de SoundTouch para estos parámetros: posición del pico de un
// impulso tras pasar por la cadena.
async function measureLatency(ratio, stPitch, sr) {
  const key = `${ratio.toFixed(5)}|${stPitch.toFixed(4)}|${sr}`;
  if (latencyCache.has(key)) return latencyCache.get(key);
  const len = Math.round(sr * 0.5);
  const probe = new AudioBuffer({ numberOfChannels: 1, length: len, sampleRate: sr });
  // Un clic corto con algo de cuerpo: un delta puro se diluye en el WSOLA.
  const d = probe.getChannelData(0);
  for (let i = 0; i < 32; i++) d[i] = 1 - i / 32;
  const out = await renderChain(probe, ratio, stPitch, len);
  const o = out.getChannelData(0);
  let peak = 0, at = 0;
  for (let i = 0; i < o.length; i++) {
    const a = Math.abs(o[i]);
    if (a > peak) { peak = a; at = i; }
  }
  // Sin pico fiable (cadena puenteada o silencio) → asumimos latencia cero.
  const lat = peak > 0.05 ? at : 0;
  latencyCache.set(key, lat);
  return lat;
}

async function stretch(buffer, fit) {
  const sr = buffer.sampleRate;
  if (fit.varispeed) {
    const rendered = await renderChain(buffer, fit.ratio, 0, Math.ceil(buffer.length / fit.ratio) + 1, false);
    return { rendered, offset: 0 };
  }
  const lat = await measureLatency(fit.ratio, fit.stPitch, sr);
  const outLen = Math.ceil(buffer.length / fit.ratio) + lat + Math.round(sr * 0.05);
  const rendered = await renderChain(buffer, fit.ratio, fit.stPitch, outLen);
  return { rendered, offset: lat };
}

/**
 * @param {AudioBuffer} buffer  audio original del loop
 * @param {object} fit          resultado de fitLoop()
 * @param {object} opts
 *   beatsPerBar: compás del loop
 *   projectBpm:  tempo del proyecto (define la rejilla)
 *   repeats:     cuántas vueltas seguidas (1 por defecto)
 */
export async function renderLoop(buffer, fit, { beatsPerBar = 4, projectBpm, repeats = 1, onProgress } = {}) {
  if (!buffer) throw new Error('Falta el audio del loop.');
  try { buffer = await capSampleRate(buffer, MAX_RENDER_RATE); } catch (_) {}
  const sr = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);

  let source = buffer, offset = 0;
  if (needsProcessing(fit)) {
    onProgress?.(0.1);
    ({ rendered: source, offset } = await stretch(buffer, fit));
  }
  onProgress?.(0.8);

  const loopLen = barsToSamples(fit.bars, beatsPerBar, projectBpm, sr);
  const n = Math.max(1, Math.floor(repeats));
  const out = new AudioBuffer({ numberOfChannels: channels, length: loopLen * n, sampleRate: sr });

  for (let c = 0; c < channels; c++) {
    const src = source.getChannelData(Math.min(c, source.numberOfChannels - 1));
    const dst = out.getChannelData(c);
    // Una vuelta exacta: lo que sobre se corta, lo que falte queda en silencio.
    const avail = Math.max(0, Math.min(loopLen, src.length - offset));
    const one = src.subarray(offset, offset + avail);
    for (let r = 0; r < n; r++) {
      const base = r * loopLen;
      dst.set(one, base);
      const fadeFrom = Math.max(0, avail - SEAM_FADE);
      for (let i = fadeFrom; i < avail; i++) dst[base + i] *= (avail - i) / SEAM_FADE;
    }
  }
  onProgress?.(1);
  return out;
}
