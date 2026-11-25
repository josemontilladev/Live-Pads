import { q, esc } from '../utils/dom.js';
import { THEMES } from '../data/banks.js';
import { paintThemeVars, savedThemeId, THEME_STORAGE_KEY as STORAGE_KEY } from './themeVars.js';

// Restore the user's last selection on boot. Falls back to gi_setlist if
// the saved value is missing or no longer matches a known theme (handles
// the case where a theme was renamed/removed between versions).
let currentTheme = savedThemeId();

export function getCurrentTheme() {
  return currentTheme;
}

const lowScreen = window.matchMedia('(max-height: 780px)');
function loadKnobs() { import('./flatKnobs.js').then(m => m.ensureFlatKnobs()).catch(() => {}); }
lowScreen.addEventListener('change', () => { if (lowScreen.matches) loadKnobs(); });

// «Controles grandes» (pantallas táctiles): independiente del tema. Solo pone
// data-touch="on" en la raíz; los tamaños viven en _theme-flat.css.
const TOUCH_KEY = 'livepads.touch';
export function isTouchMode() {
  try { return localStorage.getItem(TOUCH_KEY) === '1'; } catch { return false; }
}
function paintTouchMode(on) {
  if (on) document.documentElement.dataset.touch = 'on';
  else delete document.documentElement.dataset.touch;
}
export function setTouchMode(on) {
  try { localStorage.setItem(TOUCH_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  paintTouchMode(on);
  try { window.dispatchEvent(new Event('livepads:settings-changed')); } catch (_) {}
}
paintTouchMode(isTouchMode());

// «Alto contraste (escenario)»: independiente del tema. data-contrast="high" en la raíz; los estilos
// viven en _polish.css. La ventana de la letra (TV) lo lee de la misma clave.
export const CONTRAST_KEY = 'livepads.contrast';
export function isHighContrast() {
  try { return localStorage.getItem(CONTRAST_KEY) === '1'; } catch { return false; }
}
export function paintContrast(on = isHighContrast(), doc = document) {
  if (on) doc.documentElement.dataset.contrast = 'high'; else delete doc.documentElement.dataset.contrast;
}
export function setHighContrast(on) {
  try { localStorage.setItem(CONTRAST_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  paintContrast(on);
}
paintContrast();

// La primera vez que alguien TOCA la pantalla con el dedo se le ofrece activar
// los controles grandes. Quien usa ratón no ve nunca la pregunta, y se hace una
// sola vez (aceptar o rechazar guarda la respuesta).
(() => {
  let answered = true;
  try { answered = localStorage.getItem(TOUCH_KEY) !== null; } catch { /* ignore */ }
  if (answered) return;
  const onTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    document.removeEventListener('pointerdown', onTouch, true);
    try { if (localStorage.getItem(TOUCH_KEY) !== null) return; localStorage.setItem(TOUCH_KEY, '0'); } catch { return; }
    window.showToast?.('¿Usas la pantalla táctil? Puedes agrandar botones y deslizadores.', 'info', {
      ttl: 15000,
      action: { label: 'Activar controles grandes', onClick: () => {
        setTouchMode(true);
        const sw = q('#touch-mode-switch'); if (sw) sw.checked = true;
        window.showToast?.('Controles grandes activados. Se cambia en Ajustes → Temas.', 'success');
      } },
    });
  };
  document.addEventListener('pointerdown', onTouch, { capture: true, passive: true });
})();

// Visual-only theme switch: sets the CSS custom properties + body
// backdrop. Used for both committed selections and the hover preview.
function paintTheme(id) {
  // Variables, data-theme y fondo: themeVars.js (lo comparte la ventana de la letra).
  const t = paintThemeVars(id);
  if (!t) return;
  // Las perillas de paneo se cargan solo si hacen falta: con el tema plano, o en
  // pantallas bajas (ahí el paneo del mezclador no cabe como deslizador).
  if (t.style === 'flat' || lowScreen.matches) loadKnobs();
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
  try { window.dispatchEvent(new Event('livepads:settings-changed')); } catch (_) {}
}

export function buildThemesList() {
  const container = q('#themes-list');
  if (!container) return;
  const touch = q('#touch-mode-switch');
  if (touch) { touch.checked = isTouchMode(); touch.onchange = () => setTouchMode(touch.checked); }
  const contrast = q('#contrast-switch');
  if (contrast) { contrast.checked = isHighContrast(); contrast.onchange = () => setHighContrast(contrast.checked); }
  // Con controles grandes el volumen de cada pad se guarda tras este botón, para
  // no moverlo sin querer al golpear el pad con el dedo.
  const levels = q('#mx-pad-levels');
  if (levels) levels.onclick = () => {
    const open = document.body.classList.toggle('pad-levels-open');
    levels.classList.toggle('is-on', open);
    levels.setAttribute('aria-pressed', open ? 'true' : 'false');
  };
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
