// Panel de administración de la biblioteca de stems (solo administradores):
// subir packs de loops desde la app y publicar/despublicar.
//
//   openPackUploader({ onChanged })
//
// Por cada WAV/FLAC se deduce título, instrumento y sección por el nombre
// (loopMeta.js), BPM con el detector de la app afinado a compases exactos, y
// tono con el detector de acordes (salvo batería/percusión/FX). Todo se puede
// corregir antes de subir. Se suben el audio original, una escucha previa
// ligera (mono ~24 kHz) y la portada; luego se registran pack y loops con la
// Edge Function stem-library-admin, que vuelve a comprobar el permiso.

import * as stemLibrary from '../cloud/stemLibrary.js';
import { detectTempoMeter } from './bpmDetector.js';
import { analyzeChords, keyName, CHORD_SR } from '../chords/chordEngine.js';
import { audioBufferToWav } from './clickGenerator.js';
import { guessFromFilename, pickTempo, slugify, safeFileName, UNPITCHED } from './loopMeta.js';
import { esc } from '../utils/dom.js';
import { showToast } from '../ui/toast.js';

const INSTRUMENTS = {
  drums: 'Batería', perc: 'Percusión', bass: 'Bajo', keys: 'Teclas', pad: 'Pad', synth: 'Synth',
  guitar: 'Guitarra', strings: 'Cuerdas', vocals: 'Voces', fx: 'FX', other: 'Otros',
};
const SECTIONS = { any: 'Cualquiera', intro: 'Intro', verse: 'Verso', prechorus: 'Pre-coro', chorus: 'Coro', bridge: 'Puente', build: 'Build', outro: 'Outro' };
const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const opts = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

// ── Análisis de un archivo ─────────────────────────────────────────────────
async function decode(arrayBuffer) {
  const ctx = new OfflineAudioContext(2, 1, 48000);
  return ctx.decodeAudioData(arrayBuffer.slice(0));
}

