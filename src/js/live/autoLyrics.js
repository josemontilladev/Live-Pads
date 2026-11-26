// ─────────────────────────────────────────────────────────────────────────
// Letra automática (IA, en este equipo): LivePads escucha la voz de la canción
// y escribe un BORRADOR de la letra, con las secciones marcadas como títulos.
//   1. La voz: la pista «Voz» de la canción si ya existe; si no, se separa del
//      original (modelo de voces) y se guarda para la próxima vez.
//   2. Whisper (base ~75 MB, o small ~240 MB para más precisión) la transcribe.
//   3. El borrador se revisa en la ventana y se usa como letra (o se añade).
// El reconocimiento de voz cantada se equivoca a veces: por eso es un borrador.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { getSongs } from '../state/store.js';
import { markersFor } from '../data/markers.js';
import { buildLyricsDraft } from './lyricsDraftCore.js';
import { confirmDialogAsync } from '../ui/dialog.js';

const PREF = 'livepads.autoLyrics.size';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

async function readBuffer(ctx, url) {
  const arr = /^(livepads:|file:)/i.test(url) && window.electronAPI?.readAudioFile ? await window.electronAPI.readAudioFile(url) : await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(arr.slice ? arr.slice(0) : arr);
}
async function to16kMono(buf) {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

async function vocalOf(song, step) {
  const api = window.electronAPI;
  const audio = song.audio || {};
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const stem = Array.isArray(audio.stems) ? audio.stems.find((x) => x && x.kind === 'vocals' && x.url) : null;
  if (stem) {
    step(0.05, 'Cargando la voz de la canción…');
    try { return await readBuffer(ctx, stem.url); } catch (_) { /* si falla, se separa */ }
  }
  if (!audio.original) throw new Error('Esta canción necesita el ORIGINAL (la grabación con la voz). Añádelo desde el menú de la canción: «Subir original» u «Original desde YouTube».');
  if (!api?.stemsSeparate) throw new Error('Esta versión no puede separar la voz.');
  step(0.05, 'Cargando el original…');
  const mix = await readBuffer(ctx, audio.original);
  const off = api.onStemsSeparateProgress?.(({ fraction }) => step(0.05 + 0.4 * (fraction || 0), 'Separando la voz del original (solo la primera vez)…'));
  let res;
  try {
    const ch0 = mix.getChannelData(0).slice(), ch1 = mix.numberOfChannels > 1 ? mix.getChannelData(1).slice() : ch0;
    res = await api.stemsSeparate({ channels: [ch0, ch1], sampleRate: mix.sampleRate, mode: 'voz' });
  } finally { try { off && off(); } catch (_) {} }
  if (!res || res.cancelled || !Array.isArray(res.stems)) throw new Error('Se canceló la separación de la voz.');
  const v = res.stems.find((x) => x.kind === 'vocals') || res.stems[0];
  const chs = v.channels.map((c) => (c instanceof Float32Array ? c : new Float32Array(c)));
  const buf = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: res.sampleRate });
  chs.forEach((c, i) => buf.copyToChannel(c, i));
  // Guardar la voz en la canción (para la próxima vez, el Estudio de voces y Stems).
  if (api.saveSongStem) {
    (async () => {
      try {
        const { encodeMp3Async } = await import('../audio/mp3Pool.js');
        const mp3 = await encodeMp3Async(buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, buf.sampleRate, 160);
        const { songSlug, attachStem } = await import('../stems/songStems.js');
        const url = await api.saveSongStem({ buffer: mp3, songSlug: songSlug(song), name: 'Voz (separada)', ext: 'mp3' });
        attachStem(song, { url, name: 'Voz (separada)', kind: 'vocals' });
        api.saveGiSetlist?.(getSongs());
        window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id, stems: true } }));
      } catch (_) {}
    })();
  }
  return buf;
}

