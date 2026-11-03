// Ventana de la biblioteca de stems para SUBIR y GESTIONAR packs. Dos modos:
//
//   openPackUploader({ onChanged })                    → administrador
//     Subir pack · Mis packs (editar loops, borrar) · Moderación (envíos de la
//     comunidad: escuchar, aprobar o rechazar) · Uso (métricas)
//   openPackUploader({ onChanged, community: true })   → cuenta Pro cualquiera
//     Enviar pack · Mis envíos (estado, nota del administrador, retirar)
//
// Por cada WAV/FLAC se deduce título, instrumento y sección por el nombre
// (loopMeta.js), BPM con el detector de la app afinado a compases exactos, y
// tono con el detector de acordes (salvo batería/percusión/FX). Todo se puede
// corregir antes de subir. Se suben el audio original, una escucha previa
// ligera (mono ~24 kHz) y la portada; luego se registran pack y loops con la
// Edge Function stem-library-admin, que vuelve a comprobar el permiso.
// Volver a subir un archivo con el mismo nombre ACTUALIZA ese loop (conserva
// su marca GRATIS/PRO y sus métricas).

import * as stemLibrary from '../cloud/stemLibrary.js';
import { detectTempoMeter } from './bpmDetector.js';
import { analyzeChords, keyName, CHORD_SR } from '../chords/chordEngine.js';
import { audioBufferToWav } from './clickGenerator.js';
import { guessFromFilename, pickTempo, exactTempo, slugify, safeFileName, UNPITCHED } from './loopMeta.js';
import { esc } from '../utils/dom.js';
import { showToast } from '../ui/toast.js';
import { confirmDialogAsync } from '../ui/dialog.js';

const INSTRUMENTS = {
  drums: 'Batería', perc: 'Percusión', bass: 'Bajo', keys: 'Teclas', pad: 'Pad', synth: 'Synth',
  guitar: 'Guitarra', strings: 'Cuerdas', vocals: 'Voces', guide: 'Guía', click: 'Click', fx: 'FX', other: 'Otros',
};
const SECTIONS = { any: 'Cualquiera', intro: 'Intro', verse: 'Verso', prechorus: 'Pre-coro', chorus: 'Coro', bridge: 'Puente', build: 'Build', outro: 'Outro' };
const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FEELS = stemLibrary.FEELS;
const STATUS = {
  pending: ['En revisión', 'is-pending'], approved: ['Aprobado y publicado', 'is-ok'],
  rejected: ['Rechazado', 'is-bad'], official: ['Oficial', ''],
};

