// Service-list view — renders #service-songs-container, handles all
// click/edit/drag delegation, and exposes surgical helpers. State (the
// current service songs array, active index, open-accordion id) lives
// in app.js (and partially in data/service.js); we read it via the deps
// getters passed to initServiceList().

import { q, esc } from '../utils/dom.js';
import { linkedKeyChange } from '../utils/keyLink.js';
import { listSavedSetlists, loadSavedSetlist, deleteSavedSetlist, getServiceSongs, getCurrentSetlistName, getCurrentSetlistId, createNewSetlist, updateSetlistMeta, duplicateSetlist, setServiceSongs, getEffectiveKey, getKeyOverride, setKeyOverride, clearKeyOverride } from '../data/service.js';
import { songCardInnerHTML, songCoverHtml } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { openVoicesMenu } from './voiceRefs.js';
import { keyChoices, isKnownKey } from '../utils/musicKeys.js';
import { confirmDialog, showDialog } from './dialog.js';
import { parseSingerKeys, upsertSingerKey, cleanSingerKeys, shiftLabel, keyForSinger, singersIn } from '../utils/singerKeys.js';
import { showLoadAudioMenu } from './audioLoadMenu.js';
import { audioMenuItems } from './songMenu.js';
import { openLyricsFullscreen } from './lyricsFullscreen.js';
import { getOpenAccordionServiceId, getSongs as getLibrarySongs } from '../state/store.js';
import { getLibraryScope } from './giList.js';
import { bindTouchReorder } from '../utils/touchReorder.js';

let deps = null;
let svcSearchTerm = '';

// Al abrir la app, si hay setlists guardados, la pestaña Servicio muestra
// primero el selector de listas (chooser) en vez de las canciones. Flag de
// "pendiente de elegir esta sesión" — se consume la primera vez que se abre
// la pestaña Servicio.
let chooserPending = false;

export function initServiceList(_deps) {
  deps = _deps;
  initDelegation();
  initChooserDelegation();
  // El nombre del servicio en el header funciona como selector: clic → chooser
  // (elegir/crear lista). El elemento persiste (updateServiceMeta solo cambia su
  // texto), así que un solo listener alcanza.
  const label = q('.service-actions-label');
  if (label) label.addEventListener('click', () => showServiceChooser());
  // Cabecera del servicio abierto: «+ Canciones» y menú «⋯».
  const addBtn = q('#btn-svc-add');
  if (addBtn) addBtn.addEventListener('click', () => showServiceCreate({ edit: true }));
  const moreBtn = q('#btn-svc-more');
  if (moreBtn) moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openServiceMenu(moreBtn); });
  initLeaderChip();
  chooserPending = listSavedSetlists().length > 0;
  // Listener de búsqueda dentro del Servicio (input #svc-search en setlistTabs).
  window.addEventListener('livepads:service-search', (ev) => {
    svcSearchTerm = (ev?.detail?.q || '').trim().toLowerCase();
    renderServiceList();
  });
}