async function renderMono(buffer, sampleRate) {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

async function detectKey(buffer) {
  try {
    const mono = await renderMono(buffer, CHORD_SR);
    const k = keyName(analyzeChords(new Float32Array(mono.getChannelData(0))));
    return KEYS.includes(k) ? k : null;
  } catch (_) { return null; }
}

async function analyzeFile(file) {
  const bytes = await file.arrayBuffer();
  const buffer = await decode(bytes);
  const guess = guessFromFilename(file.name);
  const detected = guess.bpmHint ? null : (detectTempoMeter(buffer)?.bpmFloat || null);
  const { bpm, bars } = pickTempo(buffer.duration, detected, { hintBpm: guess.bpmHint });
  const key = UNPITCHED.has(guess.instrument) ? null : await detectKey(buffer);
  return { file, bytes, buffer, title: guess.title, instrument: guess.instrument, section: guess.section, bpm, bars, key, tier: null,
    hintBpm: guess.bpmHint, detectedBpm: detected };
}

// Los loops de un pack suelen compartir tempo: el BPM fiable (el del nombre de
// algún archivo) corrige a los que solo tienen el del detector.
function harmonizeTempo(rows) {
  const hints = rows.map((r) => r.hintBpm).filter(Boolean);
  if (!hints.length) return;
  const counts = new Map();
  hints.forEach((h) => counts.set(h, (counts.get(h) || 0) + 1));
  const packBpm = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  for (const r of rows) {
    if (r.hintBpm || r.edited) continue;
    Object.assign(r, pickTempo(r.buffer.duration, r.detectedBpm, { packBpm }));
  }
}

// Duración esperada vs real: si no cuadra, el loop se desfasaría en el editor.
const durationOk = (r) => Math.abs(r.buffer.duration - r.bars * 4 * 60 / r.bpm) < 0.05;

// ── Ventana ────────────────────────────────────────────────────────────────
export function openPackUploader({ onChanged } = {}) {
  document.getElementById('spu-overlay')?.remove();
  const state = { packs: [], rows: [], cover: null, busy: false, tab: 'upload' };

  const overlay = document.createElement('div');
  overlay.id = 'spu-overlay';
  overlay.className = 'stb-overlay';
  overlay.innerHTML = `
    <div class="stb-modal spu-modal" role="dialog" aria-modal="true" aria-label="Administrar biblioteca de stems">
      <header class="stb-head">
        <h3>Biblioteca de stems · Administración</h3>
        <button type="button" class="stl-x" data-act="close" aria-label="Cerrar">×</button>
      </header>
      <div class="spu-tabs" role="tablist">
        <button type="button" class="is-on" data-tab="upload" role="tab">Subir pack</button>
        <button type="button" data-tab="packs" role="tab">Mis packs</button>
      </div>

      <section data-pane="upload" class="spu-pane">
        <div class="spu-target">
          <label><input type="radio" name="spu-mode" value="new" checked> Pack nuevo</label>
          <label><input type="radio" name="spu-mode" value="existing"> Agregar a un pack existente
            <select data-ref="existing" disabled></select></label>
        </div>
        <div class="spu-pack" data-ref="newpack">
          <label>Nombre <input data-ref="title" placeholder="Ej. Adoración íntima vol. 1" maxlength="120"></label>
          <label>Descripción <input data-ref="desc" maxlength="500" placeholder="Opcional"></label>
          <label>Género <input data-ref="genre" maxlength="60" placeholder="worship, pop…"></label>
          <label>Marca por defecto <select data-ref="tier"><option value="pro">PRO</option><option value="free">GRATIS</option></select></label>
        </div>
        <div class="spu-cover">
          <div class="spu-cover-img" data-ref="coverPreview">Sin portada</div>
          <div>
            <button type="button" class="stb-btn" data-act="cover">Elegir portada</button>
            <span class="spu-note">JPG, PNG o WebP, cuadrada (mín. 500 px).</span>
          </div>
          <input type="file" data-ref="coverInput" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
        <div class="spu-drop" data-ref="drop">
          Arrastra aquí los loops en <b>WAV</b> o <b>FLAC</b>, o <button type="button" class="stb-btn" data-act="files">elige archivos</button>
          <input type="file" data-ref="filesInput" accept=".wav,.flac,audio/wav,audio/flac" multiple hidden>
          <div class="spu-note">MP3 y M4A no: añaden silencio al principio y el loop se desfasaría.</div>
        </div>
        <div class="stb-grid-wrap"><table class="stb-grid" data-ref="rows"></table></div>
        <div class="spu-progress" data-ref="progress" hidden role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="spu-progress-bar" data-ref="bar"></div>
        </div>
        <footer class="stb-foot">
          <label><input type="checkbox" data-ref="publish"> Publicar al terminar</label>
          <span class="stb-total" data-ref="status"></span>
          <button type="button" class="stb-btn stb-btn--primary" data-act="upload" disabled>Subir</button>
        </footer>
      </section>

      <section data-pane="packs" class="spu-pane" hidden>
        <div class="spu-packs" data-ref="packList"><div class="stb-empty">Cargando…</div></div>
      </section>
    </div>`;
  document.body.appendChild(overlay);
  const ref = (n) => overlay.querySelector(`[data-ref="${n}"]`);
  const mode = () => overlay.querySelector('input[name="spu-mode"]:checked').value;

  // ── Packs existentes ──
  async function loadPacks() {
    try { state.packs = await stemLibrary.adminListPacks(); }
    catch (e) { ref('packList').innerHTML = `<div class="stb-empty">No se pudo cargar: ${esc(e.message)}</div>`; return; }
    ref('existing').innerHTML = state.packs.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}${p.published ? '' : ' (borrador)'}</option>`).join('');
    renderPackList();
  }

  async function renderPackList() {
    if (!state.packs.length) { ref('packList').innerHTML = '<div class="stb-empty">Todavía no hay packs.</div>'; return; }
    ref('packList').innerHTML = state.packs.map((p) => `
      <div class="spu-packrow" data-pack="${esc(p.id)}">
        <div class="spu-thumb" data-cover="${esc(p.id)}"></div>
        <div class="spu-packinfo"><b>${esc(p.title)}</b><span>${p.loops} loop${p.loops === 1 ? '' : 's'} · marca por defecto ${p.tier === 'free' ? 'GRATIS' : 'PRO'}</span></div>
        <label class="spu-pub"><input type="checkbox" data-publish="${esc(p.id)}"${p.published ? ' checked' : ''}> Publicado</label>
      </div>`).join('');
    for (const p of state.packs) {
      stemLibrary.ensureCoverLocal(p).then((url) => {
        const el = overlay.querySelector(`[data-cover="${CSS.escape(p.id)}"]`);
        if (url && el) el.style.backgroundImage = `url("${url}")`;
      }).catch(() => {});
    }
  }

  // ── Filas de loops ──
  function renderRows() {
    const rows = state.rows;
    const defTier = mode() === 'new' ? ref('tier').value : (state.packs.find((p) => p.id === ref('existing').value)?.tier || 'pro');
    ref('rows').innerHTML = !rows.length ? '' : `
      <thead><tr><th>Título</th><th>Instrumento</th><th>Sección</th><th>BPM</th><th>Compases</th><th>Tono</th><th>Marca</th><th></th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-row="${i}">
        <td><input data-f="title" value="${esc(r.title)}" maxlength="120"></td>
        <td><select data-f="instrument">${opts(INSTRUMENTS, r.instrument)}</select></td>
        <td><select data-f="section">${opts(SECTIONS, r.section)}</select></td>
        <td><input data-f="bpm" type="number" min="20" max="300" step="0.01" value="${r.bpm}"></td>
        <td><input data-f="bars" type="number" min="1" max="64" value="${r.bars}"></td>
        <td><select data-f="key"><option value="">sin tono</option>${KEYS.map((k) => `<option${k === r.key ? ' selected' : ''}>${k}</option>`).join('')}</select></td>
        <td><select data-f="tier">${opts({ free: 'GRATIS', pro: 'PRO' }, r.tier || defTier)}</select></td>
        <td class="spu-check" title="${durationOk(r) ? 'La duración cuadra con BPM y compases' : `Dura ${r.buffer.duration.toFixed(2)} s, pero ${r.bars} compases a ${r.bpm} BPM son ${(r.bars * 240 / r.bpm).toFixed(2)} s`}">${durationOk(r) ? '✓' : '⚠'}</td>
        <td><button type="button" class="stb-del" data-del="${i}" aria-label="Quitar">×</button></td>
      </tr>`).join('')}</tbody>`;
    refreshButton();
  }

  function refreshButton() {
    const named = mode() === 'existing' ? !!ref('existing').value : !!ref('title').value.trim();
    overlay.querySelector('[data-act="upload"]').disabled = state.busy || !state.rows.length || !named;
  }

  async function addFiles(files) {
    const list = [...files].filter((f) => /\.(wav|flac)$/i.test(f.name));
    const skipped = files.length - list.length;
    if (skipped) showToast(`${skipped} archivo${skipped > 1 ? 's' : ''} ignorado${skipped > 1 ? 's' : ''}: solo WAV o FLAC.`, 'info');
    ref('status').textContent = `Analizando ${list.length} archivo${list.length === 1 ? '' : 's'}…`;
    for (const f of list) {
      try { state.rows.push(await analyzeFile(f)); renderRows(); }
      catch (e) { console.warn('No se pudo analizar', f.name, e); showToast(`No se pudo leer ${f.name}.`, 'error'); }
    }
    harmonizeTempo(state.rows);
    renderRows();
    ref('status').textContent = '';
  }

  // ── Subida ──
  async function upload() {
    state.busy = true; refreshButton();
    // Progreso por bytes: audio + escucha previa (~¼ del audio) + portada.
    const total = state.rows.reduce((n, r) => n + r.bytes.byteLength * 1.25, 0) + (state.cover?.size || 0);
    let done = 0, label = '';
    const pct = () => Math.min(100, Math.round((done / Math.max(1, total)) * 100));
    const paint = () => {
      ref('progress').hidden = false;
      ref('bar').style.width = `${pct()}%`;
      ref('progress').setAttribute('aria-valuenow', String(pct()));
      ref('status').textContent = label ? `${label} · ${pct()} %` : '';
    };
    const status = (t) => { label = t; paint(); };
    const advance = (bytes) => { done += bytes; paint(); };
    try {
      let pack;
      if (mode() === 'existing') {
        pack = state.packs.find((p) => p.id === ref('existing').value);
      } else {
        let slug = slugify(ref('title').value);
        const taken = new Set(state.packs.map((p) => p.slug));
        for (let n = 2; taken.has(slug); n++) slug = `${slugify(ref('title').value)}-${n}`;
        pack = { slug, title: ref('title').value.trim(), description: ref('desc').value.trim(), genre: ref('genre').value.trim(), tier: ref('tier').value, published: false };
      }
      let coverPath;
      if (state.cover) {
        status('Subiendo portada…');
        coverPath = `${pack.slug}/cover.${IMAGE_TYPES[state.cover.type]}`;
        await stemLibrary.adminUpload(coverPath, await state.cover.arrayBuffer(), state.cover.type);
        advance(state.cover.size);
      }
      const saved = await stemLibrary.adminSavePack({
        slug: pack.slug, title: pack.title, description: pack.description || '', genre: pack.genre || '',
        mood: pack.mood || '', tier: pack.tier, published: !!pack.published,
        ...(coverPath ? { cover_path: coverPath } : {}),
      });
      const used = new Set();
      const loops = [];
      for (const [i, r] of state.rows.entries()) {
        status(`Subiendo ${i + 1} de ${state.rows.length}: ${r.title}…`);
        let name = safeFileName(r.file.name);
        while (used.has(name)) name = `${i}-${name}`;
        used.add(name);
        const ct = /\.flac$/i.test(name) ? 'audio/flac' : 'audio/wav';
        const audioPath = `${pack.slug}/${name}`;
        await stemLibrary.adminUpload(audioPath, r.bytes, ct);
        advance(r.bytes.byteLength);
        const preview = audioBufferToWav(await renderMono(r.buffer, 24000));
        const previewPath = `${pack.slug}/preview/${name.replace(/\.flac$/i, '.wav')}`;
        await stemLibrary.adminUpload(previewPath, preview, 'audio/wav');
        advance(r.bytes.byteLength * 0.25);
        loops.push({
          title: r.title, instrument: r.instrument, section: r.section, bpm: r.bpm, bars: r.bars,
          musical_key: r.key || null, beats_per_bar: 4, tier: r.tier || pack.tier,
          audio_path: audioPath, preview_path: previewPath, size: r.bytes.byteLength,
          duration_sec: Math.round(r.buffer.duration * 1000) / 1000, sort: i,
        });
      }
      status('Registrando en la biblioteca…');
      await stemLibrary.adminAddLoops(saved.id, loops);
      if (ref('publish').checked && !saved.published) await stemLibrary.adminSetPublished(saved.id, true);
      showToast(`Pack "${saved.title}" subido con ${loops.length} loop${loops.length === 1 ? '' : 's'}${ref('publish').checked ? ' y publicado' : ' (borrador)'}.`, 'success');
      state.rows = []; state.cover = null;
      ref('coverPreview').textContent = 'Sin portada'; ref('coverPreview').style.backgroundImage = '';
      renderRows();
      await loadPacks();
      onChanged?.();
    } catch (e) {
      console.warn('Subida de pack falló:', e);
      showToast(`No se pudo subir: ${e.message}`, 'error');
    } finally {
      label = ''; ref('status').textContent = '';
      ref('progress').hidden = true; ref('bar').style.width = '0%';
      state.busy = false; refreshButton();
    }
  }

  // ── Eventos ──
  const close = () => {
    if (state.busy) { showToast('Espera a que termine la subida.', 'info'); return; }
    window.removeEventListener('keydown', onKey, true); overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (act === 'close') close();
    else if (act === 'files') ref('filesInput').click();
    else if (act === 'cover') ref('coverInput').click();
    else if (act === 'upload') upload();
    else if (del != null) { state.rows.splice(Number(del), 1); renderRows(); }
    else if (tab) {
      overlay.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
      overlay.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    }
  });

  overlay.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'spu-mode') {
      ref('existing').disabled = mode() !== 'existing';
      ref('newpack').hidden = mode() !== 'new';
      renderRows();
    } else if (t === ref('existing') || t === ref('tier')) renderRows();
    else if (t === ref('filesInput')) { await addFiles(t.files); t.value = ''; }
    else if (t === ref('coverInput')) {
      const f = t.files[0];
      if (f && IMAGE_TYPES[f.type]) {
        state.cover = f;
        ref('coverPreview').textContent = '';
        ref('coverPreview').style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
      }
      t.value = '';
    } else if (t.dataset.publish) {
      const id = t.dataset.publish;
      try {
        await stemLibrary.adminSetPublished(id, t.checked);
        const p = state.packs.find((x) => x.id === id); if (p) p.published = t.checked;
        showToast(t.checked ? 'Pack publicado.' : 'Pack despublicado.', 'success');
        onChanged?.();
      } catch (err) { t.checked = !t.checked; showToast(`No se pudo cambiar: ${err.message}`, 'error'); }
    } else if (t.dataset.f) {
      const r = state.rows[Number(t.closest('[data-row]').dataset.row)];
      const f = t.dataset.f;
      r[f] = (f === 'bpm' || f === 'bars') ? Number(t.value) : (t.value || null);
      if (f === 'bpm' || f === 'bars') { r.edited = true; renderRows(); }
    }
  });
  overlay.addEventListener('input', (e) => {
    if (e.target === ref('title')) refreshButton();
    if (e.target.dataset.f === 'title') state.rows[Number(e.target.closest('[data-row]').dataset.row)].title = e.target.value;
  });

  const drop = ref('drop');
  drop.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('is-over'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); });

  loadPacks();
}
