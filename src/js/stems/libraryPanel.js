// Panel "Biblioteca" del editor de stems: explorar los packs oficiales de
// loops, escucharlos YA ajustados al tempo/tono del proyecto y llevarlos al
// timeline (botón "Agregar" en el compás del cursor, o arrastrando a un compás).
//
// El panel no toca el engine ni las pistas: todo lo que modifica el proyecto
// pasa por los callbacks que le da workspace.js. Así este módulo solo sabe de
// catálogo, escucha previa y UI.
//
//   const lib = mountLibraryPanel(hostEl, {
//     getProject: () => ({ bpm, key, beatsPerBar }),
//     getTransport: () => ({ playing, sec }),
//     getAudioOut: () => ({ ctx, dest }),
//     addLoop: async (loop, { atSec?, repeats }) => {},
//   });
//   lib.toggle(); lib.getLoop(id); lib.getRepeats();

import * as stemLibrary from '../cloud/stemLibrary.js';
import { isLoggedIn } from '../cloud/supabase.js';
import { fitLoop } from './loopFit.js';
import { renderLoop } from './loopRender.js';
import { esc } from '../utils/dom.js';
import { showToast } from '../ui/toast.js';

export const LOOP_DRAG_TYPE = 'application/x-livepads-loop';

const INSTRUMENTS = {
  drums: 'Batería', perc: 'Percusión', bass: 'Bajo', keys: 'Teclas', pad: 'Pad',
  synth: 'Synth', guitar: 'Guitarra', strings: 'Cuerdas', vocals: 'Voces', fx: 'FX', other: 'Otros',
};
const SECTIONS = {
  any: 'Cualquiera', intro: 'Intro', verse: 'Verso', prechorus: 'Pre-coro', chorus: 'Coro',
  bridge: 'Puente', build: 'Build', outro: 'Outro',
};
const QUALITY_HINT = {
  stretched: 'Estirado bastante: puede sonar algo procesado.',
  extreme: 'Muy lejos del tempo/tono original: puede sonar artificial.',
};

const SVG_PLAY = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
const SVG_STOP = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
const SVG_PLUS = '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.6" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