export function openAutoLyrics(song) {
  if (!song || document.getElementById('alyr-box')) return;
  const api = window.electronAPI;
  if (!api?.lyricsTranscribe) { window.showToast?.('Esta versión no puede sacar la letra.', 'error'); return; }
  let size = 'small';
  try { size = localStorage.getItem(PREF) === 'base' ? 'base' : 'small'; } catch (_) {}
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box alyr-box" id="alyr-box" role="dialog" aria-modal="true" aria-label="Sacar la letra con IA">
      <div class="vn-head"><b>Sacar la letra con IA</b><span>«${esc(song.title)}»: LivePads escucha la voz y escribe un borrador de la letra (en este equipo, sin internet). Revísalo antes de usarlo.</span></div>
      <div class="ui-seg alyr-size" role="group" aria-label="Precisión">
        <button type="button" class="ui-seg-btn" data-size="base" title="Rápido. Usa el reconocimiento de voz de 75 MB">Normal</button>
        <button type="button" class="ui-seg-btn" data-size="small" title="Entiende mejor la voz cantada. La primera vez baja unos 240 MB y tarda más">Alta precisión</button>
      </div>
      <div class="mt-progress" data-ref="prog" hidden><div class="vs-bar"><i data-ref="bar"></i></div><small data-ref="step"></small></div>
      <textarea class="alyr-text" data-ref="text" spellcheck="true" hidden aria-label="Borrador de la letra"></textarea>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cerrar</button>
        <button type="button" class="vn-btn" data-act="append" hidden>Añadir al final de la letra</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="go">Sacar la letra</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let busy = false;
  const close = () => { if (busy) { api.lyricsTranscribeCancel?.(); } pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const paintSize = () => ov.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', b.dataset.size === size));
  const step = (f, txt) => { $('[data-ref="prog"]').hidden = false; $('[data-ref="bar"]').style.width = `${Math.round(f * 100)}%`; $('[data-ref="step"]').textContent = txt; };
  paintSize();

  const run = async () => {
    busy = true;
    const go = $('[data-act="go"]'); go.disabled = true;
    ov.querySelectorAll('[data-size]').forEach((b) => { b.disabled = true; });
    const offP = api.onLyricsProgress?.((d) => step(0.5 + 0.5 * (d.frac || 0), d.label || 'Escuchando la letra…'));
    try {
      const vocal = await vocalOf(song, step);
      step(0.5, 'Preparando la voz…');
      const pcm = await to16kMono(vocal);
      const r = await api.lyricsTranscribe({ pcm, size });
      const segs = (r && r.segments) || [];
      if (!segs.length) throw new Error('No se entendió ninguna frase. Prueba «Alta precisión» o revisa que la pista tenga voz.');
      const draft = buildLyricsDraft(segs, markersFor(song, song.audio && song.audio.original ? 'original' : 'sequence'));
      const ta = $('[data-ref="text"]');
      ta.value = draft; ta.hidden = false;
      $('[data-ref="prog"]').hidden = true;
      go.textContent = 'Usar como letra'; go.dataset.act = 'use'; go.disabled = false;
      $('[data-act="append"]').hidden = !(song.lyrics && song.lyrics.trim());
      window.__lpAutoLyrics = { lang: r.lang, segments: segs.length };
    } catch (e) {
      step(0, String((e && e.message) || e));
      go.disabled = false;
      ov.querySelectorAll('[data-size]').forEach((b) => { b.disabled = false; });
    } finally { busy = false; try { offP && offP(); } catch (_) {} }
  };
  const save = async (mode) => {
    const text = $('[data-ref="text"]').value.trim();
    if (!text) return;
    if (mode === 'replace' && song.lyrics && song.lyrics.trim()) {
      const ok = await confirmDialogAsync({ title: 'Reemplazar la letra', message: `«${song.title}» ya tiene letra. ¿Reemplazarla por este borrador?`, confirmLabel: 'Reemplazar', danger: true });
      if (!ok) return;
    }
    song.lyrics = mode === 'append' && song.lyrics ? `${song.lyrics.trimEnd()}\n\n${text}\n` : `${text}\n`;
    api.saveGiSetlist?.(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id } }));
    window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
    window.showToast?.(`Letra de «${song.title}» guardada (borrador de la IA: revísala con la canción).`, 'success');
    close();
  };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="cancel"]')) { close(); return; }
    const sz = e.target.closest('[data-size]');
    if (sz && !busy) { size = sz.dataset.size; try { localStorage.setItem(PREF, size); } catch (_) {} paintSize(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'go' && !busy) run();
    else if (act === 'use') save('replace');
    else if (act === 'append') save('append');
  });
}
