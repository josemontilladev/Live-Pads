// Service-list view — renders #service-songs-container, handles all
// click/edit/drag delegation, and exposes surgical helpers. State (the
// current service songs array, active index, open-accordion id) lives
// in app.js (and partially in data/service.js); we read it via the deps
// getters passed to initServiceList().

import { q, esc } from '../utils/dom.js';
import { listSavedSetlists, loadSavedSetlist, getServiceSongs, getCurrentSetlistName } from '../data/service.js';
import { songCardInnerHTML } from './songCard.js';
import { songEditFormHTML } from './songEditForm.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { showLoadAudioMenu } from './audioLoadMenu.js';
import { audioMenuItems } from './songMenu.js';
import { openLyricsFullscreen } from './lyricsFullscreen.js';
import { getOpenAccordionServiceId } from '../state/store.js';
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
  chooserPending = listSavedSetlists().length > 0;
  // Listener de búsqueda dentro del Servicio (input #svc-search en setlistTabs).
  window.addEventListener('livepads:service-search', (ev) => {
    svcSearchTerm = (ev?.detail?.q || '').trim().toLowerCase();
    renderServiceList();
  });
}

// ── Selector de setlist (chooser) ─────────────────────────────────────────
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

export function showServiceChooser() {
  const panel = q('#service-setlist-list');
  const chooser = q('#service-chooser');
  if (!panel || !chooser) return;
  const list = listSavedSetlists();
  const curN = getServiceSongs().length;
  chooser.innerHTML = `
    <div class="svc-chooser-head">
      <h4>Elegir un setlist</h4>
      <button class="svc-chooser-manage icon-btn" data-act="manage" title="Guardar la lista actual / gestionar setlists" aria-label="Guardar o gestionar setlists">
        <svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>
      </button>
    </div>
    <div class="svc-chooser-list">
      ${list.length ? list.map(s => `
        <button class="svc-chooser-item" data-act="load" data-id="${esc(s.id)}">
          <span class="svc-chooser-name">${esc(s.name)}</span>
          <span class="svc-chooser-meta">${fmtChooserDate(s)} · ${(s.songs || []).length} canción(es)</span>
        </button>`).join('')
        : '<p class="svc-chooser-empty">No hay setlists guardados todavía.</p>'}
    </div>
    <button class="svc-chooser-current" data-act="current">
      ${curN ? `Usar la lista actual (${curN} canción${curN === 1 ? '' : 'es'}) →` : 'Empezar una lista nueva →'}
    </button>`;
  panel.classList.add('choosing');
}

export function hideServiceChooser() {
  q('#service-setlist-list')?.classList.remove('choosing');
}

function initChooserDelegation() {
  const chooser = q('#service-chooser');
  if (!chooser) return;
  chooser.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'current') { hideServiceChooser(); renderServiceList(); return; }
    if (act === 'manage') { import('./setlistsModal.js').then(m => m.openSetlistsModal()).catch(() => {}); return; }
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

export function renderServiceList() {
  const container = q('#service-songs-container');
  const emptyMsg = q('#service-empty-msg');
  if (!container) return;

  container.innerHTML = '';

  const allSongs = deps.getSongs();
  const activeIdx = deps.getActiveIndex();
  updateServiceMeta(allSongs);

  if (allSongs.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
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
    removeBtnClass: 'btn-remove',
    removeBtnTitle: 'Quitar de la lista'
  });
}

function findSong(serviceId) {
  return deps.getSongs().find(s => String(s.serviceId) === serviceId);
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
        if (song.audio && song.audio.sequence) deps.loadAndPlayTrack(song, 'sequence');
        else showLoadAudioMenu({ anchor: e.target.closest('.action-btn'), song, type: 'sequence',
          loadAndPlayTrack: deps.loadAndPlayTrack, onAssigned: onServiceAudioAssigned(card) });
        return;
      case 'play-orig':
        if (song.audio && song.audio.original) deps.loadAndPlayTrack(song, 'original');
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
      case 'lyrics-fullscreen': e.stopPropagation(); openLyricsFullscreen(song); return;
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