export function mountLibraryPanel(host, api) {
  const el = document.createElement('aside');
  el.className = 'stl-drawer';
  el.id = 'stems-library';
  el.hidden = true;
  el.setAttribute('aria-label', 'Biblioteca de stems');
  el.innerHTML = `
    <header class="stl-head">
      <div class="stl-title">Biblioteca <span>de stems</span></div>
      <button class="stl-x" type="button" data-act="close" aria-label="Cerrar biblioteca" title="Cerrar">×</button>
    </header>
    <div class="stl-project" data-ref="project"></div>
    <div class="stl-packs" data-ref="packs"></div>
    <div class="stl-filters">
      <input class="stl-search" data-ref="text" type="search" placeholder="Buscar loop…" aria-label="Buscar loop">
      <select data-ref="instrument" aria-label="Instrumento">
        <option value="">Instrumento</option>
        ${Object.entries(INSTRUMENTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select data-ref="section" aria-label="Sección">
        <option value="">Sección</option>
        ${Object.entries(SECTIONS).filter(([v]) => v !== 'any').map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div class="stl-list" data-ref="list"></div>
    <footer class="stl-foot">
      <label>Repetir
        <select data-ref="repeats" aria-label="Repeticiones al agregar">
          <option value="1">1 vez</option><option value="2">2 veces</option>
          <option value="4" selected>4 veces</option><option value="8">8 veces</option>
        </select>
      </label>
      <span class="stl-foot-hint">Arrastra un loop a un compás o usa <b>+</b> para el cursor.</span>
    </footer>`;
  host.appendChild(el);

  const ref = (n) => el.querySelector(`[data-ref="${n}"]`);
  const state = { packId: '', packs: [], loops: [], loaded: false, busyId: null };
  const loopsById = new Map();
  const packsById = new Map();

  // ── Escucha previa ────────────────────────────────────────────────────────
  // Se renderiza ajustada al proyecto y suena en bucle; si el transporte está
  // en marcha, arranca en el próximo compás para escucharla en contexto.
  const preview = { id: null, src: null, cache: new Map() };

  function stopPreview() {
    if (preview.src) { try { preview.src.stop(); } catch (_) {} preview.src = null; }
    preview.id = null;
    paintPlaying();
  }

  async function playPreview(loop) {
    if (preview.id === loop.id) { stopPreview(); return; }
    stopPreview();
    preview.id = loop.id;
    paintPlaying();
    const project = api.getProject();
    const fit = fitLoop(loopSpec(loop), project);
    const key = `${loop.id}|${fit.ratio.toFixed(5)}|${fit.semitones}`;
    try {
      let buf = preview.cache.get(key);
      if (!buf) {
        setBusy(loop.id, true);
        const { ctx } = api.getAudioOut();
        const url = await stemLibrary.ensurePreviewLocal(loop);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await ctx.decodeAudioData(await res.arrayBuffer());
        buf = await renderLoop(raw, fit, { beatsPerBar: loop.beats_per_bar, projectBpm: project.bpm, repeats: 1 });
        preview.cache.set(key, buf);
      }
      if (preview.id !== loop.id) return; // el usuario ya pidió otra cosa
      const { ctx, dest } = api.getAudioOut();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(dest);
      let when = ctx.currentTime;
      const t = api.getTransport();
      if (t.playing) {
        const barSec = (60 / project.bpm) * (project.beatsPerBar || 4);
        const next = Math.ceil(t.sec / barSec - 1e-6) * barSec;
        when += Math.max(0, next - t.sec);
      }
      src.start(when);
      preview.src = src;
    } catch (e) {
      console.warn('Escucha previa falló:', e);
      showToast('No se pudo cargar la escucha previa. ¿Hay internet?', 'error');
      stopPreview();
    } finally {
      setBusy(loop.id, false);
    }
  }

  // ── Datos ────────────────────────────────────────────────────────────────
  function loopSpec(loop) {
    return { loopBpm: Number(loop.bpm), loopKey: loop.musical_key, bars: loop.bars, beatsPerBar: loop.beats_per_bar };
  }

  async function loadPacks() {
    try {
      state.packs = await stemLibrary.listPacks();
      packsById.clear();
      state.packs.forEach((p) => packsById.set(p.id, p));
    } catch (e) {
      console.warn('No se pudieron cargar los packs:', e);
      state.packs = [];
    }
    renderPacks();
  }

  let searchSeq = 0;
  async function loadLoops() {
    const seq = ++searchSeq;
    const list = ref('list');
    list.innerHTML = '<div class="stl-empty">Cargando…</div>';
    try {
      const loops = await stemLibrary.listLoops({
        packId: state.packId,
        instrument: ref('instrument').value,
        section: ref('section').value,
        text: ref('text').value,
      });
      if (seq !== searchSeq) return; // llegó una búsqueda más nueva
      state.loops = loops || [];
      loopsById.clear();
      state.loops.forEach((l) => loopsById.set(l.id, l));
      renderLoops();
    } catch (e) {
      if (seq !== searchSeq) return;
      console.warn('No se pudieron cargar los loops:', e);
      list.innerHTML = '<div class="stl-empty">No se pudo cargar la biblioteca. Revisa tu conexión.</div>';
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderProject() {
    const p = api.getProject();
    const key = p.key
      ? `en <b>${esc(p.key)}</b>`
      : '<span class="stl-warn">sin tono definido (los loops no se transponen)</span>';
    ref('project').innerHTML = `Se ajustan a <b>${Math.round(p.bpm * 100) / 100} BPM</b> ${key}`;
  }

  function renderPacks() {
    const chips = [{ id: '', title: 'Todos' }, ...state.packs].map((p) =>
      `<button type="button" class="stl-chip${p.id === state.packId ? ' active' : ''}" data-pack="${esc(p.id)}">
        ${esc(p.title)}${p.tier === 'pro' ? ' <span class="stl-pro">PRO</span>' : ''}
      </button>`).join('');
    ref('packs').innerHTML = chips;
  }

  function renderLoops() {
    const list = ref('list');
    if (!state.loops.length) {
      list.innerHTML = state.packs.length
        ? '<div class="stl-empty">No hay loops con esos filtros.</div>'
        : '<div class="stl-empty">La biblioteca todavía no tiene packs publicados.</div>';
      return;
    }
    const project = api.getProject();
    list.innerHTML = state.loops.map((l) => {
      const pack = packsById.get(l.pack_id);
      const fit = fitLoop(loopSpec(l), project);
      const fitTxt = [
        Math.abs(fit.ratio - 1) > 1e-4 ? `${Math.round(fit.effectiveBpm)}→${Math.round(project.bpm)} BPM` : '',
        fit.semitones ? `${fit.semitones > 0 ? '+' : ''}${fit.semitones} st` : '',
      ].filter(Boolean).join(' · ') || 'Sin ajuste';
      const warn = QUALITY_HINT[fit.quality] || (fit.warnings.includes('meter') ? 'Su compás no es el del proyecto.' : '');
      return `<div class="stl-loop" draggable="true" data-loop="${esc(l.id)}">
        <button type="button" class="stl-play" data-act="preview" title="Escuchar ajustado al proyecto">${SVG_PLAY}</button>
        <div class="stl-loop-main">
          <div class="stl-loop-title">${esc(l.title)}${pack?.tier === 'pro' ? ' <span class="stl-pro">PRO</span>' : ''}</div>
          <div class="stl-loop-meta">
            <span class="stl-tag stl-tag--${esc(l.instrument)}">${INSTRUMENTS[l.instrument] || esc(l.instrument)}</span>
            ${Number(l.bpm)} BPM · ${l.musical_key ? esc(l.musical_key) : 'sin tono'} · ${l.bars} comp.
          </div>
          <div class="stl-loop-fit${warn ? ' is-warn' : ''}" ${warn ? `title="${esc(warn)}"` : ''}>${esc(fitTxt)}${warn ? ' ⚠' : ''}</div>
        </div>
        <button type="button" class="stl-add" data-act="add" title="Agregar en el compás del cursor">${SVG_PLUS}</button>
      </div>`;
    }).join('');
    paintPlaying();
  }

  function paintPlaying() {
    el.querySelectorAll('.stl-loop').forEach((row) => {
      const on = row.dataset.loop === preview.id;
      row.classList.toggle('is-playing', on);
      const b = row.querySelector('.stl-play');
      if (b) b.innerHTML = on ? SVG_STOP : SVG_PLAY;
    });
  }

  function setBusy(id, busy) {
    el.querySelector(`.stl-loop[data-loop="${CSS.escape(id)}"]`)?.classList.toggle('is-busy', busy);
  }

  function renderLoggedOut() {
    ref('packs').innerHTML = '';
    ref('list').innerHTML = '<div class="stl-empty">Inicia sesión en tu cuenta de LivePads para usar la biblioteca de stems.</div>';
  }

  // ── Agregar ──────────────────────────────────────────────────────────────
  async function add(loop, atSec) {
    if (state.busyId) return;
    state.busyId = loop.id;
    setBusy(loop.id, true);
    try {
      await api.addLoop(loop, { atSec, repeats: getRepeats() });
    } finally {
      setBusy(loop.id, false);
      state.busyId = null;
    }
  }

  function getRepeats() { return Number(ref('repeats').value) || 1; }

  // ── Eventos ──────────────────────────────────────────────────────────────
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close"]')) { close(); return; }
    const chip = e.target.closest('.stl-chip');
    if (chip) {
      state.packId = chip.dataset.pack;
      renderPacks();
      loadLoops();
      return;
    }
    const row = e.target.closest('.stl-loop');
    const loop = row && loopsById.get(row.dataset.loop);
    if (!loop) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') playPreview(loop);
    else if (act === 'add') add(loop);
  });

  el.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stl-loop');
    if (!row) return;
    e.dataTransfer.setData(LOOP_DRAG_TYPE, row.dataset.loop);
    e.dataTransfer.effectAllowed = 'copy';
  });

  let searchTimer = null;
  ref('text').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadLoops, 250);
  });
  ref('instrument').addEventListener('change', loadLoops);
  ref('section').addEventListener('change', loadLoops);

  // ── Abrir / cerrar ───────────────────────────────────────────────────────
  async function open() {
    el.hidden = false;
    renderProject();
    if (!isLoggedIn()) { renderLoggedOut(); return; }
    if (!state.loaded) {
      state.loaded = true;
      await loadPacks();
      await loadLoops();
    } else {
      renderLoops(); // el BPM/tono del proyecto pudo cambiar → recalcular ajustes
    }
  }
  function close() { el.hidden = true; stopPreview(); }
  function toggle() { if (el.hidden) open(); else close(); }

  return {
    open, close, toggle, stopPreview, getRepeats,
    isOpen: () => !el.hidden,
    getLoop: (id) => loopsById.get(id) || null,
    // El proyecto cambió de BPM/tono: repinta los ajustes si está abierto.
    refresh: () => { if (!el.hidden) { renderProject(); if (state.loops.length) renderLoops(); } },
  };
}

export const instrumentLabel = (k) => INSTRUMENTS[k] || k;
