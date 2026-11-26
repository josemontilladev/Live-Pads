import { q, esc } from '../utils/dom.js';
import { closeButton } from './components.js';

const ICONS = {
  info:    '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg>',
  error:   '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

// opts.action = { label, onClick } añade un botón (p. ej. "Revisar"); opts.ttl
// cambia cuánto dura. Sin opts, todo como siempre.
export function showToast(message, type = 'info', opts = {}) {
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

  // El mismo aviso que ya se ve no se apila: se reinicia su tiempo.
  for (const t of container.querySelectorAll('.toast:not(.toast--out)')) {
    if (t._key === `${type}|${message}` && t._restart) { t._restart(); return; }
  }

  const icon = ICONS[type] || ICONS.info;

  const toast = document.createElement('div');
  // El estilo por tipo vive en CSS (.toast--info/success/error/warning en
  // _modals.css) con los tokens del theme — nada de colores inline.
  toast.className = `toast toast--${type}`;
  if (type === 'error' || type === 'warning') toast.setAttribute('role', 'alert');
  const action = opts.action && opts.action.label ? `<button class="toast-action" type="button">${esc(opts.action.label)}</button>` : '';
  toast.innerHTML = `${icon}<span>${esc(message)}</span>${action}${closeButton({ cls: 'toast-close', small: true })}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--in'));

  const dismiss = () => {
    toast.classList.add('toast--out');
    setTimeout(() => toast.remove(), 300);
  };
  // Los errores duran más (se pierden si el director miraba el escenario) y
  // todos se pueden cerrar a mano con la ×.
  const ttl = opts.ttl || (type === 'error' || action ? 9000 : 4000);
  let timer = setTimeout(dismiss, ttl);
  toast._key = `${type}|${message}`;
  toast._dismiss = () => { clearTimeout(timer); dismiss(); };
  toast._restart = () => { clearTimeout(timer); timer = setTimeout(dismiss, ttl); };
  // Como mucho 2 a la vez (antes se apilaban encima de la consola o del mezclador): se va el
  // más antiguo, salvo que sea un error o un aviso importante (esos se quedan su tiempo).
  const live = [...container.querySelectorAll('.toast:not(.toast--out)')];
  if (live.length > 2) {
    const old = live.slice(0, -1).find((t) => !/toast--(error|warning)/.test(t.className)) || live[0];
    if (old && old !== toast && old._dismiss) old._dismiss();
  }
  const actBtn = toast.querySelector('.toast-action');
  if (actBtn) actBtn.onclick = () => { toast._dismiss(); try { opts.action.onClick(); } catch (_) {} };
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) closeBtn.onclick = () => toast._dismiss();
}

// Backwards-compatible global so legacy inline handlers still work.
if (typeof window !== 'undefined') window.showToast = showToast;
