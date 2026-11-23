// Buscador con el mismo diseño y comportamiento que el de la Librería de Pads:
// campo redondo con lupa, limpiar (×) y ayuda «?»; debajo, filtros rápidos en
// píldoras (añaden o quitan su filtro del texto, así lo escrito es siempre lo
// que se filtra) y el número de resultados. Las píldoras se ven al usar el
// buscador (foco o texto) y se esconden al dejarlo vacío.
//
//   searchBoxHtml({ placeholder, label, inputClass, chips: [[token, texto, title?]], extra })
//   bindSearchBox(rootEl, { onChange(value), help: [{ label, hint, tok? }] })
//     → { setCount(texto), set(value), get(), refresh() }

import { toggleToken, norm } from '../utils/songQuery.js';
import { openCardMoreMenu } from './cardMoreMenu.js';
import { esc } from '../utils/dom.js';

const ICON = '<svg class="lp-search-ico" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" width="15" height="15"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
const CLEAR = '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

export function searchBoxHtml({ placeholder, label, inputClass = '', inputAttrs = '', chips = [], extra = '' }) {
  return `
    <div class="lp-search-row">
      <div class="lp-search">
        ${ICON}
        <input type="text" class="lp-search-input ${inputClass}" ${inputAttrs} placeholder="${esc(placeholder)}" aria-label="${esc(label)}" spellcheck="false" autocomplete="off">
        <button type="button" class="lp-search-clear" data-sb="clear" hidden aria-label="Limpiar búsqueda" title="Limpiar búsqueda">${CLEAR}</button>
        <button type="button" class="lp-search-help" data-sb="help" aria-label="Cómo buscar" title="Cómo buscar">?</button>
      </div>
      ${extra}
    </div>
    <div class="lp-chips" data-sb="chips" hidden>
      ${chips.map(([tok, txt, title]) => `<button type="button" class="lp-chip" data-tok="${esc(tok)}"${title ? ` title="${esc(title)}"` : ''}>${esc(txt)}</button>`).join('')}
      <span class="lp-count" data-sb="count"></span>
    </div>`;
}

export function bindSearchBox(root, { onChange, help = [] }) {
  const input = root.querySelector('.lp-search-input');
  const clearBtn = root.querySelector('[data-sb="clear"]');
  const helpBtn = root.querySelector('[data-sb="help"]');
  const chips = root.querySelector('[data-sb="chips"]');
  const count = root.querySelector('[data-sb="count"]');
  if (!input) return null;

  const tokens = () => new Set(String(input.value).split(/\s+/).filter(Boolean).map(norm));
  const paint = () => {
    if (clearBtn) clearBtn.hidden = !input.value;
    const t = tokens();
    chips?.querySelectorAll('[data-tok]').forEach((b) => b.classList.toggle('is-on', t.has(norm(b.dataset.tok))));
    if (chips) chips.hidden = !(input.value || root.contains(document.activeElement) || document.querySelector('.card-more-menu'));
  };
  const apply = (v, focus = true) => {
    input.value = v;
    paint();
    onChange(v);
    if (focus) { input.focus(); input.setSelectionRange(v.length, v.length); }
  };

  input.addEventListener('input', () => { paint(); onChange(input.value); });
  input.addEventListener('focus', paint);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); apply(''); } });
  // Las píldoras y los botones no le quitan el foco al campo (si no, se esconderían al tocarlas).
  root.addEventListener('mousedown', (e) => { if (e.target.closest('.lp-chip, .lp-search-clear, .lp-search-help')) e.preventDefault(); });
  root.addEventListener('focusout', () => setTimeout(paint, 120));
  clearBtn?.addEventListener('click', () => apply(''));
  chips?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tok]');
    if (b) apply(toggleToken(input.value, b.dataset.tok));
  });
  helpBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const add = (tok) => () => { const v = input.value.trim(); apply((v ? v + ' ' : '') + tok); };
    openCardMoreMenu(helpBtn, [
      { sep: true, label: 'Escribe y combina' },
      ...help.map((h) => ({ label: h.label, hint: h.hint, onSelect: h.tok ? add(h.tok) : () => input.focus() })),
      { sep: true },
      { label: 'Esc limpia la búsqueda', onSelect: () => input.focus() },
    ]);
  });
  paint();

  return {
    setCount(text) { if (count) count.textContent = text || ''; },
    set(v) { apply(v, false); },
    get: () => input.value,
    refresh: paint,
  };
}
