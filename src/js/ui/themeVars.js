// ─────────────────────────────────────────────────────────────────────────
// Pinta un tema: variables CSS, data-theme / data-theme-style y el fondo.
// Sin efectos secundarios, para usarlo también en la ventana de la letra
// (lyricsWindow.js), que antes salía siempre con los colores base.
// ─────────────────────────────────────────────────────────────────────────
import { THEMES } from '../data/banks.js';

export const THEME_STORAGE_KEY = 'livepads.theme';

export function paintThemeVars(id, doc = document) {
  const t = THEMES[id];
  if (!t) return null;
  const root = doc.documentElement, s = root.style;
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
  // Color del texto sobre el acento (los temas con acento claro lo necesitan oscuro).
  if (t.onAccent) s.setProperty('--on-accent', t.onAccent); else s.removeProperty('--on-accent');
  // Estilo estructural del tema (p. ej. «flat»: sin sombras ni degradados) → CSS propio.
  if (t.style) root.dataset.themeStyle = t.style;
  else delete root.dataset.themeStyle;
  // El id del tema, para que el CSS de un estilo pueda cambiar solo la paleta.
  root.dataset.theme = id;
  const fallbackBg = `linear-gradient(155deg, ${t.bg1} 0%, ${t.bg2} 50%, ${t.bg1} 100%)`;
  if (doc.body) doc.body.style.background = t.gradient || fallbackBg;
  return t;
}

/** El tema guardado (o el de por defecto si no hay o ya no existe). */
export function savedThemeId() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch { /* localStorage may throw in private mode */ }
  return 'gi_setlist';
}