// ── Selector de setlist (chooser) ─────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const CHOOSER_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function fmtChooserDate(s) {
  let d = null;
  if (s.date) {
    const [y, m, dd] = String(s.date).split('-').map(Number);
    if (y && m && dd) d = new Date(y, m - 1, dd);
  }
  if (!d && s.savedAt) d = new Date(s.savedAt);
  if (!d) return '';
  return `${CHOOSER_DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function chooserDay(s) {
  let d = null;
  if (s.date) { const [y, m, dd] = String(s.date).split('-').map(Number); if (y && m && dd) d = new Date(y, m - 1, dd); }
  if (!d && s.savedAt) d = new Date(s.savedAt);
  if (!d) return { dow: '', day: '–', mon: '' };
  return { dow: CHOOSER_DAYS[d.getDay()], day: String(d.getDate()), mon: MONTHS[d.getMonth()] };
}

// Se llama cuando se abre la pestaña Servicio: muestra el chooser una sola vez
// por sesión si hay setlists guardados.
export function maybeShowChooserOnServiceOpen() {
  if (!chooserPending) return;
  chooserPending = false;
  if (listSavedSetlists().length) showServiceChooser();
}

let chooserSearch = '';   // filtro del buscador del chooser
let chooserEditId = null; // setlist en edición inline (renombrar)

export function showServiceChooser() {
  const panel = q('#service-setlist-list');
  const chooser = q('#service-chooser');
  if (!panel || !chooser) return;
  const all = listSavedSetlists();
  const curN = getServiceSongs().length;
  const showSearch = all.length > 6;
  const t = chooserSearch.trim().toLowerCase();
  const list = t ? all.filter(s => (s.name || '').toLowerCase().includes(t)) : all;

  const curId = getCurrentSetlistId();
  const itemHtml = (s) => {
    if (s.id === chooserEditId) {
      // Edición inline: renombrar + fecha.
      return `<div class="svc-chooser-item is-editing" data-id="${esc(s.id)}">
        <div class="svc-chooser-edit">
          <input type="text" class="svc-edit-name" value="${esc(s.name)}" placeholder="Nombre">
          <input type="date" class="svc-edit-date" value="${esc(s.date || '')}">
          <div class="svc-edit-actions">
            <button class="svc-edit-btn" data-act="edit-cancel">Cancelar</button>
            <button class="svc-edit-btn svc-edit-btn--ok" data-act="edit-save" data-id="${esc(s.id)}">Guardar</button>
          </div>
        </div>
      </div>`;
    }
    const d = chooserDay(s);
    const n = (s.songs || []).length;
    const inUse = s.id === curId;
    return `<div class="svc-chooser-item${inUse ? ' is-current' : ''}" data-act="load" data-id="${esc(s.id)}" title="${inUse ? 'Servicio abierto: clic para volver a él' : 'Abrir este servicio'}">
      <span class="svc-day" aria-hidden="true"><small>${d.dow}</small><b>${d.day}</b><small>${d.mon}</small></span>
      <span class="svc-chooser-info">
        <span class="svc-chooser-name">${esc(s.name)}</span>
        <span class="svc-chooser-meta">${n} ${n === 1 ? 'canción' : 'canciones'}${inUse ? ' · <b class="svc-inuse">Abierto</b>' : ''}</span>
      </span>
      <button class="svc-chooser-more" data-act="menu" data-id="${esc(s.id)}" title="Opciones" aria-label="Opciones"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
    </div>`;
  };

  // Lista de trabajo con canciones que no está guardada como servicio (versiones
  // anteriores): se ofrece abrirla o guardarla, en vez del antiguo «Usar la lista actual».
  const unsaved = !curId && curN > 0;
  chooser.innerHTML = `
    <div class="svc-chooser-head">
      <h4>Servicios</h4>
      <span class="svc-chooser-count">${all.length || ''}</span>
    </div>
    <button class="svc-chooser-new" data-act="new"><svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nuevo servicio</button>
    ${showSearch ? `<input type="text" class="svc-chooser-search" placeholder="Buscar servicio…" value="${esc(chooserSearch)}">` : ''}
    ${unsaved ? `<div class="svc-chooser-item svc-unsaved" data-act="current" title="Abrir la lista sin guardar">
      <span class="svc-day svc-day--draft" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="16" y2="17"/><circle cx="4.5" cy="7" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17" r="1"/></svg></span>
      <span class="svc-chooser-info"><span class="svc-chooser-name">Lista sin guardar</span>
        <span class="svc-chooser-meta">${curN} ${curN === 1 ? 'canción' : 'canciones'}</span></span>
      <button class="svc-mini-btn" data-act="save-current">Guardar</button>
    </div>` : ''}
    <div class="svc-chooser-list">
      ${all.length
        ? (list.length ? list.map(itemHtml).join('') : '<p class="svc-chooser-empty">Sin coincidencias.</p>')
        : '<p class="svc-chooser-empty">Aún no hay servicios. Crea el primero con «Nuevo servicio».</p>'}
    </div>`;
  panel.classList.add('choosing');

  const searchEl = chooser.querySelector('.svc-chooser-search');
  if (searchEl) searchEl.oninput = () => { chooserSearch = searchEl.value; showServiceChooser(); searchEl2Focus(); };
  // Si estamos editando, foco al nombre.
  if (chooserEditId) setTimeout(() => chooser.querySelector('.svc-edit-name')?.focus(), 40);
}
// Mantener el foco/caret en el buscador tras re-render (oninput → re-render).
function searchEl2Focus() {
  const s = q('#service-chooser .svc-chooser-search');
  if (s) { s.focus(); const v = s.value; s.setSelectionRange(v.length, v.length); }
}

export function hideServiceChooser() {
  q('#service-setlist-list')?.classList.remove('choosing');
}

// Vista INLINE (dentro del panel de Servicio, no modal centrado) para crear un
// setlist: título + fecha + descripción + selector de canciones de la librería.
export function hideServiceCreate() {
  q('#service-setlist-list')?.classList.remove('creating');
}
export function showServiceCreate(opts = {}) {
  const panel = q('#service-setlist-list');
  const el = q('#service-create');
  if (!panel || !el) return;
  const lib = getLibrarySongs() || [];
  // prefillCurrent: pre-tilda las canciones de la lista actual (para GUARDAR la
  // "lista de hoy" como setlist sin volver a elegirlas).
  const editMode = !!opts.edit;   // «+ Canciones»: cambiar las canciones del servicio abierto
  const selected = new Set((opts.prefillCurrent || editMode) ? getServiceSongs().map(s => String(s.id)) : []);
  const curName = getCurrentSetlistName() || '';
  const headTitle = editMode ? (curName ? `Canciones · ${curName}` : 'Canciones del servicio')
    : opts.prefillCurrent ? 'Guardar como servicio' : 'Nuevo servicio';
  const initialName = opts.prefillCurrent ? curName : '';

  // Opciones de librería: espejamos el selector de la pestaña Librería
  // (#gi-lib-select), sin la acción "+ Crear". Arrancamos en la librería ACTIVA.
  const libSel = q('#gi-lib-select');
  const libOptions = libSel
    ? [...libSel.options].filter(o => o.value !== '__create').map(o => ({ value: o.value, label: o.textContent }))
    : [];
  let curScope = getLibraryScope() || 'all';
  if (!libOptions.some(o => o.value === curScope)) curScope = libOptions[0]?.value || 'all';
  const showLibPicker = libOptions.length > 1; // solo si hay varias librerías
  const inScope = (s) => curScope === 'all' ? true : curScope === 'local' ? !s.libraryId : s.libraryId === curScope;

  el.innerHTML = `
    <div class="svc-create-head">
      <button class="svc-create-back" data-act="back" aria-label="Volver">‹</button>
      <h4>${headTitle}</h4>
    </div>
    ${editMode ? '' : `<div class="svc-create-row2">
      <label class="svc-create-field"><span>Nombre</span>
        <input type="text" class="nsl-title" placeholder="Ej. Domingo de Alabanza" value="${esc(initialName)}"></label>
      <label class="svc-create-field svc-create-date"><span>Fecha</span>
        <input type="date" class="nsl-date" value="${todayISO()}"></label>
    </div>`}
    ${showLibPicker ? `<label class="svc-create-field"><span>Repertorio</span>
      <select class="svc-create-lib">
        ${libOptions.map(o => `<option value="${esc(o.value)}"${o.value === curScope ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select></label>` : ''}
    <div class="svc-create-songs-head">
      <span>Añadir canciones <span class="nsl-count"></span></span>
    </div>
    <input type="text" class="nsl-search" placeholder="Buscar repertorio…">
    <div class="nsl-songs-list svc-create-list"></div>
    <div class="svc-create-foot">
      <button class="nsl-btn" data-act="back">Cancelar</button>
      <button class="nsl-btn nsl-btn--primary" data-act="create">${editMode ? 'Listo' : opts.prefillCurrent ? 'Guardar servicio' : 'Crear servicio'}</button>
    </div>`;

  const listEl = el.querySelector('.nsl-songs-list');
  const countEl = el.querySelector('.nsl-count');
  const updateCount = () => { countEl.textContent = selected.size ? `(${selected.size})` : ''; };
  const renderSongs = (term = '') => {
    const t = term.trim().toLowerCase();
    listEl.innerHTML = lib
      .filter(inScope)
      .filter(s => !t || `${s.title || ''} ${s.artist || ''}`.toLowerCase().includes(t))
      .map(s => {
        const id = String(s.id);
        const music = [s.key || '', s.bpm ? `${s.bpm} BPM` : ''].filter(Boolean).join(' · ');
        const on = selected.has(id);
        return `<label class="svc-pick${on ? ' is-on' : ''}" data-id="${esc(id)}">
          <input type="checkbox" ${on ? 'checked' : ''}>
          ${songCoverHtml(s)}
          <span class="svc-pick-info"><span class="svc-pick-title">${esc(s.title || '(sin título)')}</span><span class="svc-pick-artist">${esc(s.artist || '')}</span></span>
          <span class="svc-pick-meta">${esc(music)}</span>
        </label>`;
      }).join('') || '<p class="nsl-empty">No hay canciones en la librería.</p>';
  };
  renderSongs();
  updateCount();

  const searchEl = el.querySelector('.nsl-search');
  searchEl.oninput = (e) => renderSongs(e.target.value);
  const libSelEl = el.querySelector('.svc-create-lib');
  if (libSelEl) libSelEl.onchange = () => { curScope = libSelEl.value; renderSongs(searchEl.value); };
  listEl.onchange = (e) => {
    const row = e.target.closest('.svc-pick');
    if (!row) return;
    if (e.target.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id);
    row.classList.toggle('is-on', e.target.checked);
    updateCount();
  };
  el.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') { hideServiceCreate(); if (!editMode) showServiceChooser(); return; }
    if (act === 'create' && editMode) {
      const byId = new Map(lib.map(s => [String(s.id), s]));
      // Las que ya estaban (aunque no sean del repertorio filtrado) se conservan si siguen tildadas.
      for (const s of getServiceSongs()) if (!byId.has(String(s.id))) byId.set(String(s.id), s);
      setServiceSongs([...selected].map(id => byId.get(id)).filter(Boolean));
      hideServiceCreate();
      renderServiceList({ keepScroll: true });
      window.showToast?.(`${selected.size} ${selected.size === 1 ? 'canción' : 'canciones'} en el servicio.`, 'success');
      return;
    }
    if (act === 'create') {
      const title = el.querySelector('.nsl-title')?.value.trim() || 'Servicio';
      const date = el.querySelector('.nsl-date')?.value || '';
      // En el ORDEN en que se tildaron (Set conserva el orden de inserción), no
      // en el orden de la librería.
      const byId = new Map(lib.map(s => [String(s.id), s]));
      const songs = [...selected].map(id => byId.get(id)).filter(Boolean);
      const entry = createNewSetlist(title, date, songs);
      if (entry) {
        const n = songs.length;
        window.showToast?.(n
          ? `✓ «${entry.name}» creado con ${n} ${n === 1 ? 'canción' : 'canciones'}.`
          : `✓ «${entry.name}» creado. Añade canciones con «+ Canciones».`, 'success');
        hideServiceCreate();
        renderServiceList({ keepScroll: false });
      }
    }
  };

  panel.classList.remove('choosing');
  panel.classList.add('creating');
  setTimeout(() => el.querySelector('.nsl-title')?.focus(), 60);
}

