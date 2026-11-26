// ─────────────────────────────────────────────────────────────────────────
// Estudio de voces — sonido de cada voz.
//  · renderSynthVoices(voices, dur): cada línea (melodía, 2.ª, 3.ª) cantada por un
//    «coro» sintético (vocal «o»: dos dientes de sierra + formantes + vibrato), con
//    ligado entre notas. Clara para aprender la nota, sin letra.
//  · buildRealVoice(vocal, lead, harm, shifted): la voz REAL del cantante movida nota
//    a nota al intervalo de la armonía (con letra). `shifted` = { semitonos: AudioBuffer }
//    renderizados con el mismo motor de «Referencia armónica» (stems/harmonyShifter.js).
// ─────────────────────────────────────────────────────────────────────────

import { midiToHz } from './harmonyCore.js';

const SR = 22050;
const FORMANTS = [[450, 6, 1], [820, 8, 0.55], [2830, 12, 0.22]];   // vocal «o» (suave, de coro)

function phrases(notes, gap = 0.12) {
  const out = [];
  let cur = null;
  for (const n of notes) {
    if (!n || n.off) { cur = null; continue; }
    if (cur && n.s - cur[cur.length - 1].e <= gap) cur.push(n);
    else { cur = [n]; out.push(cur); }
  }
  return out;
}

// La «garganta» de una voz: formantes de la vocal «o» + un poco de cuerpo → salida.
function voiceBus(ctx, out) {
  // Nivel medido: así cada voz queda algo por encima de la canción (antes iba ~7 veces más fuerte y saturaba).
  const bus = ctx.createGain(); bus.gain.value = 0.11;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
  const sum = ctx.createGain();
  for (const [f, q, g] of FORMANTS) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const gg = ctx.createGain(); gg.gain.value = g * 3.2;
    sum.connect(bp); bp.connect(gg); gg.connect(lp);
  }
  const body = ctx.createGain(); body.gain.value = 0.18; sum.connect(body); body.connect(lp);
  lp.connect(bus); bus.connect(out);
  return sum;
}

/**
 * Una frase cantada (notas ligadas) en el contexto: offset = tiempo del contexto
 * cuando la canción está en 0; from = desde dónde de la canción empieza a sonar (si la
 * reproducción arranca a mitad de frase). Devuelve los nodos que hay que parar.
 */
function phraseNodes(ctx, input, ph, { offset = 0, from = -Infinity, semis = 0 } = {}) {
  const start = Math.max(ph[0].s, from), end = ph[ph.length - 1].e;
  if (end <= start + 0.02) return [];
  const T = (x) => Math.max(0, x + offset);
  const env = ctx.createGain(); env.gain.value = 0;
  env.connect(input);
  const oscs = [0, 7].map((det) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.connect(env); return o; });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
  const depth = ctx.createGain(); depth.gain.value = 0;
  lfo.connect(depth); oscs.forEach((o) => depth.connect(o.detune));
  let prev = null;
  for (const n of ph) {
    if (n.e <= start) continue;
    const f = midiToHz(n.m + semis);
    for (const o of oscs) {
      if (prev == null) o.frequency.setValueAtTime(f, T(start));
      else { o.frequency.setValueAtTime(prev, T(Math.max(start, n.s - 0.001))); o.frequency.exponentialRampToValueAtTime(f, T(Math.max(start, n.s) + 0.05)); }
    }
    if (n.e - n.s > 0.45 && n.s + 0.2 > start) { depth.gain.setValueAtTime(0, T(n.s + 0.2)); depth.gain.linearRampToValueAtTime(14, T(n.s + 0.45)); depth.gain.setValueAtTime(14, T(n.e - 0.02)); depth.gain.linearRampToValueAtTime(0, T(n.e)); }
    prev = f;
  }
  env.gain.setValueAtTime(0, T(start));
  env.gain.linearRampToValueAtTime(1, T(start + 0.045));
  env.gain.setValueAtTime(1, T(Math.max(start + 0.05, end - 0.08)));
  env.gain.linearRampToValueAtTime(0, T(end + 0.02));
  for (const o of oscs) { o.start(T(start)); o.stop(T(end + 0.05)); }
  lfo.start(T(start)); lfo.stop(T(end + 0.05));
  return [...oscs, lfo, env];
}

