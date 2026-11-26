// ─────────────────────────────────────────────────────────────────────────
// Cabecera: el logo en el centro también en pantallas medianas. Si a la derecha
// (cuenta, hora y herramientas) no cabe todo en su mitad, las herramientas
// menos usadas pasan a un menú «Más ⋯», de la menos a la más usada. En
// pantallas anchas se ven todas. Los botones no se mueven del DOM (atajos,
// MIDI y estados siguen igual): solo se ocultan y el menú los «pulsa».
// ─────────────────────────────────────────────────────────────────────────

import { openCardMoreMenu, closeCardMoreMenu } from './cardMoreMenu.js';

// De la primera en esconderse a la última. «Modo en vivo» y «Actualizaciones» siempre a la vista.
const ORDER = ['btn-chords-pads', 'btn-vocal', 'btn-tuner-pads', 'btn-piano-pads', 'btn-grooves', 'btn-metro-pads', 'btn-companion', 'btn-cues'];
const SVG_MORE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';

let more = null, raf = 0, mo = null;
const MO_OPTS = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] };

const visW = (el) => (el && el.offsetParent ? el.getBoundingClientRect().width : 0);
function sideWidth(container) {
  let w = 0;
  for (const c of container.children) {
    if (!c.offsetParent || getComputedStyle(c).position === 'absolute') continue;
    const cs = getComputedStyle(c);
    w += c.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  }
  const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
  return w + gap * Math.max(0, [...container.children].filter((c) => c.offsetParent).length - 1);
}

function layout() {
  raf = 0;
  // Lo que se cambia aquí (clases, «Más») no debe volver a disparar el observador.
  if (mo) mo.disconnect();
  try { doLayout(); } finally { if (mo) { mo.takeRecords(); mo.observe(document.getElementById('topbar'), MO_OPTS); } }
}
function doLayout() {
  const top = document.getElementById('topbar');
  const left = top && top.querySelector('.topbar-left');
  const right = top && top.querySelector('.topbar-right');
  const actions = top && top.querySelector('.topbar-actions');
  const logo = top && top.querySelector('.topbar-center');
  if (!top || !left || !right || !actions || !logo || !top.offsetParent) return;
  const btns = ORDER.map((id) => document.getElementById(id)).filter(Boolean);
  btns.forEach((b) => b.classList.remove('tb-over'));
  more.hidden = true;
  const cs = getComputedStyle(top);
  const inner = top.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const half = (inner - visW(logo)) / 2 - (parseFloat(cs.columnGap) || 0);
  const fits = () => Math.max(sideWidth(left), sideWidth(right)) <= half;
  // Se mide UNA vez y se calcula cuántas herramientas sobran (antes se volvía a medir
  // toda la cabecera tras esconder cada una: hasta 9 recálculos de página seguidos).
  const L = sideWidth(left);
  let R = sideWidth(right);
  if (Math.max(L, R) <= half) return;
  const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
  const ws = btns.map((b) => (b.offsetParent ? b.getBoundingClientRect().width + gap : 0));
  const moreW = (ws.find((w) => w > 0) || 36);
  let n = 0;
  R += moreW;
  while (n < btns.length && Math.max(L, R) > half) { R -= ws[n]; n++; }
  for (let i = 0; i < n; i++) btns[i].classList.add('tb-over');
  more.hidden = n === 0;
  // Comprobación final con la medida real (por si el cálculo se quedó corto).
  while (!fits() && n < btns.length) {
    btns[n].classList.add('tb-over');
    more.hidden = false;
    n++;
  }
}
const schedule = () => { if (!raf) raf = requestAnimationFrame(layout); };

function openMore() {
  const hidden = ORDER.map((id) => document.getElementById(id)).filter((b) => b && b.classList.contains('tb-over'));
  // En el orden en que aparecen en la barra.
  hidden.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  openCardMoreMenu(more, hidden.map((b) => ({
    label: b.getAttribute('aria-label') || b.title || 'Herramienta',
    hint: (b.title || '').split(/ — |: /)[1] || '',
    icon: (b.querySelector('svg') || {}).outerHTML || '',
    checked: b.getAttribute('aria-pressed') === 'true',
    onSelect: () => { closeCardMoreMenu(); b.click(); },
  })));
}

export function initTopbarOverflow() {
  const actions = document.querySelector('#topbar .topbar-actions');
  if (!actions || more) return;
  more = document.createElement('button');
  more.type = 'button';
  more.className = 'icon-btn tb-more';
  more.id = 'btn-topbar-more';
  more.title = 'Más herramientas';
  more.setAttribute('aria-label', 'Más herramientas');
  more.innerHTML = SVG_MORE;
  more.hidden = true;
  more.addEventListener('click', (e) => { e.stopPropagation(); openMore(); });
  // Justo antes de los botones de ventana (o al final de las herramientas).
  const last = document.getElementById('btn-chords-pads');
  if (last && last.parentElement === actions) last.after(more); else actions.append(more);
  window.addEventListener('resize', schedule);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(schedule);
    for (const el of document.querySelectorAll('#topbar .topbar-left, #topbar .topbar-left > *, #btn-account-chip, #topbar-clock')) ro.observe(el);
  }
  // Cambios que mueven anchos: modo en vivo, consumo que aparece, cuenta que cambia.
  mo = new MutationObserver(schedule);
  mo.observe(document.getElementById('topbar'), MO_OPTS);
  schedule();
  setTimeout(schedule, 1500);
}