function initChooserDelegation() {
  const chooser = q('#service-chooser');
  if (!chooser) return;
  chooser.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'current') { hideServiceChooser(); renderServiceList({ keepScroll: false }); return; }
    if (act === 'save-current') { e.stopPropagation(); showServiceCreate({ prefillCurrent: true }); return; }
    if (act === 'new') { showServiceCreate(); return; }   // vista inline de creación
    if (act === 'menu') {
      e.stopPropagation();
      openSetlistItemMenu(actEl, actEl.dataset.id);
      return;
    }
    if (act === 'edit-cancel') { e.stopPropagation(); chooserEditId = null; showServiceChooser(); return; }
    if (act === 'edit-save') {
      e.stopPropagation();
      const wrap = actEl.closest('.svc-chooser-item');
      const name = wrap?.querySelector('.svc-edit-name')?.value || '';
      const date = wrap?.querySelector('.svc-edit-date')?.value || '';
      updateSetlistMeta(actEl.dataset.id, name, date);
      chooserEditId = null;
      showServiceChooser();
      window.showToast?.('✓ Setlist actualizado.', 'success');
      // Si era el activo, refrescar el header del servicio.
      refreshServiceMeta();
      return;
    }
    if (act === 'load') {
      const id = actEl.dataset.id;
      // El que ya está abierto: solo se vuelve a él (recargarlo perdería la canción activa).
      if (id === getCurrentSetlistId()) { hideServiceChooser(); renderServiceList({ keepScroll: true }); return; }
      if (loadSavedSetlist(id)) {           // replaceService → re-render del servicio
        window.showToast?.('✓ Setlist cargado.', 'success');
        hideServiceChooser();
        renderServiceList({ keepScroll: false });
      }
    }
  });
}

