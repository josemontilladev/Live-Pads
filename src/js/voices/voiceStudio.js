// ─────────────────────────────────────────────────────────────────────────
// Estudio de voces: del ORIGINAL de una canción a la melodía, la 2.ª y la 3.ª voz.
//   1. Separa la voz (IA local, la misma de Stems) — o usa la que ya tenga la canción.
//   2. Escucha la melodía nota a nota (voiceWorker.js) y busca los acordes.
//   3. Crea la 2.ª y la 3.ª voz según el tono y los acordes (harmonyCore.js).
//   4. Las dibuja como líneas de luz que avanzan con la canción (nota, acorde) y
//      las hace sonar: con un «coro» sintético o con la voz real del cantante.
// Se pueden corregir notas (clic en una y ▲▼), elegir el estilo de armonía y el
// tono, y guardar cada voz como voz de referencia de la canción (y de GI App).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { confirmDialogAsync } from '../ui/dialog.js';
import { PitchAudio } from '../audio/pitchAudio.js';
import { getSavedOutput } from '../audio/audioOutput.js';
import { getTrackAudio } from '../audio/trackPlayer.js';
import { requireFeature } from '../billing/license.js';
import { getSongs } from '../state/store.js';
import { libSongFor } from '../live/bandNotes.js';
import { markersFor } from '../data/markers.js';
import { keyTonic } from '../utils/chordNumbers.js';
import { CHORD_QUALITIES, chordName } from '../chords/chordEngine.js';
import { analyzeBufferCached, trackChordId } from '../chords/trackChords.js';
import { harmonize, noteName, STYLES, chordsWithPcs } from './harmonyCore.js';
import { partsToMidi, partsToMusicXML } from './melodyExportCore.js';
import { openCardMoreMenu } from '../ui/cardMoreMenu.js';
import { renderSynthVoices, realVoicesFast, createLiveChoir } from './voiceSynth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

const CH = [
  { id: 'mix', label: 'Canción', color: '#cbd5e1', vol: 0.55, on: true },
  { id: 'vocal', label: 'Voz original', color: '#f8fafc', vol: 0.8, on: false },
  { id: 'lead', label: 'Melodía', color: '#ffd23f', vol: 0.8, on: false },
  { id: 'v2', label: '2.ª voz', color: '#ff4f9a', vol: 0.9, on: true },
  { id: 'v3', label: '3.ª voz', color: '#35d6ff', vol: 0.9, on: true },
];
const VOICE_IDS = ['lead', 'v2', 'v3'];
const WINDOW_SEC = 8, HEAD = 0.3;

let S = null;   // estado del estudio abierto

/** Abre el estudio para una canción (de Pads o de Stems). opts.buffer: audio ya decodificado (Stems). */
export async function openVoiceStudio(song, { buffer = null, isVocal = false, label = '' } = {}) {
  if (S) return;
  if (!requireFeature('voiceStudio', 'El Estudio de voces (2.ª y 3.ª voz a partir del original) es parte de Pro.')) return;
  song = song ? libSongFor(song) : null;
  try { const a = getTrackAudio(); if (a && !a.paused) a.pause(); } catch (_) {}
  build(song, label);
  S.openArgs = { song, opts: { buffer, isVocal, label } };
  try { await prepare(song, buffer, isVocal); }
  catch (e) { showError((e && e.message) || String(e)); }
}

