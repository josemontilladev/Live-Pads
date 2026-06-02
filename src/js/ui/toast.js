import { q, esc } from '../utils/dom.js';

const STYLES = {
  info:    { bg: 'rgba(0, 170, 255, 0.9)',  color: '#000', border: '1px solid var(--blue)' },
  success: { bg: 'rgba(16, 185, 129, 0.95)', color: '#fff', border: '1px solid #10b981' },
  error:   { bg: 'rgba(239, 68, 68, 0.95)',  color: '#fff', border: '1px solid #ef4444' },
  warning: { bg: 'rgba(245, 158, 11, 0.95)', color: '#000', border: '1px solid #f59e0b' },
};

const ICONS = {
  info:    '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg>',
  error:   '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

export function showToast(message, type = 'info') {
  // Toast container is anchored ABOVE the track-player bar (height 76px)
  // so toasts never sit on top of the transport controls. Layout + style
  // live in _modals.css (.toast-container, .toast, .toast--success, etc.)
  // — this module only inserts/animates the DOM.
  let container = q('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    // Live region: los lectores de pantalla anuncian los mensajes (antes eran
    // mudos). Los errores/avisos van como role="alert" (asertivo) en el toast.
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const style = STYLES[type] || STYLES.info;
  const icon = ICONS[type] || ICONS.info;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  if (type === 'error' || type === 'warning') toast.setAttribute('role', 'alert');
  // Per-type colour still set inline since it's a small finite set and
  // keeps the global stylesheet from having to know every variant.
  toast.style.background = style.bg;
  toast.style.color = style.color;
  toast.style.border = style.border;
  toast.innerHTML = `${icon}<span>${esc(message)}</span><button class="toast-close" aria-label="Cerrar" title="Cerrar">×</button>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--in'));

  const dismiss = () => {
    toast.classList.add('toast--out');
    setTimeout(() => toast.remove(), 300);
  };
  // Los errores duran más (se pierden si el director miraba el escenario) y
  // todos se pueden cerrar a mano con la ×.
  const ttl = type === 'error' ? 9000 : 4000;
  const timer = setTimeout(dismiss, ttl);
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) closeBtn.onclick = () => { clearTimeout(timer); dismiss(); };
}

// Backwards-compatible global so legacy inline handlers still work.
if (typeof window !== 'undefined') window.showToast = showToast;