// Menú «⋯» del servicio abierto: opciones con texto (antes eran iconos sueltos).
function openServiceMenu(anchor) {
  const id = getCurrentSetlistId();
  const n = getServiceSongs().length;
  const click = (sel) => q(sel)?.click();
  const items = [];
  if (id) items.push({ label: 'Renombrar o cambiar la fecha', onSelect: () => { chooserEditId = id; showServiceChooser(); } });
  else if (n) items.push({ label: 'Guardar como servicio', onSelect: () => click('#btn-service-save') });
  items.push({ label: 'Compartir con el equipo (nube)', onSelect: () => click('#btn-service-share') });
  if (n) {
    const meta = () => { const s = id && listSavedSetlists().find((x) => x.id === id); return { name: (s && s.name) || getCurrentSetlistName() || 'Servicio', date: s ? fmtChooserDate(s) : '' }; };
    items.push({ label: 'Imprimir o PDF: setlist con hojas de acordes', onSelect: () => import('./printSheet.js').then((m) => m.printService(getServiceSongs(), { ...meta(), withSheets: true })) });
    items.push({ label: 'Imprimir o PDF: solo la lista', onSelect: () => import('./printSheet.js').then((m) => m.printService(getServiceSongs(), { ...meta(), withSheets: false })) });
    items.push({ label: 'Enviar por WhatsApp', onSelect: () => import('./shareService.js').then((m) => m.sendServiceToWhatsApp(getServiceSongs().map((x) => ({ title: x.title, artist: x.artist, key: getEffectiveKey(x) || x.key, bpm: x.bpm, youtubeUrl: x.youtubeUrl })), meta())) });
    items.push({ label: 'Guardar paquete para otro portátil (USB, sin internet)…', hint: 'Canciones, tonos del día y audios en un solo archivo', onSelect: () => import('./servicePack.js').then((m) => m.exportServicePack(meta())) });
    items.push({ label: 'Calentamiento vocal…', onSelect: () => { const first = getServiceSongs()[0]; import('../live/warmup.js').then((m) => m.openWarmup(first ? (getEffectiveKey(first) || first.key || '') : '')); } });
    items.push({ label: 'Copiar el mensaje del servicio', onSelect: () => import('./shareService.js').then((m) => m.copyServiceMessage(getServiceSongs().map((x) => ({ title: x.title, artist: x.artist, key: getEffectiveKey(x) || x.key, bpm: x.bpm, youtubeUrl: x.youtubeUrl })), meta())) });
  }
  if (id) items.push({ label: 'Duplicar', onSelect: () => {
    const c = duplicateSetlist(id);
    if (c) window.showToast?.(`✓ Duplicado como «${c.name}».`, 'success');
  } });
  items.push({ label: 'Abrir paquete de servicio (.lpservicio)…', hint: 'El que se guardó en otro portátil', onSelect: () => import('./servicePack.js').then((m) => m.importServicePack()) });
  if (n) items.push({ label: 'Quitar todas las canciones', onSelect: () => click('#btn-clear-service') });
  if (id) items.push({ label: 'Eliminar servicio', danger: true, onSelect: () => {
    const s = listSavedSetlists().find((x) => x.id === id);
    confirmDialog({
      title: 'Eliminar servicio',
      message: `¿Eliminar «${(s && s.name) || 'este servicio'}»? Las canciones siguen en tu librería.`,
      confirmLabel: 'Eliminar', danger: true,
      onConfirm: () => {
        const cloudId = deleteSavedSetlist(id);
        if (cloudId) import('../cloud/setlistSync.js').then(m => m.deleteSharedSetlist(cloudId, s && s.name)).catch(() => {});
        showServiceChooser();
      },
    });
  } });
  openCardMoreMenu(anchor, items);
}

// Menú ⋯ por setlist (estilo card unificado): cargar / renombrar / duplicar / eliminar.
function openSetlistItemMenu(anchor, id) {
  const s = listSavedSetlists().find(x => x.id === id);
  if (!s) return;
  openCardMoreMenu(anchor, [
    { label: 'Cargar', onSelect: () => {
        if (loadSavedSetlist(id)) { window.showToast?.('✓ Setlist cargado.', 'success'); hideServiceChooser(); renderServiceList({ keepScroll: false }); }
      } },
    { label: 'Renombrar / fecha', onSelect: () => { chooserEditId = id; showServiceChooser(); } },
    { label: 'Duplicar', onSelect: () => {
        const c = duplicateSetlist(id);
        if (c) { window.showToast?.(`✓ Duplicado como "${c.name}".`, 'success'); showServiceChooser(); }
      } },
    { label: 'Eliminar', danger: true, onSelect: () => {
        confirmDialog({
          title: 'Eliminar setlist',
          message: `¿Eliminar "${s.name}"? Esto no borra las canciones de tu librería.`,
          confirmLabel: 'Eliminar', danger: true,
          onConfirm: () => {
            const cloudId = deleteSavedSetlist(id);
            // Propagar el borrado al equipo. Sin esto, el setlist reaparecía en
            // la siguiente bajada (seguía vivo en la nube) o se quedaba
            // huérfano en las vistas web.
            if (cloudId) {
              import('../cloud/setlistSync.js')
                .then(m => m.deleteSharedSetlist(cloudId, s.name))
                .catch(() => {});
            }
            showServiceChooser();
          },
        });
      } },
  ]);
}

