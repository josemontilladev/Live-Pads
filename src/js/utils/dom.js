// DOM helpers & HTML escaping shared across modules.
export const q  = (s) => document.querySelector(s);
export const qa = (s) => document.querySelectorAll(s);

// Escapes a user-controlled string for safe interpolation into innerHTML or
// double-quoted attributes.
export const escapeHtml = (s) => {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const esc = escapeHtml;

// Lightweight leading-edge debounce — same arg signature as standard debounce
// implementations. Returns a function that delays invocation by `delayMs`.
export const debounce = (fn, delayMs = 250) => {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
};
