// Render the stem mix to a single MP3.
//
// 1) Re-create the runtime graph inside an OfflineAudioContext so render
//    is sample-accurate and runs faster than real-time.
// 2) Encode the resulting AudioBuffer to MP3 with lamejs at 192 kbps stereo.
//
// The encode loop yields back to the main thread every ~50 ms so the
// progress bar updates and the renderer doesn't freeze on long mixes.

import { Mp3Encoder } from '../../vendor/lamejs.js';
import * as engine from './engine.js';

const MP3_BITRATE = 192;
const MP3_SAMPLE_BLOCK = 1152; // lamejs canonical frame size

/**
 * @param {(progress: number, stage: string) => void} onProgress
 *   progress in [0, 1]. stage is 'render' or 'encode'.
 * @returns {Promise<Uint8Array>} the MP3 file bytes.
 */
/**
 * @param {(progress, stage) => void} onProgress
 * @param {Object} [opts]
 *   onlyTrackIds — restrict the mix to a subset of tracks (used by
 *   "Export individual track…"). When omitted, every track is included
 *   exactly as it sounds in the live mix.
 */
export async function exportMix(onProgress = () => {}, opts = {}) {
  const all = engine.getRawTracks();
  const tracks = opts.onlyTrackIds && opts.onlyTrackIds.length
    ? all.filter(t => opts.onlyTrackIds.includes(t.id))
    : all;
  if (!tracks.length) throw new Error('No hay pistas para exportar');
  // For an individual export, the project's overall length is the longest
  // selected track — not the project max. Otherwise short stems would
  // be padded with silence to the full song length.
  const durationSec = opts.onlyTrackIds
    ? Math.max(...tracks.map(t => (t.offsetSec || 0) + t.buffer.duration))
    : engine.getDurationSec();
  if (durationSec <= 0) throw new Error('La mezcla tiene duración cero');

  const sampleRate = 44100;
  const channels = 2;
  // Rango opcional: renderizamos hasta rangeEnd y luego recortamos desde
  // rangeStart, para exportar solo ese tramo de la mezcla.
  const hasRange = typeof opts.rangeStart === 'number' && typeof opts.rangeEnd === 'number' && opts.rangeEnd > opts.rangeStart;
  const renderSec = hasRange ? Math.min(opts.rangeEnd, durationSec) : durationSec;
  const lengthSamples = Math.ceil(renderSec * sampleRate);

  onProgress(0, 'render');

  // Render — recreate the runtime graph inside the OfflineAudioContext so
  // gain/pan/solo/mute behaviour matches what the user just heard live.
  const offline = new OfflineAudioContext(channels, lengthSamples, sampleRate);
  const offlineMaster = offline.createGain();
  offlineMaster.gain.value = engine.getMasterVolume();
  offlineMaster.connect(offline.destination);

  // For individual export, ignore mute/solo so the stem comes out clean
  // (otherwise a muted single-track export would render silence).
  const respectMix = !opts.onlyTrackIds;
  const anySoloed = respectMix && tracks.some(t => t.soloed);
  for (const t of tracks) {
    if (respectMix) {
      const audible = !t.muted && (!anySoloed || t.soloed);
      if (!audible) continue;
    }
    const src = offline.createBufferSource();
    src.buffer = t.buffer;
    const gain = offline.createGain();
    gain.gain.value = t.volume;
    const pan = offline.createStereoPanner();
    pan.pan.value = t.pan;
    src.connect(gain); gain.connect(pan); pan.connect(offlineMaster);
    // Honour the per-track timeline offset. Individual exports normalise to
    // the track's own start (offset 0) so the stem isn't padded with silence.
    // PERO con rango (rangeStart/End son coords absolutas del timeline) hay que
    // respetar el offset real aunque sea export individual, o el tramo sale
    // corrido por el valor del offset.
    const off = (opts.onlyTrackIds && !hasRange) ? 0 : (t.offsetSec || 0);
    if (off >= 0) src.start(off);
    else src.start(0, -off);
  }

  const rendered = await offline.startRendering();
  onProgress(1, 'render');

  // Encode — pull 1152-sample blocks out of the rendered buffer and feed
  // them to lamejs. Yield periodically so the UI can paint progress.
  let left  = rendered.getChannelData(0);
  let right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0);
  // Si hay rango, recortamos desde rangeStart (el render ya terminó en rangeEnd).
  if (hasRange) {
    const s0 = Math.min(left.length, Math.max(0, Math.floor(opts.rangeStart * sampleRate)));
    left = left.subarray(s0);
    right = right.subarray(s0);
  }

  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE);
  const total = left.length;
  const chunks = [];

  // lamejs expects Int16 PCM. Convert in-place per block, scaling float
  // [-1, 1] to int16 [-32768, 32767] with simple clamping.
  const leftPCM  = new Int16Array(MP3_SAMPLE_BLOCK);
  const rightPCM = new Int16Array(MP3_SAMPLE_BLOCK);

  let lastYield = performance.now();
  for (let i = 0; i < total; i += MP3_SAMPLE_BLOCK) {
    const blockLen = Math.min(MP3_SAMPLE_BLOCK, total - i);
    for (let s = 0; s < blockLen; s++) {
      const l = left[i + s];
      const r = right[i + s];
      leftPCM[s]  = Math.max(-32768, Math.min(32767, l < 0 ? l * 32768 : l * 32767));
      rightPCM[s] = Math.max(-32768, Math.min(32767, r < 0 ? r * 32768 : r * 32767));
    }
    const buf = encoder.encodeBuffer(
      leftPCM.subarray(0, blockLen),
      rightPCM.subarray(0, blockLen)
    );
    if (buf.length) chunks.push(buf);

    // Yield ~every 50 ms so progress paints.
    const now = performance.now();
    if (now - lastYield > 50) {
      onProgress(i / total, 'encode');
      lastYield = now;
      await new Promise(r => setTimeout(r, 0));
    }
  }
  const flush = encoder.flush();
  if (flush.length) chunks.push(flush);

  onProgress(1, 'encode');

  // Concatenate chunks into a single Uint8Array.
  let totalBytes = 0;
  for (const c of chunks) totalBytes += c.length;
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
