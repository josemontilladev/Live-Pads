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
//     canUsePro: () => boolean,    // ¿la cuenta puede usar loops PRO?
//     requirePro: () => {},        // abre la ventana de planes
//   });
//
// Cada loop está marcado GRATIS o PRO (stem_loops.tier). Para el
// administrador, esa marca es un botón que la cambia (lo valida el servidor).
//   lib.toggle(); lib.getLoop(id); lib.getRepeats();

import * as stemLibrary from '../cloud/stemLibrary.js';
import { isLoggedIn } from '../cloud/supabase.js';
import { fitLoop, isCompatible } from './loopFit.js';
import { renderLoop } from './loopRender.js';
import { openStructureBuilder } from './structureBuilder.js';
import { openPackUploader } from './packUploader.js';
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
const SVG_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
const SVG_LOCK ='<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.4" fill="none"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

export function mountLibraryPanel(host, api) {
  // Panel lateral gemelo del de Canciones (.stems-setlist): misma tarjeta, y
  // contraído queda un riel con icono, texto vertical, flecha y contador. Reusa
  // las clases ssl-rail-* / ssl-title-* / ssl-collapse-btn para verse idéntico.
  const el = document.createElement('aside');
  el.className = 'stems-library collapsed';
  el.id = 'stems-library';
  el.setAttribute('aria-label', 'Biblioteca de stems');
  el.innerHTML = `
    <div class="stl-rail" data-act="open" role="button" tabindex="0" title="Mostrar biblioteca" aria-label="Mostrar biblioteca">
      <span class="ssl-rail-top">
        <span class="ssl-title-icon" aria-hidden="true">${SVG_BOOK}</span>
        <span class="ssl-rail-text">Biblioteca</span>
        <span class="ssl-rail-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="15 6 9 12 15 18"/></svg>
        </span>
      </span>
      <span class="ssl-rail-count" data-ref="count" title="Loops en la biblioteca" hidden></span>
    </div>
    <div class="stl-body">
    <div class="ssl-title-row">
      <span class="ssl-title-icon" aria-hidden="true">${SVG_BOOK}</span>
      <span class="ssl-title-label">Biblioteca de stems</span>
      <!-- Administrar (admin) o Compartir un pack (comunidad): botón redondo gemelo del de contraer. -->
      <button class="ssl-collapse-btn stl-admin-btn" type="button" data-act="admin" data-ref="admin" hidden title="Compartir un pack de loops con la comunidad" aria-label="Compartir un pack con la comunidad">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </button>
      <button class="ssl-collapse-btn" type="button" data-act="close" title="Contraer biblioteca" aria-label="Contraer biblioteca">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="9 6 15 12 9 18"/></svg>
      </button>
    </div>
    <div class="stl-project" data-ref="project"></div>
    <div class="stl-packs" data-ref="packs"></div>
    <div class="stl-packcard" data-ref="packcard" hidden></div>
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
      <select data-ref="feel" aria-label="Sensación" title="Cómo suena: íntimo, alegre, intenso…">
        <option value="">Sensación</option>
        ${Object.entries(stemLibrary.FEELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div class="stl-offline" data-ref="offline" hidden>
      <b>Sin conexión</b> · usas la copia guardada. Los loops con <span class="stl-dl-dot"></span> ya están en este equipo; el resto necesita internet.
    </div>
    <button type="button" class="stl-build" data-act="build" data-ref="build" hidden title="Elige una estructura (Intro, Verso, Coro…) y arma la secuencia completa con loops de la biblioteca">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/></svg>
      Armar por secciones
    </button>
    <div class="stl-views" data-ref="views" role="group" aria-label="Vista de la biblioteca">
      <button type="button" class="is-on" data-view="all">Todos</button>
      <button type="button" data-view="compat" title="Loops que suenan naturales en tu proyecto: poco estiramiento de tempo y poca transposición">Compatibles</button>
      <button type="button" data-view="fav">★ Favoritos</button>
      <button type="button" data-view="recent">Recientes</button>
    </div>
    <div class="stl-list" data-ref="list"></div>
    <footer class="stl-foot">
      <label>Repetir
        <select data-ref="repeats" aria-label="Repeticiones al agregar">
          <option value="1">1 vez</option><option value="2">2 veces</option>
          <option value="4" selected>4 veces</option><option value="8">8 veces</option>
        </select>
      </label>
      <label class="stl-same" title="Activado: cada loop se suma a la pista de su instrumento (una pista de batería, una de bajo…). Desactivado: cada loop crea su propia pista.">
        <input type="checkbox" data-ref="same" checked> Sumar a la pista de su instrumento
      </label>
      <span class="stl-foot-hint">Arrastra un loop a un compás o usa <b>+</b> para el cursor.</span>
      <span class="stl-foot-plan" data-ref="plan" hidden>Plan Gratis: usa los loops <b>GRATIS</b>. Los <b>PRO</b>, importar tus audios y exportar son parte de Pro.</span>
    </footer>
    </div>`;
  host.appendChild(el);

  const ref = (n) => el.querySelector(`[data-ref="${n}"]`);
  const state = { packId: '', packs: [], loops: [], loaded: false, busyId: null, admin: false, view: 'all', local: new Set(), downloading: null };
  const isLocked = (loop) => loop.tier !== 'free' && !api.canUsePro();

  // Favoritos y recientes: preferencias de este equipo (como el resto del panel).
  const FAV_KEY = 'stems-library-favs', RECENT_KEY = 'stems-library-recent';
  const readList = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
  const writeList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const favs = new Set(readList(FAV_KEY));
  let recent = readList(RECENT_KEY);   // ids, el más reciente primero
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    writeList(FAV_KEY, [...favs]);
    renderLoops();
  }
  function markRecent(id) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 30);
    writeList(RECENT_KEY, recent);
  }
  const loopsById = new Map();

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
      stemLibrary.trackLoopEvent(loop.id, 'preview');
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

  // Tras subir o publicar desde el panel de administración: catálogo de nuevo.
  async function reloadCatalog() {
    coverUrls.clear();
    state.packs = await stemLibrary.listPacks({ refresh: true }).catch(() => state.packs);
    if (state.packId && !state.packs.some((p) => p.id === state.packId)) state.packId = '';
    const count = ref('count'); count.hidden = true;   // que se recalcule el total
    renderPacks();
    await loadLoops();
  }

  async function loadPacks() {
    try {
      state.packs = await stemLibrary.listPacks();
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
        feel: ref('feel').value,
        text: ref('text').value,
      });
      if (seq !== searchSeq) return; // llegó una búsqueda más nueva
      state.loops = loops || [];
      // Qué loops ya están en este equipo (sin conexión, solo esos se pueden usar).
      ref('offline').hidden = !stemLibrary.isUsingOfflineCopy();
      state.local = await stemLibrary.localLoopIds(state.loops);
      if (seq !== searchSeq) return;
      loopsById.clear();
      state.loops.forEach((l) => loopsById.set(l.id, l));
      // Contador del riel: el total sin filtros (el de la primera carga).
      const count = ref('count');
      if (count.hidden) { count.textContent = String(state.loops.length); count.hidden = false; }
      renderLoops();
    } catch (e) {
      if (seq !== searchSeq) return;
      console.warn('No se pudieron cargar los loops:', e);
      list.innerHTML = '<div class="stl-empty">No se pudo cargar la biblioteca. Revisa tu conexión.</div>';
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderProject() {
    // Contexto en chips: a qué se ajustan los loops (tempo, tono y compás).
    const p = api.getProject();
    const key = p.key
      ? `<span class="stl-ctx-chip">${esc(p.key)}</span>`
      : '<span class="stl-ctx-chip is-warn" title="Sin tono definido: los loops no se transponen. Elige la tonalidad del proyecto arriba.">Sin tono</span>';
    ref('project').innerHTML = `<span class="stl-ctx-label">Ajustados a tu proyecto</span>
      <span class="stl-ctx-chip">${Math.round(p.bpm * 100) / 100} BPM</span>${key}<span class="stl-ctx-chip">${p.beatsPerBar || 4}/${p.beatValue || 4}</span>`;
  }

  function renderPacks() {
    const chips = [{ id: '', title: 'Todos' }, ...state.packs].map((p) =>
      `<button type="button" class="stl-chip${p.id === state.packId ? ' active' : ''}" data-pack="${esc(p.id)}">${
        p.cover_path ? `<span class="stl-chip-cover" data-cover="${esc(p.id)}"></span>` : ''}${esc(p.title)}</button>`).join('');
    ref('packs').innerHTML = chips;
    renderPackCard();
    paintCovers();
  }

  // Portadas: se bajan una vez a la caché local y se pintan donde haya un
  // [data-cover] de ese pack (chip y tarjeta).
  const coverUrls = new Map();
  function paintCovers() {
    for (const p of state.packs) {
      if (!p.cover_path) continue;
      const apply = (url) => {
        if (!url) return;
        el.querySelectorAll(`[data-cover="${CSS.escape(p.id)}"]`).forEach((n) => { n.style.backgroundImage = `url("${url}")`; });
      };
      if (coverUrls.has(p.id)) { apply(coverUrls.get(p.id)); continue; }
      coverUrls.set(p.id, null);
      stemLibrary.ensureCoverLocal(p).then((url) => { coverUrls.set(p.id, url); apply(url); }).catch(() => {});
    }
  }

  function renderPackCard() {
    const card = ref('packcard');
    const p = state.packs.find((x) => x.id === state.packId);
    if (!p) { card.hidden = true; card.innerHTML = ''; return; }
    card.hidden = false;
    card.innerHTML = `
      <div class="stl-packcard-cover"${p.cover_path ? ` data-cover="${esc(p.id)}"` : ''}>${p.cover_path ? '' : SVG_BOOK}</div>
      <div class="stl-packcard-info">
        <b>${esc(p.title)}</b>
        ${p.status === 'approved' ? `<span class="stl-community">Comunidad${p.author_name ? ` · por ${esc(p.author_name)}` : ''}</span>` : ''}
        ${p.description ? `<span>${esc(p.description)}</span>` : ''}
        <span class="stl-packcard-meta">${[p.genre, p.mood].filter(Boolean).map(esc).join(' · ')}</span>
        <button type="button" class="stl-dl" data-act="download" data-ref="download" title="Baja a este equipo los loops de este pack que puedes usar, para tenerlos en el culto aunque no haya internet">Descargar para usar sin conexión</button>
      </div>`;
    paintDownload();
  }

  // Botón de la tarjeta: cuántos loops del pack (usables con tu plan) ya están aquí.
  function paintDownload() {
    const btn = ref('download');
    if (!btn) return;
    if (state.downloading) {
      btn.disabled = true;
      btn.textContent = state.downloading.total ? `Descargando ${state.downloading.done} de ${state.downloading.total}…` : 'Preparando…';
      return;
    }
    const usable = state.loops.filter((l) => l.pack_id === state.packId && !isLocked(l));
    const have = usable.filter((l) => state.local.has(l.id)).length;
    const all = !!usable.length && have === usable.length;
    btn.disabled = !usable.length || all || stemLibrary.isUsingOfflineCopy();
    btn.classList.toggle('is-done', all);
    btn.textContent = !usable.length ? 'Nada que descargar con tu plan'
      : all ? `✓ Disponible sin conexión (${have})`
      : have ? `Descargar para usar sin conexión (${have} de ${usable.length})` : 'Descargar para usar sin conexión';
  }

  async function downloadPack() {
    const packId = state.packId;
    if (!packId || state.downloading) return;
    state.downloading = { done: 0, total: 0 };
    paintDownload();
    try {
      const r = await stemLibrary.downloadPackOffline(packId, {
        canUsePro: api.canUsePro(),
        onProgress: (done, total) => { state.downloading = { done, total }; paintDownload(); },
      });
      showToast(r.failed
        ? `Descargados ${r.downloaded}; ${r.failed} no se pudieron bajar. Revisa tu conexión.`
        : 'Pack listo para usar sin conexión.', r.failed ? 'error' : 'success');
    } catch (e) {
      showToast(`No se pudo descargar: ${e.message}`, 'error');
    } finally {
      state.downloading = null;
      state.local = await stemLibrary.localLoopIds(state.loops);
      renderLoops();
    }
  }

  function renderLoops() {
    // El proyecto pudo cargarse (o cambiar de BPM/tono) después de abrir el
    // panel: la cabecera se recalcula junto con los ajustes de cada loop.
    renderProject();
    const list = ref('list');
    // Catálogo vacío: se ocultan filtros, armado y pie (no sirven sin loops) y
    // queda una tarjeta clara; el administrador tiene el atajo para subir.
    const emptyCatalog = !state.packs.length;
    el.classList.toggle('is-empty-catalog', emptyCatalog);
    if (emptyCatalog) {
      list.innerHTML = `<div class="stl-empty stl-empty--catalog">
        <div class="stl-empty-icon">${SVG_BOOK}</div>
        <b>${state.admin ? 'La biblioteca está vacía' : 'Pronto habrá loops aquí'}</b>
        <span>${state.admin
          ? 'Sube tu primer pack de loops: los usuarios lo verán aquí en cuanto lo publiques.'
          : 'Estamos preparando packs de loops listos para tus secuencias. Vuelve pronto.'}</span>
        ${state.admin ? '<button type="button" class="stb-btn stb-btn--primary" data-act="admin">Subir tu primer pack</button>' : ''}
      </div>`;
      return;
    }
    if (!state.loops.length) {
      list.innerHTML = '<div class="stl-empty">No hay loops con esos filtros.</div>';
      return;
    }
    const project = api.getProject();
    let shown = state.loops;
    if (state.view === 'compat') shown = shown.filter((l) => isCompatible(fitLoop(loopSpec(l), project)));
    else if (state.view === 'fav') shown = shown.filter((l) => favs.has(l.id));
    else if (state.view === 'recent') {
      const order = new Map(recent.map((id, i) => [id, i]));
      shown = shown.filter((l) => order.has(l.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
    }
    if (!shown.length) {
      list.innerHTML = `<div class="stl-empty">${{
        compat: `Ningún loop encaja de forma natural en ${Math.round(project.bpm)} BPM${project.key ? ' en ' + esc(project.key) : ''}. Prueba "Todos": se ajustan igual, solo que se estiran más.`,
        fav: 'Marca con ★ los loops que más uses y aparecerán aquí.',
        recent: 'Aquí verás los últimos loops que agregues al proyecto.',
      }[state.view] || 'No hay loops con esos filtros.'}</div>`;
      return;
    }
    list.innerHTML = shown.map((l) => {
      const fit = fitLoop(loopSpec(l), project);
      const free = l.tier === 'free';
      const tierLabel = free ? 'GRATIS' : 'PRO';
      const tier = state.admin
        ? `<button type="button" class="stl-tier stl-tier--${free ? 'free' : 'pro'} is-admin" data-act="tier" title="Administrador: clic para marcarlo como ${free ? 'PRO' : 'GRATIS'}">${tierLabel}</button>`
        : `<span class="stl-tier stl-tier--${free ? 'free' : 'pro'}">${tierLabel}</span>`;
      const locked = isLocked(l);
      const here = state.local.has(l.id);
      const unavailable = !here && stemLibrary.isUsingOfflineCopy();
      const fitTxt = [
        Math.abs(fit.ratio - 1) > 1e-4 ? `${Math.round(fit.effectiveBpm)}→${Math.round(project.bpm)} BPM` : '',
        fit.semitones ? `${fit.semitones > 0 ? '+' : ''}${fit.semitones} st` : '',
      ].filter(Boolean).join(' · ') || 'Sin ajuste';
      const warn = QUALITY_HINT[fit.quality] || (fit.warnings.includes('meter') ? 'Su compás no es el del proyecto.' : '');
      return `<div class="stl-loop${locked ? ' is-locked' : ''}${unavailable ? ' is-unavailable' : ''}" draggable="${locked || unavailable ? 'false' : 'true'}" data-loop="${esc(l.id)}"${unavailable ? ' title="Sin conexión: este loop aún no está en este equipo"' : ''}>
        <button type="button" class="stl-play" data-act="preview" title="Escuchar ajustado al proyecto">${SVG_PLAY}</button>
        <div class="stl-loop-main">
          <div class="stl-loop-title">${tier} ${esc(l.title)}${here ? '<span class="stl-dl-dot" title="Ya está en este equipo: funciona sin internet"></span>' : ''}</div>
          <div class="stl-loop-meta">
            <span class="stl-tag stl-tag--${esc(l.instrument)}">${INSTRUMENTS[l.instrument] || esc(l.instrument)}</span>
            ${Number(l.bpm)} BPM · ${l.musical_key ? esc(l.musical_key) : 'sin tono'} · ${l.bars} comp.
          </div>
          <div class="stl-loop-fit${warn ? ' is-warn' : ''}" ${warn ? `title="${esc(warn)}"` : ''}>${esc(fitTxt)}${warn ? ' ⚠' : ''}</div>
        </div>
        <button type="button" class="stl-fav${favs.has(l.id) ? ' is-on' : ''}" data-act="fav" aria-pressed="${favs.has(l.id)}" title="${favs.has(l.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'}">★</button>
        ${locked
          ? `<button type="button" class="stl-add stl-add--locked" data-act="add" title="Este loop es parte de LivePads Pro">${SVG_LOCK}</button>`
          : `<button type="button" class="stl-add" data-act="add" title="Agregar en el compás del cursor">${SVG_PLUS}</button>`}
      </div>`;
    }).join('');
    paintPlaying();
    paintDownload();
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
    if (isLocked(loop)) { api.requirePro(); return; }
    if (stemLibrary.isUsingOfflineCopy() && !state.local.has(loop.id)) {
      showToast('Sin conexión: este loop todavía no está en este equipo.', 'info');
      return;
    }
    if (state.busyId) return;
    state.busyId = loop.id;
    setBusy(loop.id, true);
    try {
      await api.addLoop(loop, { atSec, repeats: getRepeats(), sameTrack: getSameTrack() });
      markRecent(loop.id);
      state.local.add(loop.id);
    } finally {
      setBusy(loop.id, false);
      state.busyId = null;
    }
  }

  // "Armar por secciones": usa el catálogo completo (no solo lo filtrado en la
  // lista) y, con plan Gratis, solo los loops GRATIS.
  async function openBuilder({ preset } = {}) {
    stopPreview();
    if (!isLoggedIn()) { showToast('Inicia sesión en tu cuenta de LivePads para usar la Biblioteca.', 'info'); return; }
    let all;
    try { all = await stemLibrary.listLoops({}); }
    catch (e) { showToast('No se pudo cargar la biblioteca. Revisa tu conexión.', 'error'); return; }
    const usable = api.canUsePro() ? all : all.filter((l) => l.tier === 'free');
    if (!usable.length) { showToast('Todavía no hay loops que puedas usar para armar una secuencia.', 'info'); return; }
    openStructureBuilder({
      loops: usable, packs: state.packs, packId: state.packId,
      project: api.getProject(), hasTracks: api.hasTracks(),
      labels: (k) => INSTRUMENTS[k] || k,
      onBuild: api.buildStructure,
      preset,
    });
  }

  function getRepeats() { return Number(ref('repeats').value) || 1; }
  function getSameTrack() { return ref('same').checked; }
  const SAME_KEY = 'stems-library-same-track';
  try { if (localStorage.getItem(SAME_KEY) === '0') ref('same').checked = false; } catch (_) {}
  ref('same').addEventListener('change', () => {
    try { localStorage.setItem(SAME_KEY, ref('same').checked ? '1' : '0'); } catch (_) {}
  });

  // Administrador: alterna GRATIS ↔ PRO. Se pinta al momento y se revierte si
  // el servidor lo rechaza.
  async function toggleTier(loop) {
    const prev = loop.tier;
    loop.tier = prev === 'free' ? 'pro' : 'free';
    renderLoops();
    try {
      await stemLibrary.setLoopTier(loop.id, loop.tier);
      showToast(`"${loop.title}" ahora es ${loop.tier === 'free' ? 'GRATIS' : 'PRO'}.`, 'success');
    } catch (e) {
      loop.tier = prev;
      renderLoops();
      showToast(`No se pudo cambiar: ${e.message}`, 'error');
    }
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close"]')) { close(); return; }
    if (e.target.closest('[data-act="open"]')) { open(); return; }
    if (e.target.closest('[data-act="build"]')) { openBuilder(); return; }
    if (e.target.closest('[data-act="admin"]')) {
      stopPreview();
      if (state.admin) openPackUploader({ onChanged: () => reloadCatalog() });
      else if (!api.canUsePro()) api.requirePro('Compartir packs con la comunidad');
      else openPackUploader({ community: true, onChanged: () => reloadCatalog() });
      return;
    }
    if (e.target.closest('[data-act="download"]')) { downloadPack(); return; }
    const chip = e.target.closest('.stl-chip');
    if (chip) {
      state.packId = chip.dataset.pack;
      renderPacks();
      loadLoops();
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) {
      state.view = view.dataset.view;
      el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-on', b === view));
      renderLoops();
      return;
    }
    const row = e.target.closest('.stl-loop');
    const loop = row && loopsById.get(row.dataset.loop);
    if (!loop) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') playPreview(loop);
    else if (act === 'add') add(loop);
    else if (act === 'tier' && state.admin) toggleTier(loop);
    else if (act === 'fav') toggleFav(loop.id);
  });

  el.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stl-loop');
    if (!row || row.classList.contains('is-locked')) return;
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
  ref('feel').addEventListener('change', loadLoops);

  // ── Abrir / cerrar ───────────────────────────────────────────────────────
  // Igual que el panel de Canciones: se recuerda el estado entre sesiones. El
  // ancho se anima en CSS; al terminar, el aviso de resize hace que el
  // timeline recalcule su ancho con el espacio nuevo.
  const COLLAPSED_KEY = 'stems-library-collapsed';
  const isCollapsed = () => el.classList.contains('collapsed');
  function setCollapsed(on) {
    el.classList.toggle('collapsed', on);
    try { localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0'); } catch (_) {}
  }
  el.addEventListener('transitionend', (e) => {
    if (e.target === el && e.propertyName === 'width') window.dispatchEvent(new Event('resize'));
  });
  el.querySelector('.stl-rail').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  async function open() {
    setCollapsed(false);
    renderProject();
    ref('plan').hidden = api.canUsePro();
    if (!isLoggedIn()) { renderLoggedOut(); return; }
    ref('build').hidden = false;
    if (!state.loaded) {
      state.loaded = true;
      state.admin = await stemLibrary.isLibraryAdmin();
      const adminBtn = ref('admin');
      adminBtn.hidden = false;
      if (state.admin) {
        adminBtn.title = 'Administrar biblioteca: subir packs, editar loops, moderar envíos y ver el uso';
        adminBtn.setAttribute('aria-label', 'Administrar biblioteca');
      }
      await loadPacks();
      await loadLoops();
    } else {
      renderLoops(); // el BPM/tono del proyecto pudo cambiar → recalcular ajustes
    }
  }
  function close() { setCollapsed(true); stopPreview(); }
  function toggle() { if (isCollapsed()) open(); else close(); }

  // Arranca como lo dejó la persona; la primera vez, contraído (solo el riel).
  // Contraído, se pide igual el total para el contador del riel.
  let startOpen = false;
  try { startOpen = localStorage.getItem(COLLAPSED_KEY) === '0'; } catch (_) {}
  if (startOpen) open();
  else if (isLoggedIn()) {
    stemLibrary.listLoops().then((loops) => {
      const count = ref('count');
      if (count.hidden) { count.textContent = String(loops.length); count.hidden = false; }
    }).catch(() => {});
  }

  return {
    open, close, toggle, stopPreview, getRepeats, getSameTrack, markRecent, openBuilder,
    isOpen: () => !isCollapsed(),
    getLoop: (id) => loopsById.get(id) || null,
    // El proyecto cambió de BPM/tono: repinta los ajustes si está abierto.
    refresh: () => { if (!isCollapsed()) { renderProject(); if (state.loops.length) renderLoops(); } },
  };
}

export const instrumentLabel = (k) => INSTRUMENTS[k] || k;
