// Spotlight-style global search (Ctrl+K). Fuzzy-matches across:
//   • Library songs (title, artist, key)
//   • Commands (open settings/themes/atajos, MIDI learn, sync, import,
//     export, preflight, new song, …)
//
// Results are ranked: exact-prefix > title-substring > artist-substring
// > command. ↑/↓ navigate, Enter activates, Esc closes.
//
// State: rendered on demand, removed on close. Input stays mounted as
// long as the overlay is alive so the user's typed query is preserved
// during async re-renders.

import { q } from '../utils/dom.js';
import { getSongs } from '../state/store.js';

let mounted = null;
let inputEl = null;
let resultsEl = null;
let activeIndex = 0;
let lastResults = [];

const COMMANDS = [
  { id: 'cmd:new',      label: 'Nueva canción',           hint: 'Ctrl+N',  selector: '#btn-add-gi-song' },
  { id: 'cmd:import',   label: 'Importar librería (JSON)', hint: '',        selector: '#btn-import-gi' },
  { id: 'cmd:export',   label: 'Exportar librería',        hint: '',        selector: '#btn-export-gi' },
  { id: 'cmd:sync',     label: 'Sincronizar con MongoDB',  hint: '',        selector: '#btn-sync-gi' },
  { id: 'cmd:settings', label: 'Abrir Ajustes',            hint: '☰',       selector: '#btn-menu' },
  { id: 'cmd:midilearn',label: 'Modo Mapeo MIDI / Teclado', hint: '',       selector: '#menu-midi-learn', viaMenu: true },
];
// Paneles, temas, modo en vivo y canciones del servicio los aporta app.js vía
// registerSpotlightProvider().

// Otros módulos aportan entradas dinámicas (paneles, temas, canciones del
// servicio…). Cada proveedor devuelve items { id, kind, label, sub, search, run }.
const providers = [];
export function registerSpotlightProvider(fn) { providers.push(fn); }
function providedItems() {
  const out = [];
  for (const fn of providers) { try { out.push(...(fn() || [])); } catch (_) {} }
  return out;
}

function score(item, term) {
  if (!term) return 0;
  const lower = (item.search || '').toLowerCase();
  if (!lower) return -1;
  if (lower === term) return 100;
  if (lower.startsWith(term)) return 80;
  const idx = lower.indexOf(term);
  if (idx === 0) return 70;
  if (idx > 0) return 50 - Math.min(idx, 40);
  return -1;
}

function buildSongItem(song) {
  return {
    id: `song:${song.id}`,
    kind: 'song',
    label: song.title || 'Sin título',
    sub: [song.artist, song.key, song.bpm ? `${song.bpm} BPM` : ''].filter(Boolean).join(' · '),
    search: `${song.title || ''} ${song.artist || ''} ${song.key || ''}`,
    song,
  };
}

function buildCommandItem(cmd) {
  return {
    id: cmd.id,
    kind: 'command',
    label: cmd.label,
    sub: cmd.hint || 'Comando',
    search: cmd.label,
    cmd,
  };
}

function search(term) {
  const lower = term.trim().toLowerCase();
  const songItems = getSongs().map(buildSongItem);
  const commandItems = COMMANDS.map(buildCommandItem);
  const extra = providedItems();
  const pool = [...songItems, ...commandItems, ...extra];

  if (!lower) {
    // Sin texto: lo más útil en vivo primero (siguiente canción, modo en
    // vivo…), luego comandos base y canciones.
    const featured = extra.filter(i => i.featured);
    return [...featured, ...commandItems.slice(0, 6), ...songItems.slice(0, 6)];
  }

  const scored = pool
    .map(item => ({ item, s: score(item, lower) }))
    .filter(r => r.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 18).map(r => r.item);
}

function activate(item) {
  if (!item) return;
  closeSpotlight();
  if (typeof item.run === 'function') { setTimeout(() => item.run(), 0); return; }
  if (item.kind === 'song') {
    // Click the matching card in the library (which runs applyGiSong).
    const sel = `#gi-songs-container .gi-song-item[data-song-id="${CSS.escape(String(item.song.id))}"]`;
    const card = document.querySelector(sel);
    if (card) { card.click(); return; }
    // Card might not be mounted (filtered out) — switch to Library tab,
    // clear filter, then retry on the next frame.
    document.querySelector('.s-toggle[data-target="gi-setlist-list"]')?.click();
    const searchInput = q('#gi-search');
    if (searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setTimeout(() => {
      const c = document.querySelector(sel);
      if (c) c.click();
    }, 220);
    return;
  }
  if (item.kind === 'command') {
    const target = document.querySelector(item.cmd.selector);
    if (!target) return;
    if (item.cmd.viaMenu) {
      // Menu items live inside the hidden #menu-popover. Open the menu
      // first so the target becomes interactable.
      document.querySelector('#btn-menu')?.click();
      setTimeout(() => target.click(), 50);
    } else {
      target.click();
    }
  }
}

const KIND_ICON = {
  song:    '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  command: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>',
  service: '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  theme:   '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>',
  panel:   '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
};

function paintResults() {
  if (!resultsEl) return;
  if (lastResults.length === 0) {
    resultsEl.innerHTML = `<div class="sp-empty">Sin resultados.</div>`;
    return;
  }
  resultsEl.innerHTML = lastResults.map((item, idx) => `
    <button class="sp-row ${idx === activeIndex ? 'is-active' : ''}" data-idx="${idx}" type="button">
      <span class="sp-row-kind ${item.kind}">${KIND_ICON[item.kind] || KIND_ICON.command}</span>
      <div class="sp-row-text">
        <span class="sp-row-label">${escapeHtml(item.label)}</span>
        ${item.sub ? `<span class="sp-row-sub">${escapeHtml(item.sub)}</span>` : ''}
      </div>
    </button>
  `).join('');
  const active = resultsEl.querySelector('.sp-row.is-active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

function recompute() {
  lastResults = search(inputEl.value);
  activeIndex = 0;
  paintResults();
}

export function openSpotlight() {
  if (mounted) return;

  const overlay = document.createElement('div');
  overlay.id = 'spotlight-overlay';
  overlay.innerHTML = `
    <div class="sp-panel" role="dialog" aria-modal="true">
      <div class="sp-search-row">
        <svg class="sp-icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input class="sp-input" type="text" placeholder="Busca canciones o comandos…" autocomplete="off" autocorrect="off" spellcheck="false">
        <kbd class="sp-hint">Esc</kbd>
      </div>
      <div class="sp-results" role="listbox"></div>
      <div class="sp-footer">
        <span><kbd>↑↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> abrir</span>
        <span><kbd>Esc</kbd> cerrar</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  mounted = overlay;

  inputEl = overlay.querySelector('.sp-input');
  resultsEl = overlay.querySelector('.sp-results');

  inputEl.oninput = recompute;
  inputEl.onkeydown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, lastResults.length - 1);
      paintResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      paintResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(lastResults[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlight();
    }
  };
  resultsEl.onclick = (e) => {
    const row = e.target.closest('[data-idx]');
    if (!row) return;
    activate(lastResults[parseInt(row.dataset.idx, 10)]);
  };
  overlay.onclick = (e) => { if (e.target === overlay) closeSpotlight(); };

  recompute();
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => inputEl.focus(), 50);
}

export function closeSpotlight() {
  if (!mounted) return;
  mounted.classList.remove('open');
  const node = mounted;
  mounted = null;
  inputEl = null;
  resultsEl = null;
  setTimeout(() => node.remove(), 180);
}

export function isSpotlightOpen() { return mounted !== null; }
