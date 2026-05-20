// Generate a click track AudioBuffer from BPM + time signature.
// Accent on beat 1 of each bar (higher pitch + slightly louder),
// regular click on beats 2..N. The result is a normal AudioBuffer that
// plays through the same engine graph as any imported stem.

const SAMPLE_RATE = 44100;

/**
 * Available click sounds. Each maps to a renderClick(buf, idx, beatInBar)
 * that writes a short transient at the given sample index.
 */
const SOUND_PRESETS = {
  beep:       { name: 'Beep clásico',  freqAccent: 1500, freqBeat: 1000, ms: 25,  envMs: 4,  type: 'sine'     },
  woodblock:  { name: 'Woodblock',     freqAccent: 1200, freqBeat: 800,  ms: 32,  envMs: 6,  type: 'triangle' },
  digital:    { name: 'Digital',       freqAccent: 2400, freqBeat: 1800, ms: 18,  envMs: 2,  type: 'square'   },
  soft:       { name: 'Suave',         freqAccent: 900,  freqBeat: 650,  ms: 60,  envMs: 18, type: 'sine'     },
  percussive: { name: 'Percusivo',     freqAccent: 0,    freqBeat: 0,    ms: 30,  envMs: 6,  type: 'noise'    }
};

export function getClickSounds() {
  return Object.entries(SOUND_PRESETS).map(([id, p]) => ({ id, label: p.name }));
}

/**
 * @param {object} opts
 *   bpm — beats per minute (number).
 *   beatsPerBar — top of the time signature (e.g. 4 in 4/4).
 *   durationSec — total length of the click track to generate.
 *   ctx — optional AudioContext to inherit sampleRate from.
 */
export function generateClickTrack({ bpm, beatsPerBar, durationSec, ctx, sound = 'beep' } = {}) {
  const preset = SOUND_PRESETS[sound] || SOUND_PRESETS.beep;
  const sampleRate = ctx?.sampleRate || SAMPLE_RATE;
  const channels = 1;
  const buffer = (ctx || new OfflineAudioContext(channels, Math.ceil(durationSec * sampleRate), sampleRate))
    .createBuffer(channels, Math.ceil(durationSec * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);

  const beatIntervalSec = 60 / bpm;
  const beats = Math.floor(durationSec / beatIntervalSec) + 1;
  const clickSamples = Math.floor((preset.ms / 1000) * sampleRate);
  const envSamples = Math.floor((preset.envMs / 1000) * sampleRate);

  for (let b = 0; b < beats; b++) {
    const startSec = b * beatIntervalSec;
    const startIdx = Math.floor(startSec * sampleRate);
    if (startIdx >= data.length) break;

    const beatInBar = b % beatsPerBar;
    const isAccent = beatInBar === 0;
    const freq = isAccent ? preset.freqAccent : preset.freqBeat;
    const amp  = isAccent ? 0.85 : 0.55;

    for (let s = 0; s < clickSamples; s++) {
      const idx = startIdx + s;
      if (idx >= data.length) break;
      let env = 1;
      if (s < envSamples) env = s / envSamples;
      else if (s > clickSamples - envSamples) env = (clickSamples - s) / envSamples;

      let sample = 0;
      if (preset.type === 'sine')     sample = Math.sin(2 * Math.PI * freq * s / sampleRate);
      else if (preset.type === 'triangle') {
        const phase = (freq * s / sampleRate) % 1;
        sample = 2 * Math.abs(2 * phase - 1) - 1;
      } else if (preset.type === 'square') {
        sample = ((freq * s / sampleRate) % 1) < 0.5 ? 1 : -1;
      } else if (preset.type === 'noise') {
        sample = (Math.random() * 2 - 1);
      }
      data[idx] = sample * amp * env;
    }
  }
  return buffer;
}

// Convert an AudioBuffer back to a WAV ArrayBuffer so we can hand it to
// the engine's addTrack path (which decodes ArrayBuffers) and persist it
// to disk like any other stem. PCM 16-bit, mono.
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
