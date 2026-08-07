// Service-list view — renders #service-songs-container, handles all
// click/edit/drag delegation, and exposes surgical helpers. State (the
// current service songs array, active index, open-accordion id) lives
// in app.js (and partially in data/service.js); we read it via the deps
// getters passed to initServiceList().

import { q, esc } from '../utils/dom.js';
import { listSavedSetlists, loadSavedSetlist, deleteSavedSetlist, getServiceSongs, getCurrentSetlistName, getCurrentSetlistId, createNewSetlist, updateSetlistMeta, duplicateSetlist, getEffectiveKey, getKeyOverride, setKeyOverride, clearKeyOverride } from '../data/service.js';
import { songCardInnerHTML, songCoverHtml } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { keyChoices, isKnownKey } from '../utils/musicKeys.js';
import { confirmDialog } from './dialog.js';
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
    return `<div class="svc-chooser-item" data-act="load" data-id="${esc(s.id)}">
      <span class="svc-chooser-info">
        <span class="svc-chooser-name">${esc(s.name)}</span>
        <span class="svc-chooser-meta">${fmtChooserDate(s)} · ${(s.songs || []).length} canción(es)</span>
      </span>
      <button class="svc-chooser-more" data-act="menu" data-id="${esc(s.id)}" title="Opciones" aria-label="Opciones">⋯</button>
    </div>`;
  };

  chooser.innerHTML = `
    <div class="svc-chooser-head">
      <h4>Elegir un setlist</h4>
    </div>
    <button class="svc-chooser-new" data-act="new">＋ Crear lista nueva</button>
    ${showSearch ? `<input type="text" class="svc-chooser-search" placeholder="Buscar setlist…" value="${esc(chooserSearch)}">` : ''}
    <div class="svc-chooser-list">
      ${all.length
        ? (list.length ? list.map(itemHtml).join('') : '<p class="svc-chooser-empty">Sin coincidencias.</p>')
        : '<p class="svc-chooser-empty">No hay setlists guardados todavía.</p>'}
    </div>
    <button class="svc-chooser-current" data-act="current">
      ${curN ? `Usar la lista actual (${curN} canción${curN === 1 ? '' : 'es'}) →` : 'Empezar una lista nueva →'}
    </button>`;
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
  const selected = new Set(opts.prefillCurrent ? getServiceSongs().map(s => String(s.id)) : []);
  const headTitle = opts.prefillCurrent ? 'Guardar como setlist' : 'Nuevo setlist';
  const initialName = opts.prefillCurrent ? (getCurrentSetlistName() || '') : '';

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
    <div class="svc-create-row2">
      <label class="svc-create-field"><span>Nombre</span>
        <input type="text" class="nsl-title" placeholder="Ej. Domingo de Alabanza" value="${esc(initialName)}"></label>
      <label class="svc-create-field svc-create-date"><span>Fecha</span>
        <input type="date" class="nsl-date" value="${todayISO()}"></label>
    </div>
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
      <button class="nsl-btn nsl-btn--primary" data-act="create">${opts.prefillCurrent ? 'Guardar setlist' : 'Crear setlist'}</button>
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
    if (act === 'back') { hideServiceCreate(); showServiceChooser(); return; }
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
          ? `✓ "${entry.name}" creado con ${n} canción${n === 1 ? '' : 'es'}.`
          : `✓ Lista "${entry.name}" creada. Agregá canciones con el botón + de la Librería.`, 'success');
        hideServiceCreate();
        renderServiceList();
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
    if (act === 'current') { hideServiceChooser(); renderServiceList(); return; }
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
      if (loadSavedSetlist(id)) {           // replaceService → re-render del servicio
        window.showToast?.('✓ Setlist cargado.', 'success');
        hideServiceChooser();
        renderServiceList();
      }
    }
  });
}

// Menú ⋯ por setlist (estilo card unificado): cargar / renombrar / duplicar / eliminar.
function openSetlistItemMenu(anchor, id) {
  const s = listSavedSetlists().find(x => x.id === id);
  if (!s) return;
  openCardMoreMenu(anchor, [
    { label: 'Cargar', onSelect: () => {
        if (loadSavedSetlist(id)) { window.showToast?.('✓ Setlist cargado.', 'success'); hideServiceChooser(); renderServiceList(); }
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

export function renderServiceList() {
  const container = q('#service-songs-container');
  const emptyMsg = q('#service-empty-msg');
  if (!container) return;

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
  labelEl.textContent = name || 'Tu lista de hoy';

  const n = songs.length;
  if (n === 0) { labelEl.title = ''; return; }
  let totalSec = 0, unknown = 0;
  for (const s of songs) {
    if (typeof s.durationSec === 'number' && s.durationSec > 0) totalSec += s.durationSec;
    else { totalSec += 240; unknown++; }
  }
  const minutes = Math.max(1, Math.round(totalSec / 60));
  const prefix = unknown > 0 ? '~' : '';
  const songLabel = n === 1 ? 'canción' : 'canciones';
  labelEl.title = `${n} ${songLabel} · ${prefix}${minutes} min`;
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
  live.key = newKey;
  clearKeyOverride(song);
  // A disco primero: songs-changed re-renderiza y programa el push a la nube,
  // pero no escribe canciones_app.json. Sin esto el tono nuevo se perdía al
  // cerrar la app si el push no llegaba a completarse.
  deps.persistLibrary?.();
  try { window.dispatchEvent(new Event('livepads:songs-changed')); } catch (_) {}
  try { window.dispatchEvent(new Event('livepads:cloud-dirty')); } catch (_) {}
  window.showToast?.(`✓ «${live.title}» queda en ${newKey} para todo el equipo.`, 'success');
  renderServiceList();
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
      label: `Fijar ${current} como tono de la biblioteca`,
      icon: ICON_STAR,
      onSelect: () => promoteKeyToLibrary(song, current),
    });
  }

  keyChoices(base).forEach(({ key, label }) => {
    items.push({
      label,
      icon: key === current ? ICON_CHECK : '',
      onSelect: () => {
        setKeyOverride(song, key);
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
        song.key = card.querySelector('.edit-key').value;
        song.genre = card.querySelector('.edit-genre').value;
        deps.syncMetaToLibrary(oldKey, song);
        deps.persistServiceSongs();
        repaintServiceCard(card, song);
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
