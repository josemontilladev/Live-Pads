// ─────────────────────────────────────────────────────────────────────────
// «Desde una grabación» (Caja de ritmos): graba la batería real con el micrófono
// (o sube un audio) y LivePads saca el ritmo:
//   · pulsos y compases (Beat This!, en local; si no está, una estimación propia),
//   · bombo / caja / hi-hat / crash de cada paso (drumTranscribeCore.transcribe),
//   · las secciones y su orden (segment → buildGroove): el ritmo resultante tiene
//     el ARREGLO de la grabación, y la caja puede seguirlo sola compás a compás
//     (para ensayar el día que no hay baterista).
// La grabación se guarda (mp3) con el ritmo para volver a escucharla.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { HOP, transcribe, segment, buildGroove, barStrings, onsetStrength } from './drumTranscribeCore.js';
import { PART_LABEL } from './grooveCore.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const PART_COLORS = { intro: '#60a5fa', A: '#a855f7', D: '#22d3ee', B: '#f43f5e', C: '#fbbf24', E: '#4ade80', fill: '#94a3b8', end: '#2dd4bf', rest: '#64748b' };
const PICK = ['intro', 'A', 'D', 'B', 'C', 'E', 'end', 'rest'];

// ── Audio → envolventes por banda (filtros nativos, rápidos) ───────────────
const BANDS = {
  low: [['lowpass', 120], ['lowpass', 120]],
  mid: [['highpass', 200], ['lowpass', 1500]],
  noise: [['highpass', 2000], ['lowpass', 6000]],
  high: [['highpass', 8000]],
};
async function bandEnvelope(buf, chain) {
  const SR = 32000;
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
  const src = off.createBufferSource(); src.buffer = buf;
  let node = src;
  for (const [type, f] of chain) { const b = off.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 0.707; node.connect(b); node = b; }
  node.connect(off.destination); src.start();
  const d = (await off.startRendering()).getChannelData(0);
  const hop = Math.round(HOP * SR), n = Math.floor(d.length / hop), env = new Float32Array(n);
  for (let f = 0; f < n; f++) { let e = 0; for (let i = f * hop, end = i + hop; i < end; i++) e += d[i] * d[i]; env[f] = 10 * Math.log10(e / hop + 1e-12); }
  return env;
}

// Sin el modelo de pulsos: tempo por autocorrelación de los ataques y fase por los golpes fuertes.
function estimateGrid(odf, duration) {
  const minLag = Math.round(60 / 180 / HOP), maxLag = Math.round(60 / 60 / HOP);
  let best = minLag, bv = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let i = lag; i < odf.length; i++) s += odf[i] * odf[i - lag]; s /= odf.length - lag; if (s > bv) { bv = s; best = lag; } }
  const beat = best * HOP;
  let phase = 0, pv = -Infinity;
  for (let p = 0; p < best; p++) { let s = 0; for (let i = p; i < odf.length; i += best) s += odf[i]; if (s > pv) { pv = s; phase = p; } }
  const beats = []; for (let t = phase * HOP; t < duration; t += beat) beats.push(t);
  return { beats, downbeats: [beats[0]], beatsPerBar: 4, bpm: 60 / beat };
}

/** AudioBuffer de la batería → { bpm, spb, bars, sections, beatsPerBar } */
export async function analyzeDrumAudio(buf, step = () => {}) {
  step(0.05, 'Separando bombo, caja y platos…');
  const features = {};
  const keys = Object.keys(BANDS);
  for (let i = 0; i < keys.length; i++) { features[keys[i]] = await bandEnvelope(buf, BANDS[keys[i]]); step(0.05 + 0.4 * (i + 1) / keys.length, 'Separando bombo, caja y platos…'); }
  step(0.5, 'Buscando el pulso y los compases…');
  let grid = null;
  try {
    const { analyzeBeats } = await import('../analysis/beatGrid.js');
    const r = await analyzeBeats(buf, null);
    if (r && r.beats && r.beats.length > 8) grid = { beats: r.beats, downbeats: r.downbeats, beatsPerBar: r.beatsPerBar || 4, bpm: r.bpm };
  } catch (_) {}
  if (!grid) {
    const all = new Float32Array(features.low.length);
    const o = keys.map((k) => onsetStrength(features[k]));
    for (let f = 0; f < all.length; f++) all[f] = o[0][f] + o[1][f] + o[2][f] + o[3][f];
    grid = estimateGrid(all, buf.duration);
  }
  step(0.8, 'Escribiendo el ritmo de cada compás…');
  const tr = transcribe(features, grid);
  const sections = segment(tr.bars, { spb: tr.spb });
  step(1, '');
  return { bpm: Math.round(grid.bpm || 60 / ((grid.beats[grid.beats.length - 1] - grid.beats[0]) / (grid.beats.length - 1))), beatsPerBar: grid.beatsPerBar || 4, spb: tr.spb, steps: tr.steps, bars: tr.bars, sections };
}

