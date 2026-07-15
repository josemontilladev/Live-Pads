// ─────────────────────────────────────────────────────────────────────────
// Metrónomo con scheduler de lookahead (el patrón clásico de Web Audio: un
// setInterval corto encola clicks con precisión de muestra en el futuro).
// Click sintetizado FUERTE (el equipo toca en vivo: tiene que oírse) y con
// PANEO propio — el truco de iglesia: música a un lado, click al otro.
// ─────────────────────────────────────────────────────────────────────────

import { audioCtx } from './audio.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

let timer = null;
let running = false;
let bpm = 120;
let beatsPerBar = 4;
let subdivision = 1;   // 1x o 2x (golpes por pulso)
let nextNoteTime = 0;
let stepInBar = 0;     // paso actual (0 … beatsPerBar*subdivision-1)
let volume = 1;
let panValue = 0;
let out = null; // gain → pan → destination
let onBeat = null; // cb(beatInBar) para pintar los puntos

function ensureOut() {
  const c = audioCtx();
  if (!out) {
    const gain = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { gain.connect(pan); pan.connect(c.destination); }
    else gain.connect(c.destination);
    out = { gain, pan };
  }
  out.gain.gain.value = volume;
  if (out.pan) out.pan.pan.value = panValue;
  return out;
}

// Sample de COWBELL real de LivePads (el mismo audio), no sintetizado.
// Se cargan una vez y se disparan por beat (acento = tiempo 1).
const clickBuffers = { accent: null, normal: null };
let clickLoading = null;
async function ensureClickBuffers() {
  if (clickBuffers.accent && clickBuffers.normal) return true;
  if (clickLoading) return clickLoading;
  const c = audioCtx();
  const load = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('click ' + res.status);
    return c.decodeAudioData(await res.arrayBuffer());
  };
  clickLoading = Promise.all([
    load('assets/click/cowbell-accent.mp3'),
    load('assets/click/cowbell.mp3'),
  ]).then(([a, n]) => { clickBuffers.accent = a; clickBuffers.normal = n; return true; })
    .catch(() => false)
    .finally(() => { clickLoading = null; });
  return clickLoading;
}

// Reproduce el click en `time`. accent = tiempo 1; mainBeat = pulso principal
// (las subdivisiones "y" del 2x suenan más flojas).
function click(time, accent, mainBeat = true) {
  const c = audioCtx();
  const dest = ensureOut().gain;
  const buf = accent ? clickBuffers.accent : clickBuffers.normal;
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    // Acento fuerte / pulso normal / subdivisión floja.
    g.gain.value = accent ? 1.5 : (mainBeat ? 1.2 : 0.55);
    src.connect(g); g.connect(dest);
    src.start(time);
    return;
  }
  // Fallback limpio (sine corto) mientras carga el sample.
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.value = accent ? 2000 : (mainBeat ? 1500 : 1200);
  const g = c.createGain();
  g.gain.setValueAtTime(accent ? 0.9 : (mainBeat ? 0.6 : 0.3), time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
  o.connect(g); g.connect(dest);
  o.start(time); o.stop(time + 0.04);
}

function scheduler() {
  const c = audioCtx();
  const totalSteps = beatsPerBar * subdivision;
  while (nextNoteTime < c.currentTime + SCHEDULE_AHEAD_S) {
    const isMainBeat = stepInBar % subdivision === 0;
    const accent = stepInBar === 0;          // tiempo 1 = acento fuerte
    // En subdivisiones (2x) el "y" suena más flojo que el pulso principal.
    click(nextNoteTime, accent, isMainBeat);
    if (onBeat && isMainBeat) {
      const beatNow = Math.floor(stepInBar / subdivision);
      const at = nextNoteTime;
      const delay = Math.max(0, (at - c.currentTime) * 1000);
      setTimeout(() => { if (running) onBeat(beatNow); }, delay);
    }
    nextNoteTime += 60 / bpm / subdivision;
    stepInBar = (stepInBar + 1) % totalSteps;
  }
}

export function metroRunning() { return running; }

export function startMetronome(newBpm, timeSig, beatCb) {
  ensureClickBuffers(); // carga el sample real (best-effort, no bloquea)
  if (newBpm) bpm = Math.max(30, Math.min(300, Number(newBpm) || 120));
  beatsPerBar = parseInt(String(timeSig || '4/4').split('/')[0], 10) || 4;
  onBeat = beatCb || null;
  const c = audioCtx();
  nextNoteTime = c.currentTime + 0.08;
  stepInBar = 0;
  running = true;
  if (timer) clearInterval(timer);
  timer = setInterval(scheduler, LOOKAHEAD_MS);
}

export function stopMetronome() {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
}

export function setMetroBpm(v) { bpm = Math.max(30, Math.min(300, Number(v) || bpm)); }
export function setMetroVolume(v) { volume = v; if (out) out.gain.gain.value = v; }
export function setMetroPan(p) { panValue = p; if (out && out.pan) out.pan.pan.value = p; }
export function setMetroTimeSig(sig) { beatsPerBar = parseInt(String(sig || '4/4').split('/')[0], 10) || 4; }
export function setMetroSubdivision(n) { subdivision = Number(n) === 2 ? 2 : 1; }
