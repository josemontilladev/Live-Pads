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
  { id: 'cmd:settings', label: 'Abrir Ajustes',            hint: '',        selector: '#btn-settings-toggle' },
  { id: 'cmd:help',     label: 'Abrir Atajos',             hint: '?',       selector: '#btn-help' },
  { id: 'cmd:menu',     label: 'Abrir menú',               hint: '',        selector: '#btn-menu' },
  { id: 'cmd:preflight',label: 'Pre-vuelo del servicio',   hint: '',        selector: '#menu-preflight', viaMenu: true },
  { id: 'cmd:mappings', label: 'Mapeos activos',           hint: '',        selector: '#menu-mappings', viaMenu: true },
  { id: 'cmd:midilearn',label: 'Modo Mapeo MIDI / Teclado', hint: '',       selector: '#menu-midi-learn', viaMenu: true },
  { id: 'cmd:about',    label: 'Acerca de Live Pads',      hint: '',        selector: '#menu-about', viaMenu: true },
];

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
  const pool = [...songItems, ...commandItems];

  if (!lower) {
    // Empty query → suggest first 8 commands + first 6 songs.
    return [...commandItems.slice(0, 8), ...songItems.slice(0, 6)];
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

function paintResults() {
  if (!resultsEl) return;
  if (lastResults.length === 0) {
    resultsEl.innerHTML = `<div class="sp-empty">Sin resultados.</div>`;
    return;
  }
  resultsEl.innerHTML = lastResults.map((item, idx) => `
    <button class="sp-row ${idx === activeIndex ? 'is-active' : ''}" data-idx="${idx}" type="button">
      <span class="sp-row-kind ${item.kind}">${item.kind === 'song' ? '🎵' : '⚡'}</span>
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
