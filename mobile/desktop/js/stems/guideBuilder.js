// Build the "Guide" track from a list of markers. Each marker has a
// section cue (e.g. "Verso 1") and a time-in-seconds. We render every
// cue into a single AudioBuffer at the marker's time, returning that
// buffer for the engine to add as a normal track.
//
// Cue audio is fetched once and cached so flipping markers around stays
// snappy.

const cueCache = new Map(); // url → AudioBuffer

async function loadCueBuffer(ctx, url) {
  if (cueCache.has(url)) return cueCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar la guía: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  cueCache.set(url, buffer);
  return buffer;
}

/**
 * @param {object} opts
 *   markers — array of { id, label, url, atSec }
 *   durationSec — total length of the guide track (matches project length).
 *   sampleRate — engine sample rate to render at.
 */
export async function buildGuideTrack({ markers, durationSec, sampleRate = 44100 }) {
  if (!markers || !markers.length) return null;
  const channels = 1;
  const lengthSamples = Math.ceil(durationSec * sampleRate);
  if (lengthSamples <= 0) return null;

  // Need a real AudioContext to decode the WAVs, then an OfflineAudioContext to render.
  // We do the decode in a throw-away AudioContext to keep things simple.
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Pre-load each unique cue URL.
  const uniqueUrls = Array.from(new Set(markers.map(m => m.url)));
  for (const u of uniqueUrls) {
    await loadCueBuffer(decodeCtx, u);
  }

  const offline = new OfflineAudioContext(channels, lengthSamples, sampleRate);
  for (const m of markers) {
    const cue = cueCache.get(m.url);
    if (!cue) continue;
    const src = offline.createBufferSource();
    src.buffer = cue;
    src.connect(offline.destination);
    const when = Math.max(0, Math.min(durationSec - 0.01, m.atSec));
    src.start(when);
  }
  const rendered = await offline.startRendering();

  // Best-effort cleanup of the throw-away context.
  try { decodeCtx.close(); } catch (e) {}

  return rendered;
}
