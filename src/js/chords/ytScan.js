// ─────────────────────────────────────────────────────────────────────────
// Acordes de un video de YouTube en LivePads (sin descargar nada):
//  · El video suena en el reproductor oficial (la página player.html de GI en
//    un iframe; habla con nosotros por postMessage: «gi:…» de ida, «gi-cmd:…»
//    de vuelta).
//  · Para escanearlo se escucha el SONIDO DEL PC (loopback de Windows, sin
//    micrófono): cada trozo se guarda en el segundo del video al que
//    corresponde. Al terminar se analiza con el mismo motor (en el Worker).
// ─────────────────────────────────────────────────────────────────────────

import { CHORD_SR, makeResampler } from './chordEngine.js';

export const PLAYER_PAGE = 'https://gi-setlist.vercel.app/app/player.html';

/** Id de 11 caracteres de un enlace de YouTube (watch, youtu.be, shorts, embed, live) o null. */
export function youtubeId(url) {
  const s = String(url || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Título del video (oEmbed público); '' si no se puede. */
export async function youtubeTitle(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`);
    if (!r.ok) return '';
    return String((await r.json()).title || '');
  } catch (_) { return ''; }
}

/** Reproductor controlable. onChange() se llama cuando cambia el estado. */
export function createYtPlayer(container, id, onChange) {
  const frame = document.createElement('iframe');
  frame.src = `${PLAYER_PAGE}?v=${id}&api=1`;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.className = 'chd-ytframe';
  container.appendChild(frame);
  const st = { ready: false, playing: false, ended: false, duration: 0, error: '', t: 0, at: performance.now() };
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || typeof e.data !== 'string' || !e.data.startsWith('gi:')) return;
    const m = e.data.slice(3);
    if (m === 'loaded') { st.ready = true; onChange && onChange(); return; }
    if (m[0] !== '{') return;
    try {
      const j = JSON.parse(m);
      if (j.err != null) { st.error = `YouTube no permite reproducir este video aquí (${j.err}).`; onChange && onChange(); return; }
      const was = st.playing, wasReady = st.ready;
      st.ready = true;
      st.playing = j.s === 1; st.ended = j.s === 0;
      if (j.d > 0) st.duration = j.d;
      // Tras un salto, el reproductor puede avisar la posición vieja un momento
      if (performance.now() - (st.seekAt || 0) < 1200 && Math.abs(j.t - st.t) > 1) { if (was !== st.playing) onChange && onChange(); return; }
      st.t = j.t; st.at = performance.now();
      if (was !== st.playing || !wasReady) onChange && onChange();
    } catch (_) {}
  };
  window.addEventListener('message', onMsg);
  const send = (cmd, v = 0) => { try { frame.contentWindow.postMessage(`gi-cmd:${cmd}:${v}`, '*'); } catch (_) {} };
  return {
    state: st,
    /** Segundo actual (entre avisos avanza con el reloj, para que todo se mueva fluido). */
    now() { return st.playing ? st.t + Math.min(0.6, (performance.now() - st.at) / 1000) : st.t; },
    play() { send('play'); },
    pause() { send('pause'); },
    seek(s) {
      const v = Math.max(0, st.duration ? Math.min(st.duration, s) : s);
      st.t = v; st.at = performance.now(); st.seekAt = st.at;
      send('seek', v);
    },
    destroy() { window.removeEventListener('message', onMsg); frame.remove(); },
  };
}

/** Escucha el sonido del PC (loopback). onChunk(Float32Array mono 11 025 Hz, nivel 0..1). */
export async function startLoopback(onChunk) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach(t => t.stop()); // solo el audio
  const track = stream.getAudioTracks()[0];
  if (!track) { stream.getTracks().forEach(t => t.stop()); throw new Error('Windows no entregó el sonido del PC.'); }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const proc = ctx.createScriptProcessor(4096, 2, 1);
  const mute = ctx.createGain(); mute.gain.value = 0; // nada vuelve a los altavoces
  const resample = makeResampler(ctx.sampleRate);
  const tmp = [];
  proc.onaudioprocess = (e) => {
    const ib = e.inputBuffer, n = ib.length, ch = ib.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = ib.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    let sq = 0; for (let i = 0; i < n; i += 4) sq += mono[i] * mono[i];
    tmp.length = 0; resample(mono, tmp);
    onChunk(Float32Array.from(tmp), Math.sqrt(sq / (n / 4)));
  };
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  return () => {
    try { proc.onaudioprocess = null; src.disconnect(); proc.disconnect(); mute.disconnect(); } catch (_) {}
    try { stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { ctx.close(); } catch (_) {}
  };
}

/**
 * Escaneo: junta el audio del PC en el segundo del video al que corresponde.
 * latency = retraso típico del loopback (s).
 */
export function createScanBuffer(duration, latency = 0.08) {
  const CELL = 0.25;
  const buf = new Float32Array(Math.ceil((duration + 2) * CHORD_SR));
  const covered = new Uint8Array(Math.ceil(duration / CELL) + 1);
  let head = -1;
  return {
    buf,
    /** Escribe un trozo que terminó de sonar cuando el video iba por videoNow. */
    write(chunk, videoNow, playing) {
      if (!playing || !chunk.length) { head = -1; return; }
      const expected = (videoNow - latency - chunk.length / CHORD_SR) * CHORD_SR;
      if (head < 0 || Math.abs(expected - head) > 0.3 * CHORD_SR) head = expected;
      else head += (expected - head) * 0.05; // corrige la deriva poco a poco
      let p = Math.round(head);
      for (let i = 0; i < chunk.length; i++, p++) {
        if (p >= 0 && p < buf.length) {
          buf[p] = chunk[i];
          const c = Math.floor(p / CHORD_SR / CELL);
          if (c < covered.length) covered[c] = 1;
        }
      }
      head += chunk.length;
    },
    get head() { return head; },
    coverage() { let n = 0; for (const c of covered) n += c; return covered.length ? n / covered.length : 0; },
    /** Audio para analizar (copia, del largo del video). */
    take() { return buf.slice(0, Math.ceil(duration * CHORD_SR)); },
  };
}
