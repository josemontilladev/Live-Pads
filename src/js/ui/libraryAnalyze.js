// ─────────────────────────────────────────────────────────────────────────
// Analizar toda la librería en cola (Ajustes → Biblioteca de audios, Buscador).
// Para cada canción, y para cada audio que tenga (secuencia y original):
//   pulsos y compases · acordes · secciones (solo si no tiene) · volumen y masterizado.
// Todo queda guardado (las mismas cachés que usa la app al cargar la canción), así que
// el domingo cada canción llega lista. De una en una; mientras suena música se pone en
// pausa sola para no quitarle procesador al directo. Se puede parar y seguir otro día.
// ─────────────────────────────────────────────────────────────────────────

import { getSongs } from '../state/store.js';
import { analyzeBeats, trackKey, gridFrom } from '../analysis/beatGrid.js';
import { analyzeBufferCached, trackChordId } from '../chords/trackChords.js';
import { markersFor, withMarkersFor } from '../data/markers.js';
import { bufferLoudness, bufferMaster } from '../audio/loudness.js';
import { isSounding } from '../state/performing.js';
import { pushModal } from './modalStack.js';

const DONE_KEY = 'livepads.libAnalyzed.v1';
const SLOTS = ['sequence', 'original'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDone() { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {}; } catch (_) { return {}; } }
function markDone(k) { const d = readDone(); d[k] = Date.now(); try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (_) {} }
const jobKey = (song, slot) => `${song.cloudId || song.id}|${slot}|${song.audio[slot]}`;

/** Pistas de la librería con audio: [{ song, slot, done }]. */
export function libraryJobs() {
  const d = readDone();
  const out = [];
  for (const s of getSongs()) for (const slot of SLOTS) if (s && s.audio && s.audio[slot]) out.push({ song: s, slot, done: !!d[jobKey(s, slot)] });
  return out;
}

async function decode(url) {
  let href = url;
  if (!/^(livepads|https?|file|blob):/i.test(url)) {
    const abs = await window.electronAPI.getAbsolutePath(url.replace('../assets/', 'assets/'));
    href = encodeURI('file:///' + String(abs).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  const res = await fetch(href);
  if (!res.ok) throw new Error('No se encontró el audio');
  const bytes = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  return ctx.decodeAudioData(bytes);
}

/** Analiza una pista. → { sections: n|null } */
export async function analyzeJob({ song, slot }, onStep = () => {}) {
  onStep('Abriendo el audio…');
  const buffer = await decode(song.audio[slot]);
  onStep('Pulsos y compases…');
  const beats = await analyzeBeats(buffer, trackKey(song, slot, buffer));
  onStep('Acordes…');
  try { await analyzeBufferCached(trackChordId(song, slot, buffer), buffer); } catch (_) {}
  onStep('Volumen y sonido…');
  const id = `${song.id || song.title}.${slot}.${Math.round(buffer.duration)}`;
  try { bufferLoudness(id, buffer); bufferMaster(id, buffer, slot === 'sequence'); } catch (_) {}
  let sections = null;
  if (!markersFor(song, slot).length) {
    onStep('Secciones…');
    try {
      const { computeSections } = await import('./seqWaveform.js');
      const { found } = await computeSections(song, buffer, slot, Promise.resolve(gridFrom(beats)));
      if (found && found.length >= 2) {
        let n = 0;
        song.markers = withMarkersFor(song, slot, found.map((m) => ({ id: `auto_${Date.now().toString(36)}_${n++}`, label: m.label, t: m.t, auto: true })));
        sections = found.length;
      }
    } catch (e) { console.warn('[LivePads] secciones en lote:', e); }
  }
  markDone(jobKey(song, slot));
  return { sections };
}

let run = null;   // { stop, paused } mientras se analiza

export function openLibraryAnalyze() {
  if (document.getElementById('lba-box')) return;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `<div class="vn-box lba-box" id="lba-box" role="dialog" aria-modal="true" aria-label="Analizar toda la librería">
    <div class="vn-head"><b>Analizar toda la librería</b><span>Pulsos, compases, acordes, secciones y volumen de cada canción, para que el domingo todo llegue listo. Va de una en una y se pone en pausa mientras suena música.</span></div>
    <div class="lba-body" data-ref="body"></div>
    <div class="vn-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn vn-btn--primary" data-act="go"></button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  let status = '', log = [];

  function paint() {
    const jobs = libraryJobs();
    const done = jobs.filter((j) => j.done).length, left = jobs.length - done;
    $('[data-ref="body"]').innerHTML = `
      <div class="lba-sum"><b>${done}</b> de <b>${jobs.length}</b> pistas analizadas${left ? ` · faltan ${left}` : ' ✓'}</div>
      <div class="lba-bar"><i style="width:${jobs.length ? Math.round((100 * done) / jobs.length) : 0}%"></i></div>
      ${status ? `<p class="lba-status" aria-live="polite">${esc(status)}</p>` : ''}
      ${log.length ? `<ul class="lba-log">${log.slice(-6).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      ${!jobs.length ? '<p class="red-none">Ninguna canción tiene todavía secuencia u original.</p>' : ''}`;
    const go = $('[data-act="go"]');
    go.hidden = !jobs.length || (!left && !run);
    go.textContent = run ? 'Parar' : done ? `Analizar las ${left} que faltan` : `Analizar ${left} pistas`;
  }

  async function start() {
    if (run) { run.stop = true; status = 'Parando al terminar esta pista…'; paint(); return; }
    run = { stop: false };
    const save = () => { try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {} };
    paint();
    try {
      for (const job of libraryJobs().filter((j) => !j.done)) {
        if (run.stop) break;
        while (isSounding() && !run.stop) { status = 'En pausa: está sonando música. Sigue sola al parar.'; if (ov.isConnected) paint(); await sleep(2000); }
        if (run.stop) break;
        const name = `«${job.song.title}» (${job.slot === 'sequence' ? 'secuencia' : 'original'})`;
        try {
          const r = await analyzeJob(job, (step) => { status = `${name}: ${step}`; if (ov.isConnected) paint(); });
          log.push(`✓ ${name}${r.sections ? ` · ${r.sections} secciones` : ''}`);
          if (r.sections) { save(); window.dispatchEvent(new CustomEvent('livepads:songs-changed')); }
        } catch (e) {
          log.push(`✗ ${name}: ${(e && e.message) || e}`);
          markDone(jobKey(job.song, job.slot));   // no se reintenta en bucle; se ve en el registro
        }
        if (ov.isConnected) paint();
        await sleep(300);
      }
    } finally {
      const stopped = run && run.stop;
      run = null;
      status = stopped ? 'Parado. Puedes seguir cuando quieras.' : 'Listo: toda la librería está analizada.';
      if (ov.isConnected) paint();
      if (!stopped) window.showToast?.('✓ Librería analizada: pulsos, acordes, secciones y volumen listos.', 'success');
    }
  }

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    if (e.target.closest('[data-act="go"]')) start();
  });
  paint();
}