const opts = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
const keyOpts = (sel) => `<option value="">sin tono</option>${KEYS.map((k) => `<option${k === sel ? ' selected' : ''}>${k}</option>`).join('')}`;
const feelOpts = (sel) => `<option value="">—</option>${opts(FEELS, sel)}`;
// La sensación vive en stem_loops.tags junto a otras etiquetas: se cambia solo esa.
const feelOf = (tags) => (Array.isArray(tags) ? tags : []).find((t) => FEELS[t]) || '';
const withFeel = (tags, feel) => [...(Array.isArray(tags) ? tags : []).filter((t) => !FEELS[t]), feel].filter(Boolean);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

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
  return { file, bytes, buffer, title: guess.title, instrument: guess.instrument, section: guess.section, bpm, bars, key, tier: null, feel: '',
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

// Portada desde un video de YouTube: se baja su miniatura (proceso principal) y
// se recorta en cuadrado al centro. Las miniaturas 4:3 de YouTube (sd/hq) traen
// el video 16:9 con barras negras arriba y abajo: el recorte se hace sobre la
// zona con imagen. Si queda por debajo de 600 px, se escala a 600.
async function coverFromYoutube(url) {
  if (!window.electronAPI?.youtubeThumbnail) throw new Error('Disponible en la app de escritorio.');
  const r = await window.electronAPI.youtubeThumbnail(url);
  if (!r || r.error) throw new Error(r?.error || 'No se pudo bajar la miniatura.');
  const img = await createImageBitmap(new Blob([r.bytes], { type: 'image/jpeg' }));
  const contentH = Math.abs(img.width / img.height - 4 / 3) < 0.02 ? Math.round(img.width * 9 / 16) : img.height;
  const side = Math.min(img.width, contentH);
  const sx = Math.round((img.width - side) / 2);
  const sy = Math.round((img.height - side) / 2);
  const out = Math.max(600, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) throw new Error('No se pudo preparar la imagen.');
  return new File([blob], `yt-${r.videoId}.jpg`, { type: 'image/jpeg' });
}

// Duración esperada vs real: si no cuadra, el loop se desfasaría en el editor.
const durationOk = (r) => Math.abs(r.buffer.duration - r.bars * 4 * 60 / r.bpm) < 0.05;

// ── Ventana ────────────────────────────────────────────────────────────────
export function openPackUploader({ onChanged, community = false, tab = 'upload' } = {}) {
  document.getElementById('spu-overlay')?.remove();
  const admin = !community;
  const state = {
    packs: [], rows: [], cover: null, busy: false,
    open: null,            // id del pack desplegado en Mis packs / Moderación
    reports: [],           // loops reportados (admin)
    loops: new Map(),      // packId → loops (cargados al desplegar)
    edits: new Map(),      // loopId → cambios sin guardar
    playing: null,         // { id, audio }
  };

  const overlay = document.createElement('div');
  overlay.id = 'spu-overlay';
  overlay.className = 'stb-overlay';
  overlay.innerHTML = `
    <div class="stb-modal spu-modal" role="dialog" aria-modal="true" aria-label="${admin ? 'Administrar biblioteca de stems' : 'Compartir un pack con la comunidad'}">
      <header class="stb-head">
        <h3>${admin ? 'Biblioteca de stems · Administración' : 'Compartir un pack con la comunidad'}</h3>
        <button type="button" class="stl-x" data-act="close" aria-label="Cerrar">×</button>
      </header>
      <div class="spu-tabs" role="tablist">
        <button type="button" class="is-on" data-tab="upload" role="tab">${admin ? 'Subir pack' : 'Enviar pack'}</button>
        <button type="button" data-tab="packs" role="tab">${admin ? 'Mis packs' : 'Mis envíos'}</button>
        ${admin ? `<button type="button" data-tab="review" role="tab">Moderación <span class="spu-badge" data-ref="reviewCount" hidden></span></button>
        <button type="button" data-tab="stats" role="tab">Uso</button>` : ''}
      </div>

      <section data-pane="upload" class="spu-pane">
        ${community ? `<p class="spu-intro">Comparte tus loops con otros músicos de LivePads. Cada envío lo revisa el equipo antes de publicarse; si lo aprobamos, aparece en la Biblioteca con tu firma.</p>` : ''}
        <h4 class="spu-step"><b>1</b> El pack <span>nombre, portada y quién lo ve</span></h4>
        <div class="spu-target">
          <label><input type="radio" name="spu-mode" value="new" checked> Pack nuevo</label>
          <label><input type="radio" name="spu-mode" value="existing"> ${admin ? 'Agregar o actualizar loops de un pack' : 'Agregar a un envío'}
            <select data-ref="existing" disabled></select></label>
        </div>
        <div class="spu-pack" data-ref="newpack">
          <label>Nombre <input data-ref="title" placeholder="Ej. Adoración íntima vol. 1" maxlength="120"></label>
          <label>Descripción <input data-ref="desc" maxlength="500" placeholder="Opcional"></label>
          <label>Género <input data-ref="genre" maxlength="60" placeholder="worship, pop…"></label>
          ${admin
            ? '<label>Marca por defecto <select data-ref="tier"><option value="pro">PRO</option><option value="free">GRATIS</option></select></label>'
            : '<label>Tu firma <input data-ref="author" maxlength="80" placeholder="Cómo te verán: nombre o ministerio"></label>'}
        </div>
        <div class="spu-cover">
          <div class="spu-cover-img" data-ref="coverPreview">Sin portada</div>
          <div class="spu-cover-actions">
            <div class="spu-cover-btns">
              <button type="button" class="stb-btn" data-act="cover">Elegir portada</button>
              <button type="button" class="stb-btn" data-act="coverYtToggle" title="Usa la miniatura de un video de YouTube (se recorta en cuadrado)">Desde YouTube</button>
            </div>
            <div class="spu-yt" data-ref="ytRow" hidden>
              <input data-ref="ytUrl" placeholder="Pega el enlace del video (youtube.com/watch?v=… o youtu.be/…)" spellcheck="false">
              <button type="button" class="stb-btn stb-btn--primary" data-act="coverYt">Usar miniatura</button>
            </div>
            <span class="spu-note">JPG, PNG o WebP, cuadrada (mín. 500 px), o la miniatura de un video.</span>
          </div>
          <input type="file" data-ref="coverInput" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
        <h4 class="spu-step"><b>2</b> Tempo y tono <span>uno para todo el pack, como en tus canciones</span></h4>
        <div class="spu-packtempo">
          <label>BPM del pack <input data-ref="packBpm" type="number" min="20" max="300" step="0.01" placeholder="Ej. 96"></label>
          <label>Tono del pack <select data-ref="packKey">${keyOpts('')}</select></label>
          <label class="spu-perloop" title="Actívalo solo si los loops del pack están en tempos o tonos distintos"><input type="checkbox" data-ref="perLoop"> Cada loop con su propio BPM y tono</label>
          <span class="spu-note">Como en las canciones: un BPM y un tono para todo el pack. Se rellenan solos al soltar los audios; cámbialos si no cuadran. Batería y percusión van sin tono.</span>
        </div>
        <h4 class="spu-step"><b>3</b> Pistas <span>suelta los audios; revisa el instrumento de cada una</span></h4>
        <div class="spu-drop" data-ref="drop">
          Arrastra aquí los loops en <b>WAV</b> o <b>FLAC</b>, o <button type="button" class="stb-btn" data-act="files">elige archivos</button>
          <input type="file" data-ref="filesInput" accept=".wav,.flac,audio/wav,audio/flac" multiple hidden>
          <div class="spu-note">MP3 y M4A no: añaden silencio al principio y el loop se desfasaría. Un archivo con el mismo nombre que uno ya subido lo actualiza${admin ? ' (conserva su marca GRATIS/PRO)' : ''}.</div>
        </div>
        <div class="spu-bulk" data-ref="bulk" hidden>
          <span>Para todas las pistas:</span>
          <select data-bulk="section"><option value="">Sección…</option>${opts(SECTIONS, '')}</select>
          <select data-bulk="feel"><option value="">Sensación…</option>${opts(FEELS, '')}</select>
          ${admin ? `<select data-bulk="tier"><option value="">Marca…</option>${opts({ free: 'GRATIS', pro: 'PRO' }, '')}</select>` : ''}
          <button type="button" class="stb-btn" data-act="clearRows" title="Quitar todas las pistas de la lista">Quitar todas</button>
        </div>
        <div class="stb-grid-wrap spu-rows-wrap"><table class="stb-grid" data-ref="rows"></table></div>
        <div class="spu-progress" data-ref="progress" hidden role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="spu-progress-bar" data-ref="bar"></div>
        </div>
        ${community ? `<label class="spu-rights"><input type="checkbox" data-ref="rights">
          Confirmo que estos audios son míos o tengo los derechos para compartirlos, y autorizo a LivePads a ofrecerlos en la Biblioteca.</label>` : ''}
        <footer class="stb-foot">
          <label><input type="checkbox" data-ref="publish" checked> ${admin ? 'Publicar al terminar' : 'Enviar a revisión al terminar'}</label>
          <span class="stb-total" data-ref="status"></span>
          <button type="button" class="stb-btn stb-btn--primary" data-act="upload" disabled>${admin ? 'Subir' : 'Enviar'}</button>
        </footer>
      </section>

      <section data-pane="packs" class="spu-pane" hidden>
        <div class="spu-packs" data-ref="packList"><div class="stb-empty">Cargando…</div></div>
      </section>

      ${admin ? `<section data-pane="review" class="spu-pane" hidden>
        <div class="spu-reports" data-ref="reports"></div>
        <p class="spu-intro">Packs enviados por la comunidad. Escúchalos, corrige lo que haga falta y apruébalos (se publican) o recházalos con una nota para quien lo envió.</p>
        <div class="spu-packs" data-ref="reviewList"></div>
      </section>

      <section data-pane="stats" class="spu-pane" hidden>
        <div class="stb-bar">
          <label>Ver
            <select data-ref="statsView">
              <option value="top">Más usados</option>
              <option value="unused">Sin usar</option>
              <option value="listened">Escuchados, no agregados</option>
              <option value="packs">Por pack</option>
            </select>
          </label>
          <label>Periodo
            <select data-ref="statsDays"><option value="7">Últimos 7 días</option><option value="30" selected>Últimos 30 días</option><option value="90">Últimos 90 días</option></select>
          </label>
          <span class="spu-note">"Agregado" = entró a un proyecto en el editor. "Escuchado" = escucha previa (una vez por persona y sesión).</span>
        </div>
        <div class="spu-kpis" data-ref="kpis"></div>
        <div class="stb-grid-wrap"><table class="stb-grid" data-ref="stats"></table></div>
      </section>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const ref = (n) => overlay.querySelector(`[data-ref="${n}"]`);
  const mode = () => overlay.querySelector('input[name="spu-mode"]:checked').value;

  // ── Packs ────────────────────────────────────────────────────────────────
  // Admin: los oficiales y los aprobados van en "Mis packs"; los envíos sin
  // aprobar, en "Moderación". Comunidad: solo los suyos.
  const isSubmission = (p) => p.status === 'pending' || p.status === 'rejected';
  const ownPacks = () => (admin ? state.packs.filter((p) => !isSubmission(p)) : state.packs);
  const reviewPacks = () => state.packs
    .filter((p) => isSubmission(p) && (p.submitted_at || p.status === 'rejected'))
    .sort((a, b) => (a.status === b.status ? String(b.submitted_at).localeCompare(String(a.submitted_at)) : a.status === 'pending' ? -1 : 1));

  async function loadPacks() {
    try { state.packs = admin ? await stemLibrary.adminListPacks() : await stemLibrary.myCommunityPacks(); }
    catch (e) { ref('packList').innerHTML = `<div class="stb-empty">No se pudo cargar: ${esc(e.message)}</div>`; return; }
    const targets = admin ? ownPacks() : state.packs.filter((p) => p.status !== 'approved');
    ref('existing').innerHTML = targets.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}${p.published ? '' : admin ? ' (borrador)' : ` (${STATUS[p.status]?.[0] || ''})`}</option>`).join('');
    overlay.querySelector('input[value="existing"]').disabled = !targets.length;
    renderPackList();
    if (admin) {
      try { state.reports = await stemLibrary.adminReports(); } catch (_) { state.reports = []; }
      paintReviewBadge();
      renderReviewList();
      renderReports();
    }
    ensureOpenLoops();
  }

  function paintReviewBadge() {
    const n = reviewPacks().filter((p) => p.status === 'pending').length + state.reports.length;
    ref('reviewCount').hidden = !n;
    ref('reviewCount').textContent = String(n);
  }

  // Loops reportados por los usuarios: escuchar, descartar o retirar.
  function renderReports() {
    const box = ref('reports');
    if (!box) return;
    if (!state.reports.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h4 class="spu-h4">Loops reportados</h4>${state.reports.map((r) => `
      <div class="spu-report" data-report="${esc(r.loop_id)}">
        <button type="button" class="stl-play spu-play${state.playing?.id === r.loop_id ? ' is-on' : ''}" data-play-report="${esc(r.loop_id)}" data-pack="${esc(r.pack_id)}" title="Escuchar">${state.playing?.id === r.loop_id ? '■' : '▶'}</button>
        <div class="spu-report-info">
          <b>${esc(r.title)}</b> <span class="spu-muted">· ${esc(r.pack_title)}</span>
          <span>${r.reports} reporte${Number(r.reports) === 1 ? '' : 's'}: ${(r.reasons || []).map((x) => esc(stemLibrary.REPORT_REASONS[x] || x)).join(', ')}</span>
          ${(r.notes || []).slice(0, 3).map((n) => `<span class="spu-report-note">“${esc(n)}”</span>`).join('')}
        </div>
        <button type="button" class="stb-btn" data-act="dismissReport" data-id="${esc(r.loop_id)}">Está bien</button>
        <button type="button" class="stb-btn spu-danger" data-act="removeReported" data-id="${esc(r.loop_id)}">Retirar loop</button>
      </div>`).join('')}`;
  }

  function packRow(p) {
    const [statusLabel, statusCls] = STATUS[p.status] || ['', ''];
    const showStatus = community || isSubmission(p) || p.status === 'approved';
    const sub = [
      `${p.loops} loop${p.loops === 1 ? '' : 's'}`,
      admin && !isSubmission(p) ? `marca por defecto ${p.tier === 'free' ? 'GRATIS' : 'PRO'}` : '',
      p.author_name ? `por ${esc(p.author_name)}` : '',
      p.submitted_at ? `enviado el ${fmtDate(p.submitted_at)}` : '',
    ].filter(Boolean).join(' · ');
    const open = state.open === p.id;
    return `
      <div class="spu-packrow${open ? ' is-open' : ''}" data-pack="${esc(p.id)}">
        <button type="button" class="spu-packhead" data-open="${esc(p.id)}" aria-expanded="${open}">
          <span class="spu-thumb" data-cover="${esc(p.id)}"></span>
          <span class="spu-packinfo"><b>${esc(p.title)}</b><span>${sub}</span></span>
          ${showStatus ? `<span class="spu-status ${statusCls}">${statusLabel}${community && p.status === 'pending' && !p.submitted_at ? ' (sin enviar)' : ''}</span>` : ''}
          <span class="spu-chev" aria-hidden="true">▾</span>
        </button>
        ${admin && !isSubmission(p) ? `<span class="spu-order">
          <button type="button" class="spu-ord" data-act="moveUp" data-id="${esc(p.id)}" title="Subir en la lista de la Biblioteca" aria-label="Subir">▲</button>
          <button type="button" class="spu-ord" data-act="moveDown" data-id="${esc(p.id)}" title="Bajar en la lista de la Biblioteca" aria-label="Bajar">▼</button>
        </span>
        <label class="spu-pub"><input type="checkbox" data-publish="${esc(p.id)}"${p.published ? ' checked' : ''}> Publicado</label>` : ''}
        ${open ? `<div class="spu-editor">${editorHtml(p)}</div>` : ''}
      </div>`;
  }

  function paintCovers() {
    for (const p of state.packs) {
      stemLibrary.ensureCoverLocal(p).then((url) => {
        overlay.querySelectorAll(`[data-cover="${CSS.escape(p.id)}"]`).forEach((el) => { if (url) el.style.backgroundImage = `url("${url}")`; });
      }).catch(() => {});
    }
  }

  function renderPackList() {
    const list = ownPacks();
    ref('packList').innerHTML = list.length ? list.map(packRow).join('')
      : `<div class="stb-empty spu-empty"><b>${admin ? 'Todavía no hay packs' : 'Aún no has enviado ningún pack'}</b><span>${admin ? 'Sube tu primer pack: un BPM, un tono y sus pistas.' : 'Comparte tus loops con la comunidad.'}</span><button type="button" class="stb-btn stb-btn--primary" data-tab="upload">${admin ? 'Subir un pack' : 'Enviar un pack'}</button></div>`;
    paintCovers();
  }

  function renderReviewList() {
    if (!admin) return;
    const list = reviewPacks();
    ref('reviewList').innerHTML = list.length ? list.map(packRow).join('')
      : '<div class="stb-empty">No hay envíos de la comunidad por revisar.</div>';
    paintCovers();
  }

  const rerender = () => { renderPackList(); renderReviewList(); renderReports(); ensureOpenLoops(); };

  // ── Editor de un pack (desplegable) ──────────────────────────────────────
  function editorHtml(p) {
    const loops = state.loops.get(p.id);
    const canEditLoops = admin || p.status !== 'approved';
    const cover = (admin || p.status !== 'approved') ? `
      <div class="spu-cover spu-cover--edit">
        <div class="spu-cover-img" data-cover="${esc(p.id)}">${p.cover_path ? '' : 'Sin portada'}</div>
        <div class="spu-cover-actions">
          <div class="spu-cover-btns">
            <button type="button" class="stb-btn" data-act="changeCover" data-id="${esc(p.id)}">${p.cover_path ? 'Cambiar portada' : 'Poner portada'}</button>
            <button type="button" class="stb-btn" data-act="editYtToggle" data-id="${esc(p.id)}">Desde YouTube</button>
          </div>
          <div class="spu-yt" data-yt-row="${esc(p.id)}" hidden>
            <input data-yt-url="${esc(p.id)}" placeholder="Enlace del video de YouTube" spellcheck="false">
            <button type="button" class="stb-btn stb-btn--primary" data-act="editYt" data-id="${esc(p.id)}">Usar miniatura</button>
          </div>
        </div>
        <input type="file" data-cover-input="${esc(p.id)}" accept="image/jpeg,image/png,image/webp" hidden>
      </div>` : '';
    const communityFields = !admin && p.status !== 'approved' ? `
      <div class="spu-pack spu-pack--edit spu-pack--community">
        <label>Nombre <input data-pf="title" value="${esc(p.title)}" maxlength="120"></label>
        <label>Descripción <input data-pf="description" value="${esc(p.description || '')}" maxlength="500"></label>
        <label>Género <input data-pf="genre" value="${esc(p.genre || '')}" maxlength="60"></label>
        <label>Tu firma <input data-pf="author_name" value="${esc(p.author_name || '')}" maxlength="80"></label>
        <button type="button" class="stb-btn" data-act="savePack" data-id="${esc(p.id)}">Guardar datos</button>
      </div>` : '';
    const fields = admin ? `
      <div class="spu-pack spu-pack--edit">
        <label>Nombre <input data-pf="title" value="${esc(p.title)}" maxlength="120"></label>
        <label>Descripción <input data-pf="description" value="${esc(p.description || '')}" maxlength="500"></label>
        <label>Género <input data-pf="genre" value="${esc(p.genre || '')}" maxlength="60"></label>
        <label>Sensación del pack <input data-pf="mood" value="${esc(p.mood || '')}" maxlength="60" placeholder="íntimo, celebración…"></label>
        ${isSubmission(p) ? '' : `<label>Marca por defecto <select data-pf="tier">${opts({ pro: 'PRO', free: 'GRATIS' }, p.tier)}</select></label>`}
        <button type="button" class="stb-btn" data-act="savePack" data-id="${esc(p.id)}">Guardar datos</button>
      </div>` : (p.review_note ? `<div class="spu-note-box"><b>Nota del equipo:</b> ${esc(p.review_note)}</div>` : '') + communityFields;
    const table = !loops ? '<div class="stb-empty">Cargando loops…</div>' : !loops.length ? '<div class="stb-empty">Este pack no tiene loops.</div>' : `
      <div class="stb-grid-wrap"><table class="stb-grid spu-loops">
        <thead><tr><th></th><th>Título</th><th>Instrumento</th><th>Sección</th><th>BPM</th><th>Comp.</th><th>Tono</th><th>Sensación</th>${admin ? '<th>Marca</th>' : ''}${canEditLoops ? '<th></th><th></th>' : ''}</tr></thead>
        <tbody>${loops.map((l) => loopRowHtml(l, canEditLoops)).join('')}</tbody>
      </table></div>`;
    let actions = '';
    if (admin && isSubmission(p)) {
      actions = `
        <div class="spu-review">
          <input data-ref-note="${esc(p.id)}" maxlength="500" placeholder="Nota para quien lo envió (obligatoria al rechazar)" value="${esc(p.review_note || '')}">
          <button type="button" class="stb-btn" data-act="reject" data-id="${esc(p.id)}">Rechazar</button>
          <button type="button" class="stb-btn stb-btn--primary" data-act="approve" data-id="${esc(p.id)}">Aprobar y publicar</button>
        </div>`;
    } else if (admin) {
      actions = `<div class="spu-actions"><button type="button" class="stb-btn spu-danger" data-act="deletePack" data-id="${esc(p.id)}">Borrar pack</button></div>`;
    } else if (p.status !== 'approved') {
      actions = `<div class="spu-actions">
        <button type="button" class="stb-btn spu-danger" data-act="withdraw" data-id="${esc(p.id)}">Retirar envío</button>
        ${!p.submitted_at || p.status === 'rejected' ? `<button type="button" class="stb-btn stb-btn--primary" data-act="submit" data-id="${esc(p.id)}">${p.status === 'rejected' ? 'Volver a enviar' : 'Enviar a revisión'}</button>` : ''}
      </div>`;
    }
    return cover + fields + table + actions;
  }

  function loopRowHtml(l, editable) {
    const e = { ...l, ...(state.edits.get(l.id) || {}) };
    const dirty = state.edits.has(l.id);
    const play = `<td><button type="button" class="stl-play spu-play${state.playing?.id === l.id ? ' is-on' : ''}" data-play="${esc(l.id)}" title="Escuchar">${state.playing?.id === l.id ? '■' : '▶'}</button></td>`;
    if (!editable) {
      return `<tr>${play}<td>${esc(l.title)}</td><td>${INSTRUMENTS[l.instrument] || esc(l.instrument)}</td><td>${SECTIONS[l.section] || ''}</td>
        <td>${Number(l.bpm)}</td><td>${l.bars}</td><td>${esc(l.musical_key || '—')}</td><td>${FEELS[feelOf(l.tags)] || '—'}</td></tr>`;
    }
    return `<tr data-loop="${esc(l.id)}" class="${dirty ? 'is-dirty' : ''}">${play}
      <td><input data-lf="title" value="${esc(e.title)}" maxlength="120"></td>
      <td><select data-lf="instrument">${opts(INSTRUMENTS, e.instrument)}</select></td>
      <td><select data-lf="section">${opts(SECTIONS, e.section)}</select></td>
      <td><input data-lf="bpm" type="number" min="20" max="300" step="0.01" value="${Number(e.bpm)}"></td>
      <td><input data-lf="bars" type="number" min="1" max="1024" value="${e.bars}"></td>
      <td><select data-lf="musical_key">${keyOpts(e.musical_key)}</select></td>
      <td><select data-lf="feel">${feelOpts(feelOf(e.tags))}</select></td>
      ${admin ? `<td><select data-lf="tier">${opts({ free: 'GRATIS', pro: 'PRO' }, e.tier)}</select></td>` : ''}
      <td><button type="button" class="stb-btn spu-save" data-act="saveLoop" data-id="${esc(l.id)}"${dirty ? '' : ' disabled'}>Guardar</button></td>
      <td><button type="button" class="stb-del" data-act="deleteLoop" data-id="${esc(l.id)}" aria-label="Borrar loop" title="Borrar loop">×</button></td>
    </tr>`;
  }

  async function togglePack(id) {
    stopPlaying();
    state.open = state.open === id ? null : id;
    rerender();
  }

  // Loops del pack desplegado: se piden la primera vez que hacen falta (también
  // tras una subida, que invalida la lista de ese pack).
  const loadingLoops = new Set();
  async function ensureOpenLoops() {
    const id = state.open;
    if (!id || state.loops.has(id) || loadingLoops.has(id)) return;
    loadingLoops.add(id);
    try {
      // El admin lee también lo no publicado; la comunidad ve sus envíos por RLS.
      state.loops.set(id, admin ? await stemLibrary.adminListLoops(id) : await stemLibrary.listOwnPackLoops(id));
    } catch (e) {
      state.loops.set(id, []);
      showToast(`No se pudieron cargar los loops: ${e.message}`, 'error');
    } finally {
      loadingLoops.delete(id);
    }
    rerender();
  }

  const findLoop = (id) => { for (const ls of state.loops.values()) { const l = ls.find((x) => x.id === id); if (l) return l; } return null; };

  // ── Escuchar un loop (también los no publicados: el admin los ve por RLS) ──
  function stopPlaying() {
    if (state.playing) { state.playing.audio.pause(); state.playing = null; }
  }
  async function togglePlay(id, packId) {
    const was = state.playing?.id;
    stopPlaying();
    if (was === id) { rerender(); return; }
    if (!findLoop(id) && packId) {
      try { state.loops.set(packId, await stemLibrary.adminListLoops(packId)); } catch (_) {}
    }
    const loop = findLoop(id);
    if (!loop) return;
    try {
      const audio = new Audio(await stemLibrary.ensurePreviewLocal(loop));
      audio.loop = true;
      state.playing = { id, audio };
      await audio.play();
    } catch (e) {
      state.playing = null;
      showToast(`No se pudo escuchar: ${e.message}`, 'error');
    }
    rerender();
  }

  // ── Acciones del editor ──
  async function savePack(id) {
    const box = overlay.querySelector(`.spu-packrow[data-pack="${CSS.escape(id)}"]`);
    const patch = {};
    box.querySelectorAll('[data-pf]').forEach((el) => { patch[el.dataset.pf] = el.value; });
    try {
      const saved = admin ? await stemLibrary.adminUpdatePack(id, patch) : await stemLibrary.communitySavePack({ packId: id, ...patch });
      Object.assign(state.packs.find((p) => p.id === id) || {}, saved);
      showToast('Datos del pack guardados.', 'success');
      rerender(); onChanged?.();
    } catch (e) { showToast(`No se pudo guardar: ${e.message}`, 'error'); }
  }

  async function saveLoop(id) {
    const loop = findLoop(id), edit = state.edits.get(id);
    if (!loop || !edit) return;
    const patch = { ...edit };
    if ('feel' in patch) { patch.tags = withFeel(loop.tags, patch.feel); delete patch.feel; }
    try {
      if (!admin) delete patch.tier;
      const saved = admin ? await stemLibrary.adminUpdateLoop(id, patch) : await stemLibrary.communityUpdateLoop(id, patch);
      Object.assign(loop, saved);
      state.edits.delete(id);
      showToast(`"${saved.title}" guardado.`, 'success');
      rerender(); onChanged?.();
    } catch (e) { showToast(`No se pudo guardar: ${e.message}`, 'error'); }
  }

  async function deleteLoop(id) {
    const loop = findLoop(id);
    if (!loop) return;
    const ok = await confirmDialogAsync({ title: 'Borrar loop', message: `Se borra "${loop.title}" de la biblioteca y sus archivos. Los proyectos que ya lo usan siguen sonando (tienen su copia).`, confirmLabel: 'Borrar' });
    if (!ok) return;
    try {
      await (admin ? stemLibrary.adminDeleteLoop(id) : stemLibrary.communityDeleteLoop(id));
      if (state.playing?.id === id) stopPlaying();
      for (const [pid, ls] of state.loops) state.loops.set(pid, ls.filter((l) => l.id !== id));
      const p = state.packs.find((x) => x.id === loop.pack_id); if (p) p.loops = Math.max(0, p.loops - 1);
      state.edits.delete(id);
      showToast('Loop borrado.', 'success');
      rerender(); onChanged?.();
    } catch (e) { showToast(`No se pudo borrar: ${e.message}`, 'error'); }
  }

  async function deletePack(id, { withdraw = false } = {}) {
    const p = state.packs.find((x) => x.id === id);
    if (!p) return;
    const ok = await confirmDialogAsync(withdraw
      ? { title: 'Retirar envío', message: `Se borra "${p.title}" y sus ${p.loops} loops. No se puede deshacer.`, confirmLabel: 'Retirar' }
      : { title: 'Borrar pack', message: `Se borra "${p.title}", sus ${p.loops} loops y sus archivos. Los proyectos que ya los usan siguen sonando. No se puede deshacer.`, confirmLabel: 'Borrar pack' });
    if (!ok) return;
    try {
      stopPlaying();
      await (withdraw ? stemLibrary.communityDelete(id) : stemLibrary.adminDeletePack(id));
      state.open = null;
      showToast(withdraw ? 'Envío retirado.' : 'Pack borrado.', 'success');
      await loadPacks(); onChanged?.();
    } catch (e) { showToast(`No se pudo borrar: ${e.message}`, 'error'); }
  }

  // Portada nueva: nombre único (cover-<fecha>) para que ninguna caché local
  // siga mostrando la anterior.
  // Portada del pack nuevo desde YouTube (pestaña Subir).
  async function useYoutubeCover() {
    const btn = overlay.querySelector('[data-act="coverYt"]');
    const url = ref('ytUrl').value.trim();
    if (!url) { ref('ytUrl').focus(); return; }
    btn.disabled = true; btn.textContent = 'Bajando…';
    try {
      const file = await coverFromYoutube(url);
      state.cover = file;
      ref('coverPreview').textContent = '';
      ref('coverPreview').style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
      ref('ytRow').hidden = true; ref('ytUrl').value = '';
      showToast('Portada lista: miniatura del video recortada en cuadrado.', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Usar miniatura'; }
  }
  // Portada de un pack existente desde YouTube (Mis packs / Moderación).
  async function useYoutubeCoverFor(id) {
    const input = overlay.querySelector(`[data-yt-url="${CSS.escape(id)}"]`);
    const url = input?.value.trim();
    if (!url) { input?.focus(); return; }
    try { await changeCover(id, await coverFromYoutube(url)); }
    catch (e) { showToast(e.message, 'error'); }
  }

  async function changeCover(id, file) {
    const p = state.packs.find((x) => x.id === id);
    if (!p || !file || !IMAGE_TYPES[file.type]) return;
    const name = `cover-${Date.now()}.${IMAGE_TYPES[file.type]}`;
    try {
      const bytes = await file.arrayBuffer();
      let saved;
      if (admin) {
        const path = `${p.slug}/${name}`;
        await stemLibrary.adminUpload(path, bytes, file.type);
        saved = await stemLibrary.adminUpdatePack(id, { cover_path: path });
      } else {
        const path = await stemLibrary.communityUpload(id, name, bytes, file.type);
        saved = await stemLibrary.communitySavePack({ packId: id, title: p.title, description: p.description || '', genre: p.genre || '', author_name: p.author_name || '', cover_path: path });
      }
      Object.assign(p, saved);
      showToast('Portada actualizada.', 'success');
      rerender(); onChanged?.();
    } catch (e) { showToast(`No se pudo cambiar la portada: ${e.message}`, 'error'); }
  }

  // Orden de los packs en la Biblioteca (stem_packs.sort), de a un puesto.
  async function movePack(id, dir) {
    const list = ownPacks();
    const i = list.findIndex((p) => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const changes = list.map((p, k) => ({ p, sort: (k + 1) * 10 })).filter(({ p, sort }) => p.sort !== sort);
    try {
      await Promise.all(changes.map(({ p, sort }) => stemLibrary.adminUpdatePack(p.id, { sort }).then(() => { p.sort = sort; })));
      state.packs.sort((a, b) => (a.sort - b.sort) || a.title.localeCompare(b.title));
      rerender(); onChanged?.();
    } catch (e) { showToast(`No se pudo reordenar: ${e.message}`, 'error'); }
  }

  async function dismissReport(loopId) {
    try {
      await stemLibrary.adminDismissReports(loopId);
      state.reports = state.reports.filter((r) => r.loop_id !== loopId);
      showToast('Reportes descartados.', 'success');
      paintReviewBadge(); renderReports();
    } catch (e) { showToast(`No se pudo guardar: ${e.message}`, 'error'); }
  }

  async function removeReported(loopId) {
    const r = state.reports.find((x) => x.loop_id === loopId);
    const ok = await confirmDialogAsync({ title: 'Retirar loop', message: `Se borra "${r?.title || 'el loop'}" de la Biblioteca y sus archivos. Los proyectos que ya lo usan siguen sonando.`, confirmLabel: 'Retirar' });
    if (!ok) return;
    try {
      if (state.playing?.id === loopId) stopPlaying();
      await stemLibrary.adminDeleteLoop(loopId);
      state.reports = state.reports.filter((x) => x.loop_id !== loopId);
      state.loops.clear();
      showToast('Loop retirado de la Biblioteca.', 'success');
      await loadPacks(); onChanged?.();
    } catch (e) { showToast(`No se pudo retirar: ${e.message}`, 'error'); }
  }

  async function review(id, approve) {
    const note = overlay.querySelector(`[data-ref-note="${CSS.escape(id)}"]`)?.value.trim() || '';
    if (!approve && !note) { showToast('Escribe una nota para explicar por qué se rechaza.', 'info'); return; }
    try {
      stopPlaying();
      await stemLibrary.adminReview(id, approve, note);
      state.open = null;
      showToast(approve ? 'Pack aprobado y publicado.' : 'Envío rechazado; quien lo envió verá tu nota.', 'success');
      await loadPacks(); onChanged?.();
    } catch (e) { showToast(`No se pudo guardar: ${e.message}`, 'error'); }
  }

  async function submitOwn(id) {
    const ok = await confirmDialogAsync({
      title: 'Enviar a revisión',
      message: 'Confirmo que estos audios son míos o tengo los derechos para compartirlos, y autorizo a LivePads a ofrecerlos en la Biblioteca.',
      confirmLabel: 'Confirmar y enviar', danger: false,
    });
    if (!ok) return;
    try {
      await stemLibrary.communitySubmit(id);
      showToast('Enviado. Te avisaremos aquí cuando se revise.', 'success');
      await loadPacks();
    } catch (e) { showToast(`No se pudo enviar: ${e.message}`, 'error'); }
  }

  // ── Uso (métricas) ──
  async function loadStats() {
    const table = ref('stats'), kpis = ref('kpis');
    const view = ref('statsView').value, days = Number(ref('statsDays').value);
    table.innerHTML = '<tbody><tr><td class="stb-empty">Cargando…</td></tr></tbody>';
    kpis.innerHTML = '';
    let rows, legacy = false;
    try { rows = await stemLibrary.adminOverview(days); }
    catch (e) {
      // Sin la migración 0019 solo hay "Más usados".
      try { rows = await stemLibrary.adminStats(days); legacy = true; }
      catch (e2) {
        table.innerHTML = `<tbody><tr><td class="stb-empty">No se pudo cargar: ${esc(e2.message)}. ¿Están aplicadas las migraciones 0018 y 0019?</td></tr></tbody>`;
        return;
      }
    }
    rows = (rows || []).map((r) => ({ ...r, adds: Number(r.adds) || 0, previews: Number(r.previews) || 0, users: Number(r.users) || 0 }));
    if (!legacy) {
      const used = rows.filter((r) => r.adds > 0).length;
      const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
      kpis.innerHTML = [
        ['Loops', rows.length], ['Agregados', sum('adds')], ['Escuchas', sum('previews')],
        ['Usados al menos 1 vez', rows.length ? `${Math.round((used / rows.length) * 100)} %` : '—'],
      ].map(([l, v]) => `<div class="spu-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
    }
    if (legacy && view !== 'top') {
      table.innerHTML = '<tbody><tr><td class="stb-empty">Esta vista necesita la migración 0019.</td></tr></tbody>';
      return;
    }
    if (view === 'packs') {
      const by = new Map();
      for (const r of rows) {
        const g = by.get(r.pack_id) || { title: r.pack_title, loops: 0, used: 0, adds: 0, previews: 0 };
        g.loops++; g.adds += r.adds; g.previews += r.previews; if (r.adds) g.used++;
        by.set(r.pack_id, g);
      }
      const packs = [...by.values()].sort((a, b) => b.adds - a.adds || b.previews - a.previews);
      table.innerHTML = !packs.length ? '<tbody><tr><td class="stb-empty">Todavía no hay packs.</td></tr></tbody>' : `
        <thead><tr><th>Pack</th><th>Loops</th><th>Usados</th><th>Agregados</th><th>Escuchados</th></tr></thead>
        <tbody>${packs.map((g) => `<tr><td>${esc(g.title)}</td><td>${g.loops}</td><td>${g.used} de ${g.loops}</td><td><b>${g.adds}</b></td><td>${g.previews}</td></tr>`).join('')}</tbody>`;
      return;
    }
    let list = rows, empty = 'Todavía no hay uso registrado en este periodo.';
    if (view === 'top') list = rows.filter((r) => r.adds || r.previews).slice(0, 50);
    else if (view === 'unused') { list = rows.filter((r) => !r.adds && !r.previews); empty = '¡Todos los loops se han usado o escuchado en este periodo!'; }
    else if (view === 'listened') {
      list = rows.filter((r) => r.previews && !r.adds).sort((a, b) => b.previews - a.previews);
      empty = 'Ningún loop escuchado se quedó sin agregar en este periodo.';
    }
    if (!list.length) { table.innerHTML = `<tbody><tr><td class="stb-empty">${empty}</td></tr></tbody>`; return; }
    table.innerHTML = `
      <thead><tr><th>#</th><th>Loop</th><th>Pack</th><th>Instrumento</th>${legacy ? '' : '<th>Marca</th>'}<th>Agregado</th><th>Escuchado</th><th>Personas</th></tr></thead>
      <tbody>${list.map((r, i) => `<tr>
        <td>${i + 1}</td><td>${esc(r.title)}</td><td>${esc(r.pack_title)}${r.published === false ? ' <span class="spu-muted">(sin publicar)</span>' : ''}</td>
        <td>${esc(INSTRUMENTS[r.instrument] || r.instrument)}</td>${legacy ? '' : `<td>${r.tier === 'free' ? 'GRATIS' : 'PRO'}</td>`}
        <td><b>${r.adds}</b></td><td>${r.previews}</td><td>${r.users}</td>
      </tr>`).join('')}</tbody>`;
  }

  // ── Filas de loops a subir ──
  function defaultTier() {
    if (community) return 'free';
    return mode() === 'new' ? ref('tier').value : (state.packs.find((p) => p.id === ref('existing').value)?.tier || 'pro');
  }

  // ── Un BPM y un tono por pack (como las canciones) ──
  const perLoop = () => ref('perLoop').checked;
  const mostCommon = (vals) => {
    const c = new Map(); vals.forEach((v) => c.set(v, (c.get(v) || 0) + 1));
    return [...c].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  // Al soltar audios: BPM = el del nombre de algún archivo, o el más repetido
  // entre lo detectado; tono = el más repetido entre los instrumentos con tono.
  function suggestPackTempo() {
    if (!state.rows.length) return;
    if (!(Number(ref('packBpm').value) > 0)) {
      const hints = state.rows.map((r) => r.hintBpm).filter(Boolean);
      const det = state.rows.map((r) => Math.round(r.detectedBpm || r.bpm)).filter((x) => x >= 40 && x <= 220);
      const bpm = hints.length ? mostCommon(hints) : mostCommon(det);
      if (bpm) ref('packBpm').value = String(bpm);
    }
    if (!ref('packKey').value) {
      const k = mostCommon(state.rows.filter((r) => !UNPITCHED.has(r.instrument) && r.key).map((r) => r.key));
      if (k) ref('packKey').value = k;
    }
  }
  // Aplica el BPM y el tono del pack a cada fila (las que actualizan un loop ya
  // subido conservan los suyos). Compases = duración a ese BPM.
  function applyPackTempo() {
    if (perLoop()) return;
    const bpm = Number(ref('packBpm').value);
    const key = ref('packKey').value || null;
    for (const r of state.rows) {
      if (r.updates) continue;
      if (bpm >= 20 && bpm <= 300) {
        const t = exactTempo(r.buffer.duration, bpm);
        r.bpm = t.bpm; r.bars = t.bars; r.offTempo = t.error > 0.03;
      }
      r.key = UNPITCHED.has(r.instrument) ? null : key;
    }
  }

  function renderRows() {
    const rows = state.rows;
    applyPackTempo();
    const per = perLoop();
    ref('rows').classList.toggle('is-packtempo', !per);
    ref('rows').innerHTML = !rows.length ? '' : `
      <thead><tr><th>Pista</th><th>Instrumento</th><th>Sección</th><th class="spu-col-bpm">BPM</th><th>Compases</th><th class="spu-col-key">Tono</th><th>Sensación</th>${admin ? '<th>Marca</th>' : ''}<th></th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-row="${i}"${previewRow === i ? ' class="is-playing"' : ''}>
        <td class="spu-title-cell"><button type="button" class="spu-rowplay" data-rowplay="${i}" title="Escuchar esta pista">${previewRow === i ? '■' : '▶'}</button><input data-f="title" value="${esc(r.title)}" maxlength="120">${r.updates ? '<span class="spu-upd" title="Ya existe en el pack: se reemplaza su audio y se conservan sus datos">actualiza</span>' : ''}</td>
        <td><select data-f="instrument">${opts(INSTRUMENTS, r.instrument)}</select></td>
        <td><select data-f="section">${opts(SECTIONS, r.section)}</select></td>
        <td class="spu-col-bpm"><input data-f="bpm" type="number" min="20" max="300" step="0.01" value="${r.bpm}"></td>
        <td>${per ? `<input data-f="bars" type="number" min="1" max="1024" value="${r.bars}">` : `<span class="spu-bars" title="${r.buffer.duration.toFixed(1)} s a ${r.bpm} BPM">${r.bars}</span>`}</td>
        <td class="spu-col-key"><select data-f="key">${keyOpts(r.key)}</select></td>
        <td><select data-f="feel">${feelOpts(r.feel)}</select></td>
        ${admin ? `<td><select data-f="tier">${opts({ free: 'GRATIS', pro: 'PRO' }, r.tier || defaultTier())}</select></td>` : ''}
        <td class="spu-check" title="${!per && r.offTempo ? `No dura un número entero de compases a ${ref('packBpm').value} BPM: revisa el BPM del pack o activa «Cada loop con su propio BPM»` : durationOk(r) ? 'La duración cuadra con BPM y compases' : `Dura ${r.buffer.duration.toFixed(2)} s, pero ${r.bars} compases a ${r.bpm} BPM son ${(r.bars * 240 / r.bpm).toFixed(2)} s`}">${(!per && r.offTempo) || !durationOk(r) ? '⚠' : '✓'}</td>
        <td><button type="button" class="stb-del" data-del="${i}" aria-label="Quitar">×</button></td>
      </tr>`).join('')}</tbody>`;
    ref('bulk').hidden = !rows.length;
    refreshButton();
    paintSummary();
  }
  function paintSummary() {
    if (state.busy) return;
    const n = state.rows.length;
    const bpm = Number(ref('packBpm').value), key = ref('packKey').value;
    const warn = state.rows.filter((r) => (!perLoop() && r.offTempo) || !durationOk(r)).length;
    ref('status').textContent = !n ? '' : `${n} pista${n === 1 ? '' : 's'}${!perLoop() && bpm ? ` · ${bpm} BPM` : ''}${!perLoop() && key ? ` · ${key}` : ''}${warn ? ` · ⚠ ${warn} por revisar` : ''}`;
  }

  // Escuchar una pista antes de subirla (para saber qué es «GA 1» o «Loop»).
  var previewRow = -1, previewSrc = null, previewCtx = null;   // var: renderRows puede usarse antes de esta línea
  function stopRowPreview() {
    if (previewSrc) { try { previewSrc.stop(); } catch (_) {} previewSrc = null; }
    previewRow = -1;
  }
  function toggleRowPreview(i) {
    const was = previewRow;
    stopRowPreview();
    if (was !== i && state.rows[i]) {
      previewCtx = previewCtx || new AudioContext();
      const src = previewCtx.createBufferSource();
      src.buffer = state.rows[i].buffer; src.connect(previewCtx.destination);
      src.onended = () => { if (previewSrc === src) { previewSrc = null; previewRow = -1; renderRows(); } };
      src.start(); previewSrc = src; previewRow = i;
    }
    renderRows();
  }

  function refreshButton() {
    const named = mode() === 'existing' ? !!ref('existing').value : !!ref('title').value.trim();
    const rightsOk = admin || !ref('publish').checked || ref('rights').checked;
    overlay.querySelector('[data-act="upload"]').disabled = state.busy || !state.rows.length || !named || !rightsOk;
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
    await prefillExisting();
    suggestPackTempo();
    ref('status').textContent = '';
    renderRows();
  }

  // Agregar a un pack existente: un archivo con el mismo nombre que un loop ya
  // subido ACTUALIZA ese loop, así que la fila arranca con sus datos actuales
  // (título, instrumento, tono, sensación, marca…) en vez de lo deducido del
  // nombre: re-subir el audio no deshace lo que se corrigió a mano.
  async function prefillExisting() {
    state.rows.forEach((r) => { r.updates = false; });
    if (mode() !== 'existing' || !state.rows.length) return;
    const packId = ref('existing').value;
    if (!packId) return;
    let loops = state.loops.get(packId);
    if (!loops) {
      try { loops = admin ? await stemLibrary.adminListLoops(packId) : await stemLibrary.listOwnPackLoops(packId); }
      catch (_) { return; }
      state.loops.set(packId, loops);
    }
    // El BPM y el tono del pack que ya existe.
    if (loops.length) {
      const b = mostCommon(loops.map((l) => Number(l.bpm)));
      const k = mostCommon(loops.map((l) => l.musical_key).filter(Boolean));
      if (b) ref('packBpm').value = String(b);
      if (k) ref('packKey').value = k;
    }
    const byName = new Map(loops.map((l) => [String(l.audio_path).split('/').pop(), l]));
    for (const r of state.rows) {
      const l = byName.get(safeFileName(r.file.name));
      if (!l) continue;
      Object.assign(r, {
        title: l.title, instrument: l.instrument, section: l.section, key: l.musical_key || null,
        feel: feelOf(l.tags), tags: l.tags, tier: l.tier, bpm: Number(l.bpm), bars: l.bars,
        edited: true, updates: true,
      });
    }
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
    const finish = ref('publish').checked;
    try {
      // 1) El pack (nuevo o existente) y dónde van sus archivos.
      let pack, put;
      if (admin) {
        if (mode() === 'existing') pack = state.packs.find((p) => p.id === ref('existing').value);
        else {
          let slug = slugify(ref('title').value);
          const taken = new Set(state.packs.map((p) => p.slug));
          for (let n = 2; taken.has(slug); n++) slug = `${slugify(ref('title').value)}-${n}`;
          pack = { slug, title: ref('title').value.trim(), description: ref('desc').value.trim(), genre: ref('genre').value.trim(), tier: ref('tier').value, published: false };
        }
        put = async (name, bytes, ct) => { const path = `${pack.slug}/${name}`; await stemLibrary.adminUpload(path, bytes, ct); return path; };
      } else {
        pack = mode() === 'existing'
          ? state.packs.find((p) => p.id === ref('existing').value)
          : await stemLibrary.communitySavePack({ title: ref('title').value.trim(), description: ref('desc').value.trim(), genre: ref('genre').value.trim(), author_name: ref('author').value.trim() });
        put = (name, bytes, ct) => stemLibrary.communityUpload(pack.id, name, bytes, ct);
      }
      let coverPath;
      if (state.cover) {
        status('Subiendo portada…');
        coverPath = await put(`cover.${IMAGE_TYPES[state.cover.type]}`, await state.cover.arrayBuffer(), state.cover.type);
        advance(state.cover.size);
      }
      if (admin) {
        pack = await stemLibrary.adminSavePack({
          slug: pack.slug, title: pack.title, description: pack.description || '', genre: pack.genre || '',
          mood: pack.mood || '', tier: pack.tier, published: !!pack.published,
          ...(coverPath ? { cover_path: coverPath } : {}),
        });
      }
      // 2) Los loops.
      const used = new Set();
      const loops = [];
      for (const [i, r] of state.rows.entries()) {
        status(`Subiendo ${i + 1} de ${state.rows.length}: ${r.title}…`);
        let name = safeFileName(r.file.name);
        while (used.has(name)) name = `${i}-${name}`;
        used.add(name);
        const ct = /\.flac$/i.test(name) ? 'audio/flac' : 'audio/wav';
        const audioPath = await put(name, r.bytes, ct);
        advance(r.bytes.byteLength);
        const preview = audioBufferToWav(await renderMono(r.buffer, 24000));
        const previewPath = await put(`preview/${name.replace(/\.flac$/i, '.wav')}`, preview, 'audio/wav');
        advance(r.bytes.byteLength * 0.25);
        loops.push({
          title: r.title, instrument: r.instrument, section: r.section, bpm: r.bpm, bars: r.bars,
          musical_key: r.key || null, beats_per_bar: 4, tier: r.tier || defaultTier(),
          audio_path: audioPath, preview_path: previewPath, size: r.bytes.byteLength,
          duration_sec: Math.round(r.buffer.duration * 1000) / 1000, sort: i, tags: withFeel(r.tags, r.feel),
        });
      }
      status('Registrando en la biblioteca…');
      const res = admin
        ? await stemLibrary.adminAddLoops(pack.id, loops)
        : await stemLibrary.communityAddLoops(pack.id, loops, coverPath ? { cover_path: coverPath } : {});
      let tail = '';
      if (admin && finish && !pack.published) { await stemLibrary.adminSetPublished(pack.id, true); tail = ' y publicado'; }
      else if (admin) tail = pack.published ? '' : ' (borrador)';
      else if (finish) { await stemLibrary.communitySubmit(pack.id); tail = ' y enviado a revisión'; }
      else tail = ' (sin enviar: envíalo desde "Mis envíos")';
      const what = [res.added ? `${res.added} nuevo${res.added === 1 ? '' : 's'}` : '', res.updated ? `${res.updated} actualizado${res.updated === 1 ? '' : 's'}` : '']
        .filter(Boolean).join(' y ') || `${loops.length} loops`;
      showToast(`"${pack.title}": ${what}${tail}.`, 'success');
      state.rows = []; state.cover = null;
      state.loops.delete(pack.id);
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
    stopPlaying(); stopRowPreview();
    window.removeEventListener('keydown', onKey, true); overlay.remove();
  };
  // Esc cierra, salvo que haya un diálogo de confirmación encima.
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const dialog = document.getElementById('dialog-overlay');
    if (dialog && !dialog.classList.contains('hidden')) return;
    e.stopPropagation(); close();
  };
  window.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const t = e.target.closest('[data-act],[data-tab],[data-del],[data-open],[data-play],[data-play-report],[data-rowplay]');
    if (!t) return;
    const { act, tab, del, open, play, playReport, id, rowplay } = t.dataset;
    if (rowplay != null) toggleRowPreview(Number(rowplay));
    else if (act === 'clearRows') { stopRowPreview(); state.rows = []; renderRows(); }
    else if (open) togglePack(open);
    else if (play) togglePlay(play);
    else if (playReport) togglePlay(playReport, t.dataset.pack);
    else if (act === 'changeCover') overlay.querySelector(`[data-cover-input="${CSS.escape(id)}"]`)?.click();
    else if (act === 'moveUp') movePack(id, -1);
    else if (act === 'moveDown') movePack(id, 1);
    else if (act === 'dismissReport') dismissReport(id);
    else if (act === 'removeReported') removeReported(id);
    else if (act === 'close') close();
    else if (act === 'files') ref('filesInput').click();
    else if (act === 'cover') ref('coverInput').click();
    else if (act === 'coverYtToggle') { ref('ytRow').hidden = !ref('ytRow').hidden; if (!ref('ytRow').hidden) ref('ytUrl').focus(); }
    else if (act === 'coverYt') useYoutubeCover();
    else if (act === 'editYtToggle') {
      const row = overlay.querySelector(`[data-yt-row="${CSS.escape(id)}"]`);
      row.hidden = !row.hidden;
      if (!row.hidden) row.querySelector('input').focus();
    }
    else if (act === 'editYt') useYoutubeCoverFor(id);
    else if (act === 'upload') upload();
    else if (act === 'savePack') savePack(id);
    else if (act === 'saveLoop') saveLoop(id);
    else if (act === 'deleteLoop') deleteLoop(id);
    else if (act === 'deletePack') deletePack(id);
    else if (act === 'withdraw') deletePack(id, { withdraw: true });
    else if (act === 'approve') review(id, true);
    else if (act === 'reject') review(id, false);
    else if (act === 'submit') submitOwn(id);
    else if (del != null) { stopRowPreview(); state.rows.splice(Number(del), 1); renderRows(); }
    else if (tab) {
      stopPlaying();
      overlay.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
      overlay.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
      if (tab === 'stats') loadStats();
    }
  });

  overlay.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'spu-mode') {
      ref('existing').disabled = mode() !== 'existing';
      ref('newpack').hidden = mode() !== 'new';
      await prefillExisting();
      renderRows();
    } else if (t === ref('existing')) { await prefillExisting(); renderRows(); }
    else if (t === ref('tier')) renderRows();
    else if (t === ref('packBpm') || t === ref('packKey') || t === ref('perLoop')) renderRows();
    else if (t.dataset.bulk) {
      const f = t.dataset.bulk, v = t.value;
      if (v) { state.rows.forEach((r) => { r[f] = v; }); renderRows(); showToast('Aplicado a todas las pistas.', 'success'); }
      t.value = '';
    }
    else if (t === ref('publish') || t === ref('rights')) refreshButton();
    else if (t === ref('statsDays') || t === ref('statsView')) loadStats();
    else if (t === ref('filesInput')) { await addFiles(t.files); t.value = ''; }
    else if (t.dataset.coverInput) { await changeCover(t.dataset.coverInput, t.files[0]); t.value = ''; }
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
    } else if (t.dataset.lf) {
      const id = t.closest('[data-loop]').dataset.loop;
      const loop = findLoop(id);
      const f = t.dataset.lf;
      const edit = { ...(state.edits.get(id) || {}) };
      edit[f] = (f === 'bpm' || f === 'bars') ? Number(t.value) : t.value;
      // Si vuelve a quedar como estaba, deja de contar como cambio.
      const original = f === 'feel' ? feelOf(loop.tags) : f === 'bpm' ? Number(loop.bpm) : (loop[f] ?? '');
      if (String(edit[f]) === String(original)) delete edit[f];
      if (Object.keys(edit).length) state.edits.set(id, edit); else state.edits.delete(id);
      const row = t.closest('tr');
      row.classList.toggle('is-dirty', state.edits.has(id));
      row.querySelector('.spu-save').disabled = !state.edits.has(id);
    } else if (t.dataset.f) {
      const r = state.rows[Number(t.closest('[data-row]').dataset.row)];
      const f = t.dataset.f;
      r[f] = (f === 'bpm' || f === 'bars') ? Number(t.value) : (t.value || null);
      if (f === 'feel') r.feel = t.value;
      if (f === 'bpm' || f === 'bars') { r.edited = true; renderRows(); }
      if (f === 'instrument' && !perLoop()) renderRows();   // batería/percusión: sin tono
    }
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target === ref('ytUrl')) { e.preventDefault(); useYoutubeCover(); }
    else if (e.target.dataset.ytUrl) { e.preventDefault(); useYoutubeCoverFor(e.target.dataset.ytUrl); }
  });
  overlay.addEventListener('input', (e) => {
    if (e.target === ref('title')) refreshButton();
    if (e.target.dataset.f === 'title') state.rows[Number(e.target.closest('[data-row]').dataset.row)].title = e.target.value;
    // El título de un loop existente cuenta como cambio mientras se escribe.
    if (e.target.dataset.lf === 'title') e.target.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const drop = ref('drop');
  drop.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('is-over'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); });

  if (admin) ref('publish').checked = false;   // el admin publica a propósito
  loadPacks();
  if (tab !== 'upload') overlay.querySelector(`[data-tab="${tab}"]`)?.click();
}
