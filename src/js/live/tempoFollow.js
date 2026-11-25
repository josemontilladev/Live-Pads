// ─────────────────────────────────────────────────────────────────────────
// Click que sigue al baterista. Botón «SEGUIR» junto a TAP en el metrónomo.
// Con el metrónomo sonando, escucha la batería por el micrófono y:
//   · ajusta el BPM poco a poco al tempo real (solo ±12 % del de la canción,
//     así nunca salta al doble o a la mitad);
//   · corrige la fase unos milisegundos para que el click caiga con los golpes.
// Límites: necesita un micrófono que oiga la batería (mejor uno cerca del bombo
// o la caja, o una salida de la mesa) y que el click NO salga por los altavoces
// (in-ears), si no el micrófono se oye a sí mismo. Con secuencia sonando no se
// usa: la secuencia manda.
// ─────────────────────────────────────────────────────────────────────────

import { OnsetPicker, estimateTempo, smoothBpm, phaseError, phaseNudge } from './tempoFollowCore.js';

const WORKLET = `
class LpOnset extends AudioWorkletProcessor {
  constructor() { super(); this.lp = 0; this.prev = 0; this.eL = 0; this.eH = 0; this.n = 0; this.pL = 0; this.pH = 0; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      this.lp += 0.02 * (v - this.lp);            // graves (bombo)
      const hf = v - this.prev; this.prev = v;    // agudos (caja, platos)
      this.eL += this.lp * this.lp; this.eH += hf * hf;
    }
    this.n += x.length;
    if (this.n >= 256) {
      const L = Math.log10(1e-9 + this.eL / this.n), H = Math.log10(1e-9 + this.eH / this.n);
      const f = Math.max(0, L - this.pL) + Math.max(0, H - this.pH);
      this.pL = L; this.pH = H;
      this.port.postMessage({ t: currentTime, f, lvl: this.eH / this.n });
      this.eL = this.eH = 0; this.n = 0;
    }
    return true;
  }
}
registerProcessor('lp-onset', LpOnset);`;

let deps = { getEngine: () => null, getMetro: () => null, applyBpm: () => {} };
let st = null; // { stream, src, node, picker, onsets, errs, base, bpm, timer }

function btn() { return document.getElementById('metro-follow'); }
function paint(text) {
  const b = btn();
  if (!b) return;
  b.classList.toggle('is-on', !!st);
  b.title = text || (st ? 'Siguiendo a la batería… (pulsa para parar)' : 'El click sigue al baterista: escucha la batería por el micrófono y ajusta el tempo y el pulso');
}

export async function startTempoFollow() {
  if (st) return;
  const engine = deps.getEngine(), metro = deps.getMetro();
  if (!engine || !engine.ctx || !metro) return;
  if (!metro.running) { window.showToast?.('Primero arranca el metrónomo: luego el click seguirá al baterista.', 'info'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } });
  } catch (_) { window.showToast?.('No se pudo abrir el micrófono.', 'error'); return; }
  const ctx = engine.ctx;
  try {
    if (!ctx.__lpOnset) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      ctx.__lpOnset = true;
    }
  } catch (_) { stream.getTracks().forEach((t) => t.stop()); window.showToast?.('Este equipo no permite analizar el micrófono en vivo.', 'error'); return; }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'lp-onset');
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  // Retardo del sistema: el click suena tarde (salida) y el golpe llega tarde (entrada).
  const lat = (ctx.outputLatency || ctx.baseLatency || 0.01) + 0.012;
  st = { stream, src, node, mute, picker: new OnsetPicker(), onsets: [], errs: [], base: metro.bpm, bpm: metro.bpm, quietSince: 0 };
  node.port.onmessage = (e) => {
    const S = st;
    if (!S) return;
    const { t, f, lvl } = e.data;
    if (lvl < 1e-6) return; // silencio
    if (!S.picker.push(t, f)) return;
    const hit = t - lat;
    S.onsets.push(hit);
    while (S.onsets.length && S.onsets[0] < hit - 10) S.onsets.shift();
    const m = deps.getMetro();
    if (!m || !m.running) return;
    const interval = 60 / (m.bpm * (m.multiplier || 1) * (m.tempoScale || 1));
    S.errs.push(phaseError(hit, m._nextNoteTime, interval));
    if (S.errs.length > 6) S.errs.shift();
  };
  st.timer = setInterval(tick, 1000);
  paint();
  window.showToast?.('El click sigue al baterista. Usa in-ears: si el click sale por altavoces, el micrófono lo oye.', 'info');
}

function tick() {
  const S = st, m = deps.getMetro(), ctx = deps.getEngine()?.ctx;
  if (!S || !m || !ctx) return;
  if (!m.running) { stopTempoFollow(); return; }
  const est = estimateTempo(S.onsets, S.base, { now: ctx.currentTime });
  if (est) {
    S.bpm = smoothBpm(S.bpm, est.bpm);
    const r = Math.round(S.bpm);
    if (r !== m.bpm) deps.applyBpm(r);
    paint(`Siguiendo a la batería · ${est.bpm.toFixed(1)} BPM (pulsa para parar)`);
  } else paint('Escuchando la batería… (pulsa para parar)');
  const interval = 60 / (m.bpm * (m.multiplier || 1) * (m.tempoScale || 1));
  const n = phaseNudge(S.errs, interval);
  if (n && typeof m.nudge === 'function') { m.nudge(n); S.errs = []; }
}

export function stopTempoFollow() {
  const S = st;
  if (!S) return;
  st = null;
  clearInterval(S.timer);
  try { S.node.port.onmessage = null; S.src.disconnect(); S.node.disconnect(); S.mute.disconnect(); } catch (_) {}
  S.stream.getTracks().forEach((t) => t.stop());
  paint();
}

export function initTempoFollow(d) {
  deps = { ...deps, ...d };
  const b = btn();
  if (!b) return;
  b.addEventListener('click', () => { if (st) stopTempoFollow(); else startTempoFollow(); });
  paint();
}