// ── Construcción de la pantalla ─────────────────────────────────────────────
function build(song, label) {
  const ov = document.createElement('div');
  ov.id = 'vs-overlay';
  ov.innerHTML = `
    <div class="vs-panel" role="dialog" aria-label="Estudio de voces">
      <header class="vs-head">
        <div class="vs-titles"><b>Estudio de voces</b><span data-ref="sub">${esc(label || (song && song.title) || '')}</span></div>
        <div class="vs-tools">
          <label class="vs-field" title="Cómo se reparten la 2.ª y la 3.ª voz respecto a la melodía">Armonía
            <select data-ref="style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
          <label class="vs-field" title="Escuchar y guardar las voces en otro tono">Tono
            <select data-ref="semis">${Array.from({ length: 13 }, (_, i) => i - 6).map((n) => `<option value="${n}" ${n === 0 ? 'selected' : ''}>${n > 0 ? '+' + n : n === 0 ? 'Original' : n}</option>`).join('')}</select></label>
          <button type="button" class="vs-btn" data-act="reanalyze" hidden title="Esta canción se analizó antes: vuelve a escuchar la melodía con la versión actual del estudio (se pierden las notas corregidas a mano)">Volver a analizar</button>
          <button type="button" class="vs-btn" data-act="real" title="La 2.ª y la 3.ª voz cantadas con la voz del cantante (con letra). Tarda alrededor de un minuto.">Voz real (con letra)</button>
          <button type="button" class="vs-btn" data-act="export" title="Exportar la melodía (y la 2.ª y 3.ª voz) en MIDI o como partitura para MuseScore, Sibelius o Finale">Exportar ▾</button>
          <button type="button" class="vs-btn vs-btn--primary" data-act="save" title="Guarda la melodía, la 2.ª y la 3.ª voz (con la canción de fondo) como voces de referencia: se escuchan en «Voces» y en GI App">Guardar como voces</button>
          <button type="button" class="vs-close" data-act="close" aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
        </div>
      </header>
      <div class="vs-stage">
        <canvas data-ref="cv"></canvas>
        <div class="vs-progress" data-ref="progress"><b data-ref="pstep">Preparando…</b><div class="vs-bar"><i data-ref="pbar"></i></div><small data-ref="pdetail"></small></div>
        <div class="vs-edit" data-ref="edit" hidden>
          <span data-ref="ename"></span>
          <button type="button" data-act="up" title="Subir un semitono (↑)">▲</button>
          <button type="button" data-act="down" title="Bajar un semitono (↓)">▼</button>
          <button type="button" data-act="mute-note" title="Que esta voz no cante esta nota (Supr)">Silenciar</button>
          <button type="button" data-act="reset-note" title="Volver a la nota propuesta">Restaurar</button>
        </div>
        <p class="vs-hint" data-ref="hint">Clic en una nota de la 2.ª o 3.ª voz para corregirla · arrastra para moverte por la canción</p>
      </div>
      <footer class="vs-foot">
        <div class="vs-transport">
          <button type="button" class="vs-play" data-act="play" aria-label="Reproducir" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
          <span class="vs-time" data-ref="time">0:00 / 0:00</span>
          <div class="vs-secs" data-ref="secs"></div>
        </div>
        <div class="vs-mixer">${CH.map((c) => `
          <div class="vs-ch" data-ch="${c.id}" style="--c:${c.color}">
            <button type="button" class="vs-ch-on" data-act="toggle" aria-pressed="${c.on}" title="Activar o callar"><i></i>${esc(c.label)}</button>
            <button type="button" class="vs-ch-solo" data-act="solo" title="Escuchar solo esta">S</button>
            <input type="range" min="0" max="1.2" step="0.05" value="${c.vol}" aria-label="Volumen de ${esc(c.label)}">
            ${c.id === 'v2' || c.id === 'v3' ? `<div class="vs-ch-src" role="group" aria-label="Sonido"><button type="button" data-src="synth" class="is-on">Coro</button><button type="button" data-src="real" disabled title="Pulsa «Voz real (con letra)» arriba">Voz real</button></div>` : ''}
          </div>`).join('')}
        </div>
      </footer>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  S = {
    ov, $, song, ctx: null, players: {}, gains: {}, ch: Object.fromEntries(CH.map((c) => [c.id, { ...c, solo: false, src: 'synth' }])),
    dur: 0, t: 0, playing: false, startCtx: 0, startT: 0, raf: 0, dirty: true,
    lead: [], voices: { v2: [], v3: [] }, f0: null, hop: 0.01, chords: [], key: null, flats: false,
    style: 'arriba-abajo', semis: 0, sel: null, edits: {}, synth: {}, real: {}, realStale: false, ready: false,
  };
  S.popModal = pushModal(() => { if (S && S.sel) { select(null); return; } close(); }, ov);
  ov.addEventListener('click', onClick);
  ov.querySelectorAll('.vs-ch input[type=range]').forEach((r) => r.addEventListener('input', () => { S.ch[r.closest('.vs-ch').dataset.ch].vol = Number(r.value); applyGains(); }));
  $('[data-ref="style"]').addEventListener('change', (e) => { S.style = e.target.value; rebuildVoices(true); });
  $('[data-ref="semis"]').addEventListener('change', (e) => { S.semis = Number(e.target.value); applyPitch(); persist(); });
  document.addEventListener('keydown', onKey, true);
  const cv = $('[data-ref="cv"]');
  cv.addEventListener('pointerdown', onPointer);
  new ResizeObserver(() => { S && (S.dirty = true); }).observe(cv);
  S.raf = requestAnimationFrame(loop);
}

function progress(step, frac, detail = '') {
  if (!S) return;
  const p = S.$('[data-ref="progress"]');
  p.hidden = false;
  S.$('[data-ref="pstep"]').textContent = step;
  S.$('[data-ref="pbar"]').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  S.$('[data-ref="pdetail"]').textContent = detail;
}
function showError(msg) {
  if (!S) return;
  progress('No se pudo preparar el estudio', 0, msg);
  S.$('[data-ref="progress"]').classList.add('is-error');
}

// ── Preparación (audio, voz, melodía, acordes, voces) ────────────────────────
async function readBuffer(ctx, url) {
  let arr;
  if (/^(livepads:|file:)/i.test(url) && window.electronAPI?.readAudioFile) arr = await window.electronAPI.readAudioFile(url);
  else arr = await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(arr);
}

async function prepare(song, givenBuffer, givenIsVocal) {
  const AC = window.AudioContext || window.webkitAudioContext;
  S.ctx = new AC({ latencyHint: 'playback' });
  try { const out = getSavedOutput(); if (out.id && S.ctx.setSinkId) await S.ctx.setSinkId(out.id); } catch (_) {}
  const audio = (song && song.audio) || {};
  const vocalStem = Array.isArray(audio.stems) ? audio.stems.find((x) => x && x.kind === 'vocals' && x.url) : null;

  // 1. La canción (original)
  const T0 = performance.now(); S.timing = {}; const mark = (k) => { S.timing[k] = Math.round(performance.now() - T0); };
  progress('Cargando la canción…', 0.03);
  let mix = givenBuffer;
  if (!mix) {
    if (!audio.original) throw new Error('Esta canción necesita el ORIGINAL (la grabación con la voz) para sacar la melodía. Añádelo desde el menú de la canción: «Subir original» u «Original desde YouTube».');
    mix = await readBuffer(S.ctx, audio.original);
  }
  S.dur = mix.duration;
  S.mixBuf = mix;
  S.src = givenBuffer ? `stems:${Math.round(mix.duration)}` : `${audio.original}|${Math.round(mix.duration)}`;

  // 2. La voz sola
  let vocal = null;
  if (givenIsVocal) vocal = givenBuffer;
  else if (vocalStem && !givenBuffer) {
    progress('Cargando la voz separada…', 0.08);
    try { vocal = await readBuffer(S.ctx, vocalStem.url); } catch (_) { vocal = null; }
  }
  mark('cancion');
  if (!vocal) vocal = await separateVocal(mix, song);
  mark('voz');
  if (!S) return;
  S.vocalBuf = vocal;

  // 3. Acordes y tono (en paralelo con la melodía)
  const chordsJob = (async () => {
    try {
      const r = await analyzeBufferCached(trackChordId(song || { id: 'stems' }, 'original', mix), mix, (p) => { S && (S.chordP = p); });
      return r;
    } catch (_) { return null; }
  })();

  // 4. Melodía
  const saved = song && song.harmony && song.harmony.src === S.src && Array.isArray(song.harmony.lead) ? song.harmony : null;
  if (saved) {
    // Ya se escuchó antes: las notas están guardadas. La curva fina (cómo cantó de verdad)
    // se calcula en segundo plano y aparece cuando esté.
    S.lead = saved.lead;
    S.$('[data-act="reanalyze"]').hidden = false;
    pitchInWorker(vocal, true).then((tr) => { if (S) { S.f0 = tr.f0; S.conf = tr.conf; S.hop = tr.hop; S.dirty = true; } }).catch(() => {});
  } else {
    progress('Escuchando la melodía…', 0.55);
    const tr = await pitchInWorker(vocal);
    if (!S) return;
    S.f0 = tr.f0; S.conf = tr.conf; S.hop = tr.hop;
    S.lead = tr.notes;
  }
  if (saved) { S.style = saved.style || S.style; S.semis = Number(saved.semis) || 0; S.edits = saved.edits || {}; }
  S.$('[data-ref="style"]').value = S.style;
  S.$('[data-ref="semis"]').value = String(S.semis);

  mark('melodia');
  progress('Buscando los acordes…', 0.75);
  const ch = await chordsJob;
  if (!S) return;
  if (ch && Array.isArray(ch.seg)) {
    S.chords = ch.seg.filter((c) => c && c.r >= 0);
    S.key = Number.isFinite(ch.k) ? { k: ch.k, m: !!ch.m } : null;
  }
  if (!S.key && song && song.key) { const t = keyTonic(song.key); if (t) S.key = { k: t.pc, m: t.minor }; }
  S.flats = !!(S.key && (S.key.m ? [2, 7, 0, 5, 10, 3] : [5, 10, 3, 8, 1, 6]).includes(((S.key.k % 12) + 12) % 12));
  const keyTxt = S.key ? `Tono ${noteName(60 + S.key.k, S.flats).replace(/\d+$/, '')}${S.key.m ? 'm' : ''}` : '';
  S.$('[data-ref="sub"]').textContent = [(song && song.title) || 'Pista de Stems', keyTxt, `${S.lead.length} notas de melodía`].filter(Boolean).join(' · ');

  // 5. Voces
  mark('acordes');
  progress('Creando la 2.ª y la 3.ª voz…', 0.85);
  await rebuildVoices(false);
  if (!S) return;
  // Reproductores: la canción, la voz original y la voz real (audio). El coro canta en vivo
  // (sin preparar nada antes: antes se renderizaban las voces y tardaba ~30 s).
  for (const id of ['mix', 'vocal', 'v2', 'v3']) {
    const p = new PitchAudio(S.ctx);
    p.output.connect(S.ctx.destination);
    S.players[id] = p;
  }
  S.choir = createLiveChoir(S.ctx, ['lead', 'v2', 'v3']);
  for (const id of ['lead', 'v2', 'v3']) S.choir.outputs[id].connect(S.ctx.destination);
  S.mixBuf = mix;
  S.players.mix.setBuffer(mix, 'mix');
  S.players.vocal.setBuffer(vocal, 'vocal');
  setVoiceBuffers();
  applyGains(); applyPitch();
  // Secciones
  const ms = song ? markersFor(song, 'original').filter((m) => m && Number.isFinite(m.t)).sort((a, b) => a.t - b.t) : [];
  S.$('[data-ref="secs"]').innerHTML = ms.map((m) => `<button type="button" data-seek="${m.t}">${esc(m.label)}</button>`).join('');
  S.$('[data-ref="progress"]').hidden = true;
  S.$('[data-act="play"]').disabled = false;
  mark('voces');
  S.ready = true; S.dirty = true;
  S.realTimer = setTimeout(() => prepareReal(false), 1200);
  persist();
}

async function separateVocal(mix, song) {
  if (!window.electronAPI?.stemsSeparate) throw new Error('Esta versión no puede separar la voz.');
  progress('Separando la voz del original (IA: unos minutos, solo la primera vez)…', 0.1);
  const off = window.electronAPI.onStemsSeparateProgress?.(({ fraction, stage }) => progress('Separando la voz del original (IA: unos minutos, solo la primera vez)…', 0.1 + 0.4 * (fraction || 0), stage || ''));
  let res;
  try {
    const ch0 = mix.getChannelData(0).slice(), ch1 = mix.numberOfChannels > 1 ? mix.getChannelData(1).slice() : ch0;
    res = await window.electronAPI.stemsSeparate({ channels: [ch0, ch1], sampleRate: mix.sampleRate, mode: 'voz' });
  } finally { try { off && off(); } catch (_) {} }
  if (!res || res.cancelled || !Array.isArray(res.stems)) throw new Error('Se canceló la separación de la voz.');
  const v = res.stems.find((x) => x.kind === 'vocals') || res.stems[res.stems.length - 1];
  const chs = v.channels.map((c) => (c instanceof Float32Array ? c : new Float32Array(c)));
  const buf = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: res.sampleRate });
  chs.forEach((c, i) => buf.copyToChannel(c, i));
  // Se guarda en la canción como pista «Voz»: la próxima vez es inmediato (y sirve en Stems).
  if (song && window.electronAPI.saveSongStem) {
    (async () => {
      try {
        // MP3 en hilos aparte (4 minutos de audio bloquearían la pantalla).
        const mp3 = await toMp3(buf, 160);
        const { songSlug, attachStem } = await import('../stems/songStems.js');
        const url = await window.electronAPI.saveSongStem({ buffer: mp3, songSlug: songSlug(song), name: 'Voz (separada)', ext: 'mp3' });
        attachStem(song, { url, name: 'Voz (separada)', kind: 'vocals' });
        window.electronAPI.saveGiSetlist?.(getSongs());
        window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id, stems: true } }));
      } catch (e) { console.warn('No se pudo guardar la voz separada', e); }
    })();
  }
  return buf;
}

async function toMp3(buf, kbps) {
  const { encodeMp3Async } = await import('../audio/mp3Pool.js');
  const l = buf.getChannelData(0).slice(), r = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : null;
  return encodeMp3Async(l, r, buf.sampleRate, kbps);
}

function pitchInWorker(buf, quiet = false) {
  return new Promise((resolve, reject) => {
    const n = buf.length, mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    const w = new Worker(new URL('./voiceWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { if (!quiet) progress('Escuchando la melodía…', 0.55 + 0.2 * m.p); }
      else if (m.type === 'done') { w.terminate(); resolve(m); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.error)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Error al analizar la voz')); };
    w.postMessage({ mono, sr: buf.sampleRate }, [mono.buffer]);
  });
}

// ── Voces (armonía + correcciones) ──────────────────────────────────────────
function editsFor(style) { S.edits[style] = S.edits[style] || { lead: {}, v2: {}, v3: {} }; return S.edits[style]; }
function applyEdits(list, ed) { return list.map((n, i) => (ed && ed[i] ? { ...n, ...ed[i] } : n)); }

async function rebuildVoices(rerender) {
  const chords = chordsWithPcs(S.chords, CHORD_QUALITIES);
  const h = harmonize(S.lead, { key: S.key, chords, style: S.style });
  const ed = editsFor(S.style);
  S.base = h;
  S.voices = { v2: applyEdits(h.v2, ed.v2), v3: applyEdits(h.v3, ed.v3) };
  S.leadShown = applyEdits(S.lead, ed.lead);
  S.dirty = true;
  if (S.ready) bumpVoices(); else { S.real = {}; markRealAvailable(); }
  if (rerender) { restartChoir(); persist(); }
}
let renderTimer = null;

// Lo que canta el coro en vivo: la melodía siempre; la 2.ª y la 3.ª si no suenan con la voz real.
const useReal = (v) => S.ch[v].src === 'real' && !!S.real[v];
function choirNotes() { return { lead: S.leadShown, v2: useReal('v2') ? [] : S.voices.v2, v3: useReal('v3') ? [] : S.voices.v3 }; }
function restartChoir() { if (S && S.playing && S.choir) S.choir.play(curTime(), choirNotes(), S.semis); }

function setVoiceBuffers() {
  if (!S || !S.players.v2) return;
  const was = S.playing; if (was) pauseAll();
  for (const v of ['v2', 'v3']) S.players[v].setBuffer(useReal(v) ? S.real[v] : null, v);
  applyGains(); applyPitch();
  if (was) playAll();
}

// ── Voz real (la del cantante, movida nota a nota) ──────────────────────────
function markRealAvailable() {
  if (!S) return;
  S.ov.querySelectorAll('[data-src="real"]').forEach((b) => { const v = b.closest('.vs-ch').dataset.ch; b.disabled = !S.real[v]; });
  let changed = false;
  for (const v of ['v2', 'v3']) {
    // Sin voz real (se está rehaciendo): canta el coro. Cuando vuelve a estar, si la habías elegido, vuelve sola.
    const want = S.real[v] && S.ch[v].want === 'real' ? 'real' : 'synth';
    if (S.ch[v].src !== want) { setSrc(v, want, true); changed = true; }
  }
  if (changed && S.players && S.players.v2) setVoiceBuffers();
}
// La voz real se prepara sola en segundo plano en cuanto el estudio está listo (y otra vez
// tras cada corrección): al pulsar «Voz real» ya está. `S.ver` cambia con cada cambio de
// las voces: un trabajo que termina con voces viejas se descarta.
function bumpVoices() { S.ver = (S.ver || 0) + 1; S.real = {}; markRealAvailable(); clearTimeout(S.realTimer); S.realTimer = setTimeout(() => prepareReal(false), 1500); }

async function prepareReal(show) {
  if (!S || !S.vocalBuf) return null;
  const ver = S.ver || 0;
  if (S.realJob && S.realJob.ver === ver) return S.realJob.promise;
  const job = { ver };
  job.promise = (async () => {
    const { pitchShiftBuffer, pitchShiftBufferHQ } = await import('../stems/harmonyShifter.js');
    // Motor de alta calidad (conserva el timbre de la voz); si no está, el de siempre.
    const shiftFn = async (buf, s2, o) => (await pitchShiftBufferHQ(buf, s2, o).catch(() => null)) || pitchShiftBuffer(buf, s2, o);
    const real = await realVoicesFast(S.vocalBuf, S.leadShown, [S.voices.v2, S.voices.v3], shiftFn,
      (f, i, n) => { if (S && S.showReal) progress('Cantando la 2.ª y la 3.ª voz con la voz real…', f, `${i} de ${n} intervalos`); });
    if (!S || (S.ver || 0) !== ver) return null;
    S.real = real;
    markRealAvailable();
    return real;
  })();
  S.realJob = job;
  return job.promise;
}

async function makeRealVoices() {
  if (!S || !S.vocalBuf || S.busyReal) return;
  S.busyReal = true;
  const btn = S.$('[data-act="real"]'); btn.disabled = true;
  try {
    if (!S.real.v2) {
      S.showReal = true;
      progress('Cantando la 2.ª y la 3.ª voz con la voz real…', 0);
      await prepareReal(true);
    }
    if (!S) return;
    S.showReal = false;
    S.$('[data-ref="progress"]').hidden = true;
    if (!S.real.v2) return;
    for (const v of ['v2', 'v3']) { S.ch[v].want = 'real'; setSrc(v, 'real', true); }
    setVoiceBuffers();
    window.showToast?.('La 2.ª y la 3.ª voz suenan con la voz real (y su letra). Puedes volver a «Coro» en cada una.', 'success');
  } catch (e) {
    S && (S.$('[data-ref="progress"]').hidden = true);
    window.showToast?.('No se pudo crear la voz real: ' + ((e && e.message) || e), 'error');
  } finally { if (S) { S.busyReal = false; S.showReal = false; btn.disabled = false; } }
}
function setSrc(v, src, silent) {
  if (!S) return;
  S.ch[v].src = src;
  S.ov.querySelectorAll(`.vs-ch[data-ch="${v}"] [data-src]`).forEach((b) => b.classList.toggle('is-on', b.dataset.src === src));
  if (!silent) setVoiceBuffers();
}

// ── Reproducción ─────────────────────────────────────────────────────────────
function curTime() { return S.playing ? Math.min(S.dur, S.startT + (S.ctx.currentTime - S.startCtx)) : S.t; }
function playAll() {
  if (!S.ready) return;
  if (S.ctx.state === 'suspended') S.ctx.resume();
  if (S.t >= S.dur - 0.05) S.t = 0;
  for (const p of Object.values(S.players)) { if (!p.buffer) continue; try { p.currentTime = S.t; p.play().catch(() => {}); } catch (_) {} }
  S.startCtx = S.ctx.currentTime; S.startT = S.t; S.playing = true;
  if (S.choir) S.choir.play(S.t, choirNotes(), S.semis);
  paintPlay();
}
function pauseAll() {
  S.t = curTime();
  for (const p of Object.values(S.players)) { try { p.pause(); } catch (_) {} }
  if (S.choir) S.choir.stop();
  S.playing = false;
  paintPlay();
}
function seek(t) {
  const was = S.playing;
  if (was) pauseAll();
  S.t = Math.max(0, Math.min(S.dur, t));
  S.dirty = true;
  if (was) playAll();
}
function paintPlay() {
  const b = S.$('[data-act="play"]');
  b.innerHTML = S.playing ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  b.setAttribute('aria-label', S.playing ? 'Pausa' : 'Reproducir');
}
function applyGains() {
  const anySolo = Object.values(S.ch).some((c) => c.solo);
  for (const c of Object.values(S.ch)) {
    const audible = anySolo ? c.solo : c.on;
    const vol = audible ? c.vol : 0;
    const p = S.players[c.id];
    if (p) p.volume = (c.id === 'v2' || c.id === 'v3') && !useReal(c.id) ? 0 : vol;
    if (S.choir && S.choir.outputs[c.id]) S.choir.outputs[c.id].gain.setTargetAtTime(c.id === 'lead' || !useReal(c.id) ? vol : 0, S.ctx.currentTime, 0.02);
    const el = S.ov.querySelector(`.vs-ch[data-ch="${c.id}"]`);
    el.querySelector('[data-act="toggle"]').setAttribute('aria-pressed', String(c.on));
    el.querySelector('[data-act="solo"]').classList.toggle('is-on', c.solo);
    el.classList.toggle('is-muted', !audible);
  }
  S.dirty = true;
}
function applyPitch() {
  for (const p of Object.values(S.players)) { try { p.pitchSemitones = S.semis; } catch (_) {} }
  restartChoir();
  S.dirty = true;
}

// ── Guardar ─────────────────────────────────────────────────────────────────
function persist() {
  const song = S && S.song;
  if (!song) return;
  song.harmony = { v: 1, src: S.src, style: S.style, semis: S.semis, lead: S.lead, edits: S.edits, at: Date.now() };
  try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {}
}

// Audio en mono a la frecuencia pedida (con interpolación lineal): para mezclar a mano, rápido.
function toMonoAt(buf, sr, len) {
  const out = new Float32Array(len);
  const n = buf.numberOfChannels, r = buf.sampleRate / sr, g = 1 / n;
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c);
    if (r === 1) { const m = Math.min(len, d.length); for (let k = 0; k < m; k++) out[k] += d[k] * g; continue; }
    for (let k = 0; k < len; k++) {
      const x = k * r, i = x | 0;
      if (i + 1 >= d.length) break;
      const f = x - i;
      out[k] += (d[i] * (1 - f) + d[i + 1] * f) * g;
    }
  }
  return out;
}

async function saveAsVoices() {
  const song = S.song;
  if (!song) { window.showToast?.('Guarda primero la pista como canción para poder guardar sus voces.', 'info'); return; }
  if (!window.electronAPI?.saveVoiceNote) { window.showToast?.('Esta versión no puede guardar voces.', 'error'); return; }
  const btn = S.$('[data-act="save"]'); btn.disabled = true;
  try {
    // Voces de referencia en MONO (para escucharlas y aprenderlas sobra) con la canción de fondo.
    // Rápido: se mezcla a mano, solo se prepara el coro de las voces que lo usan y los tres MP3
    // se codifican a la vez en hilos aparte.
    const SR = 44100, len = Math.ceil(S.dur * SR);
    const shift = async (buf) => {
      const { pitchShiftBuffer, pitchShiftBufferHQ } = await import('../stems/harmonyShifter.js');
      return (await pitchShiftBufferHQ(buf, S.semis).catch(() => null)) || pitchShiftBuffer(buf, S.semis);
    };
    progress('Preparando la canción de fondo…', 0.05);
    const bed = toMonoAt(S.semis ? await shift(S.mixBuf) : S.mixBuf, SR, len);
    const ids = ['lead', 'v2', 'v3'];
    const synthIds = ids.filter((id) => id === 'lead' || !useReal(id));
    progress('Preparando las voces…', 0.2);
    const rendered = await renderSynthVoices(synthIds.map((id) => (id === 'lead' ? S.leadShown : S.voices[id])), S.dur, { semis: S.semis });
    const voice = {};
    synthIds.forEach((id, i) => { voice[id] = toMonoAt(rendered[i], SR, len); });
    for (const id of ids) if (!voice[id]) voice[id] = toMonoAt(S.semis ? await shift(S.real[id]) : S.real[id], SR, len);
    progress('Guardando las voces de referencia…', 0.5);
    const { encodeMp3Async } = await import('../audio/mp3Pool.js');
    const labels = { lead: 'Melodía', v2: '2.ª voz', v3: '3.ª voz' };
    const mp3s = await Promise.all(ids.map((id) => {
      const v = voice[id], mix = new Float32Array(len);
      let peak = 0;
      for (let k = 0; k < len; k++) { const x = bed[k] * 0.32 + v[k]; mix[k] = x; const ax = x < 0 ? -x : x; if (ax > peak) peak = ax; }
      if (peak > 0.98) { const g = 0.98 / peak; for (let k = 0; k < len; k++) mix[k] *= g; }
      return encodeMp3Async(mix, null, SR, 128);
    }));
    const tone = S.semis ? ` · tono ${S.semis > 0 ? '+' : ''}${S.semis}` : '';
    const saved = [];
    for (let i = 0; i < ids.length; i++) {
      const it = ids[i];
      const r = await window.electronAPI.saveVoiceNote({ buffer: mp3s[i], title: `${song.title || 'cancion'} ${labels[it]}`, ext: 'mp3' });
      saved.push({ id: r.id, label: `${labels[it]} (Estudio)`, path: r.url, by: 'Estudio de voces', note: `${STYLES[S.style].label}${tone}${it !== 'lead' && useReal(it) ? ' · voz real' : ''} · con la canción de fondo`, gen: 'studio', at: new Date().toISOString(), sec: Math.round(S.dur) });
    }
    song.audio = song.audio || {};
    const keep = (Array.isArray(song.audio.voices) ? song.audio.voices : []).filter((v) => v && v.gen !== 'studio');
    song.audio.voices = [...keep, ...saved];
    window.electronAPI.saveGiSetlist?.(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id } }));
    window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
    S.$('[data-ref="progress"]').hidden = true;
    window.showToast?.('✓ Melodía, 2.ª y 3.ª voz guardadas en «Voces» de la canción (también llegan a GI App con la sincronización de audios).', 'success', { ttl: 8000 });
  } catch (e) {
    S && (S.$('[data-ref="progress"]').hidden = true);
    window.showToast?.('No se pudieron guardar las voces: ' + ((e && e.message) || e), 'error');
  } finally { if (S) btn.disabled = false; }
}

// ── Exportar la melodía (MIDI / partitura MusicXML) ───────────────────────────
function openExportMenu(anchor) {
  openCardMoreMenu(anchor, [
    { label: 'Melodía en MIDI', hint: 'Un archivo .mid con la melodía', onSelect: () => exportMelody('lead-midi') },
    { label: 'Melodía y voces en MIDI', hint: 'Melodía, 2.ª y 3.ª voz en pistas separadas', onSelect: () => exportMelody('all-midi') },
    { label: 'Partitura (MusicXML)', hint: 'Melodía, 2.ª y 3.ª voz para MuseScore, Sibelius o Finale', onSelect: () => exportMelody('score') },
  ]);
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]+/g, ' ');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportMelody(kind) {
  if (!S || !S.ready) return;
  const semis = Number(S.semis) || 0;
  const shift = (ns) => (ns || []).map((n) => ({ s: n.s, e: n.e, m: n.m + semis }));
  const parts = [{ name: 'Melodía', notes: shift(S.leadShown || S.lead) }];
  if (kind !== 'lead-midi') { const ch = choirNotes(); parts.push({ name: '2.ª voz', notes: shift(ch.v2 && ch.v2.length ? ch.v2 : S.voices.v2) }, { name: '3.ª voz', notes: shift(ch.v3 && ch.v3.length ? ch.v3 : S.voices.v3) }); }
  if (!parts[0].notes.length) { window.showToast?.('Todavía no hay melodía que exportar.', 'info'); return; }
  // Tempo y primer compás: los de la rejilla de pulsos de la canción (si hay); si no, su BPM.
  const beatsPerBar = parseInt(String((S.song && S.song.timeSig) || '4/4').split('/')[0], 10) || 4;
  let bpm = Number(S.song && S.song.bpm) || 0, offset = 0;
  try {
    const B = await import('../analysis/beatGrid.js');
    if (S.mixBuf) { const r = await B.analyzeBeats(S.mixBuf, B.trackKey(S.song, 'original', S.mixBuf)); if (r) { if (r.bpm > 0) bpm = r.bpm; if (r.downbeats && Number.isFinite(r.downbeats[0])) offset = r.downbeats[0]; } }
  } catch (_) {}
  bpm = bpm > 0 ? Math.round(bpm * 10) / 10 : 120;
  const barSec = (60 / bpm) * beatsPerBar;
  offset = ((offset % barSec) + barSec) % barSec;
  const key = S.key ? { k: (((S.key.k + semis) % 12) + 12) % 12, m: S.key.m } : null;
  const title = (S.song && S.song.title) || 'Melodía';
  if (kind === 'score') download(new TextEncoder().encode(partsToMusicXML(parts, { bpm, beatsPerBar, key, offsetSec: offset, title })), `${title} - partitura.musicxml`, 'application/vnd.recordare.musicxml+xml');
  else download(partsToMidi(parts, bpm), `${title} - ${kind === 'lead-midi' ? 'melodía' : 'voces'}.mid`, 'audio/midi');
  window.showToast?.(kind === 'score' ? '✓ Partitura lista: ábrela con MuseScore (gratis), Sibelius o Finale.' : '✓ MIDI listo.', 'success');
}

// ── Interacción ─────────────────────────────────────────────────────────────
function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const chEl = e.target.closest('.vs-ch');
  const seekB = e.target.closest('[data-seek]');
  if (seekB) { seek(Number(seekB.dataset.seek)); return; }
  const srcB = e.target.closest('[data-src]');
  if (srcB && !srcB.disabled && chEl) { S.ch[chEl.dataset.ch].want = srcB.dataset.src; setSrc(chEl.dataset.ch, srcB.dataset.src); return; }
  if (!act) return;
  if (act === 'close') { close(); return; }
  if (act === 'play') { if (S.playing) pauseAll(); else playAll(); return; }
  if (act === 'save') { if (S.ready) saveAsVoices(); return; }
  if (act === 'export') { if (S.ready) openExportMenu(e.target.closest('[data-act]')); return; }
  if (act === 'real') { if (S.ready) makeRealVoices(); return; }
  if (act === 'reanalyze') { reanalyze(); return; }
  if (act === 'toggle' && chEl) { const c = S.ch[chEl.dataset.ch]; c.on = !c.on; applyGains(); return; }
  if (act === 'solo' && chEl) { const c = S.ch[chEl.dataset.ch]; c.solo = !c.solo; applyGains(); return; }
  if (act === 'up') { nudge(1); return; }
  if (act === 'down') { nudge(-1); return; }
  if (act === 'mute-note') { editSel({ off: !(cur() && cur().off) }); return; }
  if (act === 'reset-note') { resetSel(); return; }
}
function onKey(e) {
  if (!S) return;
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (S.ready) { if (S.playing) pauseAll(); else playAll(); } return; }
  if (!S.sel) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); nudge(1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); nudge(-1); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); editSel({ off: !(cur() && cur().off) }); }
}

const listOf = (v) => (v === 'lead' ? S.leadShown : S.voices[v]);
const cur = () => (S.sel ? listOf(S.sel.v)[S.sel.i] : null);
function select(sel) {
  S.sel = sel; S.dirty = true;
  const box = S.$('[data-ref="edit"]');
  box.hidden = !sel;
  S.$('[data-ref="hint"]').hidden = !!sel;
  if (sel) paintSel();
}
function paintSel() {
  const n = cur(); if (!n) return;
  const name = { lead: 'Melodía', v2: '2.ª voz', v3: '3.ª voz' }[S.sel.v];
  S.$('[data-ref="ename"]').innerHTML = `<i style="background:${S.ch[S.sel.v].color}"></i>${name} · <b>${noteName(n.m + S.semis, S.flats)}</b>${n.off ? ' · silenciada' : ''}`;
  S.$('[data-act="mute-note"]').textContent = n.off ? 'Que cante' : 'Silenciar';
}
function editSel(patch) {
  if (!S.sel) return;
  const ed = editsFor(S.style)[S.sel.v];
  const n = cur();
  ed[S.sel.i] = { ...(ed[S.sel.i] || {}), ...patch, m: patch.m != null ? patch.m : n.m };
  afterEdit();
}
function nudge(d) { const n = cur(); if (n) editSel({ m: n.m + d }); }
function resetSel() { if (!S.sel) return; delete editsFor(S.style)[S.sel.v][S.sel.i]; afterEdit(); }
function afterEdit() {
  const ed = editsFor(S.style);
  S.voices = { v2: applyEdits(S.base.v2, ed.v2), v3: applyEdits(S.base.v3, ed.v3) };
  S.leadShown = applyEdits(S.lead, ed.lead);
  const wasReal = useReal('v2') || useReal('v3');
  bumpVoices();
  if (wasReal) window.showToast?.('Cambiaste notas: la voz real se vuelve a preparar con la corrección (unos segundos).', 'info');
  paintSel(); S.dirty = true;
  restartChoir(); persist();
}

// Clic: sobre una nota → la selecciona; si no, arrastrar para moverse por la canción.
function onPointer(e) {
  if (!S.ready) return;
  const cv = e.currentTarget, r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = hitNote(x, y, r.width, r.height);
  if (hit) { select(hit); return; }
  select(null);
  const t0 = S.playing ? curTime() : S.t, x0 = e.clientX;
  const pxPerSec = r.width / WINDOW_SEC;
  const was = S.playing; if (was) pauseAll();
  cv.setPointerCapture(e.pointerId);
  const move = (ev) => { S.t = Math.max(0, Math.min(S.dur, t0 - (ev.clientX - x0) / pxPerSec)); S.dirty = true; };
  const up = (ev) => {
    cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up);
    // Clic sin arrastrar: ir a ese punto.
    if (Math.abs(ev.clientX - x0) < 4) S.t = Math.max(0, Math.min(S.dur, t0 + (x - r.width * HEAD) / pxPerSec));
    if (was) playAll(); else S.dirty = true;
  };
  cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
}

// ── Dibujo ───────────────────────────────────────────────────────────────────
function geometry(w, h) {
  const all = [...S.leadShown, ...S.voices.v2, ...S.voices.v3];
  let lo = 127, hi = 0;
  for (const n of all) { if (n.m < lo) lo = n.m; if (n.m > hi) hi = n.m; }
  if (lo > hi) { lo = 48; hi = 72; }
  lo -= 2; hi += 2;
  const top = Math.min(130, h * 0.22), bottom = h - 28;
  const t = curTime();
  return { t, lo, hi, top, bottom, x: (s) => (s - t) * (w / WINDOW_SEC) + w * HEAD, y: (m) => bottom - ((m - lo) / (hi - lo)) * (bottom - top) };
}
function hitNote(x, y, w, h) {
  const g = geometry(w, h);
  let best = null, bestD = 14;
  for (const v of ['v2', 'v3', 'lead']) {
    if (!S.ch[v].on && !S.ch[v].solo && v !== 'lead') continue;
    listOf(v).forEach((n, i) => {
      const x1 = g.x(n.s), x2 = g.x(n.e);
      if (x < x1 - 4 || x > x2 + 4) return;
      const d = Math.abs(g.y(n.m) - y);
      if (d < bestD) { bestD = d; best = { v, i }; }
    });
  }
  return best;
}

function loop() {
  if (!S) return;
  S.raf = requestAnimationFrame(loop);
  if (S.playing) { S.t = curTime(); if (S.t >= S.dur - 0.02) pauseAll(); }
  if (!S.playing && !S.dirty) return;
  S.dirty = false;
  draw();
  S.$('[data-ref="time"]').textContent = `${fmt(S.t)} / ${fmt(S.dur)}`;
}

function draw() {
  const cv = S.$('[data-ref="cv"]');
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Fondo como el de la referencia: oscuro con luces de color suaves.
  c.fillStyle = '#07070d'; c.fillRect(0, 0, w, h);
  let gr = c.createRadialGradient(w * 0.15, h * 0.85, 0, w * 0.15, h * 0.85, w * 0.7);
  gr.addColorStop(0, 'rgba(46,160,90,.28)'); gr.addColorStop(1, 'rgba(46,160,90,0)');
  c.fillStyle = gr; c.fillRect(0, 0, w, h);
  gr = c.createRadialGradient(w * 0.75, h * 0.1, 0, w * 0.75, h * 0.1, w * 0.6);
  gr.addColorStop(0, 'rgba(130,60,200,.30)'); gr.addColorStop(1, 'rgba(130,60,200,0)');
  c.fillStyle = gr; c.fillRect(0, 0, w, h);
  if (!S.ready) return;
  const g = geometry(w, h);
  const t0 = g.t - WINDOW_SEC * HEAD, t1 = g.t + WINDOW_SEC * (1 - HEAD);
  // Rejilla: una línea suave en cada Do.
  c.font = '600 10px system-ui, sans-serif'; c.textBaseline = 'middle';
  for (let m = Math.ceil(g.lo); m <= g.hi; m++) {
    if (((m % 12) + 12) % 12 !== 0) continue;
    const y = g.y(m);
    c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fillText(noteName(m + S.semis, S.flats), 6, y - 7);
  }
  // Acordes: línea vertical y nombre en cada cambio; el que suena, en grande arriba.
  const keyObj = S.key ? { k: S.key.k, m: S.key.m } : null;
  let now = null;
  c.textAlign = 'left';
  for (const ch of S.chords) {
    if (ch.s <= g.t && g.t < ch.e) now = ch;
    if (ch.e < t0 || ch.s > t1) continue;
    const x = g.x(ch.s);
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, g.top - 26); c.lineTo(x, g.bottom); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '600 14px system-ui, sans-serif';
    c.fillText(chordName(ch, { shift: S.semis, key: keyObj }), x + 6, g.top - 14);
  }
  if (now) {
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.font = `300 ${Math.max(28, Math.min(64, h * 0.1))}px system-ui, sans-serif`;
    c.fillText(chordName(now, { shift: S.semis, key: keyObj }), w / 2, Math.max(30, g.top * 0.38));
  }
  // Curva real de la voz (fina, tenue): cómo cantó de verdad.
  if (S.f0) {
    c.strokeStyle = 'rgba(255,210,63,.28)'; c.lineWidth = 1.2; c.beginPath();
    let pen = false;
    const a = Math.max(0, Math.floor(t0 / S.hop)), b = Math.min(S.f0.length, Math.ceil(t1 / S.hop));
    let ni = 0;
    const leadL = S.leadShown;
    for (let i = a; i < b; i++) {
      const f = S.f0[i];
      if (!(f > 0) || S.conf[i] < 0.6) { pen = false; continue; }
      const tt = i * S.hop;
      while (ni < leadL.length && leadL[ni].e < tt) ni++;
      const n = leadL[ni];
      const m = 69 + 12 * Math.log2(f / 440);
      if (!n || n.s - 0.08 > tt || Math.abs(m - n.m) > 2.5) { pen = false; continue; }
      const x = g.x(tt), y = g.y(m);
      if (pen) c.lineTo(x, y); else c.moveTo(x, y);
      pen = true;
    }
    c.stroke();
  }
  // Las voces: líneas de luz con curvas suaves entre notas.
  const order = ['v3', 'v2', 'lead'];
  const labels = [];
  for (const v of order) {
    const list = listOf(v), ch = S.ch[v];
    const audible = Object.values(S.ch).some((q) => q.solo) ? ch.solo : ch.on;
    if (!audible && v === 'lead' && !S.ch.lead.on) { /* la melodía se dibuja siempre, más tenue si está callada */ }
    c.save();
    c.globalAlpha = audible || v === 'lead' ? 1 : 0.4;
    c.strokeStyle = ch.color; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.shadowColor = ch.color; c.shadowBlur = 16;
    c.beginPath();
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.e < t0 - 1 || n.s > t1 + 1) { prev = null; continue; }
      if (n.off) { prev = null; continue; }
      const xs = g.x(n.s), xe = g.x(n.e), y = g.y(n.m);
      // Dentro de una frase (respiros y consonantes cortos) la línea sigue, con una curva suave.
      if (prev && n.s - prev.e < 0.6) {
        const px = g.x(prev.e), py = g.y(prev.m);
        if (py === y) c.lineTo(xs, y);
        else { const k = Math.min(18, (xs - px) / 2 + 8); c.lineTo(Math.max(px, xs - k * 2), py); c.bezierCurveTo(xs - k, py, xs - k, y, xs, y); }
      } else c.moveTo(xs, y);
      c.lineTo(xe, y);
      prev = n;
    }
    c.stroke();
    c.shadowBlur = 0; c.lineWidth = 1.4; c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
    // Nota seleccionada
    if (S.sel && S.sel.v === v) {
      const n = list[S.sel.i];
      if (n) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.setLineDash([4, 3]); c.strokeRect(g.x(n.s) - 4, g.y(n.m) - 9, g.x(n.e) - g.x(n.s) + 8, 18); c.setLineDash([]); }
    }
    c.restore();
    // Punto en la línea de «ahora» y nombre de la nota.
    const on = list.find((n) => !n.off && n.s <= g.t && g.t < n.e);
    if (on) labels.push({ v, y: g.y(on.m), name: noteName(on.m + S.semis, S.flats), color: ch.color, dim: !audible && v !== 'lead' });
  }
  // Línea de «ahora».
  const hx = w * HEAD;
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx, g.top - 26); c.lineTo(hx, g.bottom + 8); c.stroke();
  labels.sort((a, b) => a.y - b.y);
  let lastY = -99;
  for (const l of labels) {
    c.save(); c.globalAlpha = l.dim ? 0.45 : 1;
    c.fillStyle = l.color; c.shadowColor = l.color; c.shadowBlur = 12;
    c.beginPath(); c.arc(hx, l.y, 6, 0, Math.PI * 2); c.fill();
    const ly = Math.max(l.y, lastY + 18); lastY = ly;
    c.shadowBlur = 8; c.font = '800 15px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(l.name, hx + 14, ly);
    c.restore();
  }
}

// «Volver a analizar»: olvida el análisis guardado de la canción (melodía, estilo, tono y
// correcciones) y abre el estudio otra vez, que vuelve a escuchar la melodía con la versión actual.
async function reanalyze() {
  if (!S || !S.openArgs) return;
  const { song, opts } = S.openArgs;
  const edited = S.edits && Object.keys(S.edits).length;
  const ok = await confirmDialogAsync({
    title: 'Volver a analizar',
    message: `Se vuelve a escuchar la melodía de «${(song && song.title) || 'la canción'}» con la versión actual del estudio.${edited ? ' Se perderán las notas que corregiste a mano.' : ''} ¿Continuar?`,
    confirmLabel: 'Volver a analizar', danger: !!edited,
  });
  if (!ok || !S) return;
  if (song) {
    delete song.harmony;
    try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {}
    window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id } }));
  }
  close();
  openVoiceStudio(song, opts);
}

function close() {
  if (!S) return;
  const s = S; S = null;
  cancelAnimationFrame(s.raf);
  clearTimeout(renderTimer); clearTimeout(s.realTimer);
  document.removeEventListener('keydown', onKey, true);
  for (const p of Object.values(s.players)) { try { p.pause(); } catch (_) {} }
  try { s.choir && s.choir.stop(); } catch (_) {}
  try { s.ctx && s.ctx.close(); } catch (_) {}
  try { s.popModal && s.popModal(); } catch (_) {}
  s.ov.remove();
}

export const isVoiceStudioOpen = () => !!S;

/** Para las pruebas automáticas: un resumen del estado (sin tocarlo). */
export function _vsDebug() {
  if (!S) return null;
  return { timing: S.timing, ready: S.ready, lead: S.lead.length, v2: S.voices.v2.length, v3: S.voices.v3.length, chords: S.chords.length, key: S.key, t: S.t, dur: S.dur, playing: S.playing, real: !!S.real.v2, src: { v2: S.ch.v2.src, v3: S.ch.v3.src }, style: S.style, sel: S.sel, edits: S.edits };
}
export function _vsSelect(v, i) { if (S) select({ v, i }); }
/** Para las pruebas automáticas: nivel (RMS) de cada fuente durante `ms` milisegundos. */
export async function _vsLevels(ms = 800) {
  if (!S || !S.ctx) return null;
  const taps = {};
  const tap = (id, node) => { const an = S.ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); taps[id] = { an, node, sum: 0, n: 0 }; };
  for (const id of ['lead', 'v2', 'v3']) if (S.choir) tap('coro_' + id, S.choir.outputs[id]);
  for (const id of ['mix', 'vocal', 'v2', 'v3']) if (S.players[id]) tap('audio_' + id, S.players[id].output);
  const buf = new Float32Array(2048);
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    for (const t of Object.values(taps)) { t.an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; t.sum += e / buf.length; t.n++; }
    await new Promise((r) => setTimeout(r, 40));
  }
  const out = {};
  for (const [id, t] of Object.entries(taps)) { out[id] = +Math.sqrt(t.sum / Math.max(1, t.n)).toFixed(4); try { t.node.disconnect(t.an); } catch (_) {} }
  return out;
}
/** Para las pruebas: una nota larga de la 2.ª voz { s, e } y saltar a un tiempo. */
export function _vsLongNote() { if (!S) return null; const n = S.voices.v2.filter((x) => !x.off).sort((a, b) => (b.e - b.s) - (a.e - a.s))[0]; return n ? { s: n.s, e: n.e, m: n.m } : null; }
export function _vsSeek(t) { if (S) seek(t); }
