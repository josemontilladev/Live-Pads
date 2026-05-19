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
  let container = q('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 10000; pointer-events: none;';
    document.body.appendChild(container);
  }

  const style = STYLES[type] || STYLES.info;
  const icon = ICONS[type] || ICONS.info;

  const toast = document.createElement('div');
  toast.style.cssText = `background: ${style.bg}; color: ${style.color}; border: ${style.border}; backdrop-filter: blur(8px); padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; box-shadow: 0 10px 25px rgba(0,0,0,0.3); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); display: flex; align-items: center; gap: 8px;`;
  toast.innerHTML = `${icon}<span>${esc(message)}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Backwards-compatible global so legacy inline handlers still work.
if (typeof window !== 'undefined') window.showToast = showToast;