/** voices: [[notas], …] → AudioBuffer[] (una por voz), a 22 kHz. Para guardar en archivo. */
export async function renderSynthVoices(voices, dur, { semis = 0 } = {}) {
  const len = Math.max(1, Math.ceil((dur + 0.5) * SR));
  const ctx = new OfflineAudioContext(voices.length, len, SR);
  const merger = ctx.createChannelMerger(voices.length);
  merger.connect(ctx.destination);
  voices.forEach((notes, vi) => {
    const g = ctx.createGain(); g.connect(merger, 0, vi);
    const input = voiceBus(ctx, g);
    for (const ph of phrases(notes)) phraseNodes(ctx, input, ph, { semis });
  });
  const out = await ctx.startRendering();
  return voices.map((_, vi) => {
    const b = new AudioBuffer({ length: out.length, numberOfChannels: 1, sampleRate: SR });
    b.copyToChannel(out.getChannelData(vi), 0);
    return b;
  });
}

/**
 * Coro en vivo: canta las voces mientras suena, sin preparar nada antes (programa
 * cada frase poco antes de que llegue). Una salida (GainNode) por voz para el volumen.
 *   const ch = createLiveChoir(ctx, ['lead', 'v2', 'v3']);
 *   ch.outputs.v2.connect(ctx.destination);
 *   ch.play(songTime, getNotes(id), semis) · ch.stop()
 */
export function createLiveChoir(ctx, ids) {
  const outputs = {}, inputs = {};
  for (const id of ids) { outputs[id] = ctx.createGain(); inputs[id] = voiceBus(ctx, outputs[id]); }
  let live = [], timer = 0, state = null;
  const LOOK = 1.5;
  function pump() {
    if (!state) return;
    const songNow = ctx.currentTime - state.offset;
    for (const id of ids) {
      const list = state.phrases[id];
      let i = state.next[id];
      while (i < list.length && list[i][0].s < songNow + LOOK) {
        const ph = list[i];
        if (ph[ph.length - 1].e > state.from) live.push(...phraseNodes(ctx, inputs[id], ph, { offset: state.offset, from: state.from, semis: state.semis }));
        i++;
      }
      state.next[id] = i;
    }
    // Lo que ya terminó se suelta (para no acumular nodos en canciones largas).
    if (live.length > 400) live = live.filter((n) => !n._done);
  }
  function stop() {
    clearInterval(timer); timer = 0; state = null;
    const t = ctx.currentTime;
    for (const n of live) { try { if (n.stop) n.stop(t + 0.02); else if (n.gain) { n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(0, t, 0.01); } } catch (_) {} }
    live = [];
  }
  function play(from, notesById, semis = 0) {
    stop();
    const ph = {}, next = {};
    for (const id of ids) {
      ph[id] = phrases(notesById[id] || []);
      next[id] = ph[id].findIndex((p) => p[p.length - 1].e > from);
      if (next[id] < 0) next[id] = ph[id].length;
    }
    state = { from, offset: ctx.currentTime - from, phrases: ph, next, semis };
    pump();
    timer = setInterval(pump, 250);
  }
  return { outputs, play, stop, get playing() { return !!state; } };
}

/**
 * Voz real armonizada: para cada nota de la melodía, el trozo de la voz desplazado
 * los semitonos que separan la armonía de la melodía (con fundidos de 15 ms).
 * vocal: AudioBuffer de la voz separada; lead y harm alineadas nota a nota.
 */
export function buildRealVoice(vocal, lead, harm, shifted) {
  const sr = vocal.sampleRate, ch = Math.min(2, vocal.numberOfChannels);
  const out = new AudioBuffer({ length: vocal.length, numberOfChannels: ch, sampleRate: sr });
  const fade = Math.round(0.015 * sr);
  for (let i = 0; i < lead.length; i++) {
    const h = harm[i];
    if (!h || h.off) continue;
    const src = shifted[h.m - lead[i].m];
    if (!src) continue;
    // Un poco antes y después de la nota (consonantes y final de la sílaba).
    const a = Math.max(0, Math.round((lead[i].s - 0.04) * sr)), b = Math.min(vocal.length, Math.round((lead[i].e + 0.05) * sr));
    for (let c = 0; c < ch; c++) {
      const s = src.getChannelData(Math.min(c, src.numberOfChannels - 1)), d = out.getChannelData(c);
      for (let k = a; k < b && k < s.length; k++) {
        const w = Math.min(1, (k - a) / fade, (b - k) / fade);
        d[k] += s[k] * w;
      }
    }
  }
  return out;
}

