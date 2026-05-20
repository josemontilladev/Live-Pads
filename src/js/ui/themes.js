import { q, esc } from '../utils/dom.js';
import { THEMES } from '../data/banks.js';

const STORAGE_KEY = 'livepads.theme';

// Restore the user's last selection on boot. Falls back to gi_setlist if
// the saved value is missing or no longer matches a known theme (handles
// the case where a theme was renamed/removed between versions).
let currentTheme = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch { /* localStorage may throw in private mode */ }
  return 'gi_setlist';
})();

export function getCurrentTheme() {
  return currentTheme;
}

// Visual-only theme switch: sets the CSS custom properties + body
// backdrop. Used for both committed selections and the hover preview.
function paintTheme(id) {
  const t = THEMES[id];
  if (!t) return;

  const s = document.documentElement.style;
  s.setProperty('--blue', t.blue);
  s.setProperty('--accent', t.blue); // semantic alias — `--blue` is legacy
  s.setProperty('--accent2', t.accent2 || t.blue);
  s.setProperty('--bg-main', t.bg1);
  s.setProperty('--bg-card', t.bg2);
  s.setProperty('--bg-surface', t.bg3);
  s.setProperty('--bg-hover', t.bgHover || '#1f1f1f');
  s.setProperty('--border', t.border || 'rgba(255,255,255,0.08)');
  s.setProperty('--border-strong', t.borderStrong || t.border || 'rgba(255,255,255,0.18)');
  s.setProperty('--glow', t.glow || 'rgba(255,255,255,0.10)');
  s.setProperty('--text', t.text || '#ffffff');
  s.setProperty('--text-muted', t.textMuted || '#a3a3a3');

  const fallbackBg = `linear-gradient(155deg, ${t.bg1} 0%, ${t.bg2} 50%, ${t.bg1} 100%)`;
  document.body.style.background = t.gradient || fallbackBg;
}

// Public: commits a theme as the user's choice. Hover preview uses
// paintTheme() instead and reverts on mouseleave. Persists to
// localStorage so the choice survives app restart.
export function applyTheme(id) {
  if (!THEMES[id]) return;
  currentTheme = id;
  paintTheme(id);
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  buildThemesList();
  // Notify any view that needs to repaint with the new tokens — the
  // Stems waveforms use the accent at draw time so they must re-render.
  document.dispatchEvent(new CustomEvent('livepads:theme-change', { detail: { id } }));
}

export function buildThemesList() {
  const container = q('#themes-list');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(THEMES).forEach(id => {
    const t = THEMES[id];
    const item = document.createElement('div');
    item.className = 'theme-item' + (currentTheme === id ? ' active' : '');
    item.innerHTML = `
      <div class="theme-swatch" style="background:${t.swatch}"></div>
      <div class="theme-info">
        <div class="theme-name">${esc(t.name)}</div>
        <div class="theme-desc">${esc(t.desc)}</div>
      </div>
      ${currentTheme === id ? '<div class="theme-check"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg></div>' : ''}
    `;
    item.onclick = () => applyTheme(id);
    // Hover preview — paint without committing. mouseleave reverts to
    // whichever theme is currently committed, so darting between rows
    // lets the user "feel" each palette without scrolling away to undo.
    item.onmouseenter = () => { if (id !== currentTheme) paintTheme(id); };
    item.onmouseleave = () => { if (id !== currentTheme) paintTheme(currentTheme); };
    container.appendChild(item);
    const div = document.createElement('div');
    div.className = 'theme-div';
    container.appendChild(div);
  });
}
