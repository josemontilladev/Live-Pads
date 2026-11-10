// ═══ Componentes reutilizables (HTML) ═══════════════════════════════════════
// Botones que se repiten en toda la app. El aspecto y los efectos viven en
// src/css/modules/_components.css; aquí solo se arma el marcado, para que
// cualquier ventana nueva use exactamente el mismo botón.
//
//   closeButton({ label, cls, attrs, small })   → <button class="ui-close …">
//   removeButton({ label, cls, attrs })         → <button class="ui-remove …">
//   makeCloseButton({ label, small, onClick })  → HTMLButtonElement
//   uiButton({ text, icon, variant, size, on, title, cls, attrs }) → <button class="ui-btn …">
//   uiSeg(options, { value, accent, label, cls, btnCls, attrs })   → selector segmentado
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

/**
 * Botón de pastilla. variant: 'primary' | 'ghost' | '' · size: 'sm' | ''.
 * Sin texto (solo icono) → círculo; entonces title/aria-label son obligatorios.
 */
export function uiButton({ text = '', icon = '', variant = '', size = '', on = false, title = '', cls = '', attrs = {} } = {}) {
  const c = ['ui-btn', variant && `ui-btn--${variant}`, size && `ui-btn--${size}`, !text && icon && 'ui-btn--icon', on && 'is-on', cls].filter(Boolean).join(' ');
  const a = { title: title || null, 'aria-label': !text ? (title || null) : null, ...attrs };
  return `<button type="button" class="${c}"${attrsHtml(a)}>${icon}${text ? `<span>${text}</span>` : ''}</button>`;
}

/**
 * Selector segmentado. options: [{ value, text, title? }]. El botón elegido lleva
 * .is-on y aria-pressed; cada uno lleva data-value para leerlo al pulsar.
 */
export function uiSeg(options, { value, accent = false, label = '', cls = '', btnCls = '', attrs = {} } = {}) {
  const c = ['ui-seg', accent && 'ui-seg--accent', cls].filter(Boolean).join(' ');
  const btns = options.map((o) => {
    const on = o.value === value;
    const bc = ['ui-seg-btn', btnCls, on && 'is-on'].filter(Boolean).join(' ');
    return `<button type="button" class="${bc}" data-value="${escAttr(o.value)}" aria-pressed="${on}"${o.title ? ` title="${escAttr(o.title)}"` : ''}>${o.text}</button>`;
  }).join('');
  return `<div class="${c}" role="group"${label ? ` aria-label="${escAttr(label)}"` : ''}${attrsHtml(attrs)}>${btns}</div>`;
}