/**
 * Voz real, rápida: para cada intervalo solo se procesan los trozos de la voz que lo
 * usan (juntos en un búfer corto), no la canción entera. Con 6-8 intervalos distintos,
 * el trabajo total queda en torno a una sola pasada.
 *   shiftFn(buffer, semitonos, { onProgress }) → AudioBuffer (stems/harmonyShifter.js)
 * → { v2: AudioBuffer, v3: AudioBuffer }
 */
export async function realVoicesFast(vocal, lead, voices, shiftFn, onProgress) {
  const sr = vocal.sampleRate, ch = Math.min(2, vocal.numberOfChannels), PAD = Math.round(0.25 * sr), fade = Math.round(0.015 * sr);
  const outs = voices.map(() => new AudioBuffer({ length: vocal.length, numberOfChannels: ch, sampleRate: sr }));
  // Trozos por intervalo: [{ a, b }] de la voz (nota ± margen), con qué voz y nota.
  const byShift = new Map();
  voices.forEach((list, vi) => list.forEach((h, i) => {
    if (!h || h.off || !lead[i]) return;
    const s = h.m - lead[i].m;
    if (Math.abs(s) > 12) return;
    const a = Math.max(0, Math.round((lead[i].s - 0.04) * sr)), b = Math.min(vocal.length, Math.round((lead[i].e + 0.05) * sr));
    if (b <= a) return;
    if (!byShift.has(s)) byShift.set(s, []);
    byShift.get(s).push({ a, b, vi });
  }));
  const shifts = [...byShift.keys()];
  // Mezcla un trozo (con fundidos) en la voz de salida.
  const put = (vi, src, srcOff, a, b) => {
    for (let c = 0; c < ch; c++) {
      const s = src.getChannelData(Math.min(c, src.numberOfChannels - 1)), d = outs[vi].getChannelData(c);
      for (let k = a; k < b; k++) {
        const j = srcOff + (k - a);
        if (j < 0 || j >= s.length) continue;
        const w = Math.min(1, (k - a) / fade, (b - k) / fade);
        d[k] += s[j] * w;
      }
    }
  };
  for (let si = 0; si < shifts.length; si++) {
    const s = shifts[si];
    const segs = byShift.get(s).slice().sort((x, y) => x.a - y.a);
    if (s === 0) { for (const g of segs) put(g.vi, vocal, g.a, g.a, g.b); continue; }
    // Regiones (trozos que se tocan o están cerca se unen) → búfer compacto con márgenes.
    const regions = [];
    for (const g of segs) {
      const r = regions[regions.length - 1];
      if (r && g.a - PAD <= r.b + PAD) r.b = Math.max(r.b, g.b); else regions.push({ a: g.a, b: g.b });
    }
    let len = 0;
    for (const r of regions) { r.ca = Math.max(0, r.a - PAD); r.cb = Math.min(vocal.length, r.b + PAD); r.off = len; len += r.cb - r.ca; }
    const compact = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: ch, sampleRate: sr });
    for (let c = 0; c < ch; c++) {
      const src = vocal.getChannelData(Math.min(c, vocal.numberOfChannels - 1)), d = compact.getChannelData(c);
      for (const r of regions) d.set(src.subarray(r.ca, r.cb), r.off);
    }
    const shifted = await shiftFn(compact, s, { onProgress: (p) => onProgress && onProgress((si + p) / shifts.length, si + 1, shifts.length) });
    for (const g of segs) {
      const r = regions.find((x) => x.ca <= g.a && g.b <= x.cb);
      if (r) put(g.vi, shifted, r.off + (g.a - r.ca), g.a, g.b);
    }
    if (onProgress) onProgress((si + 1) / shifts.length, si + 1, shifts.length);
  }
  return { v2: outs[0], v3: outs[1] };
}

/** Semitonos distintos que hacen falta (armonía − melodía) para la voz real. */
export function neededShifts(lead, voices) {
  const set = new Set();
  for (const v of voices) v.forEach((h, i) => { if (h && !h.off && lead[i]) set.add(h.m - lead[i].m); });
  set.delete(0);
  return [...set].filter((s) => Math.abs(s) <= 12).sort((a, b) => a - b);
}
