import { q, esc } from '../utils/dom.js';
import { THEMES } from '../data/banks.js';

let currentTheme = 'gi_setlist';

export function getCurrentTheme() {
  return currentTheme;
}

export function applyTheme(id) {
  const t = THEMES[id];
  if (!t) return;
  currentTheme = id;

  const s = document.documentElement.style;
  // Core palette (used everywhere)
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

  // Premium body backdrop: subtle radial highlight + cohesive linear blend.
  // Per-theme `gradient` lets each palette breathe its own vibe.
  const fallbackBg = `linear-gradient(155deg, ${t.bg1} 0%, ${t.bg2} 50%, ${t.bg1} 100%)`;
  document.body.style.background = t.gradient || fallbackBg;

  buildThemesList();
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
    container.appendChild(item);
    const div = document.createElement('div');
    div.className = 'theme-div';
    container.appendChild(div);
  });
}