// keepScroll: re-renders triggered by sync/reorder/duration updates must not
// yank the leader back to the top mid-service. Loading a different setlist
// passes false so the new list starts at the top.
export function renderServiceList({ keepScroll = true } = {}) {
  const container = q('#service-songs-container');
  const emptyMsg = q('#service-empty-msg');
  if (!container) return;

  const prevScrollTop = keepScroll ? container.scrollTop : 0;
  container.innerHTML = '';

  const allSongs = deps.getSongs();
  const activeIdx = deps.getActiveIndex();
  updateServiceMeta(allSongs);

  if (allSongs.length === 0) {
    if (emptyMsg) {
      emptyMsg.classList.remove('hidden');
      // El CTA cambia según si hay setlists guardados para elegir: si NO hay,
      // invita a CREAR uno (en vez de mandar a la Librería). El onclick (en
      // setlistTabs.js) hace la misma bifurcación.
      const btn = q('#btn-service-go-library');
      if (btn) {
        const noLists = listSavedSetlists().length === 0;
        btn.innerHTML = noLists
          ? '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Crear setlist'
          : '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg> Ir a la Librería';
      }
    }
    return;
  }

  if (emptyMsg) emptyMsg.classList.add('hidden');

  // Filtro de búsqueda — conserva el índice original para que la navegación
  // (prev/next y el highlight de activa) siga apuntando bien.
  const t = svcSearchTerm;
  const visible = t
    ? allSongs.map((s, i) => ({ s, i }))
              .filter(({ s }) => (s.title || '').toLowerCase().includes(t) || (s.artist || '').toLowerCase().includes(t))
    : allSongs.map((s, i) => ({ s, i }));

  if (visible.length === 0) {
    container.innerHTML = '<div class="setlist-empty">Sin coincidencias en el servicio.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach(({ s, i }) => fragment.appendChild(buildCard(s, i, activeIdx)));
  container.appendChild(fragment);
  container.scrollTop = prevScrollTop;
}

// Update the "X canciones · ~Y min" subtitle next to "Tu lista de hoy".
// When a song is currently active in the service, also prepend the
// position cue ("3 / 8 ·") so the leader sees at a glance how far into
// the set they are. 4 min/song is a worship-service heuristic; swap for
// a real sum once duration becomes a per-song stored field.
export function refreshServiceMeta() {
  if (deps) updateServiceMeta(deps.getSongs());
}

function updateServiceMeta(songs) {
  // El título del servicio = nombre del setlist cargado (ej. "Servicio Domingo")
  // o "Tu lista de hoy" si es la lista de trabajo sin nombre. La cantidad de
  // canciones / duración va como tooltip para no ocupar otra línea (en laptop se
  // veía muy espacioso). La línea de meta queda vacía (se oculta con :empty).
  const labelEl = q('.service-actions-label');
  const metaEl = q('#service-meta');
  if (metaEl) metaEl.textContent = '';
  if (!labelEl) return;
  const name = getCurrentSetlistName();
  labelEl.textContent = name || 'Lista sin guardar';
  const entry = listSavedSetlists().find((x) => x.id === getCurrentSetlistId());
  const dateTxt = entry ? fmtChooserDate(entry) : '';

  const n = songs.length;
  if (n === 0) { labelEl.title = ''; if (metaEl) metaEl.textContent = dateTxt ? `${dateTxt} · sin canciones` : 'Sin canciones'; return; }
  let totalSec = 0, unknown = 0;
  for (const s of songs) {
    if (typeof s.durationSec === 'number' && s.durationSec > 0) totalSec += s.durationSec;
    else { totalSec += 240; unknown++; }
  }
  const minutes = Math.max(1, Math.round(totalSec / 60));
  const prefix = unknown > 0 ? '~' : '';
  const songLabel = n === 1 ? 'canción' : 'canciones';
  labelEl.title = `${n} ${songLabel} · ${prefix}${minutes} min`;
  if (metaEl) metaEl.textContent = [dateTxt, `${n} ${songLabel}`, `${prefix}${minutes} min`].filter(Boolean).join(' · ');
}

function buildCard(song, index, activeIdx) {
  const el = document.createElement('div');
  el.className = 'gi-song-item';
  if (song.serviceId != null) el.dataset.serviceId = String(song.serviceId);
  el.dataset.index = String(index);
  el.draggable = true;

  const isActive = index === activeIdx;
  const isLyricsOpen = song.serviceId && (song.serviceId === getOpenAccordionServiceId());
  if (isActive) el.classList.add('active-song');
  if (isLyricsOpen) el.classList.add('lyrics-open');   // (en vez de :has() en el CSS: más barato)
  el.classList.add('has-order');                        // las tarjetas del servicio llevan flechas de orden

  el.innerHTML = songCardInnerHTML(song, {
    rowNumber: index + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: false,
    includeReorder: true,
    // Solo en el Servicio el tono es editable: es el contexto donde "hoy lo
    // tocamos en otro tono" tiene sentido.
    keyEditable: true,
    serviceKey: getEffectiveKey(song),
    singerKeys: singerKeysOf(song),
    removeBtnClass: 'btn-remove',
    removeBtnTitle: 'Quitar de la lista'
  });
  return el;
}

// Repaint one service card in place using the song's current state.
export function repaintServiceCard(card, song) {
  if (!card) return;
  const idx = Array.prototype.indexOf.call(card.parentNode.children, card);
  const isActive = idx === deps.getActiveIndex();
  const isLyricsOpen = song.serviceId && (song.serviceId === getOpenAccordionServiceId());
  card.classList.toggle('active-song', !!isActive);
  card.innerHTML = songCardInnerHTML(song, {
    rowNumber: idx + 1,
    isLyricsOpen,
    showChords: !!song.showChords,
    includeAdd: false,
    includeReorder: true,
    // Solo en el Servicio el tono es editable: es el contexto donde "hoy lo
    // tocamos en otro tono" tiene sentido.
    keyEditable: true,
    serviceKey: getEffectiveKey(song),
    singerKeys: singerKeysOf(song),
    removeBtnClass: 'btn-remove',
    removeBtnTitle: 'Quitar de la lista'
  });
}

function findSong(serviceId) {
  return deps.getSongs().find(s => String(s.serviceId) === serviceId);
}

// ── Tono del servicio ──────────────────────────────────────────────────────
// El tono de la librería es el "oficial". Aquí se elige en qué tono se toca HOY
// esa canción, sin tocar el oficial: el override viaja con el setlist a la nube
// (setlists.song_keys), así que todo el equipo abre el domingo en el mismo tono.
// Y si el cambio resultó ser permanente, "Fijar como tono de la biblioteca" lo
// promueve al oficial y se propaga a todos.
const ICON_CHECK = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_UNDO  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const ICON_STAR  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

// Promueve el tono de hoy a tono OFICIAL de la canción en la librería. Cambia
// la canción viva (no la copia del setlist), quita el override —ya no hace
// falta— y deja que el auto-push lo comparta con el equipo.
function promoteKeyToLibrary(song, newKey) {
  const live = (getLibrarySongs() || []).find(s =>
    (song.cloudId && s.cloudId === song.cloudId) || String(s.id) === String(song.id));
  if (!live) { window.showToast?.('Esta canción no está en tu librería.', 'info'); return; }
  // El tono del día pasa a ser el de la canción: la letra se transporta y el audio
  // sigue sonando igual (antes, al quitar el chip, volvía al tono de la grabación).
  const ch = linkedKeyChange(live, live.key, newKey);
  live.key = newKey;
  if (ch) {
    live.lyrics = ch.lyrics;
    if (!live.audio) live.audio = {};
    live.audio.pitch = ch.pitch;
    live.audio.keyPitch = ch.keyPitch; live.audio.keyPitchSet = true;
  }
  clearKeyOverride(song);
  // A disco primero: songs-changed re-renderiza y programa el push a la nube,
  // pero no escribe canciones_app.json. Sin esto el tono nuevo se perdía al
  // cerrar la app si el push no llegaba a completarse.
  deps.persistLibrary?.();
  try { window.dispatchEvent(new Event('livepads:songs-changed')); } catch (_) {}
  try { window.dispatchEvent(new Event('livepads:cloud-dirty')); } catch (_) {}
  window.showToast?.(`✓ «${live.title}» queda en ${newKey} para todo el equipo.`, 'success');
  renderServiceList();
  // Tras sincronizar las copias del servicio (songs-changed): pista y pad al día.
  deps.onKeyChanged?.(song);
}

// La canción de la LIBRERÍA que corresponde a una del servicio (que es una copia).
function librarySongOf(song) {
  return (getLibrarySongs() || []).find(s =>
    (song.cloudId && s.cloudId === song.cloudId) || String(s.id) === String(song.id)) || null;
}
function singerKeysOf(song) {
  const live = librarySongOf(song);
  return (live ? live.singerKeys : song.singerKeys) || '';
}
// Guarda el tono de hoy en la canción, con el nombre de quien la canta, para que
// la próxima vez baste un toque («G · María»).
function saveSingerKey(song, key) {
  const live = librarySongOf(song);
  if (!live) { window.showToast?.('Esta canción no está en tu librería.', 'info'); return; }
  showDialog(`¿Quién canta «${live.title}» en ${key}?`, 'Nombre (p. ej. María)', (name) => {
    live.singerKeys = upsertSingerKey(live.singerKeys, key, name);
    song.singerKeys = live.singerKeys;
    deps.persistLibrary?.();
    try { window.dispatchEvent(new Event('livepads:songs-changed')); } catch (_) {}
    try { window.dispatchEvent(new Event('livepads:cloud-dirty')); } catch (_) {}
    const who = String(name || '').trim();
    window.showToast?.(`Guardado: «${live.title}» en ${key}${who ? ` para ${who}` : ''}.`, 'success');
    renderServiceList();
  });
}

function openKeyMenu(anchorEl, song, card) {
  const base = song.key || '';
  if (!isKnownKey(base)) {
    window.showToast?.(
      base ? `El tono "${base}" no se reconoce: editá la canción para poner uno estándar (G, Em, Bb…).`
           : 'Esta canción no tiene tono. Editala para ponerle uno.',
      'info');
    return;
  }
  const current = getEffectiveKey(song);
  const items = [];

  if (getKeyOverride(song)) {
    items.push({
      label: `Volver al original (${base})`,
      icon: ICON_UNDO,
      onSelect: () => { clearKeyOverride(song); repaintServiceCard(card, song); deps.onKeyChanged?.(song); },
    });
    items.push({
      label: `Guardar ${current} para un cantante…`,
      icon: ICON_STAR,
      onSelect: () => saveSingerKey(song, current),
    });
    items.push({
      label: `Fijar ${current} como tono de la biblioteca`,
      icon: ICON_STAR,
      onSelect: () => promoteKeyToLibrary(song, current),
    });
  }

  // Tonos ya guardados para un cantante: un toque y queda en ese tono hoy.
  parseSingerKeys(singerKeysOf(song)).filter((x) => x.key !== base).forEach((x) => {
    items.push({
      label: `${x.key} · ${x.note || 'otro tono'} (${shiftLabel(base, x.key)})`,
      icon: x.key === current ? ICON_CHECK : '',
      onSelect: () => {
        setKeyOverride(song, x.key);
        learnLeaderKey(song, x.key);
        repaintServiceCard(card, song);
        deps.onKeyChanged?.(song);
      },
    });
  });

  keyChoices(base).forEach(({ key, label }) => {
    items.push({
      label,
      icon: key === current ? ICON_CHECK : '',
      onSelect: () => {
        setKeyOverride(song, key);
        learnLeaderKey(song, key);
        repaintServiceCard(card, song);
        deps.onKeyChanged?.(song);
      },
    });
  });

  openCardMoreMenu(anchorEl, items);
}

// Callback tras cargar audio (archivo o YouTube) a una canción del Servicio:
// sincroniza el audio a la librería, persiste el servicio y repinta la tarjeta.
function onServiceAudioAssigned(card) {
  return (song) => {
    deps.syncAudioToLibrary?.(song);
    deps.persistServiceSongs();
    repaintServiceCard(card, song);
  };
}

// Menú completo de una card de Servicio: opciones de AUDIO/carátula (módulo
// compartido, iguales a Librería/Stems) + favorito, editar, quitar. Lo abren el
// botón ⋮ y el clic derecho.
function openServiceCardMenu(anchorEl, song, card) {
  const ICON_EDIT_SM   = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_STAR_OUT  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const ICON_STAR_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const ICON_REMOVE_SM = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  openCardMoreMenu(anchorEl, [
    ...audioMenuItems(song, onServiceAudioAssigned(card)),
    {
      label: song.favorite ? 'Quitar de favoritos' : 'Marcar favorito',
      icon: song.favorite ? ICON_STAR_FILL : ICON_STAR_OUT,
      onSelect: () => {
        song.favorite = !song.favorite;
        deps.syncFavoriteToLibrary(song);
        deps.persistServiceSongs();
        repaintServiceCard(card, song);
      }
    },
    {
      label: 'Imprimir o guardar en PDF',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
      onSelect: () => import('./printSheet.js').then((m) => m.printSong(song)),
    },
    {
      label: 'Notas para improvisar',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v8M12 5v8M17 5v8"/></svg>',
      onSelect: () => Promise.all([import('./scaleHelper.js'), import('../data/service.js')]).then(([m, sv]) => m.showScaleHelper(card.querySelector('[data-action="more"]') || card, sv.getEffectiveKey(song) || song.key, song.title || '')),
    },
    {
      label: 'Click por sección…',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.4 3.2A1.6 1.6 0 0 1 12 2a1.6 1.6 0 0 1 1.6 1.2l4.5 16.4A1.9 1.9 0 0 1 16.3 22H7.7a1.9 1.9 0 0 1-1.8-2.4z"/><path d="M12 17 18 5.5"/></svg>',
      onSelect: () => import('../live/clickSections.js').then((m) => m.openClickSectionsDialog(song)),
    },
    {
      label: 'Sonido del teclado (MIDI)…',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 6v7M10 6v7M14 6v7M18 6v7"/><circle cx="12" cy="3" r="1"/></svg>',
      onSelect: () => import('./midiOutDialog.js').then((m) => m.openMidiOutDialog(song)),
    },
    {
      label: 'Subir el tono en el último coro…',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
      onSelect: () => import('../live/modulation.js').then((m) => m.openModulationDialog(song)),
    },
    {
      label: 'Medley: unir con la siguiente…',
      icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10a4 4 0 0 1 0 8H8"/><polyline points="11 12 8 15 11 18"/><line x1="18" y1="19" x2="21" y2="19"/></svg>',
      onSelect: () => import('../live/medley.js').then((m) => m.openMedleyDialog(song)),
    },
    {
      label: 'Editar',
      icon: ICON_EDIT_SM,
      onSelect: () => { card.innerHTML = songEditFormHTML(song, { showLibrary: false }); }
    },
    {
      label: 'Quitar del servicio',
      icon: ICON_REMOVE_SM,
      danger: true,
      onSelect: () => deps.removeFromService(song.serviceId)
    }
  ]);
}

// ── Delegation ────────────────────────────────────────────────────────

function initDelegation() {
  const container = q('#service-songs-container');
  if (!container) return;

  // Touch reorder — mirrors the native drag handlers below for finger users.
  bindTouchReorder('#service-songs-container', '.gi-song-item', 'index', (fromIdx, toIdx) => {
    deps.reorderService(fromIdx, toIdx);
    renderServiceList();
  });

  container.addEventListener('click', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    const song = findSong(card.dataset.serviceId);
    if (!song) return;

    const actionEl = e.target.closest('[data-action]');
    const action = actionEl && card.contains(actionEl) ? actionEl.dataset.action : null;

    switch (action) {
      case 'play-seq':
        if (song.audio && song.audio.sequence) (deps.onPlaySongSource || deps.loadAndPlayTrack)(song, 'sequence');
        else showLoadAudioMenu({ anchor: e.target.closest('.action-btn'), song, type: 'sequence',
          loadAndPlayTrack: deps.loadAndPlayTrack, onAssigned: onServiceAudioAssigned(card) });
        return;
      case 'play-orig':
        if (song.audio && song.audio.original) (deps.onPlaySongSource || deps.loadAndPlayTrack)(song, 'original');
        else showLoadAudioMenu({ anchor: e.target.closest('.action-btn'), song, type: 'original',
          loadAndPlayTrack: deps.loadAndPlayTrack, onAssigned: onServiceAudioAssigned(card) });
        return;
      case 'voices':    e.stopPropagation(); openVoicesMenu(actionEl, song); return;
      case 'remove':    deps.removeFromService(song.serviceId); return;
      case 'move-up': {
        const idx = parseInt(card.dataset.index, 10);
        if (idx > 0) { deps.reorderService(idx, idx - 1); renderServiceList(); }
        return;
      }
      case 'move-down': {
        const idx = parseInt(card.dataset.index, 10);
        if (idx < deps.getSongs().length - 1) { deps.reorderService(idx, idx + 1); renderServiceList(); }
        return;
      }
      case 'toggle-lyrics':
        // Sin letra → editor directo para agregarla; con letra → acordeón.
        if (!song.lyrics) {
          deps.openLyricsEditorModal(song, (newLyrics) => {
            song.lyrics = newLyrics;
            deps.syncLyricsToLibrary(song);
            deps.persistServiceSongs();
            repaintServiceCard(card, song);
          });
        } else {
          deps.toggleLyricsAccordion(song, true);
        }
        return;
      case 'key': e.stopPropagation(); openKeyMenu(actionEl, song, card); return;
      case 'lyrics-fullscreen': e.stopPropagation(); openLyricsFullscreen(song, { key: getEffectiveKey(song) }); return;
      case 'toggle-chords': deps.toggleChordVisibility(song, true, true); return;
      case 'edit-lyrics':
        deps.openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          // Mirror the change onto the matching library song (matched by
          // title+artist) and surgically repaint its card if mounted.
          deps.syncLyricsToLibrary(song);
          deps.persistServiceSongs();
          repaintServiceCard(card, song);
        });
        return;
      case 'more': {
        e.stopPropagation();
        openServiceCardMenu(actionEl, song, card);
        return;
      }
      case 'edit':
        card.innerHTML = songEditFormHTML(song, { showLibrary: false });
        return;
      case 'edit-save': {
        // The library is matched by title+artist; if either was renamed in
        // this edit, look up by the *previous* identity.
        const oldKey = song.title + '\x00' + song.artist;
        song.title = card.querySelector('.edit-title').value;
        song.artist = card.querySelector('.edit-artist').value;
        song.bpm = card.querySelector('.edit-bpm').value;
        const prevKey = song.key || '';
        song.key = card.querySelector('.edit-key').value;
        const keyChanged = (song.key || '') !== prevKey;
        song.genre = card.querySelector('.edit-genre').value;
        {
          const sk = card.querySelector('.edit-singerkeys');
          if (sk) {
            song.singerKeys = cleanSingerKeys(sk.value);
            const live = librarySongOf(song);
            if (live) live.singerKeys = song.singerKeys;
          }
        }
        deps.syncMetaToLibrary(oldKey, song);
        deps.persistServiceSongs();
        repaintServiceCard(card, song);
        // Tono nuevo: reemplaza al fijado para el servicio y llega al pad (app.js).
        if (keyChanged || song.key) window.dispatchEvent(new CustomEvent('livepads:song-key-changed', { detail: { song: librarySongOf(song) || song, oldKey: keyChanged ? prevKey : '' } }));
        return;
      }
      case 'edit-cancel':
        repaintServiceCard(card, song);
        return;
      case 'edit-form-shell':
        return;
    }

    deps.onApplySong(song);
  });

  // Clic derecho sobre una card del Servicio → mismo menú que el botón ⋮.
  container.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    if (card.querySelector('.gi-edit-form')) return; // editando → sin menú
    const song = findSong(card.dataset.serviceId);
    if (!song) return;
    e.preventDefault();
    openServiceCardMenu(card.querySelector('.btn-more') || card, song, card);
  });

  // Drag-and-drop is delegated too. dataTransfer.setData carries the
  // origin index in `text/plain`; the drop target reads its own index.
  container.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.index || '');
  });
  container.addEventListener('dragend', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (card) card.classList.remove('dragging');
  });
  container.addEventListener('dragover', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    e.preventDefault();
    card.classList.add('drag-over');
  });
  container.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (card) card.classList.remove('drag-over');
  });
  container.addEventListener('drop', (e) => {
    const card = e.target.closest('.gi-song-item');
    if (!card || !container.contains(card)) return;
    e.preventDefault();
    card.classList.remove('drag-over');
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex = parseInt(card.dataset.index, 10);
    if (fromIndex !== toIndex && Number.isFinite(fromIndex) && Number.isFinite(toIndex)) {
      deps.reorderService(fromIndex, toIndex);
      renderServiceList();
    }
  });
}

