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
import { openCardMoreMenu } from '../ui/cardMoreMenu.js';
import { pushModal } from '../ui/modalStack.js';
import { closeButton } from '../ui/components.js';

export const LOOP_DRAG_TYPE = 'application/x-livepads-loop';

const INSTRUMENTS = {
  drums: 'Batería', perc: 'Percusión', bass: 'Bajo', keys: 'Teclas', pad: 'Pad',
  synth: 'Synth', guitar: 'Guitarra', strings: 'Cuerdas', vocals: 'Voces', guide: 'Guía', click: 'Click', fx: 'FX', other: 'Otros',
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
const SVG_MORE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
const SVG_HEART = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 5 6.6 5c2 0 3.6 1.1 4.4 2.6l1 .1C12.8 6.1 14.4 5 16.4 5 19.8 5 22 8.3 20.5 11.8 18.5 16.4 12 21 12 21z"/></svg>';
// Orden de instrumentos para escuchar / probar un pack (una base que suene completa).
const LAYER_ORDER = ['drums', 'bass', 'keys', 'pad', 'guitar', 'synth', 'strings', 'perc', 'other', 'fx', 'vocals'];
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
    <div class="stl-filters stl-filters--simple">
      <input class="stl-search" data-ref="text" type="search" placeholder="Buscar por canción o artista…" aria-label="Buscar por canción o artista">
      <select data-ref="instrument" aria-label="Instrumento" hidden>
        <option value="">Instrumento</option>
        ${Object.entries(INSTRUMENTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select data-ref="section" aria-label="Sección" hidden>
        <option value="">Sección</option>
        ${Object.entries(SECTIONS).filter(([v]) => v !== 'any').map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select data-ref="feel" aria-label="Sensación" hidden>
        <option value="">Sensación</option>
        ${Object.entries(stemLibrary.FEELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>
    <div class="stl-offline" data-ref="offline" hidden>
      <b>Sin conexión</b> · <span data-ref="offline-txt">usas la copia guardada.</span>
      <button type="button" class="stl-linkbtn" data-act="only-local">Ver solo los descargados</button>
    </div>
    <div class="stl-try" data-ref="try" hidden></div>
    <button type="button" class="stl-build" data-act="build" data-ref="build" hidden title="Elige una estructura (Intro, Verso, Coro…) y arma la secuencia completa con loops de la biblioteca">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/></svg>
      Armar por secciones
    </button>
    <div class="stl-views" data-ref="views" role="group" aria-label="Vista de la biblioteca" hidden>
      <button type="button" class="is-on" data-view="all">Todos</button>
      <button type="button" data-view="compat" title="Loops que suenan naturales en tu proyecto: poco estiramiento de tempo y poca transposición">Compatibles</button>
      <button type="button" data-view="fav">★ Favoritos</button>
      <button type="button" data-view="recent">Recientes</button>
      <button type="button" data-view="local" title="Loops que ya están en este equipo: funcionan sin internet">Descargados</button>
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
  const state = { packId: '', packs: [], loops: [], loaded: false, busyId: null, admin: false, view: 'all', local: new Set(), downloading: null,
    catalog: [], localAll: new Set(), loadError: false };
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
  // Packs favoritos (♥) y usados hace poco: salen primero en la fila de packs.
  const FAVPACK_KEY = 'stems-library-fav-packs', RECENTPACK_KEY = 'stems-library-recent-packs';
  const favPacks = new Set(readList(FAVPACK_KEY));
  let recentPacks = readList(RECENTPACK_KEY);
  function toggleFavPack(id) {
    favPacks.has(id) ? favPacks.delete(id) : favPacks.add(id);
    writeList(FAVPACK_KEY, [...favPacks]);
    renderPacks();
  }
  function markRecentPack(id) {
    if (!id) return;
    recentPacks = [id, ...recentPacks.filter((x) => x !== id)].slice(0, 12);
    writeList(RECENTPACK_KEY, recentPacks);
  }
  const loopsById = new Map();

  // ── Escucha previa ────────────────────────────────────────────────────────
  // Se renderiza ajustada al proyecto y suena en bucle; si el transporte está
  // en marcha, arranca en el próximo compás para escucharla en contexto.
  // La PRIMERA vez que se escucha un loop suena al instante en streaming (al tempo
  // del proyecto), mientras se baja y se prepara la versión ajustada también de
  // tono; cuando está lista, la escucha pasa a esa sin cortar el bucle.
  const preview = { id: null, src: null, srcs: [], el: null, cache: new Map() };

  function stopPreview() {
    if (preview.src) { try { preview.src.stop(); } catch (_) {} preview.src = null; }
    preview.srcs.forEach((s) => { try { s.stop(); } catch (_) {} }); preview.srcs = [];
    if (preview.el) { try { preview.el.pause(); preview.el.src = ''; } catch (_) {} preview.el = null; }
    preview.id = null;
    paintPlaying();
  }

  // Pistas de canción completa: para escuchar basta el principio (16 compases).
  const PREVIEW_BARS = 16;
  async function fittedBuffer(loop, project) {
    const long = loop.bars > PREVIEW_BARS;
    const spec = long ? { ...loopSpec(loop), bars: PREVIEW_BARS } : loopSpec(loop);
    const fit = fitLoop(spec, project);
    const key = `${loop.id}|${fit.ratio.toFixed(5)}|${fit.semitones}`;
    let buf = preview.cache.get(key);
    if (buf) return { buf, fit };
    const { ctx } = api.getAudioOut();
    const url = await stemLibrary.ensurePreviewLocal(loop);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let raw = await ctx.decodeAudioData(await res.arrayBuffer());
    if (long) {
      const sec = PREVIEW_BARS * (loop.beats_per_bar || 4) * 60 / Number(loop.bpm);
      const len = Math.min(raw.length, Math.round(sec * raw.sampleRate));
      const cut = new AudioBuffer({ numberOfChannels: raw.numberOfChannels, length: len, sampleRate: raw.sampleRate });
      for (let c = 0; c < raw.numberOfChannels; c++) cut.getChannelData(c).set(raw.getChannelData(c).subarray(0, len));
      raw = cut;
    }
    buf = await renderLoop(raw, fit, { beatsPerBar: loop.beats_per_bar, projectBpm: project.bpm, repeats: 1 });
    preview.cache.set(key, buf);
    return { buf, fit };
  }

  function nextBarDelay(project) {
    const t = api.getTransport();
    if (!t.playing) return 0;
    const barSec = (60 / project.bpm) * (project.beatsPerBar || 4);
    const next = Math.ceil(t.sec / barSec - 1e-6) * barSec;
    return Math.max(0, next - t.sec);
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
      const cached = preview.cache.has(key);
      if (!cached && !stemLibrary.isUsingOfflineCopy() && !(await stemLibrary.isPreviewLocal(loop))) {
        // Al instante: streaming desde la nube (tempo ajustado; el tono llega enseguida).
        try {
          const url = await stemLibrary.previewStreamUrl(loop);
          if (preview.id !== loop.id) return;
          const a = new Audio(url);
          a.loop = true; a.preservesPitch = true;
          a.playbackRate = Math.min(4, Math.max(0.25, fit.ratio || 1));
          await a.play();
          if (preview.id !== loop.id) { a.pause(); return; }
          preview.el = a;
          paintPlaying();
        } catch (_) { /* sin streaming: se espera a la versión ajustada */ }
      }
      setBusy(loop.id, !preview.el);
      const { buf } = await fittedBuffer(loop, project);
      if (preview.id !== loop.id) return; // el usuario ya pidió otra cosa
      const { ctx, dest } = api.getAudioOut();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(dest);
      let offset = 0, when = ctx.currentTime;
      if (preview.el) {
        // Sigue por donde iba el streaming.
        offset = ((preview.el.currentTime || 0) / (fit.ratio || 1)) % buf.duration;
        try { preview.el.pause(); preview.el.src = ''; } catch (_) {}
        preview.el = null;
      } else when += nextBarDelay(project);
      src.start(when, offset);
      preview.src = src;
      paintPlaying();
      stemLibrary.trackLoopEvent(loop.id, 'preview');
    } catch (e) {
      console.warn('Escucha previa falló:', e);
      showToast(stemLibrary.isUsingOfflineCopy() ? 'Sin conexión: este loop aún no está en este equipo.' : 'No se pudo cargar la escucha previa. Revisa tu conexión e inténtalo de nuevo.', 'error');
      stopPreview();
    } finally {
      setBusy(loop.id, false);
    }
  }

  // Una base del pack (batería + bajo + teclas + pad…), elegida de la misma sección.
  function pickPackLayers(packId, { usableOnly = false, max = 4 } = {}) {
    const loops = state.catalog.filter((l) => l.pack_id === packId && (!usableOnly || !isLocked(l))
      && (!stemLibrary.isUsingOfflineCopy() || state.localAll.has(l.id)));
    if (!loops.length) return [];
    const bySec = new Map();
    loops.forEach((l) => { const k = l.section || 'any'; if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(l); });
    let best = null, bestScore = -1;
    bySec.forEach((arr, k) => {
      const score = new Set(arr.map((l) => l.instrument)).size + (k === 'chorus' ? 0.5 : k === 'verse' ? 0.3 : 0);
      if (score > bestScore) { bestScore = score; best = arr; }
    });
    const rank = (i) => { const r = LAYER_ORDER.indexOf(i); return r < 0 ? 99 : r; };
    const out = [], seen = new Set();
    best.slice().sort((a, b) => rank(a.instrument) - rank(b.instrument)).forEach((l) => {
      if (out.length < max && !seen.has(l.instrument)) { seen.add(l.instrument); out.push(l); }
    });
    return out;
  }

  async function playPackPreview(packId) {
    const id = 'pack:' + packId;
    if (preview.id === id) { stopPreview(); return; }
    stopPreview();
    const layers = pickPackLayers(packId);
    if (!layers.length) { showToast(stemLibrary.isUsingOfflineCopy() ? 'Sin conexión: este pack no está en este equipo.' : 'Este pack todavía no tiene loops para escuchar.', 'info'); return; }
    preview.id = id;
    paintPackPreview(true);
    const project = api.getProject();
    try {
      const bufs = await Promise.all(layers.map((l) => fittedBuffer(l, project).then((r) => r.buf).catch(() => null)));
      if (preview.id !== id) return;
      const { ctx, dest } = api.getAudioOut();
      const when = ctx.currentTime + 0.05 + nextBarDelay(project);
      bufs.filter(Boolean).forEach((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.connect(dest); src.start(when);
        preview.srcs.push(src);
      });
      if (!preview.srcs.length) throw new Error('sin audio');
      layers.forEach((l) => stemLibrary.trackLoopEvent(l.id, 'preview'));
    } catch (e) {
      showToast('No se pudo escuchar el pack. Revisa tu conexión e inténtalo de nuevo.', 'error');
      stopPreview();
    }
    paintPackPreview(false);
  }
  function paintPackPreview(loading) {
    const b = ref('packcard')?.querySelector('[data-act="pack-preview"]');
    if (!b) return;
    const on = preview.id === 'pack:' + state.packId;
    b.classList.toggle('is-on', on);
    b.innerHTML = `${on && !loading ? SVG_STOP : SVG_PLAY} ${loading && on ? 'Preparando…' : on ? 'Parar' : 'Escuchar el pack'}`;
  }

  // «Probar un pack»: pone una base del pack en el inicio del proyecto y suena.
  async function tryPack(packId) {
    stopPreview();
    const pid = packId || state.packId || (state.packs.find((p) => pickPackLayers(p.id, { usableOnly: true }).length) || {}).id;
    const layers = pid ? pickPackLayers(pid, { usableOnly: true }) : [];
    if (!layers.length) { showToast('No hay un pack que puedas usar ahora mismo.', 'info'); return; }
    const btn = ref('try')?.querySelector('[data-act="try"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Cargando la base…'; }
    try {
      for (const l of layers) {
        await api.addLoop(l, { atSec: 0, repeats: l.bars > 16 ? 1 : 4, sameTrack: true });
        markRecent(l.id); state.local.add(l.id); state.localAll.add(l.id);
      }
      markRecentPack(pid);
      api.play?.();
      const p = state.packs.find((x) => x.id === pid);
      showToast(`Sonando una base de «${p ? p.title : 'el pack'}». Cambia o añade loops desde aquí.`, 'success');
    } catch (e) {
      showToast(`No se pudo cargar el pack: ${e.message}`, 'error');
    } finally {
      renderTry();
    }
  }
  function renderTry() {
    const box = ref('try');
    if (!box) return;
    const show = state.loaded && !api.hasTracks() && !state.loadError
      && state.packs.some((p) => pickPackLayers(p.id, { usableOnly: true }).length);
    box.hidden = !show;
    if (!show) return;
    box.innerHTML = `<b>¿Primera vez?</b><span>Carga una base de batería, bajo y teclas en tu proyecto y empieza a sonar.</span>
      <button type="button" class="stb-btn stb-btn--primary" data-act="try">▶ Probar un pack</button>`;
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
      state.catalog = await stemLibrary.listLoops({});
      state.localAll = await stemLibrary.localLoopIds(state.catalog);
    } catch (e) {
      console.warn('No se pudieron cargar los packs:', e);
      state.packs = state.packs || [];
    }
    ensurePack();
    renderPacks();
    renderTry();
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
        text: '',
      });
      if (seq !== searchSeq) return; // llegó una búsqueda más nueva
      state.loops = loops || [];
      state.loadError = false;
      // Qué loops ya están en este equipo (sin conexión, solo esos se pueden usar).
      ref('offline').hidden = !stemLibrary.isUsingOfflineCopy();
      state.local = await stemLibrary.localLoopIds(state.loops);
      if (stemLibrary.isUsingOfflineCopy()) {
        const n = state.localAll.size || state.local.size;
        ref('offline-txt').textContent = n ? `Tienes ${n} loop${n === 1 ? '' : 's'} descargado${n === 1 ? '' : 's'} que funcionan sin internet.` : 'Todavía no has descargado loops en este equipo; vuelve a conectarte para usar la biblioteca.';
        el.querySelector('[data-act="only-local"]').hidden = !n;
      }
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
      state.loadError = true;
      renderTry();
      list.innerHTML = `<div class="stl-empty"><b>No se pudo cargar la biblioteca.</b><br>Revisa tu conexión a internet.
        <div class="stl-empty-actions"><button type="button" class="stb-btn stb-btn--primary" data-act="retry">Reintentar</button>${state.localAll.size ? `<button type="button" class="stb-btn" data-act="only-local">Ver los ${state.localAll.size} descargados</button>` : ''}</div></div>`;
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

  // Estado de un pack en UNA etiqueta: Pro · Descargado · n de m en el equipo · En la nube.
  function packStatus(pid) {
    const loops = state.catalog.filter((l) => l.pack_id === pid);
    const usable = loops.filter((l) => !isLocked(l));
    if (loops.length && !usable.length) return { cls: 'pro', txt: 'Pro', tip: 'Los loops de este pack son parte de LivePads Pro' };
    const have = usable.filter((l) => state.localAll.has(l.id)).length;
    if (usable.length && have === usable.length) return { cls: 'local', txt: '✓ Descargado', tip: 'Ya está en este equipo: funciona sin internet' };
    if (have) return { cls: 'part', txt: `${have} de ${usable.length} aquí`, tip: 'Parte del pack ya está en este equipo' };
    return { cls: 'cloud', txt: 'En la nube', tip: 'Se baja al usarlo (necesita internet la primera vez)' };
  }
  function packMeta(pid) {
    const loops = state.catalog.filter((l) => l.pack_id === pid);
    if (!loops.length) return '';
    const bpms = [...new Set(loops.map((l) => Math.round(Number(l.bpm))).filter((x) => x > 0))].sort((a, b) => a - b);
    const keys = {};
    loops.forEach((l) => { if (l.musical_key) keys[l.musical_key] = (keys[l.musical_key] || 0) + 1; });
    const key = Object.keys(keys).sort((a, b) => keys[b] - keys[a])[0];
    const bpm = !bpms.length ? '' : bpms.length === 1 ? `${bpms[0]} BPM` : `${bpms[0]}–${bpms[bpms.length - 1]} BPM`;
    return [bpm, key].filter(Boolean).join(' · ');
  }
  // Los tracks no se mezclan entre packs: siempre hay UN pack elegido
  // (el último que usaste o, si no, el primero de la lista).
  function ensurePack() {
    if (state.packId && state.packs.some((p) => p.id === state.packId)) return;
    const recent = recentPacks.find((id) => state.packs.some((p) => p.id === id));
    state.packId = recent || (sortedPacks()[0] || {}).id || '';
  }
  function sortedPacks() {
    const rec = new Map(recentPacks.map((id, i) => [id, i]));
    return state.packs.slice().sort((a, b) => {
      const fa = favPacks.has(a.id) ? 0 : 1, fb = favPacks.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = rec.has(a.id) ? rec.get(a.id) : 999, rb = rec.has(b.id) ? rec.get(b.id) : 999;
      return ra - rb;
    });
  }
  function renderPacks() {
    const cur = state.packs.find((p) => p.id === state.packId);
    ref('packs').innerHTML = !state.packs.length ? '' : `
      <button type="button" class="stl-packpick stl-packpick--slim" data-act="packs" title="Elegir otro pack">
        <span class="stl-packpick-ico">${SVG_BOOK}</span>
        <span class="stl-packpick-txt"><b>Packs</b><small>${state.packs.length} ${state.packs.length === 1 ? 'pack disponible' : 'packs disponibles'}</small></span>
        <span class="stl-packpick-go">Ver todos</span>
      </button>`;
    renderPackCard();
    paintCovers();
    if (packsWin) packsWin.render();
  }

  // ── Ventana «Packs»: todos los packs en cuadrícula, con buscador ──
  let packsWin = null;
  function openPacksWindow() {
    if (packsWin) return;
    const ov = document.createElement('div');
    ov.className = 'stl-packs-overlay';
    ov.innerHTML = `
      <div class="stl-packs-win" role="dialog" aria-modal="true" aria-label="Packs de la biblioteca">
        <header class="stl-packs-head">
          <h3>Packs</h3>
          <input class="stl-search stl-packs-search" type="search" placeholder="Buscar pack, canción o artista…" aria-label="Buscar pack">
          ${closeButton({ attrs: { 'data-act': 'close' } })}
        </header>
        <div class="stl-packs-grid"></div>
      </div>`;
    document.body.appendChild(ov);
    const grid = ov.querySelector('.stl-packs-grid');
    const search = ov.querySelector('.stl-packs-search');
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const render = () => {
      const q = norm(search.value).split(/\s+/).filter(Boolean);
      const packs = sortedPacks().filter((p) => {
        const hay = norm(`${p.title} ${p.artist || ''} ${p.genre || ''}`);
        return q.every((w) => hay.includes(w));
      });
      const count = (pid) => state.catalog.filter((l) => l.pack_id === pid).length;
      grid.innerHTML = packs.map((p) => {
        const st = packStatus(p.id);
        const n = count(p.id);
        return `<button type="button" class="stl-pc${p.id === state.packId ? ' active' : ''}" data-pick="${esc(p.id)}" title="${esc(p.title)} — ${esc(st.tip)}">
          <span class="stl-pc-cover"${p.cover_path ? ` data-cover="${esc(p.id)}"` : ''}>${p.cover_path ? '' : SVG_BOOK}${favPacks.has(p.id) ? `<i class="stl-pk-fav">${SVG_HEART}</i>` : ''}</span>
          <span class="stl-pc-title">${esc(p.title)}</span>
          <span class="stl-pc-sub">${esc(p.artist || packMeta(p.id) || '')}</span>
          <span class="stl-pc-foot"><span>${n} ${n === 1 ? 'loop' : 'loops'}</span><span class="stl-st stl-st--${st.cls}">${esc(st.txt)}</span></span>
        </button>`;
      }).join('') + (!packs.length && q.length ? '<div class="stl-empty">Ningún pack coincide con la búsqueda.</div>' : '');
      paintCovers();
    };
    let pop = null;
    const close = () => {
      if (!packsWin) return;
      packsWin = null;
      if (pop) { pop(); pop = null; }
      ov.remove();
    };
    packsWin = { render, close };
    pop = pushModal(close, ov.querySelector('.stl-packs-win'));
    search.addEventListener('input', render);
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
      const card = e.target.closest('[data-pick]');
      if (!card) return;
      state.packId = card.dataset.pick;
      ref('text').value = '';
      close();
      renderPacks();
      loadLoops();
    });
    render();
    setTimeout(() => { try { search.focus(); } catch (_) {} }, 30);
  }

  // Portadas: se bajan una vez a la caché local y se pintan donde haya un
  // [data-cover] de ese pack (chip y tarjeta).
  const coverUrls = new Map();
  function paintCovers() {
    for (const p of state.packs) {
      if (!p.cover_path) continue;
      const apply = (url) => {
        if (!url) return;
        document.querySelectorAll(`[data-cover="${CSS.escape(p.id)}"]`).forEach((n) => { n.style.backgroundImage = `url("${url}")`; });
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
        ${p.artist ? `<span class="stl-packcard-artist">${esc(p.artist)}</span>` : ''}
        ${p.status === 'approved' ? `<span class="stl-community">Comunidad${p.author_name ? ` · por ${esc(p.author_name)}` : ''}</span>` : ''}
        ${p.description ? `<span>${esc(p.description)}</span>` : ''}
        <span class="stl-packcard-meta">${[packMeta(p.id), p.genre, p.mood].filter(Boolean).map(esc).join(' · ')}</span>
        <span class="stl-st stl-st--${packStatus(p.id).cls}" title="${esc(packStatus(p.id).tip)}">${esc(packStatus(p.id).txt)}</span>
        <div class="stl-packcard-actions">
          <button type="button" class="stl-main" data-act="pack-preview">${SVG_PLAY} Escuchar el pack</button>
          <button type="button" class="stl-more" data-act="pack-more" title="Más opciones del pack" aria-label="Más opciones del pack">${SVG_MORE}</button>
        </div>
        <span class="stl-dl-progress" data-ref="download"></span>
      </div>`;
    paintDownload();
    paintPackPreview(false);
  }

  // Botón de la tarjeta: cuántos loops del pack (usables con tu plan) ya están aquí.
  function paintDownload() {
    const btn = ref('download');
    if (!btn) return;
    btn.textContent = state.downloading
      ? (state.downloading.total ? `Descargando ${state.downloading.done} de ${state.downloading.total}…` : 'Preparando la descarga…')
      : '';
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
      state.localAll = await stemLibrary.localLoopIds(state.catalog);
      renderPacks();
      renderLoops();
    }
  }

  // Buscar = encontrar el pack de una canción o artista; al elegirlo, se ven sus tracks.
  function renderPackResults() {
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = norm(ref('text').value).split(/\s+/).filter(Boolean);
    const packs = sortedPacks().filter((p) => {
      const hay = norm(`${p.title} ${p.artist || ''} ${p.genre || ''}`);
      return q.every((w) => hay.includes(w));
    });
    const list = ref('list');
    if (!packs.length) { list.innerHTML = '<div class="stl-empty">Ningún pack coincide con esa canción o artista.</div>'; return; }
    list.innerHTML = `<div class="stl-results-k">${packs.length} ${packs.length === 1 ? 'pack' : 'packs'}</div>` + packs.map((p) => {
      const n = state.catalog.filter((l) => l.pack_id === p.id).length;
      return `<button type="button" class="stl-presult${p.id === state.packId ? ' active' : ''}" data-pick-pack="${esc(p.id)}">
        <span class="stl-presult-cover"${p.cover_path ? ` data-cover="${esc(p.id)}"` : ''}>${p.cover_path ? '' : SVG_BOOK}</span>
        <span class="stl-presult-txt"><b>${esc(p.title)}</b><small>${esc([p.artist, `${n} ${n === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · '))}</small></span>
      </button>`;
    }).join('');
    paintCovers();
  }

  function renderLoops() {
    if (ref('text').value.trim()) { renderPackResults(); return; }
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
    renderTry();
    if (!state.loops.length) {
      list.innerHTML = emptyFiltersHtml();
      return;
    }
    const project = api.getProject();
    let shown = state.loops;
    if (state.view === 'compat') shown = shown.filter((l) => isCompatible(fitLoop(loopSpec(l), project)));
    else if (state.view === 'fav') shown = shown.filter((l) => favs.has(l.id));
    else if (state.view === 'local') shown = shown.filter((l) => state.local.has(l.id));
    else if (state.view === 'recent') {
      const order = new Map(recent.map((id, i) => [id, i]));
      shown = shown.filter((l) => order.has(l.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
    }
    if (!shown.length) {
      list.innerHTML = `<div class="stl-empty">${{
        compat: `Ningún loop encaja de forma natural en ${Math.round(project.bpm)} BPM${project.key ? ' en ' + esc(project.key) : ''}. Prueba "Todos": se ajustan igual, solo que se estiran más.`,
        fav: 'Marca con ★ los loops que más uses y aparecerán aquí.',
        recent: 'Aquí verás los últimos loops que agregues al proyecto.',
        local: 'Todavía no hay loops de esta vista en este equipo. Abre un pack y, en su menú ⋮, elige «Descargar para usar sin conexión».',
      }[state.view] || 'No hay loops con esos filtros.'}<div class="stl-empty-actions"><button type="button" class="stb-btn" data-act="view-all">Ver todos</button></div></div>`;
      return;
    }
    list.innerHTML = shown.map((l) => {
      const fit = fitLoop(loopSpec(l), project);
      const free = l.tier === 'free';
      const tierLabel = free ? 'GRATIS' : 'PRO';
      void tierLabel;
      const locked = isLocked(l);
      const here = state.local.has(l.id);
      // UNA etiqueta de estado: Pro (bloqueado) · Descargado · En la nube.
      const st = locked ? { cls: 'pro', txt: 'Pro', tip: 'Parte de LivePads Pro' }
        : here ? { cls: 'local', txt: '✓ Descargado', tip: 'Ya está en este equipo: funciona sin internet' }
        : { cls: 'cloud', txt: free ? 'Gratis' : 'En la nube', tip: 'Se baja al usarlo (necesita internet la primera vez)' };
      const unavailable = !here && stemLibrary.isUsingOfflineCopy();
      const fitTxt = [
        Math.abs(fit.ratio - 1) > 1e-4 ? `${Math.round(fit.effectiveBpm)}→${Math.round(project.bpm)} BPM` : '',
        fit.semitones ? `${fit.semitones > 0 ? '+' : ''}${fit.semitones} st` : '',
      ].filter(Boolean).join(' · ') || 'Sin ajuste';
      const warn = QUALITY_HINT[fit.quality] || (fit.warnings.includes('meter') ? 'Su compás no es el del proyecto.' : '');
      return `<div class="stl-loop${locked ? ' is-locked' : ''}${unavailable ? ' is-unavailable' : ''}" draggable="${locked || unavailable ? 'false' : 'true'}" data-loop="${esc(l.id)}"${unavailable ? ' title="Sin conexión: este loop aún no está en este equipo"' : ''}>
        <button type="button" class="stl-play" data-act="preview" title="Escuchar ajustado al proyecto (suena al instante)">${SVG_PLAY}</button>
        <div class="stl-loop-main">
          <div class="stl-loop-title">${favs.has(l.id) ? '<span class="stl-star" title="Favorito">★</span>' : ''}${esc(l.title)}</div>
          <div class="stl-loop-meta">
            <span class="stl-tag stl-tag--${esc(l.instrument)}">${INSTRUMENTS[l.instrument] || esc(l.instrument)}</span>
            ${Number(l.bpm)} BPM · ${l.musical_key ? esc(l.musical_key) : 'sin tono'} · ${l.bars} comp.
          </div>
          <div class="stl-loop-fit${warn ? ' is-warn' : ''}" ${warn ? `title="${esc(warn)}"` : ''}><span class="stl-st stl-st--${st.cls}" title="${esc(st.tip)}">${esc(st.txt)}</span> ${esc(fitTxt)}${warn ? ' ⚠' : ''}</div>
        </div>
        ${locked
          ? `<button type="button" class="stl-add stl-add--locked" data-act="add" title="Este loop es parte de LivePads Pro">${SVG_LOCK}<span>Pro</span></button>`
          : `<button type="button" class="stl-add" data-act="add" title="Agregar en el compás del cursor (o arrástralo a un compás)">${SVG_PLUS}<span>Agregar</span></button>`}
        <button type="button" class="stl-more" data-act="loop-more" title="Más opciones" aria-label="Más opciones">${SVG_MORE}</button>
      </div>`;
    }).join('');
    paintPlaying();
    paintDownload();
  }

  function paintPlaying() {
    el.querySelectorAll('.stl-loop').forEach((row) => {
      const on = row.dataset.loop === preview.id;
      row.classList.toggle('is-playing', on);
      row.classList.toggle('is-streaming', on && !!preview.el);
      const b = row.querySelector('.stl-play');
      if (b) b.innerHTML = on ? SVG_STOP : SVG_PLAY;
    });
  }

  function setBusy(id, busy) {
    const row = el.querySelector(`.stl-loop[data-loop="${CSS.escape(id)}"]`);
    if (!row) return;
    row.classList.toggle('is-busy', busy);
    let tag = row.querySelector('.stl-loading');
    if (busy && !tag) {
      tag = document.createElement('span');
      tag.className = 'stl-loading';
      tag.textContent = 'Cargando en la línea de tiempo…';
      (row.querySelector('.stl-loop-info, .stl-loop-main') || row).appendChild(tag);
    } else if (!busy && tag) tag.remove();
  }
  function flashAdded(id) {
    const row = el.querySelector(`.stl-loop[data-loop="${CSS.escape(id)}"]`);
    if (!row) return;
    row.classList.add('is-added');
    setTimeout(() => row.classList.remove('is-added'), 1800);
  }

  function renderLoggedOut() {
    ref('packs').innerHTML = '';
    ref('list').innerHTML = '<div class="stl-empty">Inicia sesión en tu cuenta de LivePads para usar la biblioteca de stems.</div>';
  }

  // ── Reportar (solo loops de la comunidad) ───────────────────────────────
  const communityPack = (loop) => state.packs.find((p) => p.id === loop.pack_id)?.status === 'approved';

  function openReport(loop) {
    document.getElementById('stl-report-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'stl-report-overlay';
    ov.className = 'stb-overlay';
    ov.innerHTML = `
      <div class="stb-modal stl-report-modal" role="dialog" aria-modal="true" aria-label="Reportar loop">
        <header class="stb-head"><h3>Reportar "${esc(loop.title)}"</h3><button type="button" class="stl-x ui-close" data-act="close" aria-label="Cerrar">×</button></header>
        <p class="stb-hint">El equipo de LivePads lo revisará. Si no cumple, se retira de la Biblioteca.</p>
        <div class="stl-report-reasons">
          ${Object.entries(stemLibrary.REPORT_REASONS).map(([v, l], i) => `<label><input type="radio" name="stl-reason" value="${v}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}
        </div>
        <textarea data-ref="note" maxlength="500" rows="3" placeholder="Cuéntanos más (opcional): de qué canción es, qué suena mal…"></textarea>
        <footer class="stb-foot"><span class="stb-total"></span>
          <button type="button" class="stb-btn" data-act="close">Cancelar</button>
          <button type="button" class="stb-btn stb-btn--primary" data-act="send">Enviar reporte</button>
        </footer>
      </div>`;
    document.body.appendChild(ov);
    const close = () => { window.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', async (e) => {
      if (e.target === ov) { close(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'send') {
        const btn = e.target.closest('[data-act]');
        btn.disabled = true;
        try {
          const r = await stemLibrary.reportLoop(loop.id, ov.querySelector('input[name="stl-reason"]:checked').value, ov.querySelector('[data-ref="note"]').value);
          showToast(r === 'already' ? 'Ya habías reportado este loop. Gracias.' : 'Reporte enviado. Gracias por avisar.', 'success');
          close();
        } catch (err) {
          btn.disabled = false;
          showToast(`No se pudo enviar el reporte: ${err.message}`, 'error');
        }
      }
    });
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
      // Una pista de canción completa (multitrack) entra una sola vez, no 4.
      await api.addLoop(loop, { atSec, repeats: loop.bars > 16 ? 1 : getRepeats(), sameTrack: getSameTrack() });
      markRecent(loop.id);
      markRecentPack(loop.pack_id);
      state.localAll.add(loop.id);
      renderTry();
      state.local.add(loop.id);
      setBusy(loop.id, false);
      flashAdded(loop.id);
    } catch (e) {
      showToast(`No se pudo agregar «${loop.title}»: ${e.message || e}`, 'error');
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

  // Cuántos loops puede usar esta cuenta (-1 = sin sesión). Lo consulta el
  // inicio rápido antes de tocar el proyecto.
  async function usableLoopCount() {
    if (!isLoggedIn()) return -1;
    try {
      const all = await stemLibrary.listLoops({});
      return (api.canUsePro() ? all : all.filter((l) => l.tier === 'free')).length;
    } catch (_) { return 0; }
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
    const actEl = e.target.closest('[data-act]');
    const act0 = actEl && actEl.dataset.act;
    if (act0 === 'pack-preview') { playPackPreview(state.packId); return; }
    if (act0 === 'pack-more') { openPackMenu(actEl); return; }
    if (act0 === 'try') { tryPack(); return; }
    if (act0 === 'retry') { state.loaded = false; open(); return; }
    if (act0 === 'only-local') { setView('local'); return; }
    if (act0 === 'view-all') { setView('all'); return; }
    if (act0 === 'packs') { openPacksWindow(); return; }
    if (act0 === 'clear-filter') { clearFilter(actEl.dataset.filter); return; }
    const pick = e.target.closest('[data-pick-pack]');
    if (pick) {
      state.packId = pick.dataset.pickPack;
      ref('text').value = '';
      renderPacks();
      loadLoops();
      return;
    }
    const chip = e.target.closest('[data-pack]');
    if (chip) {
      state.packId = chip.dataset.pack;
      renderPacks();
      loadLoops();
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) { setView(view.dataset.view); return; }
    const row = e.target.closest('.stl-loop');
    const loop = row && loopsById.get(row.dataset.loop);
    if (!loop) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') playPreview(loop);
    else if (act === 'add') add(loop);
    else if (act === 'tier' && state.admin) toggleTier(loop);
    else if (act === 'fav') toggleFav(loop.id);
    else if (act === 'report') openReport(loop);
    else if (act === 'loop-more') openLoopMenu(e.target.closest('[data-act]'), loop);
  });

  function setView(v) {
    state.view = v;
    el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.view === v));
    renderLoops();
  }
  function clearFilter(f) {
    if (f === 'pack') { state.packId = ''; renderPacks(); }
    else if (f === 'all') { state.packId = ''; ['text', 'instrument', 'section', 'feel'].forEach((k) => { ref(k).value = ''; }); renderPacks(); }
    else if (ref(f)) ref(f).value = '';
    loadLoops();
  }
  // Vacío por filtros: qué filtro quitar, con un botón para cada uno.
  function emptyFiltersHtml() {
    const opts = [];
    const pack = state.packs.find((p) => p.id === state.packId);
    if (ref('text').value) opts.push(['text', `Quitar la búsqueda «${esc(ref('text').value)}»`]);
    if (ref('instrument').value) opts.push(['instrument', `Todos los instrumentos (no solo ${esc(INSTRUMENTS[ref('instrument').value] || ref('instrument').value)})`]);
    if (ref('section').value) opts.push(['section', 'Cualquier sección']);
    if (ref('feel').value) opts.push(['feel', 'Cualquier sensación']);
    return `<div class="stl-empty"><b>No hay loops con esos filtros.</b>${opts.length ? '<br>Prueba:' : ''}
      <div class="stl-empty-actions">${opts.map(([f, t]) => `<button type="button" class="stb-btn" data-act="clear-filter" data-filter="${f}">${t}</button>`).join('')}
      ${opts.length > 1 ? '<button type="button" class="stb-btn stb-btn--primary" data-act="clear-filter" data-filter="all">Quitar todos los filtros</button>' : ''}</div></div>`;
  }
  function openLoopMenu(anchor, loop) {
    const items = [
      { label: favs.has(loop.id) ? '★ Quitar de favoritos' : '☆ Añadir a favoritos', onSelect: () => toggleFav(loop.id) },
      { label: 'Agregar al inicio del proyecto', onSelect: () => add(loop, 0) },
    ];
    if (communityPack(loop)) items.push({ label: '⚑ Reportar este loop…', onSelect: () => openReport(loop) });
    if (state.admin) items.push({ label: `Administrador: marcar como ${loop.tier === 'free' ? 'PRO' : 'GRATIS'}`, onSelect: () => toggleTier(loop) });
    openCardMoreMenu(anchor, items);
  }
  function openPackMenu(anchor) {
    const pid = state.packId; if (!pid) return;
    const st = packStatus(pid);
    const items = [
      { label: 'Probar este pack en el proyecto', onSelect: () => tryPack(pid) },
      { label: favPacks.has(pid) ? '♥ Quitar de mis packs favoritos' : '♡ Añadir a mis packs favoritos', onSelect: () => toggleFavPack(pid) },
    ];
    if (st.cls !== 'pro' && st.cls !== 'local' && !stemLibrary.isUsingOfflineCopy()) items.push({ label: 'Descargar para usar sin conexión', onSelect: () => downloadPack() });
    items.push({ label: 'Armar una canción con este pack…', onSelect: () => openBuilder() });
    openCardMoreMenu(anchor, items);
  }

  el.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stl-loop');
    if (!row || row.classList.contains('is-locked')) return;
    e.dataTransfer.setData(LOOP_DRAG_TYPE, row.dataset.loop);
    e.dataTransfer.effectAllowed = 'copy';
  });

  let searchTimer = null;
  ref('text').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (ref('text').value.trim()) renderPackResults(); else loadLoops(); }, 180);
  });
  ref('instrument').addEventListener('change', loadLoops);
  ref('section').addEventListener('change', loadLoops);
  ref('feel').addEventListener('change', loadLoops);
  // Cambios hechos desde otra ventana (avisos de la comunidad → Moderación).
  window.addEventListener('livepads:stem-library-changed', () => { if (state.loaded) reloadCatalog(); });

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
    renderTry();
  }
  function close() { setCollapsed(true); stopPreview(); }
  // Abre la Biblioteca directamente en un pack (desde la lista de canciones).
  async function openPack(packId) {
    await open();
    if (!state.packs.some((p) => p.id === packId)) return;
    state.packId = packId;
    renderPacks();
    loadLoops();
  }
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
    open, openPack, close, toggle, stopPreview, getRepeats, getSameTrack, markRecent, openBuilder, usableLoopCount,
    isOpen: () => !isCollapsed(),
    getLoop: (id) => loopsById.get(id) || null,
    // El proyecto cambió de BPM/tono: repinta los ajustes si está abierto.
    refresh: () => { if (!isCollapsed()) { renderProject(); if (state.loops.length) renderLoops(); } },
  };
}

export const instrumentLabel = (k) => INSTRUMENTS[k] || k;
