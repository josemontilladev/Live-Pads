// ═══ Componentes reutilizables (HTML) ═══════════════════════════════════════
// Botones que se repiten en toda la app. El aspecto y los efectos viven en
// src/css/modules/_components.css; aquí solo se arma el marcado, para que
// cualquier ventana nueva use exactamente el mismo botón.
//
//   closeButton({ label, cls, attrs, small })   → <button class="ui-close …">
//   removeButton({ label, cls, attrs })         → <button class="ui-remove …">
//   makeCloseButton({ label, small, onClick })  → HTMLButtonElement
//
// El icono X lo pinta el CSS (máscara), así todos son idénticos.

const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function attrsHtml(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join('');
}

export function closeButton({ label = 'Cerrar', cls = '', attrs = {}, small = false } = {}) {
  const c = ['ui-close', small ? 'ui-close--sm' : '', cls].filter(Boolean).join(' ');
  return `<button type="button" class="${c}" aria-label="${escAttr(label)}" title="${escAttr(label)}"${attrsHtml(attrs)}></button>`;
}

export function removeButton({ label = 'Quitar', cls = '', attrs = {} } = {}) {
  const c = ['ui-remove', cls].filter(Boolean).join(' ');
  return `<button type="button" class="${c}" aria-label="${escAttr(label)}" title="${escAttr(label)}"${attrsHtml(attrs)}></button>`;
}

export function makeCloseButton({ label = 'Cerrar', small = false, cls = '', onClick } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ['ui-close', small ? 'ui-close--sm' : '', cls].filter(Boolean).join(' ');
  b.setAttribute('aria-label', label);
  b.title = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