// Los tonos por cantante viven en la librería; las canciones del servicio son
// copias. Cuando la librería carga o cambia (al arrancar llega DESPUÉS de pintar
// el servicio), se refresca la copia y se repinta solo si algo cambió.
let _singerKeysTimer = 0;
function refreshSingerKeysFromLibrary() {
  clearTimeout(_singerKeysTimer);
  _singerKeysTimer = setTimeout(() => {
    let changed = false;
    for (const s of (getServiceSongs() || [])) {
      const live = librarySongOf(s);
      if (!live) continue;
      const v = live.singerKeys || '';
      if ((s.singerKeys || '') !== v) { s.singerKeys = v; changed = true; }
    }
    if (changed) renderServiceList();
  }, 150);
}
if (typeof window !== 'undefined') {
  window.addEventListener('livepads:songs-changed', refreshSingerKeysFromLibrary);
  window.addEventListener('livepads:library-reload', refreshSingerKeysFromLibrary);
  window.addEventListener('livepads:songs-updated', refreshSingerKeysFromLibrary);
}


// ── Quién dirige ─────────────────────────────────────────────────────────
// «🎤 Dirige: María» en la cabecera del servicio. Al elegir a alguien, cada canción
// del servicio que tenga un tono guardado para esa persona (singerKeys de la
// librería: «G · María») pasa a ese tono hoy. Y mientras dirige, si cambias el
// tono de una canción, queda guardado como el suyo. Guardado: «livepads.leader».
const LEADER_KEY = 'livepads.leader';
const leaderName = () => { try { return localStorage.getItem(LEADER_KEY) || ''; } catch (_) { return ''; } };
function paintLeaderChip() {
  const b = q('#svc-leader');
  if (!b) return;
  const n = leaderName();
  b.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>${n ? 'Dirige: ' + esc(n) : 'Quién dirige'}</span>`;
  b.classList.toggle('is-on', !!n);
  b.title = n ? `Las canciones van en los tonos de ${n} (las que tienen uno guardado). Clic para cambiar.` : 'Elige quién dirige hoy: cada canción pasa a su tono guardado.';
}
function initLeaderChip() {
  const host = q('.service-actions-text');
  if (!host || q('#svc-leader')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'svc-leader'; b.className = 'svc-leader';
  // En su propia línea, bajo la cabecera del servicio: en columnas estrechas no cabe al lado.
  const row = host.parentElement;
  if (row && row.parentElement) row.insertAdjacentElement('afterend', b); else host.appendChild(b);
  b.addEventListener('click', (e) => { e.stopPropagation(); openLeaderMenu(b); });
  paintLeaderChip();
}
function openLeaderMenu(anchor) {
  const lib = getLibrarySongs() || [];
  const names = singersIn(lib.map((s) => s.singerKeys));
  const cur = leaderName();
  if (cur && !names.some((n) => n.toLowerCase() === cur.toLowerCase())) names.unshift(cur);
  const items = names.map((n) => ({ label: n, icon: n === cur ? ICON_CHECK : '', onSelect: () => setLeader(n) }));
  items.push({ label: 'Otro cantante…', icon: '', onSelect: () => showDialog('¿Quién dirige hoy?', 'Nombre (p. ej. María)', (name) => { const v = String(name || '').trim(); if (v) setLeader(v); }) });
  if (cur) items.push({ label: 'Nadie (tonos de la librería)', icon: '', onSelect: () => setLeader('') });
  openCardMoreMenu(anchor, items);
}
function setLeader(name) {
  try { if (name) localStorage.setItem(LEADER_KEY, name); else localStorage.removeItem(LEADER_KEY); } catch (_) {}
  paintLeaderChip();
  if (!name) { window.showToast?.('Sin cantante elegido: cada canción queda en el tono que tenga hoy.', 'info'); return; }
  import('../live/vocalRange.js').then(({ suggestFor }) => {
    let changed = 0, missing = 0, suggested = 0;
    for (const song of getServiceSongs()) {
      let k = keyForSinger(singerKeysOf(song), name);
      if (!k) {
        const sg = suggestFor(name, song.key);
        if (sg) { k = sg.key; suggested++; } else { missing++; continue; }
      }
      if (getEffectiveKey(song) !== k) { setKeyOverride(song, k); changed++; deps.onKeyChanged?.(song); }
    }
    renderServiceList();
    window.showToast?.(`Dirige ${name}: ${changed} ${changed === 1 ? 'canción' : 'canciones'} en sus tonos`
      + (suggested ? ` · ${suggested} sugerido${suggested === 1 ? '' : 's'} por su rango vocal` : '')
      + (missing ? ` · ${missing} sin tono guardado (haz la «Prueba de rango vocal» o cámbialo y quedará guardado)` : '') + '.', 'success');
  });
}
/** Con alguien dirigiendo, el tono que elijas para una canción queda como el suyo. */
function learnLeaderKey(song, key) {
  const name = leaderName();
  const live = librarySongOf(song);
  if (!name || !live || !key) return;
  if (keyForSinger(live.singerKeys, name) === key) return;
  live.singerKeys = upsertSingerKey(live.singerKeys, key, name);
  song.singerKeys = live.singerKeys;
  deps.persistLibrary?.();
  try { window.dispatchEvent(new Event('livepads:cloud-dirty')); } catch (_) {}
  window.showToast?.(`Guardado: «${live.title}» en ${key} para ${name}.`, 'success');
}
