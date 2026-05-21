// Generate a click track AudioBuffer from BPM + time signature using the
// SAME real click samples as the Pads metronome (assets/Click Tracks).
// Accent sample on beat 1 of each bar, normal sample on beats 2..N. The
// result is a normal AudioBuffer that plays through the same engine graph
// as any imported stem. Falls back to a synthesized beep if the sample
// files can't be loaded.

const SAMPLE_RATE = 44100;

// Real click sample pairs — identical to SynthEngine.CLICK_FILE_MAP so the
// stems click sounds exactly match the Pads metronome. The double space in
// the base path is intentional (matches the file names on disk).
const CLICK_BASE = 'assets/Click Tracks/New Click -  ';
const CLICK_FILE_MAP = {
  classic:    { accent: `${CLICK_BASE}Classic-accents.mp3`,    normal: `${CLICK_BASE}Classic-quarter.mp3` },
  woodblock:  { accent: `${CLICK_BASE}Woodblock-accents.mp3`,  normal: `${CLICK_BASE}Woodblock-quarter.mp3` },
  percussive: { accent: `${CLICK_BASE}Percussive-accents.mp3`, normal: `${CLICK_BASE}Percussive-quarter.mp3` },
  gentle:     { accent: `${CLICK_BASE}Gentle-accents.mp3`,     normal: `${CLICK_BASE}Gentle-quarter.mp3` },
  blip:       { accent: `${CLICK_BASE}Blip-accents.mp3`,       normal: `${CLICK_BASE}Blip-quarter.mp3` },
  digital:    { accent: `${CLICK_BASE}Digital-accents.mp3`,    normal: `${CLICK_BASE}Digital-sixteenth.mp3` },
  cowbell:    { accent: `${CLICK_BASE}Cowbell-accents.mp3`,    normal: `${CLICK_BASE}Cowbell-quarter.mp3` },
};

const CLICK_LABELS = {
  classic:    'Clásico',
  woodblock:  'Woodblock',
  percussive: 'Percus.',
  gentle:     'Suave',
  blip:       'Blip',
  digital:    'Digital',
  cowbell:    'Cowbell',
};

export function getClickSounds() {
  return Object.keys(CLICK_FILE_MAP).map(id => ({ id, label: CLICK_LABELS[id] }));
}

// Decoded-sample cache keyed by file path. Buffers are bound to the context
// that decoded them; since we always pass the live engine AudioContext this
// stays valid across regenerations.
const _sampleCache = new Map();
async function decodeSample(ctx, path) {
  if (_sampleCache.has(path)) return _sampleCache.get(path);
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const ab = await resp.arrayBuffer();
  const buf = await ctx.decodeAudioData(ab);
  _sampleCache.set(path, buf);
  return buf;
}

/**
 * @param {object} opts
 *   bpm — beats per minute (number).
 *   beatsPerBar — top of the time signature (e.g. 4 in 4/4).
 *   durationSec — total length of the click track to generate.
 *   ctx — AudioContext to decode samples and inherit sampleRate from.
 *   sound — one of the keys in CLICK_FILE_MAP (default 'cowbell').
 */
export async function generateClickTrack({ bpm, beatsPerBar, durationSec, ctx, sound = 'cowbell', accentBeatOffset = 0 } = {}) {
  const map = CLICK_FILE_MAP[sound] || CLICK_FILE_MAP.cowbell;
  const audioCtx = ctx || new OfflineAudioContext(2, Math.ceil(durationSec * SAMPLE_RATE), SAMPLE_RATE);
  const sampleRate = audioCtx.sampleRate;

  let accentBuf, normalBuf;
  try {
    [accentBuf, normalBuf] = await Promise.all([
      decodeSample(audioCtx, map.accent),
      decodeSample(audioCtx, map.normal),
    ]);
  } catch (e) {
    console.warn('Click samples not loaded, using synth fallback:', e.message);
    return synthClick({ bpm, beatsPerBar, durationSec, sampleRate, audioCtx, accentBeatOffset });
  }

  const channels = Math.max(accentBuf.numberOfChannels, normalBuf.numberOfChannels, 1);
  const length = Math.ceil(durationSec * sampleRate);
  const out = audioCtx.createBuffer(channels, length, sampleRate);

  const beatIntervalSec = 60 / bpm;
  const beats = Math.floor(durationSec / beatIntervalSec) + 1;

  for (let b = 0; b < beats; b++) {
    const startIdx = Math.floor(b * beatIntervalSec * sampleRate);
    if (startIdx >= length) break;
    const src = (((b + accentBeatOffset) % beatsPerBar) === 0) ? accentBuf : normalBuf;
    for (let ch = 0; ch < channels; ch++) {
      const dst = out.getChannelData(ch);
      const srcData = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
      const n = Math.min(srcData.length, length - startIdx);
      for (let s = 0; s < n; s++) dst[startIdx + s] += srcData[s];
    }
  }
  return out;
}

// Synthesized beep fallback (used only if the real samples fail to load).
function synthClick({ bpm, beatsPerBar, durationSec, sampleRate, audioCtx, accentBeatOffset = 0 }) {
  const length = Math.ceil(durationSec * sampleRate);
  const buffer = (audioCtx || new OfflineAudioContext(1, length, sampleRate)).createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const beatIntervalSec = 60 / bpm;
  const beats = Math.floor(durationSec / beatIntervalSec) + 1;
  const clickSamples = Math.floor(0.025 * sampleRate);
  const envSamples = Math.floor(0.004 * sampleRate);

  for (let b = 0; b < beats; b++) {
    const startIdx = Math.floor(b * beatIntervalSec * sampleRate);
    if (startIdx >= length) break;
    const isAccent = (((b + accentBeatOffset) % beatsPerBar) === 0);
    const freq = isAccent ? 1500 : 1000;
    const amp = isAccent ? 0.85 : 0.55;
    for (let s = 0; s < clickSamples; s++) {
      const idx = startIdx + s;
      if (idx >= length) break;
      let env = 1;
      if (s < envSamples) env = s / envSamples;
      else if (s > clickSamples - envSamples) env = (clickSamples - s) / envSamples;
      data[idx] = Math.sin(2 * Math.PI * freq * s / sampleRate) * amp * env;
    }
  }
  return buffer;
}

// Convert an AudioBuffer back to a WAV ArrayBuffer so we can hand it to
// the engine's addTrack path (which decodes ArrayBuffers) and persist it
// to disk like any other stem. PCM 16-bit, supports mono or stereo.
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);    // fmt chunk size
  view.setUint16(20, 1, true);     // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);    // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and clamp.
  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, v < 0 ? v * 32768 : v * 32767, true);
      offset += 2;
    }
  }
  return buf;
}
