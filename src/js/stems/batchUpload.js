// ─────────────────────────────────────────────────────────────────────────
// Subida por lotes a la Biblioteca de stems (administrador).
// Desde «Mis carpetas de multitracks» se marcan varios ZIP o carpetas y aquí:
//   1. ANALIZAR (en segundo plano, uno tras otro): título, artista, BPM y tono del
//      nombre; y se escuchan dos pistas para comprobarlo (el click → BPM; una
//      armónica → tono). Solo se decodifican esas dos: la memoria no se llena.
//   2. REVISAR: tabla editable con avisos (sin BPM, el nombre dice un tono y el
//      audio otro, artista dudoso, ya existe…) y la marca GRATIS / PRO de cada pack.
//   3. SUBIR: pack a pack y pista a pista (se lee, se comprime a MP3 en hilos aparte,
//      se sube y se suelta). Los packs quedan como borrador salvo «Publicar al terminar».
// La lógica de qué se deduce y qué se avisa está en batchCore.js (con pruebas).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { confirmDialogAsync } from '../ui/dialog.js';
import { detectStemRole } from './stemRole.js';
import { LIB_KEYS, packMeta, pickProbeTracks, resolveItem, reviewIssues, estimateCloudBytes, normKey } from './batchCore.js';

const AUDIO = /\.(wav|wave|mp3|flac)$/i;
const FREE_BYTES = 10 * 1024 ** 3;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const base = (n) => String(n || '').split(/[\\/]/).pop();
const fmt = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`).replace('.', ',');
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Audio ──────────────────────────────────────────────────────────────────
async function decode(bytes) {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return ctx.decodeAudioData(bytes.slice ? bytes.slice(0) : bytes);
}
/** Un trozo (del centro) de un AudioBuffer, en mono: basta para BPM y tono y es mucho más rápido. */
function excerpt(buf, secs) {
  const len = Math.min(buf.length, Math.round(secs * buf.sampleRate));
  const from = Math.max(0, Math.floor((buf.length - len) / 2));
  const out = new AudioBuffer({ length: len, sampleRate: buf.sampleRate, numberOfChannels: 1 });
  const o = out.getChannelData(0);
  const n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) o[i] += d[from + i] / n; }
  return out;
}
async function detectBpm(buf) {
  const { detectTempoMeter } = await import('./bpmDetector.js');
  const r = detectTempoMeter(excerpt(buf, 60));
  return r && r.bpmFloat > 0 ? r.bpmFloat : null;
}
async function detectKey(buf) {
  const { analyzeChords, keyName, CHORD_SR } = await import('../chords/chordEngine.js');
  const ex = excerpt(buf, 120);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(ex.duration * CHORD_SR)), CHORD_SR);
  const src = off.createBufferSource(); src.buffer = ex; src.connect(off.destination); src.start();
  const mono = await off.startRendering();
  return normKey(keyName(analyzeChords(new Float32Array(mono.getChannelData(0))))) || null;
}

let openBox = null;

/**
 * targets: [{ path, name, size }] de «Mis carpetas de multitracks».
 * onDone(): se llama al terminar de subir (para repintar la lista).
 */
export async function openBatchUpload(targets, { onDone, lib: libOverride = null } = {}) {
  const api = window.electronAPI;
  if ((openBox && openBox.el && openBox.el.isConnected) || !targets || !targets.length) return;
  // libOverride: solo para las pruebas (una biblioteca de mentira que no toca la nube).
  const lib = libOverride || await import('../cloud/stemLibrary.js');
  if (!(await lib.isLibraryAdmin().catch(() => false))) { window.showToast?.('Solo el administrador puede subir a la Biblioteca de stems.', 'error'); return; }
  let packs = [];
  try { packs = await lib.adminListPacks(); } catch (_) {}
  const existing = new Set(packs.map((p) => String(p.title || '').toLowerCase()));

  const items = targets.map((t, i) => ({ i, path: t.path, name: t.name, size: t.size || 0, files: [], roles: [], meta: packMeta(t.name), detected: null, edit: {}, tier: 'pro', state: 'pending', msg: '', removed: false }));
  const S = { analyzing: true, uploading: false, cancel: false, closed: false, publish: false };

  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box bu-box" role="dialog" aria-modal="true" aria-label="Subir por lotes a la Biblioteca de stems">
      <div class="vn-head"><b>Subir por lotes a la Biblioteca de stems</b>
        <span>Revisa lo que se dedujo de cada multitrack (lo dudoso sale en ámbar) y elige GRATIS o PRO. Los WAV se comprimen a MP3 al subir.</span></div>
      <div class="bu-tools">
        <span class="bu-sum" data-ref="sum"></span>
        <span class="bu-bulk">Todos:
          <button type="button" class="mtl-link" data-act="all-free">GRATIS</button>
          <button type="button" class="mtl-link" data-act="all-pro">PRO</button></span>
        <label class="bu-pub"><input type="checkbox" class="mo-switch" data-ref="publish"> Publicar al terminar</label>
      </div>
      <div class="bu-table-wrap"><table class="bu-table">
        <thead><tr><th></th><th>Nombre</th><th>Artista</th><th>BPM</th><th>Tono</th><th>Marca</th><th>Pistas</th><th></th></tr></thead>
        <tbody data-ref="rows"></tbody></table></div>
      <div class="mt-progress" data-ref="prog"><div class="vs-bar"><i data-ref="bar"></i></div><small data-ref="step"></small></div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cerrar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="go" disabled>Subir</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => {
    if (S.uploading) { window.showToast?.('Espera a que termine el pack que se está subiendo, o pulsa «Detener».', 'info'); return; }
    S.closed = true; S.cancel = true; pop(); ov.remove(); openBox = null;
  };
  const pop = pushModal(close, ov);
  openBox = { close, el: ov };

  const keyOpts = (sel) => `<option value="">—</option>${LIB_KEYS.map((k) => `<option${k === sel ? ' selected' : ''}>${k}</option>`).join('')}`;
  const STATE = { pending: ['…', 'En cola para analizar'], analyzing: ['◔', 'Analizando'], ready: ['', ''], uploading: ['⇡', 'Subiendo'], done: ['✓', 'Subido'], error: ['!', 'Error'] };

  function rowHtml(it) {
    const v = resolveItem(it);
    return `<tr data-i="${it.i}" class="bu-row is-${it.state}">
      <td class="bu-st" data-ref="st"></td>
      <td><input class="bu-in bu-title" data-f="title" value="${esc(v.title)}" maxlength="120" aria-label="Nombre del pack"><div class="bu-issues" data-ref="issues"></div></td>
      <td><input class="bu-in" data-f="artist" value="${esc(v.artist)}" maxlength="80" placeholder="Artista" aria-label="Artista"></td>
      <td><input class="bu-in bu-num" data-f="bpm" value="${esc(v.bpm || '')}" inputmode="decimal" maxlength="6" aria-label="BPM"></td>
      <td><select class="bu-in" data-f="key" aria-label="Tono">${keyOpts(v.key)}</select></td>
      <td><div class="ui-seg bu-tier" role="group" aria-label="Marca">
        <button type="button" class="ui-seg-btn${v.tier === 'free' ? ' is-on' : ''}" data-tier="free">GRATIS</button>
        <button type="button" class="ui-seg-btn${v.tier === 'pro' ? ' is-on' : ''}" data-tier="pro">PRO</button></div></td>
      <td class="bu-files" data-ref="files">${fmt(it.size)}</td>
      <td><button type="button" class="ui-close ui-close--sm bu-rm" data-act="rm" title="Quitar de la lista" aria-label="Quitar">×</button></td>
    </tr>`;
  }
  function paintRow(it) {
    const tr = $(`tr[data-i="${it.i}"]`);
    if (!tr) return;
    tr.className = `bu-row is-${it.state}`;
    const [ico, tip] = STATE[it.state] || ['', ''];
    const st = tr.querySelector('[data-ref="st"]');
    st.textContent = ico; st.title = it.msg || tip;
    const issues = it.state === 'pending' || it.state === 'analyzing' ? [] : reviewIssues(it, existing);
    it.blocked = issues.some((x) => x.level === 'bad');
    tr.querySelector('[data-ref="issues"]').innerHTML = (it.state === 'error' ? `<span class="is-bad">${esc(it.msg)}</span>` : '')
      + (it.state === 'done' ? `<span class="is-ok">${esc(it.msg)}</span>` : issues.map((x) => `<span class="is-${x.level}">${esc(x.text)}</span>`).join(''));
    tr.querySelector('[data-ref="files"]').textContent = it.files.length ? `${it.files.length} · ${fmt(it.size)}` : fmt(it.size);
    // Lo detectado rellena lo que el nombre no traía (sin pisar lo escrito a mano).
    const v = resolveItem(it);
    const bpmIn = tr.querySelector('[data-f="bpm"]'), keyIn = tr.querySelector('[data-f="key"]');
    if (it.edit.bpm == null && document.activeElement !== bpmIn) bpmIn.value = v.bpm || '';
    if (it.edit.key == null && document.activeElement !== keyIn) keyIn.value = v.key || '';
    tr.querySelectorAll('input, select, .bu-tier button, .bu-rm').forEach((x) => { x.disabled = S.uploading || it.state === 'done'; });
  }
  function paintSummary() {
    const live = items.filter((x) => !x.removed);
    const todo = live.filter((x) => x.state !== 'done');
    const ready = todo.filter((x) => x.state === 'ready' && !x.blocked);
    const est = todo.reduce((t, x) => t + (x.files.length ? estimateCloudBytes(x.files) : x.size * 0.14), 0);
    const pro = todo.filter((x) => resolveItem(x).tier === 'pro').length;
    $('[data-ref="sum"]').textContent = `${todo.length} ${todo.length === 1 ? 'pack' : 'packs'} · ${pro} PRO · ${todo.length - pro} GRATIS · ~${fmt(est)} en la nube`;
    const go = $('[data-act="go"]');
    go.disabled = S.uploading ? false : !ready.length;
    go.textContent = S.uploading ? 'Detener' : `Subir ${ready.length} ${ready.length === 1 ? 'pack' : 'packs'}`;
    const doneN = live.filter((x) => x.state === 'done').length;
    if (!todo.length && doneN) { $('[data-ref="sum"]').textContent = `Todo subido: ${doneN} ${doneN === 1 ? 'pack' : 'packs'}`; go.hidden = true; } else go.hidden = false;
    $('[data-act="cancel"]').disabled = S.uploading;
  }
  const step = (frac, txt) => { $('[data-ref="bar"]').style.width = `${Math.round(frac * 100)}%`; $('[data-ref="step"]').textContent = txt; };

  $('[data-ref="rows"]').innerHTML = items.map(rowHtml).join('');
  items.forEach(paintRow); paintSummary();

  // ── Edición ──
  ov.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    const tr = e.target.closest('tr[data-i]');
    if (!f || !tr) return;
    const it = items[Number(tr.dataset.i)];
    it.edit[f] = e.target.value;
    paintRow(it); paintSummary();
  });
  ov.addEventListener('change', (e) => {
    if (e.target === $('[data-ref="publish"]')) S.publish = e.target.checked;
  });
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) { close(); return; }
    const tierBtn = e.target.closest('[data-tier]');
    if (tierBtn) {
      const it = items[Number(tierBtn.closest('tr').dataset.i)];
      it.edit.tier = tierBtn.dataset.tier;
      tierBtn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === tierBtn));
      paintSummary(); return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') { close(); return; }
    if (act === 'rm') {
      const tr = e.target.closest('tr');
      const it = items[Number(tr.dataset.i)];
      it.removed = true; tr.remove(); paintSummary(); return;
    }
    if (act === 'all-free' || act === 'all-pro') {
      const t = act === 'all-free' ? 'free' : 'pro';
      items.forEach((it) => { if (it.state !== 'done') it.edit.tier = t; });
      ov.querySelectorAll('.bu-tier').forEach((g) => g.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.tier === t)));
      paintSummary(); return;
    }
    if (act === 'go') { if (S.uploading) { S.cancel = true; step(0, 'Deteniendo al terminar la pista actual…'); } else upload(); }
  });

  // ── 1. Analizar ──
  async function analyze() {
    const live = () => items.filter((x) => !x.removed);
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      if (S.closed) return;
      if (it.removed) continue;
      it.state = 'analyzing'; paintRow(it);
      step(n / items.length, `Analizando ${n + 1} de ${items.length}: ${it.meta.title}…`);
      try {
        const pk = await api.mtlibOpen({ target: it.path });
        it.files = pk.files.filter((f) => AUDIO.test(f.name)).map((f) => ({ id: f.id, name: base(f.name), size: f.size }));
        it.size = it.files.reduce((t, f) => t + f.size, 0) || it.size;
        const names = it.files.map((f) => f.name);
        it.meta = packMeta(it.name, names);
        it.roles = names.map((nm) => detectStemRole(nm).kind || 'other');
        const probe = pickProbeTracks(it.roles);
        it.detected = {};
        if (probe.bpm >= 0) {
          const buf = await decode(await api.multitrackRead({ token: pk.token, id: it.files[probe.bpm].id }));
          it.detected.bpm = await detectBpm(buf);
          if (probe.key === probe.bpm) it.detected.key = await detectKey(buf);
        }
        if (probe.key >= 0 && probe.key !== probe.bpm && !S.closed) {
          const buf = await decode(await api.multitrackRead({ token: pk.token, id: it.files[probe.key].id }));
          it.detected.key = await detectKey(buf);
        }
        it.state = 'ready';
        // El título del nombre de la carpeta puede haber cambiado con los archivos: refrescar los campos.
        const tr = $(`tr[data-i="${it.i}"]`);
        if (tr) { const v = resolveItem(it); if (it.edit.title == null) tr.querySelector('[data-f="title"]').value = v.title; if (it.edit.artist == null) tr.querySelector('[data-f="artist"]').value = v.artist; }
      } catch (err) {
        it.state = 'error'; it.msg = 'No se pudo leer: ' + ((err && err.message) || err);
      }
      if (S.closed) return;
      paintRow(it); paintSummary();
      await tick();
    }
    S.analyzing = false;
    const n = live().filter((x) => x.state === 'ready').length;
    step(1, `Análisis listo: ${n} ${n === 1 ? 'pack' : 'packs'}. Revisa lo marcado en ámbar y pulsa «Subir».`);
  }

  // ── 2. Subir ──
  async function upload() {
    const queue = items.filter((x) => !x.removed && x.state === 'ready' && !x.blocked);
    if (!queue.length) return;
    try {
      const st = await lib.adminStorage();
      const est = queue.reduce((t, x) => t + estimateCloudBytes(x.files), 0);
      if (st && st.bytes + est > FREE_BYTES) {
        const ok = await confirmDialogAsync({
          title: 'Pasarías de los 10 GB gratis',
          message: `La biblioteca ocupa ${fmt(st.bytes)} y estos packs sumarían unos ${fmt(est)}. Lo que pase de 10 GB lo cobra Cloudflare (unos 0,015 $ por GB al mes). ¿Subirlos igual?`,
          confirmLabel: 'Subir igual', danger: true,
        });
        if (!ok) return;
      }
    } catch (_) {}
    S.uploading = true; S.cancel = false;
    items.forEach(paintRow); paintSummary();
    const { prepareTrack } = await import('./packAudio.js');
    const { guessFromFilename, exactTempo, slugify, safeFileName, UNPITCHED } = await import('./loopMeta.js');
    const { mp3Info, fixMp3Gapless, isMp3Name } = await import('./mp3Info.js');
    const slugs = new Set(packs.map((p) => p.slug));
    let ok = 0;
    for (let q = 0; q < queue.length && !S.cancel; q++) {
      const it = queue[q];
      const v = resolveItem(it);
      it.state = 'uploading'; paintRow(it);
      const say = (k, total, txt) => step((q + (total ? k / total : 0)) / queue.length, `Pack ${q + 1} de ${queue.length} · ${v.title}: ${txt}`);
      try {
        let slug = slugify(v.title) || `pack-${Date.now()}`;
        for (let n = 2; slugs.has(slug); n++) slug = `${slugify(v.title)}-${n}`;
        slugs.add(slug);
        const pack = await lib.adminSavePack({ slug, title: v.title, ...(v.artist ? { artist: v.artist } : {}), description: '', genre: '', mood: '', tier: v.tier, published: false });
        const pk = await api.mtlibOpen({ target: it.path });
        const files = pk.files.filter((f) => AUDIO.test(f.name));
        const loops = [];
        const used = new Set();
        let before = 0, after = 0;
        // Pista a pista: leer → comprimir → subir → soltar. La siguiente se va preparando mientras sube la actual.
        const prep = async (k) => {
          const f = files[k];
          const name = base(f.name);
          const bytes = await api.multitrackRead({ token: pk.token, id: f.id });
          let buffer = await decode(bytes);
          let mp3 = null, mp3Fixed = false;
          if (isMp3Name(name)) { mp3 = mp3Info(bytes); if (mp3) ({ buffer, fixed: mp3Fixed } = fixMp3Gapless(mp3, buffer)); }
          const g = guessFromFilename(name);
          // Loops cortos: compases enteros (el BPM se ajusta un pelo para que cierre el bucle).
          // Canciones completas: el BPM del pack tal cual (si no, se desfasarían con el click del
          // proyecto) y los compases redondeados hacia arriba (que no se corte el final).
          const exact = exactTempo(buffer.duration, v.bpm);
          const long = exact.bars > 16 || buffer.duration > 45;
          const t = long ? { bpm: v.bpm, bars: Math.max(1, Math.ceil(buffer.duration * v.bpm / 240 - 0.01)) } : exact;
          const row = { file: { name }, bytes: mp3 || /\.flac$/i.test(name) || !long ? bytes : { byteLength: bytes.byteLength }, buffer, mp3, mp3Fixed,
            title: g.title, instrument: g.instrument, section: g.section, bpm: t.bpm, bars: t.bars, key: UNPITCHED.has(g.instrument) ? null : (v.key || null) };
          let b = String(safeFileName(name)).replace(/\.[^.]+$/, '');
          while (used.has(b)) b = `${k}-${b}`;
          used.add(b);
          const pt = await prepareTrack(row, b);
          return { row, pt };
        };
        let next = files.length ? prep(0) : null;
        for (let k = 0; k < files.length; k++) {
          if (S.cancel) throw new Error('Detenido');
          say(k, files.length, `comprimiendo ${k + 1} de ${files.length}…`);
          const { row, pt } = await next;
          next = k + 1 < files.length ? prep(k + 1) : null;
          if (next) next.catch(() => {});
          say(k + 0.5, files.length, `subiendo ${k + 1} de ${files.length}: ${row.title} (${pt.format}, ${fmt(pt.after)})…`);
          const audioPath = `${slug}/${pt.audio.name}`;
          await lib.adminUpload(audioPath, pt.audio.bytes, pt.audio.ct);
          let previewPath = null;
          if (pt.preview) { previewPath = `${slug}/${pt.preview.name}`; await lib.adminUpload(previewPath, pt.preview.bytes, pt.preview.ct); }
          before += pt.before; after += pt.after;
          loops.push({ title: row.title, instrument: row.instrument, section: row.section, bpm: row.bpm, bars: row.bars,
            musical_key: row.key, beats_per_bar: 4, tier: v.tier, audio_path: audioPath, preview_path: previewPath, size: pt.after,
            duration_sec: Math.round(row.buffer.duration * 1000) / 1000, sort: k, tags: [] });
        }
        say(1, 1, 'registrando en la biblioteca…');
        await lib.adminAddLoops(pack.id, loops);
        if (S.publish) await lib.adminSetPublished(pack.id, true);
        it.state = 'done';
        it.msg = `${loops.length} pistas · ${fmt(after)} en la nube (los originales pesaban ${fmt(before)})${S.publish ? ' · publicado' : ' · borrador'}`;
        existing.add(v.title.toLowerCase());
        ok++;
      } catch (err) {
        it.state = S.cancel ? 'ready' : 'error';
        it.msg = S.cancel ? '' : 'No se pudo subir: ' + ((err && err.message) || err);
      }
      paintRow(it); paintSummary();
    }
    S.uploading = false;
    items.forEach(paintRow); paintSummary();
    step(1, `${ok} de ${queue.length} ${queue.length === 1 ? 'pack subido' : 'packs subidos'}${S.publish ? ' y publicados' : ' como borrador (publícalos en «Mis packs»)'}.`);
    window.showToast?.(`Biblioteca de stems: ${ok} ${ok === 1 ? 'pack subido' : 'packs subidos'}.`, ok ? 'success' : 'info');
    try { await lib.listPacks({ refresh: true }); } catch (_) {}
    try { onDone && onDone(); } catch (_) {}
  }

  analyze();
}