/**
 * Ventana. onCreate({ groove: { parts, arrangement, beats, spb, bpm, name }, buffer, url }) la llama
 * grooveUI para guardar el ritmo con su kit.
 */
export function openDrumFromRecording({ onCreate } = {}) {
  if (document.getElementById('dgr-box')) return;
  const S = { buf: null, res: null, sel: 0, rec: null, stream: null, ctx: null, src: null, playing: false, meterRaf: 0, t0: 0, busy: false };
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box dgr-box" id="dgr-box" role="dialog" aria-modal="true" aria-label="Ritmo desde una grabación">
      <div class="vn-head"><b>Ritmo desde una grabación</b><span>Graba la batería (un groove o la canción entera) y LivePads saca el ritmo: bombo, caja, hi-hat y platos de cada sección, y el orden de la grabación para ensayar sin baterista. Todo en este equipo.</span></div>
      <div class="dgr-src" data-ref="srcRow">
        <button type="button" class="vn-btn vn-btn--primary dgr-rec" data-act="rec"><span class="dgr-dot"></span> Grabar con el micrófono</button>
        <button type="button" class="vn-btn" data-act="file">Subir un audio…</button>
        <input type="file" accept="audio/*" data-ref="file" hidden>
        <span class="dgr-tip">Consejo: el micrófono a unos metros de la batería, y que se oiga solo la batería.</span>
      </div>
      <div class="dgr-recbar" data-ref="recbar" hidden>
        <span class="dgr-time" data-ref="rtime">0:00</span>
        <div class="dgr-meter"><i data-ref="meter"></i></div>
        <button type="button" class="vn-btn vn-btn--primary" data-act="stop">■ Parar y analizar</button>
      </div>
      <div class="mt-progress" data-ref="prog" hidden><div class="vs-bar"><i data-ref="bar"></i></div><small data-ref="step"></small></div>
      <div class="dgr-result" data-ref="result" hidden>
        <div class="dgr-sum" data-ref="sum"></div>
        <div class="dgr-wave" data-ref="wave" title="Clic en una sección: elegirla y escucharla"><canvas data-ref="cv"></canvas></div>
        <div class="dgr-secrow">
          <span class="dgr-seclbl" data-ref="secLbl"></span>
          <div class="ui-seg dgr-parts" role="group" aria-label="Parte del ritmo">${PICK.map((p) => `<button type="button" class="ui-seg-btn" data-part="${p}">${PART_LABEL[p]}</button>`).join('')}</div>
          <button type="button" class="vn-btn" data-act="listen">▶ Escuchar</button>
        </div>
        <pre class="dgr-grid" data-ref="grid" aria-label="Compás detectado de la sección"></pre>
        <label class="dgr-name"><span>Nombre del ritmo</span><input type="text" data-ref="name" maxlength="40"></label>
      </div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cerrar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="create" hidden>Crear el ritmo</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (q) => ov.querySelector(q);
  const step = (f, txt) => { $('[data-ref="prog"]').hidden = !txt; $('[data-ref="bar"]').style.width = `${Math.round(f * 100)}%`; $('[data-ref="step"]').textContent = txt; };
  const ctx = () => (S.ctx || (S.ctx = new AudioContext()));

  // ── Grabar ──
  async function startRec() {
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (_) { window.showToast?.('No se pudo usar el micrófono. Revisa el permiso de micrófono de Windows para LivePads.', 'error'); return; }
    const chunks = [];
    S.rec = new MediaRecorder(S.stream);
    S.rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    S.rec.onstop = async () => {
      S.stream.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(S.meterRaf);
      $('[data-ref="recbar"]').hidden = true;
      const blob = new Blob(chunks, { type: S.rec.mimeType || 'audio/webm' });
      try { await useBuffer(await ctx().decodeAudioData(await blob.arrayBuffer())); } catch (_) { step(0, 'No se pudo leer la grabación.'); $('[data-ref="srcRow"]').hidden = false; }
    };
    const an = ctx().createAnalyser(); an.fftSize = 1024;
    ctx().createMediaStreamSource(S.stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    S.t0 = performance.now();
    const meter = () => {
      an.getFloatTimeDomainData(buf);
      let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v));
      $('[data-ref="meter"]').style.width = `${Math.min(100, Math.round(p * 100))}%`;
      $('[data-ref="meter"]').classList.toggle('is-clip', p > 0.98);
      $('[data-ref="rtime"]').textContent = fmt((performance.now() - S.t0) / 1000);
      S.meterRaf = requestAnimationFrame(meter);
    };
    meter();
    S.rec.start(1000);
    $('[data-ref="srcRow"]').hidden = true;
    $('[data-ref="recbar"]').hidden = false;
  }

  async function useBuffer(buf) {
    if (buf.duration < 4) { step(0, 'La grabación es muy corta: graba al menos 4 compases.'); $('[data-ref="srcRow"]').hidden = false; return; }
    S.buf = buf; S.busy = true;
    $('[data-ref="srcRow"]').hidden = true;
    try {
      S.res = await analyzeDrumAudio(buf, step);
      if (!S.res.bars.length) throw new Error('No se encontró un pulso claro en la grabación.');
      step(0, '');
      S.sel = 0;
      $('[data-ref="name"]').value = `Mi batería (${S.res.bpm} BPM)`;
      $('[data-ref="result"]').hidden = false;
      $('[data-act="create"]').hidden = false;
      paint();
      window.__lpDrumRec = S;
    } catch (e) {
      step(0, String((e && e.message) || e));
      $('[data-ref="srcRow"]').hidden = false;
    } finally { S.busy = false; }
  }

  // ── Resultado ──
  function paint() {
    const r = S.res, secs = r.sections;
    const kinds = new Set(secs.map((s) => s.part));
    $('[data-ref="sum"]').innerHTML = `<b>${r.bpm} BPM</b> · ${r.beatsPerBar}/4${r.spb === 3 ? ' (shuffle)' : ''} · ${r.bars.length} compases · ${secs.length} tramos (${[...kinds].map((k) => PART_LABEL[k]).join(', ')})${secs.some((s) => s.fill) ? ' · con redobles' : ''}`;
    const s = secs[S.sel];
    $('[data-ref="secLbl"]').textContent = s ? `Tramo ${S.sel + 1}: compases ${s.from + 1}-${s.to + 1}${s.fill ? ' (termina con redoble)' : ''}` : '';
    ov.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('is-on', s && b.dataset.part === s.part));
    // Compás detectado (el más típico del tramo)
    if (s) {
      const g = buildGroove(r.bars.slice(s.from, s.to + 1), [{ ...s, from: 0, to: s.to - s.from }], { steps: r.steps });
      const p = g.parts[s.part] || g.parts.A || {};
      const names = { kick: 'Bombo ', snare: 'Caja  ', hhc: 'Hi-hat', crash: 'Crash ' };
      $('[data-ref="grid"]').textContent = Object.entries(names).filter(([v]) => p[v]).map(([v, n]) => `${n} ${p[v].replace(/(.{${r.spb}})/g, '$1 ').trim()}`).join('\n') || '(sin golpes claros)';
    }
    draw();
  }
  function draw() {
    const cv = $('[data-ref="cv"]'), box = $('[data-ref="wave"]');
    const W = box.clientWidth || 600, H = box.clientHeight || 110, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const r = S.res, dur = S.buf.duration, x = (t) => (t / dur) * W;
    r.sections.forEach((s, i) => {
      const a = x(r.bars[s.from].t0), b = x(r.bars[s.to].t1);
      g.fillStyle = PART_COLORS[s.part] || '#888'; g.globalAlpha = i === S.sel ? 0.42 : 0.2; g.fillRect(a, 0, b - a, H);
      g.globalAlpha = 1; g.fillRect(a, 0, 2, H);
      if (s.fill) { const f = x(r.bars[s.to].t0); g.fillStyle = PART_COLORS.fill; g.globalAlpha = 0.45; g.fillRect(f, 0, b - f, H); g.globalAlpha = 1; }
      g.fillStyle = getComputedStyle(ov).getPropertyValue('--text').trim() || '#fff';
      g.font = `${i === S.sel ? 700 : 500} 11px system-ui`;
      // La etiqueta cabe en su tramo (si no, se acorta; en uno muy estrecho, solo la inicial).
      let lbl = PART_LABEL[s.part] || s.part;
      const room = b - a - 8;
      while (lbl.length > 1 && g.measureText(lbl).width > room) lbl = lbl.length > 4 ? lbl.slice(0, -2) + '.' : lbl.slice(0, 1);
      if (room > 6 && g.measureText(lbl).width <= room) g.fillText(lbl.replace(/\.\.$/, '.'), a + 5, 14);
    });
    const d = S.buf.getChannelData(0), per = Math.max(1, Math.floor(d.length / W));
    g.fillStyle = getComputedStyle(ov).getPropertyValue('--text-muted').trim() || '#999'; g.globalAlpha = 0.8;
    for (let px = 0; px < W; px++) { let m = 0; for (let i = px * per, e = Math.min(d.length, i + per); i < e; i += 4) { const v = Math.abs(d[i]); if (v > m) m = v; } const h = Math.min(1, m * 1.4) * (H - 26); g.fillRect(px, 20 + (H - 20 - h) / 2, 1, Math.max(1, h)); }
    g.globalAlpha = 1;
  }
  function listen() {
    stopListen();
    const s = S.res.sections[S.sel]; if (!s) return;
    const t0 = S.res.bars[s.from].t0, t1 = S.res.bars[s.to].t1;
    const src = ctx().createBufferSource(); src.buffer = S.buf; src.connect(ctx().destination);
    src.start(0, t0, t1 - t0); S.src = src; S.playing = true;
    src.onended = () => { if (S.src === src) { S.playing = false; $('[data-act="listen"]').textContent = '▶ Escuchar'; } };
    $('[data-act="listen"]').textContent = '■ Parar';
  }
  function stopListen() { if (S.src) { try { S.src.stop(); } catch (_) {} S.src = null; } S.playing = false; const b = $('[data-act="listen"]'); if (b) b.textContent = '▶ Escuchar'; }

  async function create() {
    const r = S.res;
    const { parts, arrangement } = buildGroove(r.bars, r.sections, { steps: r.steps });
    const name = ($('[data-ref="name"]').value || '').trim() || `Mi batería (${r.bpm} BPM)`;
    // Guardar la grabación (mp3) para volver a escucharla.
    let url = null;
    try {
      const api = window.electronAPI;
      if (api?.saveSongStem) {
        step(0.5, 'Guardando la grabación…');
        const { encodeMp3Async } = await import('../audio/mp3Pool.js');
        const b = S.buf;
        const mp3 = await encodeMp3Async(b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : null, b.sampleRate, 128);
        url = await api.saveSongStem({ buffer: mp3, songSlug: 'grabaciones-de-bateria', name, ext: 'mp3' });
        step(0, '');
      }
    } catch (_) { step(0, ''); }
    const groove = { name, beats: r.beatsPerBar, spb: r.spb, bpm: r.bpm, parts, arrangement, source: url ? { url, duration: Math.round(S.buf.duration * 10) / 10 } : null };
    onCreate && onCreate(groove);
    close(true);
  }

  // ── Eventos ──
  const close = (force) => {
    if (S.rec && S.rec.state === 'recording') { S.rec.onstop = null; S.rec.stop(); S.stream?.getTracks().forEach((t) => t.stop()); }
    cancelAnimationFrame(S.meterRaf); stopListen();
    try { S.ctx && S.ctx.close(); } catch (_) {}
    pop(); ov.remove();
  };
  const pop = pushModal(() => close(), ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const part = e.target.closest('[data-part]')?.dataset.part;
    if (part && S.res) { S.res.sections[S.sel].part = part; paint(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    else if (act === 'rec' && !S.busy) startRec();
    else if (act === 'stop' && S.rec) S.rec.stop();
    else if (act === 'file' && !S.busy) $('[data-ref="file"]').click();
    else if (act === 'listen') (S.playing ? stopListen() : listen());
    else if (act === 'create' && S.res) create();
  });
  $('[data-ref="file"]').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    step(0.02, 'Leyendo el audio…');
    try { await useBuffer(await ctx().decodeAudioData(await f.arrayBuffer())); } catch (_) { step(0, 'No se pudo leer ese archivo de audio.'); }
  });
  $('[data-ref="wave"]').addEventListener('click', (e) => {
    if (!S.res) return;
    const r = $('[data-ref="wave"]').getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * S.buf.duration;
    const i = S.res.sections.findIndex((s) => t >= S.res.bars[s.from].t0 && t <= S.res.bars[s.to].t1);
    if (i >= 0) { S.sel = i; paint(); listen(); }
  });
  new ResizeObserver(() => { if (S.res) draw(); }).observe($('[data-ref="wave"]'));
  window.__lpDrumRecUI = { S, useBuffer, create, paint };
}
