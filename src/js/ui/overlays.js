// Small overlay/sidebar helpers. Decoupled from app.js's state — pure DOM
// class manipulation.

import { q, qa } from '../utils/dom.js';

// Open the sidebar and switch to a specific tab (settings/themes/about).
export function openSidebarTab(tab) {
  q('#sidebar').classList.add('open');
  qa('.stab').forEach(b => b.classList.remove('active'));
  qa('.stab-body').forEach(b => b.classList.remove('visible'));
  const stab = q(`.stab[data-tab="${tab}"]`);
  if (stab) stab.classList.add('active');
  const body = q(`#tab-${tab}`);
  if (body) body.classList.add('visible');
}

// Hide every floating overlay (hamburger menu, dialog, dead bank pickers).
// Idempotent — safe to call from any UI event without checking state.
export function closeAllOverlays() {
  const ids = ['#menu-popover', '#menu-overlay', '#dialog-overlay', '#pad-bank-picker', '#kit-bank-picker'];
  for (const id of ids) {
    const el = q(id);
    if (el) el.classList.add('hidden');
  }
}
